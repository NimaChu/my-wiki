#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractLocalDocument } from "./document-extractor.mjs";
import { materializeEmbeddedAssets } from "./capture-service.mjs";
import { compactPageRanges } from "./pdf-quality.mjs";
import { finalizeExtractionReport, persistExtractionArtifacts } from "./extraction-standard.mjs";
import { checkMarkdownFormulas, formulaGateBlocked, formulaGateFollowupReasons, shouldGateExtractedFormulas } from "./formula-gate.mjs";
import { unicodeReplacementFollowupReasons, unicodeReplacementNote, unicodeReplacementReport } from "./content-integrity.mjs";
import { appendLog, asArray, scanVault, upsertFrontmatterValues, vaultPath } from "./wiki-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(here, "..", "..", "assets", "dashboard");

export async function reextractSources({
  vault = vaultPath(),
  source = "",
  allFollowup = false,
  dependencyRoot = dashboardRoot,
  environment = process.env,
  agentRunner = null
} = {}) {
  const scan = await scanVault(vault);
  const normalizedSource = normalizeSourceReference(source);
  const candidates = scan.nodes.filter((node) => {
    if (!node.id.startsWith("references/sources/")) return false;
    if (normalizedSource) return normalizeSourceReference(node.id) === normalizedSource || normalizeSourceReference(node.path) === normalizedSource;
    return allFollowup && node.status === "needs-followup" && String(node.frontmatter.snapshot_path || "").trim();
  });
  if (normalizedSource && candidates.length === 0) throw new Error(`Raw source not found: ${source}`);
  if (!normalizedSource && !allFollowup) throw new Error("Provide --source references/sources/<note>.md or --all-followup.");

  const results = [];
  for (const node of candidates) {
    const snapshotReference = String(node.frontmatter.snapshot_path || "").trim();
    if (!snapshotReference) {
      results.push({ path: node.path, status: "skipped", message: "No snapshot_path is available." });
      continue;
    }
    const snapshot = safeVaultPath(vault, snapshotReference);
    const extracted = await extractLocalDocument({
      file: snapshot,
      filename: String(node.frontmatter.original_filename || path.basename(snapshot)),
      dependencyRoot,
      cacheRoot: path.join(vault, ".my-wiki", "ocr-cache"),
      environment,
      agentRunner
    });
    const rawBase = path.basename(node.file, ".md");
    const materialized = await materializeEmbeddedAssets({
      vault,
      notePath: node.file,
      rawBase,
      markdown: extracted.content || "",
      assets: Array.isArray(extracted.assets) ? extracted.assets : []
    });
    const indexedImages = await readIndexedPageAssets({ vault, notePath: node.file, rawBase });
    const restored = reinsertIndexedPageAssets(materialized.markdown, indexedImages);
    const formulaGate = shouldGateExtractedFormulas({ extractionMethod: extracted.method, extractionQuality: extracted.quality })
      ? await checkMarkdownFormulas(restored.content, { dependencyRoot, repairSafeDelimiters: true })
      : null;
    const finalContent = formulaGatedMarkdown(restored.content, formulaGate);
    const unicodeReplacementGate = unicodeReplacementReport(finalContent);
    const extractionArtifacts = await persistExtractionArtifacts({
      vault,
      rawBase,
      report: finalizeExtractionReport(extracted.extractionReport, { formulaGate, unicodeGate: unicodeReplacementGate }),
      document: extracted.document
    });
    const updated = applyExtractionToRawNote(node.content, {
      ...extracted,
      content: finalContent,
      assetCount: Math.max(indexedImages.length, materialized.copied),
      restoredAssetReferences: restored.inserted,
      formulaGate,
      unicodeReplacementGate,
      extractionArtifacts
    });
    await fs.writeFile(node.file, updated, "utf8");
    await appendLog(`REEXTRACT_RAW source="${node.path}" status="${extracted.status}" method="${extracted.method}"`, vault);
    results.push({
      path: node.path,
      status: extracted.status === "complete" && !formulaGateBlocked(formulaGate) && !unicodeReplacementGate.blocked ? "inbox" : "needs-followup",
      extractionStatus: extracted.status,
      extractionMethod: extracted.method,
      extractedPages: extracted.pages,
      extractedCharacters: extracted.characters,
      extractionConfidence: extracted.confidence,
      extractionEngine: extracted.engine,
      extractionQuality: extracted.quality,
      formulaGate,
      message: extracted.message || ""
    });
  }
  return { vault, count: results.length, results };
}

export function formulaGatedMarkdown(content, formulaGate) {
  return formulaGate?.markdown ?? content;
}

