import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { captureSource } from "./capture-service.mjs";
import { extractLocalDocument, extractionFromText, sourceTypeForLocalFile } from "./document-extractor.mjs";
import { exists, slugify } from "./wiki-lib.mjs";

const ZIP_ENTRY_LIMIT = Number(process.env.MY_WIKI_ZIP_ENTRY_LIMIT || 2000);
const ZIP_EXPANDED_LIMIT = Number(process.env.MY_WIKI_ZIP_EXPANDED_LIMIT_BYTES || 500 * 1024 * 1024);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg"]);

export async function ingestLocalFile({
  vault,
  file,
  filename = path.basename(file),
  title = "",
  collection = "",
  sourcePath = "",
  dependencyRoot,
  captureMethod = "agent-file"
}) {
  const uploadPath = sourcePath || filename;
  if (isIgnoredLocalEntry(uploadPath)) {
    return { kind: "file", count: 0, items: [], ignored: [uploadPath], total: 0 };
  }
  if (path.extname(filename).toLowerCase() === ".zip") {
    return ingestZipBundle({ vault, file, filename, collection, dependencyRoot, captureMethod: captureMethod.replace(/file$/, "zip") });
  }
  const snapshot = await preserveUploadedSnapshot({ vault, file, filename });
  const extracted = await extractLocalDocument({
    file: snapshot.file,
    filename,
    dependencyRoot,
    cacheRoot: path.join(vault, ".my-wiki", "ocr-cache")
  }).catch((error) => failedExtraction("local-parser", cleanError(error)));
  const result = await captureSource({
    vault,
    title: title.trim() || path.basename(filename, path.extname(filename)) || "Uploaded Source",
    sourceType: sourceTypeForLocalFile(filename),
    collection,
    snapshotReference: snapshot.relative,
    content: extracted.content,
    textExtraction: extracted.status,
    extractionStatus: extracted.status,
    extractionMethod: extracted.method,
    extractedPages: extracted.pages,
    extractedCharacters: extracted.characters,
    extractedUnits: extracted.units,
    extractedUnitLabel: extracted.unitLabel,
    extractionConfidence: extracted.confidence,
    extractionEngine: extracted.engine,
    extractionQuality: extracted.quality,
    extractionWarnings: extracted.warnings,
    originalFilename: filename,
    sourcePath,
    initialStatus: extracted.status === "complete" ? "inbox" : "needs-followup",
    embeddedAssets: extracted.assets,
    requireLocalAttachments: true,
    captureMethod,
    shouldSnapshot: true,
    shouldMirrorImages: true
  });
  return { kind: "file", count: 1, items: [{ ...result, extractionMessage: extracted.message || "", extractionWarnings: extracted.warnings || [] }] };
}

