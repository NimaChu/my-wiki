import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function renderPdfPages({ file, pages = [], outputDir, dependencyRoot, environment = process.env } = {}) {
  const requested = [...new Set(pages.map(Number).filter((page) => Number.isInteger(page) && page > 0))];
  if (!requested.length) return [];
  if (!dependencyRoot) throw new Error("PDF page rendering requires the Dashboard dependency root.");
  await fs.mkdir(outputDir, { recursive: true });

  const require = createRequire(path.resolve(dependencyRoot, "package.json"));
  const canvasRuntime = require("@napi-rs/canvas");
  globalThis.DOMMatrix ||= canvasRuntime.DOMMatrix;
  globalThis.Path2D ||= canvasRuntime.Path2D;
  globalThis.ImageData ||= canvasRuntime.ImageData;
  const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await fs.readFile(file)),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;
  const configuredScale = Number(environment.MY_WIKI_VISUAL_REPAIR_SCALE || 1.8);
  const scale = Number.isFinite(configuredScale) ? Math.min(3, Math.max(1, configuredScale)) : 1.8;
  const rendered = [];
  try {
    for (const pageNumber of requested) {
      if (pageNumber > document.numPages) continue;
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRuntime.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: "white" }).promise;
      const target = path.join(outputDir, `page-${String(pageNumber).padStart(4, "0")}.png`);
      await fs.writeFile(target, canvas.toBuffer("image/png"));
      rendered.push({ page: pageNumber, file: target, width: canvas.width, height: canvas.height });
      page.cleanup?.();
    }
  } finally {
    await document.destroy().catch(() => {});
  }
  return rendered;
}
