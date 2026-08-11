import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SCALE = 0.35;

export function pdfVisualGateSettings(environment = process.env) {
  return {
    enabled: !["0", "false", "off", "no"].includes(String(environment.MY_WIKI_PDF_VISUAL_GATE ?? "1").trim().toLowerCase()),
    scale: clamp(Number(environment.MY_WIKI_PDF_VISUAL_GATE_SCALE || DEFAULT_SCALE), 0.2, 0.8),
    forcedBlankPages: parsePageRanges(environment.MY_WIKI_PDF_BLANK_PAGES)
  };
}

export async function analyzePdfVisualPages({ file, dependencyRoot, pages = 0, environment = process.env } = {}) {
  const settings = pdfVisualGateSettings(environment);
  const forced = new Set(settings.forcedBlankPages);
  if (!settings.enabled || !dependencyRoot) return forcedVisualPages(forced, pages);

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

    const rendered = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: settings.scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = canvasRuntime.createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context, viewport, background: "white" }).promise;
      const pixels = context.getImageData(0, 0, width, height).data;
      rendered.push(pageVisualMetrics(pageNumber, pixels, width, height));
      page.cleanup?.();
    }
    return classifyPdfVisualPages(rendered, { forcedBlankPages: [...forced] });
  } finally {
    await document?.destroy().catch(() => {});
  }
}

export function classifyPdfVisualPages(metrics = [], { forcedBlankPages = [] } = {}) {
  const forced = new Set(parsePageRanges(forcedBlankPages));
  const values = metrics.filter((item) => item && Number.isFinite(Number(item.darkCoverage)));
  if (!values.length) return forcedVisualPages(forced);

  const typicalDark = quantile(values.map((item) => Number(item.darkCoverage)), 0.65);
  const typicalInk = quantile(values.map((item) => Number(item.inkCoverage)), 0.65);
  const typicalContrast = quantile(values.map((item) => Number(item.contrast)), 0.65);
  const byPage = new Map(values.map((item) => [Number(item.page), item]));

  return values.map((item) => {
    const page = Number(item.page);
    if (forced.has(page)) return publicVisual(item, "manual-blank", { forced: true });

    const strongInkRatio = Number(item.darkCoverage) / Math.max(0.000001, Number(item.inkCoverage));
    const blankCandidate = Number(item.darkCoverage) <= Math.max(0.0015, typicalDark * 0.14)
      && Number(item.inkCoverage) <= Math.max(0.003, typicalInk * 0.16)
      && Number(item.contrast) <= Math.max(9, typicalContrast * 0.35)
      && strongInkRatio < 0.72;
    if (blankCandidate) return publicVisual(item, "blank-noise", { strongInkRatio });

    const mirror = strongestMirroredNeighbor(item, byPage);
    const neighbor = mirror.page ? byPage.get(mirror.page) : null;
    const mirroredShowthrough = neighbor
      && mirror.correlation >= 0.28
      && Number(item.darkCoverage) < Number(neighbor.darkCoverage) * 0.45
      && Number(item.inkCoverage) < Number(neighbor.inkCoverage) * 0.62
      && Number(item.contrast) < Number(neighbor.contrast) * 0.65;
    if (mirroredShowthrough) {
      return publicVisual(item, "reverse-side-showthrough", {
        mirroredNeighborPage: mirror.page,
        mirroredNeighborCorrelation: mirror.correlation,
        strongInkRatio
      });
    }

    const lowContrast = Number(item.darkCoverage) <= Math.max(0.012, typicalDark * 0.55)
      && Number(item.contrast) <= Math.max(22, typicalContrast * 0.72);
    return publicVisual(item, lowContrast ? "low-contrast" : "normal", {
      mirroredNeighborPage: mirror.page || 0,
      mirroredNeighborCorrelation: mirror.correlation,
      strongInkRatio
    });
  });
}

export function parsePageRanges(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const pages = new Set();
  for (const tokenValue of values) {
    const token = String(tokenValue || "").trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > 0 && end >= start && end - start <= 10_000) {
        for (let page = start; page <= end; page += 1) pages.add(page);
      }
      continue;
    }
    const page = Number(token);
    if (Number.isInteger(page) && page > 0) pages.add(page);
  }
  return [...pages].sort((left, right) => left - right);
}

function pageVisualMetrics(page, pixels, width, height) {
  const luminance = new Uint8Array(width * height);
  let dark = 0;
  let ink = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let pixel = 0, index = 0; pixel < pixels.length; pixel += 4, index += 1) {
    const alpha = pixels[pixel + 3] / 255;
    const gray = Math.round((0.299 * pixels[pixel] + 0.587 * pixels[pixel + 1] + 0.114 * pixels[pixel + 2]) * alpha + 255 * (1 - alpha));
    luminance[index] = gray;
    if (gray < 128) dark += 1;
    if (gray < 220) ink += 1;
    sum += gray;
    sumSquares += gray * gray;
  }
  const total = Math.max(1, luminance.length);
  const mean = sum / total;
  return {
    page,
    width,
    height,
    darkCoverage: roundRatio(dark / total),
    inkCoverage: roundRatio(ink / total),
    contrast: round(Math.sqrt(Math.max(0, sumSquares / total - mean * mean))),
    luminance
  };
}

function strongestMirroredNeighbor(item, byPage) {
  let best = { page: 0, correlation: 0 };
  for (const page of [Number(item.page) - 1, Number(item.page) + 1]) {
    const neighbor = byPage.get(page);
    if (!neighbor || neighbor.width !== item.width || neighbor.height !== item.height || !item.luminance || !neighbor.luminance) continue;
    const correlation = mirroredInkCorrelation(item, neighbor);
    if (correlation > best.correlation) best = { page, correlation };
  }
  return best;
}

function mirroredInkCorrelation(left, right) {
  const total = left.width * left.height;
  let sumLeft = 0;
  let sumRight = 0;
  let sumLeftSquares = 0;
  let sumRightSquares = 0;
  let sumProduct = 0;
  for (let y = 0; y < left.height; y += 1) {
    const row = y * left.width;
    for (let x = 0; x < left.width; x += 1) {
      const a = Math.max(0, 247 - left.luminance[row + x]);
      const b = Math.max(0, 247 - right.luminance[row + left.width - 1 - x]);
      sumLeft += a;
      sumRight += b;
      sumLeftSquares += a * a;
      sumRightSquares += b * b;
      sumProduct += a * b;
    }
  }
  const covariance = sumProduct - (sumLeft * sumRight) / total;
  const leftVariance = sumLeftSquares - (sumLeft * sumLeft) / total;
  const rightVariance = sumRightSquares - (sumRight * sumRight) / total;
  return roundRatio(covariance / Math.max(1, Math.sqrt(Math.max(0, leftVariance) * Math.max(0, rightVariance))));
}

function publicVisual(item, classification, extra = {}) {
  return {
    page: Number(item.page),
    darkCoverage: roundRatio(Number(item.darkCoverage)),
    inkCoverage: roundRatio(Number(item.inkCoverage)),
    contrast: round(Number(item.contrast)),
    classification,
    ...extra
  };
}

function forcedVisualPages(pages, expectedPages = 0) {
  const forced = pages instanceof Set ? [...pages] : parsePageRanges(pages);
  if (!forced.length && expectedPages <= 0) return [];
  return forced.map((page) => ({ page, classification: "manual-blank", forced: true }));
}

function quantile(values, percentile) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentile)));
  return sorted[index];
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return DEFAULT_SCALE;
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function roundRatio(value) {
  return Math.round(Number(value || 0) * 100_000) / 100_000;
}
