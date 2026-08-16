import { createHash } from "node:crypto";

export const DOCUMENT_IR_SCHEMA = "my-wiki.document-ir/v1";

export function createDocumentIr({
  filename = "",
  sourceHash = "",
  engine = "unknown",
  engineVersion = "",
  method = "",
  pages = [],
  blocks = [],
  assets = [],
  metadata = {},
  diagnostics = []
} = {}) {
  const normalizedPages = normalizePages(pages, blocks);
  return {
    schema: DOCUMENT_IR_SCHEMA,
    source: { filename: String(filename || ""), sha256: String(sourceHash || "") },
    producer: { engine: String(engine || "unknown"), version: String(engineVersion || ""), method: String(method || engine || "") },
    metadata: serializable(metadata),
    pages: normalizedPages,
    blocks: blocks.map((block, index) => normalizeBlock(block, index)),
    assets: assets.map((asset, index) => normalizeAsset(asset, index)),
    diagnostics: diagnostics.map(normalizeDiagnostic),
    generated_at: new Date().toISOString()
  };
}

export function documentIrFromMarkdown({ content = "", filename = "", sourceHash = "", engine = "unknown", engineVersion = "", method = "", pages = 0, assets = [], quality = null } = {}) {
  const sections = markdownPageSections(content);
  const pageEntries = sections.length
    ? sections
    : [{ page: pages > 0 ? 1 : 0, markdown: String(content || "").trim() }];
  const blocks = [];
  for (const section of pageEntries) {
    for (const [index, markdown] of splitMarkdownBlocks(section.markdown).entries()) {
      blocks.push({
        id: `page-${section.page || 0}-block-${index + 1}`,
        type: markdownBlockType(markdown),
        page: section.page || 0,
        order: blocks.length,
        markdown,
        text: markdownText(markdown),
        confidence: qualityScoreForPage(quality, section.page)
      });
    }
  }
  const totalPages = Math.max(Number(pages || 0), ...pageEntries.map((item) => item.page || 0), 0);
  return createDocumentIr({
    filename,
    sourceHash,
    engine,
    engineVersion,
    method,
    pages: Array.from({ length: totalPages }, (_, index) => ({ number: index + 1 })),
    blocks,
    assets,
    diagnostics: quality?.reasons || []
  });
}

export function markdownPageSections(content = "") {
  const value = String(content || "").trim();
  if (!value) return [];
  const expression = /^### Page (\d+)\s*$/gm;
  const matches = [...value.matchAll(expression)];
  if (!matches.length) return [];
  return matches.map((match, index) => {
    const start = Number(match.index) + match[0].length;
    const end = index + 1 < matches.length ? Number(matches[index + 1].index) : value.length;
    return { page: Number(match[1]), markdown: value.slice(start, end).trim() };
  });
}

export function replaceMarkdownPages(content, replacements = new Map()) {
  const sections = markdownPageSections(content);
  if (!sections.length || !replacements.size) return String(content || "");
  const prefixIndex = String(content || "").search(/^### Page \d+\s*$/m);
  const prefix = prefixIndex > 0 ? String(content).slice(0, prefixIndex).trimEnd() : "";
  const body = sections.map((section) => {
    const replacement = replacements.get(section.page);
    return `### Page ${section.page}\n\n${String(replacement ?? section.markdown).trim()}`;
  }).join("\n\n");
  return prefix ? `${prefix}\n\n${body}` : body;
}

export function documentIrDigest(ir) {
  return createHash("sha256").update(JSON.stringify(ir)).digest("hex");
}

function normalizePages(pages, blocks) {
  const provided = Array.isArray(pages) ? pages : [];
  const numbers = new Set(provided.map((page) => Number(page?.number ?? page)).filter((page) => Number.isInteger(page) && page > 0));
  for (const block of blocks) {
    const page = Number(block?.page || 0);
    if (Number.isInteger(page) && page > 0) numbers.add(page);
  }
  return [...numbers].sort((a, b) => a - b).map((number) => {
    const value = provided.find((page) => Number(page?.number ?? page) === number);
    return { number, width: numberOrNull(value?.width), height: numberOrNull(value?.height), image: String(value?.image || "") };
  });
}

function normalizeBlock(block, index) {
  return {
    id: String(block?.id || `block-${index + 1}`),
    type: String(block?.type || "text"),
    page: Number(block?.page || 0),
    order: Number.isFinite(Number(block?.order)) ? Number(block.order) : index,
    bbox: normalizeBbox(block?.bbox),
    text: String(block?.text || ""),
    markdown: String(block?.markdown || block?.text || ""),
    latex: String(block?.latex || ""),
    table: block?.table ? serializable(block.table) : null,
    asset_ref: String(block?.assetRef || block?.asset_ref || ""),
    confidence: numberOrNull(block?.confidence),
    provenance: serializable(block?.provenance || {})
  };
}

function normalizeAsset(asset, index) {
  return {
    id: String(asset?.id || `asset-${index + 1}`),
    reference: String(asset?.reference || ""),
    name: String(asset?.name || ""),
    page: Number(asset?.page || 0),
    mime_type: String(asset?.mimeType || asset?.mime_type || ""),
    status: String(asset?.status || "")
  };
}

function normalizeBbox(value) {
  if (!value || typeof value !== "object") return null;
  const left = numberOrNull(value.l ?? value.left ?? value.x);
  const top = numberOrNull(value.t ?? value.top ?? value.y);
  const right = numberOrNull(value.r ?? value.right);
  const bottom = numberOrNull(value.b ?? value.bottom);
  if ([left, top, right, bottom].every((item) => item === null)) return null;
  return { left, top, right, bottom, origin: String(value.coord_origin || value.origin || "") };
}

function normalizeDiagnostic(value) {
  return typeof value === "string" ? { code: value, severity: "warning", message: value } : serializable(value);
}

function splitMarkdownBlocks(value) {
  return String(value || "").split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}

function markdownBlockType(markdown) {
  if (/^#{1,6}\s/.test(markdown)) return "heading";
  if (/^\$\$[\s\S]*\$\$$/.test(markdown) || /^\\\[[\s\S]*\\\]$/.test(markdown)) return "formula";
  if (/^```/.test(markdown)) return "code";
  if (/^!\[[^\]]*\]\([^)]+\)/.test(markdown)) return "picture";
  if (/^\|.+\|\s*\n\|[-: |]+\|/.test(markdown)) return "table";
  if (/^(?:[-*+] |\d+\. )/m.test(markdown)) return "list";
  return "text";
}

function markdownText(markdown) {
  return String(markdown || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function qualityScoreForPage(quality, page) {
  const pageResult = quality?.pages?.find?.((item) => Number(item?.page) === Number(page));
  return numberOrNull(pageResult?.score ?? quality?.score);
}

function serializable(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
