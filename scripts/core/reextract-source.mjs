#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractLocalDocument } from "./document-extractor.mjs";
import { appendLog, asArray, scanVault, upsertFrontmatterValues, vaultPath } from "./wiki-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(here, "..", "..", "assets", "dashboard");

export async function reextractSources({ vault = vaultPath(), source = "", allFollowup = false, dependencyRoot = dashboardRoot } = {}) {
  const scan = await scanVault(vault);
  const normalizedSource = normalizeSourceReference(source);
  const candidates = scan.nodes.filter((node) => {
    if (!node.id.startsWith("raw/sources/")) return false;
    if (normalizedSource) return normalizeSourceReference(node.id) === normalizedSource || normalizeSourceReference(node.path) === normalizedSource;
    return allFollowup && node.status === "needs-followup" && String(node.frontmatter.snapshot_path || "").trim();
  });
  if (normalizedSource && candidates.length === 0) throw new Error(`Raw source not found: ${source}`);
  if (!normalizedSource && !allFollowup) throw new Error("Provide --source raw/sources/<note>.md or --all-followup.");

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
      cacheRoot: path.join(vault, ".my-wiki", "ocr-cache")
    });
    const updated = applyExtractionToRawNote(node.content, extracted);
    await fs.writeFile(node.file, updated, "utf8");
    await appendLog(`REEXTRACT_RAW source="${node.path}" status="${extracted.status}" method="${extracted.method}"`, vault);
    results.push({
      path: node.path,
      status: extracted.status === "complete" ? "inbox" : "needs-followup",
      extractionStatus: extracted.status,
      extractionMethod: extracted.method,
      extractedPages: extracted.pages,
      extractedCharacters: extracted.characters,
      extractionConfidence: extracted.confidence,
      extractionEngine: extracted.engine,
      extractionQuality: extracted.quality,
      message: extracted.message || ""
    });
  }
  return { vault, count: results.length, results };
}

export function applyExtractionToRawNote(content, extracted) {
  const complete = extracted.status === "complete";
  const existingTags = asArray(frontmatterValue(content, "tags"));
  const tags = [...new Set(existingTags.filter((tag) => tag !== "needs-followup"))];
  if (!complete) tags.push("needs-followup");
  let updated = upsertFrontmatterValues(content, {
    status: complete ? "inbox" : "needs-followup",
    needs_followup: !complete,
    followup_reasons: complete ? [] : [`extraction:${extracted.status}`],
    extraction_status: extracted.status,
    extraction_method: extracted.method,
    text_extraction: extracted.status,
    extracted_pages: Number(extracted.pages || 0),
    extracted_characters: Number(extracted.characters || 0),
    extracted_units: Number(extracted.units || extracted.pages || 0),
    extracted_unit_label: extracted.unitLabel || "items",
    extraction_confidence: Number(extracted.confidence || 0),
    extraction_engine: extracted.engine || extracted.method || "local-parser",
    extraction_quality: extracted.quality?.level || "unknown",
    extraction_quality_score: Number(extracted.quality?.score || 0),
    extraction_low_quality_pages: compactPageList(extracted.quality?.lowQualityPages),
    extraction_degraded_pages: compactPageList(extracted.quality?.degradedPages),
    extraction_formula_risk_pages: compactPageList(extracted.quality?.formulaRiskPages),
    extraction_repetitive_hallucination_pages: compactPageList(extracted.quality?.repetitiveHallucinationPages),
    tags
  });
  updated = replaceMarkdownSection(updated, "Capture", extracted.content || "");
  updated = updateProcessingNotes(updated, extracted, complete);
  return updated;
}

function compactPageList(pages) {
  return Array.isArray(pages) ? pages.slice(0, 100).join(",") : "";
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
  const reasons = complete ? "none" : `extraction:${extracted.status}`;
  const extraction = `- Content extraction: ${extracted.status} via ${extracted.method || "local-parser"} (${Number(extracted.characters || 0)} characters)`;
  let updated = content
    .replace(/^- Status: .*$/m, `- Status: ${status}`)
    .replace(/^- Follow-up reasons:.*$/m, `- Follow-up reasons: ${reasons}`);
  if (/^- Content extraction:.*$/m.test(updated)) return updated.replace(/^- Content extraction:.*$/m, extraction);
  return updated.replace(/^(## Processing Notes\s*)$/m, `$1\n${extraction}`);
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