export function applyExtractionToRawNote(content, extracted) {
  const extractionComplete = extracted.status === "complete";
  const formulaReasons = formulaGateFollowupReasons(extracted.formulaGate);
  const unicodeReplacementGate = extracted.unicodeReplacementGate || unicodeReplacementReport(extracted.content || "");
  const encodingReasons = unicodeReplacementFollowupReasons(unicodeReplacementGate);
  const complete = extractionComplete && formulaReasons.length === 0 && encodingReasons.length === 0;
  const visualReasons = extracted.quality?.missingVisualEvidencePages?.length
    ? [`missing-visual-evidence:pages=${compactPageList(extracted.quality.missingVisualEvidencePages)}`]
    : [];
  const existingTags = asArray(frontmatterValue(content, "tags"));
  const tags = [...new Set(existingTags.filter((tag) => tag !== "needs-followup"))];
  if (!complete) tags.push("needs-followup");
  if (Number(extracted.assetCount || 0) > 0 && !tags.includes("images")) tags.push("images");
  let updated = upsertFrontmatterValues(content, {
    workflow_status: complete ? "inbox" : "needs-followup",
    needs_followup: !complete,
    followup_reasons: complete
      ? []
      : [...visualReasons, ...(!extractionComplete ? [`extraction:${extracted.status}`] : []), ...formulaReasons, ...encodingReasons],
    extraction_status: extracted.status,
    extraction_method: extracted.method,
    text_extraction: extracted.status,
    extracted_pages: Number(extracted.pages || 0),
    extracted_characters: Number(extracted.characters || 0),
    extracted_units: Number(extracted.units || extracted.pages || 0),
    extracted_unit_label: extracted.unitLabel || "items",
    extraction_confidence: Number(extracted.confidence || 0),
    extraction_engine: extracted.engine || extracted.method || "local-parser",
    extraction_report: extracted.extractionArtifacts?.reportPath || "",
    extraction_document_ir: extracted.extractionArtifacts?.documentPath || "",
    extraction_quality: extracted.quality?.level || "unknown",
    extraction_quality_score: Number(extracted.quality?.score || 0),
    extraction_low_quality_pages: compactPageList(extracted.quality?.lowQualityPages),
    extraction_degraded_pages: compactPageList(extracted.quality?.degradedPages),
    extraction_missing_visual_pages: compactPageList(extracted.quality?.missingVisualEvidencePages),
    extraction_rendered_visual_pages: compactPageList(extracted.quality?.preservedVisualEvidencePages),
    extraction_unicode_replacement_pages: compactPageList(unicodeReplacementGate.pages),
    extraction_unicode_replacement_count: Number(unicodeReplacementGate.count || 0),
    extraction_formula_risk_pages: compactPageList(extracted.quality?.formulaRiskPages),
    extraction_formula_syntax_error_pages: compactPageList(extracted.formulaGate?.syntaxErrorPages),
    extraction_formula_strict_warning_pages: compactPageList(extracted.formulaGate?.strictWarningPages),
    extraction_formula_repair_pages: compactPageList(extracted.formulaGate?.repairPages),
    extraction_formula_syntax_error_count: Number(extracted.formulaGate?.errors?.length || 0),
    extraction_formula_strict_warning_count: Number(extracted.formulaGate?.strictWarnings?.length || 0),
    extraction_repetitive_hallucination_pages: compactPageList(extracted.quality?.repetitiveHallucinationPages),
    extraction_suppressed_hallucination_pages: compactPageList(extracted.quality?.suppressedHallucinationPages),
    extraction_blank_pages: compactPageList(extracted.quality?.blankPages),
    extraction_showthrough_pages: compactPageList(extracted.quality?.showthroughPages),
    extraction_visual_review_pages: compactPageList(extracted.quality?.visualReviewPages),
    tags
  });
  updated = replaceMarkdownSection(updated, "Capture", extracted.content || "");
  updated = updateProcessingNotes(updated, extracted, complete);
  return updated;
}

function compactPageList(pages) {
  return Array.isArray(pages) ? compactPageRanges(pages, 0) : "";
}

