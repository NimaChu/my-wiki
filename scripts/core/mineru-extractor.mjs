import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assessPdfPage, qualityWarnings, summarizePdfQuality } from "./pdf-quality.mjs";
import { analyzePdfVisualPages } from "./pdf-visual-gate.mjs";

export async function extractPdfWithMineru({ file, pages = 0, cacheRoot = "", dependencyRoot = "", environment = process.env } = {}) {
  const command = String(environment.MY_WIKI_MINERU_COMMAND || "mineru").trim();
  const availability = await commandAvailable(command);
  if (!availability) return { status: "unavailable", method: "mineru", message: `MinerU command is not available: ${command}` };

  const temporaryRoot = cacheRoot || os.tmpdir();
  await fs.mkdir(temporaryRoot, { recursive: true });
  const outputRoot = await fs.mkdtemp(path.join(temporaryRoot, "my-wiki-mineru-"));
  const backend = String(environment.MY_WIKI_MINERU_BACKEND || "hybrid-engine").trim();
  const effort = String(environment.MY_WIKI_MINERU_EFFORT || "medium").trim();
  const language = String(environment.MY_WIKI_MINERU_LANGUAGE || "ch").trim();
  const timeout = Math.max(60_000, Number(environment.MY_WIKI_MINERU_TIMEOUT_MS || 12 * 60 * 60 * 1000));
  try {
    const visualPages = await analyzePdfVisualPages({ file, dependencyRoot, pages, environment }).catch(() => []);
    const args = ["-p", file, "-o", outputRoot, "-b", backend, "-l", language];
    if (backend.startsWith("hybrid-")) args.push("--effort", effort);
    const result = await runCommand(command, args, { timeout, environment });
    if (result.code !== 0) {
      return { status: "failed", method: "mineru", message: `MinerU failed (${result.code}): ${cleanError(result.stderr || result.stdout)}` };
    }
    const parsed = await readMineruOutput(outputRoot, pages, { visualPages });
    if (!parsed.content.trim()) return { status: "failed", method: "mineru", message: "MinerU completed without readable Markdown output." };
    const assetPages = new Set((parsed.assets || []).map((asset) => Number(asset.page || 0)).filter(Boolean));
    const diagramPages = relationshipDiagramPages(parsed.pageResults).filter((page) => !assetPages.has(page));
    const renderedDiagrams = await renderPdfPageAssets({ file, pages: diagramPages, dependencyRoot, environment }).catch(() => []);
    const assets = [...(parsed.assets || []), ...renderedDiagrams];
    const content = insertPageAssetReferences(parsed.content, renderedDiagrams);
    const quality = summarizePdfQuality(parsed.pageResults, { method: "mineru" });
    const warnings = qualityWarnings(quality);
    const status = quality.level === "poor" ? "low-quality" : "complete";
    return {
      status,
      method: "mineru",
      engine: "mineru",
      content: `> Parsed locally with MinerU. The preserved PDF remains the layout reference.\n\n${content.trim()}`,
      pages: parsed.pages || pages,
      characters: meaningfulCharacterCount(parsed.content),
      units: parsed.pages || pages,
      unitLabel: "pages",
      confidence: quality.score,
      quality,
      warnings,
      message: status === "complete" ? warnings.join("; ") : `MinerU output did not meet the page-quality threshold. ${warnings.join("; ")}`.trim(),
      assets
    };
  } catch (error) {
    return {
      status: "failed",
      method: "mineru",
      engine: "mineru",
      message: `MinerU extraction failed: ${cleanError(error?.message || error)}`
    };
  } finally {
    await fs.rm(outputRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function readMineruOutput(outputRoot, expectedPages = 0, { visualPages = [] } = {}) {
  const files = await listFiles(outputRoot);
  const contentListFile = files.find((file) => /(?:^|_)content_list\.json$/i.test(path.basename(file)));
  if (contentListFile) {
    const entries = JSON.parse(await fs.readFile(contentListFile, "utf8"));
    if (Array.isArray(entries)) {
      const hydrated = await hydrateMineruImageEntries(entries, { outputRoot, contentListFile, files });
      return { ...mineruEntriesToMarkdown(hydrated.entries, expectedPages, { visualPages }), assets: hydrated.assets };
    }
  }
  const markdownFile = files.find((file) => file.toLowerCase().endsWith(".md"));
  if (!markdownFile) return { content: "", pages: expectedPages, pageResults: [] };
  const markdown = await fs.readFile(markdownFile, "utf8");
  const chunks = markdown.split(/^### Page \d+\s*$/m);
  if (chunks.length > 1) {
    const visualByPage = visualPageMap(visualPages);
    const pageResults = chunks.slice(1).map((text, index) => assessPdfPage({ page: index + 1, text, method: "mineru", visual: visualByPage.get(index + 1) }));
    const content = pageResults.map((result) => `### Page ${result.page}\n\n${result.text || "_No text recognized on this page._"}`).join("\n\n");
    return { content, pages: pageResults.length, pageResults, assets: [] };
  }
  const result = assessPdfPage({ page: 1, text: markdown, method: "mineru", visual: visualPageMap(visualPages).get(1) });
  return { content: result.text, pages: expectedPages || 1, pageResults: [result], assets: [] };
}

export function mineruEntriesToMarkdown(entries, expectedPages = 0, { visualPages = [] } = {}) {
  const grouped = new Map();
  for (const entry of entries) {
    const page = Number(entry.page_idx ?? entry.page_index ?? 0) + 1;
    if (!grouped.has(page)) grouped.set(page, []);
    const block = mineruBlock(entry);
    if (block) grouped.get(page).push(block);
  }
  const pages = Math.max(expectedPages, ...grouped.keys(), 0);
  const sections = [];
  const pageResults = [];
  const visualByPage = visualPageMap(visualPages);
  for (let page = 1; page <= pages; page += 1) {
    const text = (grouped.get(page) || []).join("\n\n").trim();
    const result = assessPdfPage({ page, text, method: "mineru", visual: visualByPage.get(page) });
    sections.push(`### Page ${page}\n\n${result.text || "_No text recognized on this page._"}`);
    pageResults.push(result);
  }
  return { content: sections.join("\n\n"), pages, pageResults };
}

function visualPageMap(values) {
  if (values instanceof Map) return values;
  return new Map((Array.isArray(values) ? values : []).map((item) => [Number(item?.page), item]).filter(([page]) => Number.isInteger(page) && page > 0));
}

function mineruBlock(entry) {
  const type = String(entry.type || "").toLowerCase();
  const captions = [...asTextList(entry.image_caption), ...asTextList(entry.table_caption)];
  const footnotes = [...asTextList(entry.image_footnote), ...asTextList(entry.table_footnote)];
  if (type.includes("image")) {
    const reference = String(entry.asset_reference || "").trim();
    const alt = String(entry.asset_alt || captions.join(" ") || "Extracted PDF image").replace(/[\[\]]/g, "");
    return [reference ? `![${alt}](${reference})` : "", ...captions, ...footnotes].filter(Boolean).join("\n\n");
  }
  const text = String(
    entry.text
    || entry.content
    || entry.table_body
    || entry.html
    || captions.join("\n")
    || ""
  ).trim();
  if (!text) return "";
  if (type.includes("equation") || type.includes("formula")) return text.startsWith("$") ? text : `$$\n${text}\n$$`;
  if (type.includes("title")) return `## ${text.replace(/^#+\s*/, "")}`;
  if (type.includes("table")) return [captions.length ? `**${captions.join(" ")}**` : "", text, footnotes.join("\n")].filter(Boolean).join("\n\n");
  return [text, ...footnotes].filter(Boolean).join("\n\n");
}

async function hydrateMineruImageEntries(entries, { outputRoot, contentListFile, files }) {
  const assets = [];
  const bySource = new Map();
  let imageIndex = 0;
  const hydrated = [];
  for (const entry of entries) {
    const type = String(entry?.type || "").toLowerCase();
    if (!type.includes("image")) {
      hydrated.push(entry);
      continue;
    }
    const referencePath = mineruImagePath(entry);
    const source = referencePath ? resolveMineruImageFile(referencePath, { outputRoot, contentListFile, files }) : "";
    if (!source) {
      hydrated.push(entry);
      continue;
    }
    let asset = bySource.get(source);
    if (!asset) {
      imageIndex += 1;
      const page = Number(entry.page_idx ?? entry.page_index ?? 0) + 1;
      const extension = path.extname(source).toLowerCase() || ".png";
      const basename = safeMineruAssetName(path.basename(source, path.extname(source)));
      const name = `page-${String(page).padStart(3, "0")}-${String(imageIndex).padStart(2, "0")}-${basename}${extension}`;
      const captions = asTextList(entry.image_caption);
      asset = {
        reference: `my-wiki-asset:mineru-image-${imageIndex}${extension}`,
        id: `mineru-image-${imageIndex}`,
        name,
        buffer: await fs.readFile(source),
        page,
        alt: captions.join(" ") || `PDF Page ${page} image`,
        status: "extracted-by-mineru"
      };
      bySource.set(source, asset);
      assets.push(asset);
    }
    hydrated.push({ ...entry, asset_reference: asset.reference, asset_alt: asset.alt });
  }
  return { entries: hydrated, assets };
}

function mineruImagePath(entry) {
  for (const value of [entry?.img_path, entry?.image_path, entry?.image, entry?.path]) {
    const text = String(value || "").trim();
    if (/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/i.test(text)) return text;
  }
  return "";
}

function resolveMineruImageFile(reference, { outputRoot, contentListFile, files }) {
  const normalized = String(reference || "").replace(/\\/g, "/");
  const candidates = path.isAbsolute(reference)
    ? [path.resolve(reference)]
    : [path.resolve(path.dirname(contentListFile), normalized), path.resolve(outputRoot, normalized)];
  for (const candidate of candidates) {
    if (files.includes(candidate) && isWithin(outputRoot, candidate)) return candidate;
  }
  const basename = path.basename(normalized).toLowerCase();
  const matches = files.filter((file) => path.basename(file).toLowerCase() === basename && isWithin(outputRoot, file));
  return matches.length === 1 ? matches[0] : "";
}

function isWithin(root, file) {
  const relative = path.relative(root, file);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeMineruAssetName(value) {
  return String(value || "image").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
}

function asTextList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  return text ? [text] : [];
}

export function relationshipDiagramPages(pageResults = []) {
  return pageResults
    .filter((result) => {
      const text = String(result?.text || "");
      const withoutImages = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
      const hasDiagramHeading = /^(?:#{1,6}\s*)?(?:[一二三四五六七八九十0-9]+[、.．]\s*)?(?:内容结构框图|结构框图|关系图|流程图|思维导图)\s*$/mi.test(withoutImages)
        || /^(?:#{1,6}\s*)?(?:concept\s*map|flow\s*chart)\s*$/mi.test(withoutImages);
      return hasDiagramHeading
        && meaningfulCharacterCount(withoutImages) < 400;
    })
    .map((result) => Number(result.page))
    .filter((page) => Number.isInteger(page) && page > 0);
}

export function insertPageAssetReferences(content, assets = []) {
  let updated = String(content || "");
  for (const asset of assets) {
    const page = Number(asset?.page || 0);
    const reference = String(asset?.reference || "").trim();
    if (!Number.isInteger(page) || page <= 0 || !reference || updated.includes(`](${reference})`)) continue;
    const expression = new RegExp(`(^### Page ${page}[ \\t]*$)`, "m");
    if (!expression.test(updated)) continue;
    const alt = String(asset?.alt || `PDF Page ${page} image`).replace(/[\[\]]/g, "");
    updated = updated.replace(expression, `$1\n\n![${alt}](${reference})`);
  }
  return updated;
}

async function renderPdfPageAssets({ file, pages = [], dependencyRoot, environment = process.env }) {
  const requested = [...new Set(pages.map(Number).filter((page) => Number.isInteger(page) && page > 0))];
  if (!requested.length || !dependencyRoot) return [];
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
  const scaleValue = Number(environment.MY_WIKI_PDF_DIAGRAM_SCALE || 1.8);
  const scale = Number.isFinite(scaleValue) ? Math.min(3, Math.max(1, scaleValue)) : 1.8;
  const assets = [];
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
      assets.push({
        reference: `my-wiki-asset:pdf-page-${pageNumber}-content-map.png`,
        id: `page-${String(pageNumber).padStart(3, "0")}-content-map`,
        name: `page-${String(pageNumber).padStart(3, "0")}-content-map.png`,
        buffer: canvas.toBuffer("image/png"),
        page: pageNumber,
        alt: `PDF Page ${pageNumber} 内容结构框图`,
        status: "rendered-diagram-fallback"
      });
      page.cleanup?.();
    }
  } finally {
    await document.destroy().catch(() => {});
  }
  return assets;
}

async function commandAvailable(command) {
  if (path.isAbsolute(command)) return fs.access(command).then(() => true, () => false);
  const lookup = process.platform === "win32" ? ["where", command] : ["sh", "-lc", `command -v ${shellQuote(command)}`];
  const result = await runCommand(lookup[0], lookup.slice(1), { timeout: 10_000 }).catch(() => ({ code: 1 }));
  return result.code === 0;
}

function runCommand(command, args, { timeout, environment = process.env }) {
  return new Promise((resolve, reject) => {
    const noProxy = [environment.NO_PROXY, environment.no_proxy, "127.0.0.1", "localhost"].filter(Boolean).join(",");
    const taskTimeout = String(Math.ceil(timeout / 1000));
    const childEnvironment = {
      ...environment,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
      MINERU_TASK_RESULT_TIMEOUT_SECONDS: environment.MINERU_TASK_RESULT_TIMEOUT_SECONDS || taskTimeout,
      PYTORCH_ENABLE_MPS_FALLBACK: environment.PYTORCH_ENABLE_MPS_FALLBACK || "1"
    };
    if (process.platform === "darwin") {
      childEnvironment.MINERU_HYBRID_BATCH_RATIO ||= "4";
      childEnvironment.MINERU_VIRTUAL_VRAM_SIZE ||= "8";
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: childEnvironment });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeout} ms: ${command}`));
    }, timeout);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: Number(code), stdout, stderr }); });
  });
}

async function listFiles(root) {
  const output = [];
  const walk = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else output.push(file);
    }
  };
  await walk(root);
  return output.sort();
}

function meaningfulCharacterCount(value) {
  return String(value || "").replace(/[\s`*_#>|\-:[\](){}.!?,;，。！？；：'"“”‘’/\\]/g, "").length;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function cleanError(error) {
  return String(error || "unknown error").replace(/[\r\n]+/g, " ").slice(0, 600);
}
