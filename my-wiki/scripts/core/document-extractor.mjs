import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractPdfMarkdown } from "./pdf-text.mjs";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".csv", ".json", ".xml", ".html", ".htm", ".yaml", ".yml"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"]);
const LEGACY_OFFICE_EXTENSIONS = new Set([".doc", ".ppt", ".xls"]);
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
const MIN_MEANINGFUL_CHARACTERS = 24;
const DEFAULT_MIN_OCR_CONFIDENCE = 40;

export function sourceTypeForLocalFile(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(extension) || extension === ".svg") return "image";
  if ([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(extension)) return "document";
  if ([".md", ".markdown", ".txt", ".yaml", ".yml"].includes(extension)) return "note";
  if ([".html", ".htm"].includes(extension)) return "webpage";
  return "file";
}

export function fileNeedsReadableExtraction(filename) {
  const extension = path.extname(filename).toLowerCase();
  return extension === ".pdf" || IMAGE_EXTENSIONS.has(extension) || extension === ".svg" ||
    [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(extension) || TEXT_EXTENSIONS.has(extension);
}

export function extractionFromText(value, method = "plain-text") {
  return extractPlainText(value, method);
}

export async function extractLocalDocument({ file, filename = path.basename(file), dependencyRoot, cacheRoot = "" }) {
  const extension = path.extname(filename).toLowerCase();
  const stat = await fs.stat(file);
  if (stat.size > Number(process.env.MY_WIKI_EXTRACTION_LIMIT_BYTES || DEFAULT_MAX_BYTES)) {
    return failure("skipped-large", "size-limit", `Content extraction is limited to ${Math.round(DEFAULT_MAX_BYTES / 1024 / 1024)} MB.`);
  }

  try {
    if (TEXT_EXTENSIONS.has(extension)) return extractPlainText(await fs.readFile(file, "utf8"));
    if (extension === ".pdf") return extractPdfWithOcrFallback({ file, dependencyRoot, cacheRoot });
    if (IMAGE_EXTENSIONS.has(extension)) return extractImageOcr({ file, dependencyRoot, cacheRoot });
    if (extension === ".svg") return extractSvgText(await fs.readFile(file, "utf8"));
    if (extension === ".docx") return extractDocx({ file, dependencyRoot });
    if (extension === ".pptx") return extractPptx({ file, dependencyRoot });
    if (extension === ".xlsx") return extractXlsx({ file, dependencyRoot });
    if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
      return failure("unavailable", "legacy-office", `Legacy ${extension.slice(1).toUpperCase()} files must be converted to the modern Office Open XML format before local extraction.`);
    }
    return failure("unavailable", "unsupported-binary", `No deterministic local parser is available for ${extension || "this file type"}.`);
  } catch (error) {
    return failure("failed", methodForExtension(extension), cleanError(error));
  }
}

async function extractPdfWithOcrFallback({ file, dependencyRoot, cacheRoot }) {
  const parsed = await extractPdfMarkdown({ file, dependencyRoot });
  if (parsed.status === "complete" && isMeaningful(parsed.content)) {
    return success({ ...parsed, method: "pdf-text", units: parsed.pages, unitLabel: "pages" });
  }
  return extractScannedPdfOcr({ file, dependencyRoot, cacheRoot, parserMessage: parsed.message });
}