function frontmatterValue(content, key) {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return [];
  const lines = block[1].split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return [];
  const inline = lines[index].slice(key.length + 1).trim();
  if (inline) return inline === "[]" ? [] : [inline.replace(/^['"]|['"]$/g, "")];
  const values = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const match = lines[cursor].match(/^\s+-\s+["']?(.*?)["']?\s*$/);
    if (!match) break;
    values.push(match[1]);
  }
  return values;
}

function replaceMarkdownSection(content, heading, body) {
  const marker = content.match(new RegExp(`^## ${escapeRegex(heading)}\\s*$`, "m"));
  if (!marker || marker.index === undefined) return `${content.trimEnd()}\n\n## ${heading}\n\n${body.trim()}\n`;
  const bodyStart = marker.index + marker[0].length;
  const tail = content.slice(bodyStart);
  const nextHeading = tail.search(/^##\s+/m);
  const bodyEnd = nextHeading < 0 ? content.length : bodyStart + nextHeading;
  return `${content.slice(0, bodyStart)}\n\n${body.trim()}\n\n${content.slice(bodyEnd).replace(/^\s+/, "")}`;
}

function updateProcessingNotes(content, extracted, complete) {
  const status = complete ? "inbox" : "needs-followup";
  const formulaReasons = formulaGateFollowupReasons(extracted.formulaGate);
  const unicodeReplacementGate = extracted.unicodeReplacementGate || unicodeReplacementReport(extracted.content || "");
  const encodingReasons = unicodeReplacementFollowupReasons(unicodeReplacementGate);
  const reasons = complete
    ? "none"
    : [...(extracted.status !== "complete" ? [`extraction:${extracted.status}`] : []), ...formulaReasons, ...encodingReasons].join("; ");
  const warnings = [...new Set((Array.isArray(extracted.warnings) ? extracted.warnings : []).map(String).filter(Boolean))];
  const deterministic = [
    `- Status: ${status}`,
    `- Follow-up reasons: ${reasons}`,
    `- Content extraction: ${extracted.status} via ${extracted.method || "local-parser"} (${Number(extracted.characters || 0)} characters)`,
    `- Formula gate: ${formulaGateBlocked(extracted.formulaGate) ? `blocked (${Number(extracted.formulaGate?.errors?.length || 0)} syntax errors, ${Number(extracted.formulaGate?.strictWarnings?.length || 0)} strict warnings)` : "passed"}; checked ${Number(extracted.formulaGate?.checked || 0)}, safely repaired ${Number(extracted.formulaGate?.repairs?.length || 0)}`,
    `- Encoding gate: ${unicodeReplacementNote(unicodeReplacementGate)}`,
    ...(warnings.length ? [`- Extraction warnings: ${warnings.join("; ")}`] : []),
    `- Embedded local assets: ${Number(extracted.assetCount || 0)}`
  ];
  const marker = content.match(/^## Processing Notes\s*$/m);
  if (!marker || marker.index === undefined) return `${content.trimEnd()}\n\n## Processing Notes\n\n${deterministic.join("\n")}\n`;
  const bodyStart = marker.index + marker[0].length;
  const tail = content.slice(bodyStart);
  const nextHeading = tail.search(/^##\s+/m);
  const bodyEnd = nextHeading < 0 ? content.length : bodyStart + nextHeading;
  const preserved = content.slice(bodyStart, bodyEnd)
    .split(/\r?\n/)
    .filter((line) => !/^-(?: Status| Follow-up reasons| Content extraction| Formula(?: syntax)? gate| Encoding gate| Extraction warnings| Embedded local assets):/.test(line))
    .join("\n")
    .trim();
  const replacement = `${marker[0]}\n\n${deterministic.join("\n")}${preserved ? `\n${preserved}` : ""}\n\n`;
  return `${content.slice(0, marker.index)}${replacement}${content.slice(bodyEnd).replace(/^\s+/, "")}`;
}

export function reinsertIndexedPageAssets(content, images = []) {
  let updated = String(content || "");
  let inserted = 0;
  for (const image of images) {
    const page = Number(image?.page || 0);
    const reference = String(image?.local_note_path || "").trim();
    if (!Number.isInteger(page) || page <= 0 || !reference || updated.includes(`](${reference})`)) continue;
    const expression = new RegExp(`(^### Page ${page}[ \\t]*$)`, "m");
    if (!expression.test(updated)) continue;
    const alt = String(image?.alt || `PDF Page ${page} image`).replace(/[\[\]]/g, "");
    updated = updated.replace(expression, `$1\n\n![${alt}](${reference})`);
    inserted += 1;
  }
  return { content: updated, inserted };
}

async function readIndexedPageAssets({ vault, notePath, rawBase }) {
  const indexFile = path.join(vault, "references", "assets", rawBase, "image-index.json");
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(indexFile, "utf8"));
  } catch {
    return [];
  }
  const output = [];
  for (const image of Array.isArray(parsed?.images) ? parsed.images : []) {
    const page = Number(image?.page || 0);
    const localNotePath = String(image?.local_note_path || "").trim();
    const localPath = String(image?.local_path || "").trim();
    if (!Number.isInteger(page) || page <= 0 || (!localNotePath && !localPath)) continue;
    const resolved = localPath ? path.resolve(vault, localPath) : path.resolve(path.dirname(notePath), decodeReference(localNotePath));
    const relative = path.relative(vault, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      await fs.access(resolved);
    } catch {
      continue;
    }
    output.push({ ...image, page, local_note_path: localNotePath || portableReference(path.relative(path.dirname(notePath), resolved)) });
  }
  return output;
}

function decodeReference(value) {
  try {
    return decodeURIComponent(String(value || "").split("#")[0].split("?")[0]);
  } catch {
    return String(value || "").split("#")[0].split("?")[0];
  }
}

function portableReference(value) {
  return String(value || "").replace(/\\/g, "/").split("/").map((part) => part === "." || part === ".." ? part : encodeURIComponent(part)).join("/");
}

function safeVaultPath(vault, reference) {
  const resolved = path.resolve(vault, reference);
  const relative = path.relative(vault, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe snapshot path: ${reference}`);
  return resolved;
}

function normalizeSourceReference(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/, "");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const sourceIndex = process.argv.indexOf("--source");
  const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] || "" : "";
  console.log(JSON.stringify(await reextractSources({ source, allFollowup: process.argv.includes("--all-followup") }), null, 2));
}