export async function ingestDirectory({ vault, directory, collection = "", dependencyRoot, captureMethod = "agent-directory" }) {
  const root = path.resolve(directory);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${root}`);
  const files = await listDirectoryFiles(root);
  const items = [];
  const failures = [];
  for (const file of files) {
    const sourcePath = path.relative(root, file).replace(/\\/g, "/");
    try {
      const result = await ingestLocalFile({ vault, file, filename: path.basename(file), collection, sourcePath, dependencyRoot, captureMethod });
      items.push(...result.items);
    } catch (error) {
      failures.push({ path: sourcePath, error: cleanError(error) });
    }
  }
  return { kind: "directory", count: items.length, items, failures, total: files.length };
}

export async function ingestZipBundle({ vault, file, filename = path.basename(file), collection = "", dependencyRoot, captureMethod = "agent-zip" }) {
  const snapshot = await preserveUploadedSnapshot({ vault, file, filename });
  try {
    return await ingestPreservedZipBundle({ vault, filename, collection, dependencyRoot, captureMethod, snapshot });
  } catch (error) {
    const message = cleanError(error);
    const result = await captureSource({
      vault,
      title: path.basename(filename, path.extname(filename)) || "Uploaded ZIP",
      sourceType: "file",
      collection,
      snapshotReference: snapshot.relative,
      content: failedExtraction("zip-validation", message).content,
      textExtraction: "failed",
      extractionStatus: "failed",
      extractionMethod: "zip-validation",
      extractionWarnings: [message],
      originalFilename: filename,
      initialStatus: "needs-followup",
      captureMethod,
      shouldSnapshot: true,
      shouldMirrorImages: false
    });
    return { kind: "zip", count: 1, items: [{ ...result, extractionMessage: message, extractionWarnings: [message] }], total: 0, failures: [{ path: filename, error: message }] };
  }
}

async function ingestPreservedZipBundle({ vault, filename, collection, dependencyRoot, captureMethod, snapshot }) {
  const JSZip = createRequire(path.resolve(dependencyRoot, "package.json"))("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(snapshot.file), { checkCRC32: true, createFolders: false });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !isIgnoredArchiveEntry(entry.name));
  if (entries.length > ZIP_ENTRY_LIMIT) throw new Error(`ZIP contains ${entries.length} files; the limit is ${ZIP_ENTRY_LIMIT}.`);
  for (const entry of entries) validateArchivePath(entry.name);
  const declaredExpandedBytes = entries.reduce((total, entry) => total + Number(entry?._data?.uncompressedSize || 0), 0);
  if (declaredExpandedBytes > ZIP_EXPANDED_LIMIT) throw new Error(`Expanded ZIP content exceeds ${ZIP_EXPANDED_LIMIT} bytes.`);

  const markdownEntries = entries.filter((entry) => MARKDOWN_EXTENSIONS.has(path.posix.extname(entry.name).toLowerCase()));
  if (!markdownEntries.length) throw new Error("ZIP upload requires at least one Markdown file. Use folder or file upload for independent documents.");

  const entryByName = new Map(entries.map((entry) => [normalizeArchivePath(entry.name), entry]));
  const bufferCache = new Map();
  let expandedBytes = 0;
  const readEntry = async (entry) => {
    if (bufferCache.has(entry.name)) return bufferCache.get(entry.name);
    const buffer = await entry.async("nodebuffer");
    expandedBytes += buffer.length;
    if (expandedBytes > ZIP_EXPANDED_LIMIT) throw new Error(`Expanded ZIP content exceeds ${ZIP_EXPANDED_LIMIT} bytes.`);
    bufferCache.set(entry.name, buffer);
    return buffer;
  };

  const assignedImages = new Set();
  const plans = [];
  for (const markdownEntry of markdownEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    const content = (await readEntry(markdownEntry)).toString("utf8");
    const extracted = extractionFromText(content, "zip-markdown");
    const references = localMarkdownImageReferences(content);
    const assets = [];
    for (const reference of references) {
      const archiveName = resolveArchiveReference(markdownEntry.name, reference.path);
      const entry = entryByName.get(archiveName);
      if (!entry || !IMAGE_EXTENSIONS.has(path.posix.extname(entry.name).toLowerCase())) continue;
      const existing = assets.find((asset) => asset.archiveName === entry.name);
      if (existing) {
        existing.references.push(reference.literal);
        continue;
      }
      assignedImages.add(entry.name);
      assets.push({ archiveName: entry.name, references: [reference.literal], name: path.posix.basename(entry.name), buffer: await readEntry(entry) });
    }
    plans.push({ markdownEntry, content, extracted, assets });
  }

  for (const entry of entries.filter((candidate) => IMAGE_EXTENSIONS.has(path.posix.extname(candidate.name).toLowerCase()) && !assignedImages.has(candidate.name))) {
    const owner = plans
      .map((plan) => ({ plan, score: commonDirectoryDepth(plan.markdownEntry.name, entry.name) }))
      .sort((a, b) => b.score - a.score || a.plan.markdownEntry.name.localeCompare(b.plan.markdownEntry.name))[0]?.plan;
    if (owner) {
      owner.assets.push({ archiveName: entry.name, references: [`my-wiki-asset:${entry.name}`], name: path.posix.basename(entry.name), buffer: await readEntry(entry) });
    }
  }

  const items = [];
  for (const { markdownEntry, content, extracted, assets } of plans) {
    const result = await captureSource({
      vault,
      title: markdownTitle(content) || path.posix.basename(markdownEntry.name, path.posix.extname(markdownEntry.name)),
      sourceType: "note",
      collection,
      snapshotReference: snapshot.relative,
      content: extracted.content,
      textExtraction: extracted.status,
      extractionStatus: extracted.status,
      extractionMethod: extracted.method,
      extractedCharacters: extracted.characters,
      extractedUnits: 1,
      extractedUnitLabel: "documents",
      originalFilename: `${filename}#${markdownEntry.name}`,
      sourcePath: markdownEntry.name,
      initialStatus: extracted.status === "complete" ? "inbox" : "needs-followup",
      embeddedAssets: assets.map(({ references, name, buffer }) => ({ references, name, buffer })),
      requireLocalAttachments: true,
      captureMethod,
      shouldSnapshot: true,
      shouldMirrorImages: true
    });
    items.push({ ...result, extractionMessage: extracted.message || "" });
  }
  return { kind: "zip", count: items.length, items, total: markdownEntries.length, failures: [] };
}