async function extractScannedPdfOcr({ file, dependencyRoot, cacheRoot, parserMessage = "" }) {
  const require = dependencyRequire(dependencyRoot);
  const canvasRuntime = require("@napi-rs/canvas");
  globalThis.DOMMatrix ||= canvasRuntime.DOMMatrix;
  globalThis.Path2D ||= canvasRuntime.Path2D;
  globalThis.ImageData ||= canvasRuntime.ImageData;
  const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const bytes = await fs.readFile(file);
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, useSystemFonts: true }).promise;
  const maxPages = Math.max(1, Number(process.env.MY_WIKI_OCR_MAX_PDF_PAGES || 120));
  if (document.numPages > maxPages) {
    return failure("skipped-large", "pdf-ocr", `The PDF has ${document.numPages} pages; automatic OCR is limited to ${maxPages} pages. Increase MY_WIKI_OCR_MAX_PDF_PAGES to process it locally.`, { pages: document.numPages });
  }

  const worker = await createOcrWorker({ dependencyRoot, cacheRoot });
  const sections = [];
  const confidences = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: Number(process.env.MY_WIKI_OCR_PDF_SCALE || 1.8) });
      const canvas = canvasRuntime.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const recognized = await worker.recognize(canvas.toBuffer("image/png"));
      const text = normalizeText(recognized.data?.text || "");
      sections.push(`### Page ${pageNumber}\n\n${text || "_No text recognized on this page._"}`);
      if (text && Number.isFinite(Number(recognized.data?.confidence))) confidences.push(Number(recognized.data.confidence));
    }
  } finally {
    await worker.terminate();
    await document.destroy();
  }

  const content = `> Text recovered locally with OCR from ${sections.length} scanned PDF pages. The preserved PDF remains the layout reference.\n\n${sections.join("\n\n")}`;
  const characters = meaningfulCharacterCount(sections.join("\n"));
  const confidence = average(confidences);
  if (characters < MIN_MEANINGFUL_CHARACTERS || confidence < minimumOcrConfidence()) {
    const message = `OCR output did not meet the readable-evidence threshold (${round(confidence)} confidence).${parserMessage ? ` Initial text extraction: ${parserMessage}` : ""}`;
    return failure("unavailable", "pdf-ocr", message, { content, pages: sections.length, characters, confidence });
  }
  return success({ content, method: "pdf-ocr", pages: sections.length, units: sections.length, unitLabel: "pages", characters, confidence });
}

async function extractImageOcr({ file, dependencyRoot, cacheRoot }) {
  const worker = await createOcrWorker({ dependencyRoot, cacheRoot });
  try {
    const recognized = await worker.recognize(file);
    const text = normalizeText(recognized.data?.text || "");
    const confidence = Number(recognized.data?.confidence || 0);
    if (!isMeaningful(text) || confidence < minimumOcrConfidence()) {
      return failure("unavailable", "image-ocr", `OCR output did not meet the readable-evidence threshold (${round(confidence)} confidence). A vision-capable agent must review the preserved image.`, {
        content: text ? `> Partial local OCR output follows. It is not reliable enough for automatic maintenance.\n\n${text}` : "",
        characters: meaningfulCharacterCount(text),
        confidence
      });
    }
    return success({
      content: `> Text recovered locally with OCR. The preserved image remains the visual reference.\n\n${text}`,
      method: "image-ocr",
      characters: meaningfulCharacterCount(text),
      confidence,
      units: 1,
      unitLabel: "images"
    });
  } finally {
    await worker.terminate();
  }
}

async function createOcrWorker({ dependencyRoot, cacheRoot }) {
  const { createWorker } = dependencyRequire(dependencyRoot)("tesseract.js");
  const languages = String(process.env.MY_WIKI_OCR_LANGS || "eng+chi_sim").split(/[+,]/).map((value) => value.trim()).filter(Boolean);
  const resolvedCache = cacheRoot || path.join(dependencyRoot, ".ocr-cache");
  await fs.mkdir(resolvedCache, { recursive: true });
  return createWorker(languages, 1, { cachePath: resolvedCache, logger: () => {} });
}

async function extractDocx({ file, dependencyRoot }) {
  const require = dependencyRequire(dependencyRoot);
  const mammoth = require("mammoth");
  const assets = [];
  let imageIndex = 0;
  const result = await mammoth.convertToMarkdown({ path: file }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      imageIndex += 1;
      const extension = extensionForContentType(image.contentType);
      const reference = `my-wiki-asset:docx-image-${imageIndex}${extension}`;
      assets.push({ reference, name: `image-${String(imageIndex).padStart(2, "0")}${extension}`, buffer: Buffer.from(await image.read("base64"), "base64") });
      return { src: reference };
    })
  });
  const markdown = normalizeText(result.value);
  if (!isMeaningful(markdown)) return failure("unavailable", "docx-markdown", "The DOCX did not contain substantive readable text.");
  const warnings = (result.messages || []).map((item) => String(item.message || item)).filter(Boolean);
  return success({ content: markdown, method: "docx-markdown", characters: meaningfulCharacterCount(markdown), units: 1, unitLabel: "documents", assets, warnings });
}

