import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assessPdfPage, qualityWarnings, summarizePdfQuality } from "./pdf-quality.mjs";

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

export async function extractPdfMarkdown({ file, dependencyRoot, maxBytes = DEFAULT_MAX_BYTES }) {
  const stat = await fs.stat(file);
  if (stat.size > maxBytes) {
    return extractionFailure("skipped-large", `PDF text extraction is limited to ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  let document;
  try {
    const require = createRequire(path.resolve(dependencyRoot, "package.json"));
    const canvasRuntime = require("@napi-rs/canvas");
    globalThis.DOMMatrix ||= canvasRuntime.DOMMatrix;
    globalThis.Path2D ||= canvasRuntime.Path2D;
    globalThis.ImageData ||= canvasRuntime.ImageData;
    const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
    document = await pdfjs.getDocument({
      data: new Uint8Array(await fs.readFile(file)),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true
    }).promise;
    const sections = [];
    const pageResults = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const result = assessPdfPage({ page: pageNumber, text: await renderPageText(page), method: "pdf-text" });
      pageResults.push(result);
      sections.push(`### Page ${pageNumber}\n\n${result.text}`);
    }
    const text = normalizeExtractedText(sections.join("\n\n"));
    const characters = text.replace(/^### Page \d+\s*$/gm, "").trim().length;
    if (characters === 0) {
      return extractionFailure("unavailable", "No extractable text was found. The PDF may require OCR.", document.numPages);
    }
    const quality = summarizePdfQuality(pageResults, { method: "pdf-text" });
    const warnings = qualityWarnings(quality);
    return {
      status: quality.level === "poor" ? "low-quality" : "complete",
      pages: document.numPages,
      characters,
      content: `> Extracted locally from ${document.numPages} PDF pages. The preserved PDF remains the layout reference.\n\n${text}`,
      confidence: quality.score,
      quality,
      warnings,
      message: warnings.join("; ")
    };
  } catch (error) {
    return extractionFailure("failed", `PDF text extraction failed: ${cleanError(error)}`);
  } finally {
    await document?.destroy().catch(() => {});
  }
}

async function renderPageText(page) {
  const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  let output = "";
  let previousY;
  for (const item of content.items || []) {
    const value = String(item.str || "").replace(/\u0000/g, "");
    const y = Number(item.transform?.[5]);
    if (previousY === undefined || (Number.isFinite(y) && Math.abs(y - previousY) < 0.1)) output += value;
    else output += `\n${value}`;
    previousY = y;
  }
  return output.trim();
}

function normalizeExtractedText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractionFailure(status, message, pages = 0) {
  return {
    status,
    pages,
    characters: 0,
    content: `> ${message} Preserve this source as inbox or needs-followup until searchable text is available. Do not mark it processed.`,
    message
  };
}

function cleanError(error) {
  return String(error?.message || error || "unknown error").replace(/[\r\n]+/g, " ").slice(0, 400);
}