async function preserveUploadedSnapshot({ vault, file, filename }) {
  const snapshotsDir = path.join(vault, "raw", "snapshots");
  await fs.mkdir(snapshotsDir, { recursive: true });
  const originalName = path.basename(filename || file || "uploaded-source.bin");
  const originalExtension = path.extname(originalName);
  const extension = /^\.[a-z0-9]{1,12}$/i.test(originalExtension) ? originalExtension.toLowerCase() : ".bin";
  const base = `${new Date().toISOString().slice(0, 10)}--${slugify(path.basename(originalName, originalExtension) || "uploaded-source")}`;
  let target = path.join(snapshotsDir, `${base}${extension}`);
  let counter = 2;
  while (await exists(target)) {
    target = path.join(snapshotsDir, `${base}-${counter}${extension}`);
    counter += 1;
  }
  await fs.copyFile(path.resolve(file), target);
  return {
    file: target,
    relative: path.relative(vault, target).replace(/\\/g, "/")
  };
}

function failedExtraction(method, message) {
  return {
    status: "failed",
    method,
    content: `> ${message} The original file is preserved. Keep this source in needs-followup until readable evidence is available.`,
    pages: 0,
    characters: 0,
    units: 0,
    unitLabel: "items",
    confidence: 0,
    assets: [],
    warnings: [message],
    message
  };
}

function commonDirectoryDepth(left, right) {
  const leftParts = path.posix.dirname(normalizeArchivePath(left)).split("/").filter(Boolean);
  const rightParts = path.posix.dirname(normalizeArchivePath(right)).split("/").filter(Boolean);
  let depth = 0;
  while (depth < leftParts.length && depth < rightParts.length && leftParts[depth] === rightParts[depth]) depth += 1;
  return depth;
}

async function listDirectoryFiles(root) {
  const output = [];
  const walk = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (isIgnoredLocalEntry(path.relative(root, candidate))) continue;
      if (entry.isDirectory()) await walk(candidate);
      else if (entry.isFile()) output.push(candidate);
    }
  };
  await walk(root);
  return output.sort((a, b) => a.localeCompare(b));
}

function localMarkdownImageReferences(markdown) {
  const values = [];
  const add = (literalValue) => {
    const literal = String(literalValue || "").trim();
    const decoded = decodeURIComponentSafe(literal).replace(/\\/g, "/");
    const referencePath = decoded.split("#")[0].split("?")[0];
    if (referencePath && !/^(?:[a-z]+:|#|\/)/i.test(referencePath)) values.push({ literal, path: referencePath });
  };
  for (const match of String(markdown).matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)) {
    add(match[1] || match[2]);
  }
  for (const match of String(markdown).matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    add(match[1] || match[2] || match[3]);
  }
  return [...new Map(values.map((value) => [value.literal, value])).values()];
}

function resolveArchiveReference(markdownName, reference) {
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(normalizeArchivePath(markdownName)), reference));
  validateArchivePath(normalized);
  return normalized;
}

function normalizeArchivePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function validateArchivePath(value) {
  const normalized = normalizeArchivePath(value);
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe ZIP entry path: ${value}`);
  }
  return normalized;
}

function isIgnoredArchiveEntry(value) {
  return isIgnoredLocalEntry(normalizeArchivePath(value));
}

export function isIgnoredLocalEntry(value) {
  const normalized = normalizeArchivePath(value);
  const parts = normalized.split("/").filter(Boolean);
  const basename = String(parts[parts.length - 1] || "").toLowerCase();
  return parts.some((part) => part.startsWith(".") || ["__macosx", "node_modules"].includes(part.toLowerCase()))
    || ["thumbs.db", "ehthumbs.db", "desktop.ini", "icon\r"].includes(basename)
    || basename.startsWith("~$");
}

function markdownTitle(content) {
  return String(content).match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanError(error) {
  return String(error?.message || error || "Unknown ingest error").replace(/[\r\n]+/g, " ").slice(0, 500);
}