async function extractPptx({ file, dependencyRoot }) {
  const require = dependencyRequire(dependencyRoot);
  const JSZip = require("jszip");
  const { XMLParser } = require("fast-xml-parser");
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: false });
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(naturalOfficeOrder);
  const sections = [];

  for (let index = 0; index < slideNames.length; index += 1) {
    const xml = await zip.file(slideNames[index]).async("string");
    const root = parser.parse(xml);
    const lines = uniqueNonempty(findValuesByKey(root, "sp").flatMap((shape) => findValuesByKey(shape, "p")).map(paragraphText));
    const tables = findValuesByKey(root, "tbl").map(markdownTableFromPptx).filter(Boolean);
    const body = [...lines.map((line) => `- ${escapeMarkdownLine(line)}`), ...tables].join("\n\n");
    sections.push(`## Slide ${index + 1}\n\n${body || "_No readable text on this slide._"}`);
  }

  const assets = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^ppt\/media\/[^/]+$/i.test(entry)).sort()) {
    assets.push({ reference: `my-wiki-asset:${name}`, name: path.posix.basename(name), buffer: await zip.file(name).async("nodebuffer") });
  }
  const content = sections.join("\n\n");
  if (!isMeaningful(content.replace(/_No readable text on this slide\._/g, ""))) {
    return failure("unavailable", "pptx-markdown", "The PPTX did not contain substantive readable text. Embedded images were preserved in the original presentation.", { pages: slideNames.length });
  }
  return success({ content, method: "pptx-markdown", pages: slideNames.length, characters: meaningfulCharacterCount(content), units: slideNames.length, unitLabel: "slides", assets });
}

async function extractXlsx({ file, dependencyRoot }) {
  const readExcelFile = dependencyRequire(dependencyRoot)("read-excel-file/node").default;
  const workbook = await readExcelFile(file);
  const sections = [];
  let populatedCells = 0;
  for (const worksheet of workbook) {
    const rows = worksheet.data
      .map((row) => row.map(excelCellText))
      .map((row) => {
        while (row.length && !row.at(-1)) row.pop();
        return row;
      })
      .filter((row) => row.some(Boolean));
    const maxColumns = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    populatedCells += rows.reduce((count, row) => count + row.filter(Boolean).length, 0);
    if (!rows.length) {
      sections.push(`## ${escapeMarkdownLine(worksheet.sheet)}\n\n_Empty worksheet._`);
      continue;
    }
    const normalized = rows.map((row) => Array.from({ length: maxColumns }, (_, index) => escapeTableCell(row[index] || "")));
    const header = normalized[0];
    const bodyRows = normalized.slice(1);
    const table = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...bodyRows.map((row) => `| ${row.join(" | ")} |`)
    ].join("\n");
    sections.push(`## ${escapeMarkdownLine(worksheet.sheet)}\n\n${table}`);
  }
  const content = sections.join("\n\n");
  if (populatedCells === 0) return failure("unavailable", "xlsx-markdown", "The XLSX did not contain any populated cells.");
  return success({ content, method: "xlsx-markdown", characters: meaningfulCharacterCount(content), units: workbook.length, unitLabel: "worksheets" });
}

function extractPlainText(value, method = "plain-text") {
  const content = normalizeText(value);
  if (!isMeaningful(content)) return failure("unavailable", method, "The uploaded text file is empty or contains no substantive text.");
  return success({ content, method, characters: meaningfulCharacterCount(content), units: 1, unitLabel: "documents" });
}

