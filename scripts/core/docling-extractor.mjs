import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDocumentIr } from "./document-ir.mjs";
import { cleanExternalError, commandAvailable, runExternalCommand } from "./external-tool.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridge = path.resolve(here, "..", "python", "docling_bridge.py");

export async function extractDocumentWithDocling({ file, filename = path.basename(file), environment = process.env, cacheRoot = "", onProgress = null } = {}) {
  const mode = String(environment.MY_WIKI_DOCLING_MODE || "auto").trim().toLowerCase();
  if (mode === "off" || mode === "disabled" || mode === "0") return unavailable("Docling is disabled by MY_WIKI_DOCLING_MODE.");
  const python = await doclingPython(environment);
  if (!python) return unavailable("Docling is not installed. Run npm run document:setup or set MY_WIKI_DOCLING_PYTHON.");
  const root = await fs.mkdtemp(path.join(cacheRoot || os.tmpdir(), "my-wiki-docling-"));
  const output = path.join(root, "conversion.json");
  const timeout = Math.max(60_000, Number(environment.MY_WIKI_DOCLING_TIMEOUT_MS || 4 * 60 * 60 * 1000));
  try {
    onProgress?.({ phase: "docling", percent: null, message: "Docling is analyzing document structure." });
    const result = await runExternalCommand(python, [bridge, file, output], { environment, timeout });
    if (result.code !== 0) return failed(`Docling failed (${result.code}): ${cleanExternalError(result.stderr || result.stdout)}`);
    const payload = JSON.parse(await fs.readFile(output, "utf8"));
    const markdown = String(payload.markdown || "").trim();
    if (!markdown) return failed("Docling completed without readable Markdown output.");
    const document = doclingDocumentToIr(payload.document, { filename, markdown, confidence: payload.confidence });
    const pageCount = Math.max(Number(payload.pages || 0), document.pages.length);
    const confidence = doclingConfidence(payload.confidence);
    const quality = doclingQuality(payload.confidence, pageCount);
    const warnings = (payload.errors || []).map((item) => cleanExternalError(item?.error_message || item?.message || JSON.stringify(item))).filter(Boolean);
    onProgress?.({ phase: "docling", current: pageCount, total: pageCount, percent: 88, message: "Docling structure extraction complete." });
    return {
      status: quality.level === "poor" ? "low-quality" : "complete",
      method: "docling",
      engine: "docling",
      content: `> Parsed locally with Docling. The preserved original remains the layout reference.\n\n${markdown}`,
      pages: pageCount,
      characters: meaningfulCharacterCount(markdown),
      units: pageCount || 1,
      unitLabel: pageCount ? "pages" : "documents",
      confidence,
      quality,
      warnings,
      assets: [],
      document,
      message: warnings.join("; ")
    };
  } catch (error) {
    return failed(`Docling extraction failed: ${cleanExternalError(error?.message || error)}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

export async function doclingAvailable(environment = process.env) {
  return Boolean(await doclingPython(environment));
}

export function doclingDocumentToIr(document, { filename = "", markdown = "", confidence = null } = {}) {
  const blocks = [];
  const ordered = orderedDoclingItems(document);
  for (const [index, item] of ordered.entries()) {
    const provenance = Array.isArray(item?.prov) ? item.prov[0] : null;
    const type = doclingType(item?.label);
    const text = String(item?.text || item?.orig || "").trim();
    blocks.push({
      id: String(item?.self_ref || `docling-${index + 1}`),
      type,
      page: Number(provenance?.page_no || 0),
      order: index,
      bbox: provenance?.bbox || null,
      text,
      markdown: doclingMarkdown(type, text),
      table: type === "table" ? item?.data || null : null,
      confidence: Number(item?.confidence ?? confidence?.mean_score ?? confidence?.mean_grade_score) || null,
      provenance: { charspan: provenance?.charspan || null, source: "docling" }
    });
  }
  const pages = Object.entries(document?.pages || {}).map(([number, page]) => ({ number: Number(number), width: page?.size?.width, height: page?.size?.height }));
  if (!blocks.length && markdown) blocks.push({ id: "docling-markdown", type: "document", page: pages.length ? 1 : 0, order: 0, text: markdown, markdown, provenance: { source: "docling-markdown" } });
  return createDocumentIr({ filename, engine: "docling", method: "docling", pages, blocks, metadata: { name: document?.name || "", origin: document?.origin || null } });
}

async function doclingPython(environment) {
  const configured = String(environment.MY_WIKI_DOCLING_PYTHON || "").trim();
  const candidates = configured ? [configured] : process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const command of candidates) {
    if (await commandAvailable(command, ["-c", "import docling,sys;sys.stdout.write('ok')"], { environment })) return command;
  }
  if (await commandAvailable("uv", ["--version"], { environment })) {
    const toolDir = await runExternalCommand("uv", ["tool", "dir"], { environment, timeout: 15_000 }).catch(() => null);
    const root = String(toolDir?.stdout || "").trim();
    const command = root
      ? path.join(root, "docling", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python")
      : "";
    if (command && await commandAvailable(command, ["-c", "import docling,sys;sys.stdout.write('ok')"], { environment })) return command;
  }
  return "";
}

function orderedDoclingItems(document) {
  const collections = [document?.texts, document?.tables, document?.pictures, document?.key_value_items, document?.form_items]
    .flatMap((items) => Array.isArray(items) ? items : []);
  const byReference = new Map(collections.map((item) => [String(item?.self_ref || ""), item]).filter(([reference]) => reference));
  const ordered = [];
  const visited = new Set();
  const visit = (node) => {
    const reference = String(node?.$ref || node?.cref || node?.self_ref || "");
    const item = byReference.get(reference);
    if (item && !visited.has(reference)) {
      visited.add(reference);
      ordered.push(item);
      for (const child of item.children || []) visit(child);
      return;
    }
    for (const child of node?.children || []) visit(child);
  };
  visit(document?.body || {});
  for (const item of collections) {
    const reference = String(item?.self_ref || "");
    if (!reference || !visited.has(reference)) ordered.push(item);
  }
  return ordered;
}

function doclingType(label) {
  const value = String(label || "text").toLowerCase();
  if (value.includes("title") || value.includes("section_header")) return "heading";
  if (value.includes("formula")) return "formula";
  if (value.includes("code")) return "code";
  if (value.includes("table")) return "table";
  if (value.includes("picture")) return "picture";
  if (value.includes("list")) return "list";
  return "text";
}

function doclingMarkdown(type, text) {
  if (!text) return "";
  if (type === "heading") return `## ${text.replace(/^#+\s*/, "")}`;
  if (type === "formula") return text.startsWith("$") ? text : `$$\n${text}\n$$`;
  if (type === "code") return `\`\`\`\n${text}\n\`\`\``;
  return text;
}

function doclingConfidence(value) {
  const score = Number(value?.mean_score ?? value?.mean ?? value?.ocr_score ?? 0);
  return score > 0 && score <= 1 ? Math.round(score * 100) : Math.round(score || 0);
}

function doclingQuality(value, pages) {
  const grade = String(value?.mean_grade || value?.low_grade || "").toLowerCase();
  const score = doclingConfidence(value);
  const level = grade === "poor" || (score > 0 && score < 50) ? "poor" : grade === "fair" || (score > 0 && score < 72) ? "degraded" : "good";
  return { level, score, totalPages: pages, lowQualityPages: [], degradedPages: [], formulaRiskPages: [], visualReviewPages: [], reasons: grade ? [`docling-confidence:${grade}`] : [] };
}

function meaningfulCharacterCount(value) {
  return (String(value || "").match(/[\p{L}\p{N}\u3400-\u9fff]/gu) || []).length;
}

function unavailable(message) {
  return { status: "unavailable", method: "docling", engine: "docling", content: "", pages: 0, characters: 0, units: 0, unitLabel: "items", confidence: 0, quality: null, assets: [], warnings: [], message };
}

function failed(message) {
  return { ...unavailable(message), status: "failed" };
}
