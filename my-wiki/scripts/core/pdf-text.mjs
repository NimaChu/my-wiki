import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

export async function extractPdfMarkdown({ file, dependencyRoot, maxBytes = DEFAULT_MAX_BYTES }) {
  const stat = await fs.stat(file);
  if (stat.size > maxBytes) {
    return extractionFailure("skipped-large", `PDF text extraction is limited to ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  let pdfParse;
  try {
    const require = createRequire(path.resolve(dependencyRoot, "package.json"));
    pdfParse = require("pdf-parse");
  } catch (error) {
    return extractionFailure("failed", `The local PDF parser is unavailable: ${cleanError(error)}`);
  }

  try {
    let pageNumber = 0;
    const data = await pdfParse(await fs.readFile(file), {
      pagerender: async (page) => {
        const pageText = await renderPageText(page);
        pageNumber += 1;
        return `### Page ${pageNumber}\n\n${pageText}`;
      }
    });
    const text = normalizeExtractedText(data.text);
    const characters = text.replace(/^### Page \d+\s*$/gm, "").trim().length;
    if (characters === 0) {
      return extractionFailure("unavailable", "No extractable text was found. The PDF may require OCR.", Number(data.numpages || pageNumber));
    }
    return {
      status: "complete",
      pages: Number(data.numpages || pageNumber),
      characters,
      content: `> Extracted locally from ${Number(data.numpages || pageNumber)} PDF pages. The preserved PDF remains the layout reference.\n\n${text}`,
      message: ""
    };
  } catch (error) {
    return extractionFailure("failed", `PDF text extraction failed: ${cleanError(error)}`);
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