function extractSvgText(value) {
  const text = normalizeText(String(value).replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"));
  if (!isMeaningful(text)) return failure("unavailable", "svg-text", "The SVG contains no substantive accessible text. A vision-capable agent must review the preserved image.");
  return success({ content: `> Accessible text extracted locally from SVG. The preserved image remains the visual reference.\n\n${text}`, method: "svg-text", characters: meaningfulCharacterCount(text), units: 1, unitLabel: "images" });
}

function success({ content, method, pages = 0, characters = 0, units = 0, unitLabel = "items", confidence = 0, assets = [], warnings = [] }) {
  return { status: "complete", method, content, pages, characters: characters || meaningfulCharacterCount(content), units, unitLabel, confidence: round(confidence), assets, warnings, message: warnings.join("; ") };
}

function failure(status, method, message, values = {}) {
  return {
    status,
    method,
    content: values.content || `> ${message} The original file is preserved. Keep this source in needs-followup until readable evidence is available.`,
    pages: Number(values.pages || 0),
    characters: Number(values.characters || 0),
    units: Number(values.units || values.pages || 0),
    unitLabel: values.unitLabel || "items",
    confidence: round(values.confidence || 0),
    assets: [],
    warnings: [],
    message
  };
}

function dependencyRequire(root) {
  return createRequire(path.resolve(root, "package.json"));
}

function methodForExtension(extension) {
  if (extension === ".pdf") return "pdf-ocr";
  if (IMAGE_EXTENSIONS.has(extension)) return "image-ocr";
  if (extension === ".docx") return "docx-markdown";
  if (extension === ".pptx") return "pptx-markdown";
  if (extension === ".xlsx") return "xlsx-markdown";
  return "local-parser";
}

function findValuesByKey(value, key, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) findValuesByKey(item, key, output);
    return output;
  }
  for (const [name, child] of Object.entries(value)) {
    if (name === key) output.push(...(Array.isArray(child) ? child : [child]));
    findValuesByKey(child, key, output);
  }
  return output;
}

function paragraphText(paragraph) {
  return normalizeText(findValuesByKey(paragraph, "t").map(textNodeValue).join(""));
}

function textNodeValue(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return String(value["#text"] || "");
  return "";
}

function markdownTableFromPptx(table) {
  const rows = findValuesByKey(table, "tr").map((row) => findValuesByKey(row, "tc").map((cell) => escapeTableCell(findValuesByKey(cell, "t").map(textNodeValue).join(" "))));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${normalized[0].map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function excelCellText(cell) {
  const value = cell;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  return displayObjectValue(value);
}

function displayObjectValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value.text || value.error || JSON.stringify(value);
  return String(value);
}

function naturalOfficeOrder(left, right) {
  return Number(left.match(/(\d+)\.xml$/)?.[1] || 0) - Number(right.match(/(\d+)\.xml$/)?.[1] || 0);
}

function uniqueNonempty(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function extensionForContentType(contentType) {
  const types = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/svg+xml": ".svg", "image/tiff": ".tiff", "image/webp": ".webp" };
  return types[String(contentType || "").toLowerCase()] || ".bin";
}

function normalizeText(value) {
  return String(value || "").replace(/\u0000/g, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

function meaningfulCharacterCount(value) {
  return String(value || "").replace(/[\s`*_#>|\-:[\](){}.!?,;，。！？；：'"“”‘’/\\]/g, "").length;
}

function isMeaningful(value) {
  return meaningfulCharacterCount(value) >= MIN_MEANINGFUL_CHARACTERS;
}

function escapeMarkdownLine(value) {
  return String(value || "").replace(/\r?\n/g, " ").trim();
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function minimumOcrConfidence() {
  return Math.max(0, Math.min(100, Number(process.env.MY_WIKI_OCR_MIN_CONFIDENCE || DEFAULT_MIN_OCR_CONFIDENCE)));
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function cleanError(error) {
  return String(error?.message || error || "Unknown extraction error").replace(/[\r\n]+/g, " ").slice(0, 600);
}
