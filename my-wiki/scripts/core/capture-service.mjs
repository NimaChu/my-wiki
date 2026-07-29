import { promises as fs } from "node:fs";
import path from "node:path";
import {
  appendLog,
  exists,
  hashContent,
  inferRawCollection,
  slugify,
  yamlList,
  yamlString
} from "./wiki-lib.mjs";

const DEFAULT_FETCH_BYTES = 100 * 1024 * 1024;

export async function captureSource({
  vault,
  title = "Untitled Source",
  url = "",
  sourceType = url ? "webpage" : "note",
  author = "",
  published = "",
  sourceQuality = url ? "primary-url" : "captured",
  captureMethod = "",
  collection = "",
  snapshotFile = "",
  snapshotReference = "",
  content = "",
  textExtraction = "",
  extractionStatus = textExtraction,
  extractionMethod = "",
  extractedPages = 0,
  extractedCharacters = 0,
  extractedUnits = 0,
  extractedUnitLabel = "items",
  extractionConfidence = 0,
  extractionWarnings = [],
  originalFilename = "",
  sourcePath = "",
  initialStatus = "",
  embeddedAssets = [],
  requireLocalAttachments = false,
  imageInputs = [],
  shouldSnapshot = true,
  requireSnapshot = false,
  shouldMirrorImages = true,
  fetchMaxBytes = DEFAULT_FETCH_BYTES,
  validateUrl = null
}) {
  if (!vault) throw new Error("captureSource requires a vault path");
  const date = new Date().toISOString().slice(0, 10);
  const capturedAt = new Date().toISOString();
  const rawDir = path.join(vault, "raw", "sources");
  const resolvedCollection = inferRawCollection({ collection, sourceUrl: url, sourceType, captureMethod });
  const noteSlug = slugify(title);
  await fs.mkdir(rawDir, { recursive: true });

  let filename = `${date}--${noteSlug}.md`;
  let target = path.join(rawDir, filename);
  let counter = 2;
  while (await exists(target)) {
    filename = `${date}--${noteSlug}-${counter}.md`;
    target = path.join(rawDir, filename);
    counter += 1;
  }

  const rawBase = path.basename(target, ".md");
  const snapshot = await saveSnapshot({ vault, rawBase, url, snapshotFile, snapshotReference, shouldSnapshot, fetchMaxBytes, validateUrl });
  if (requireSnapshot && !snapshot?.path) {
    throw new Error(snapshot?.method?.replace(/^snapshot-failed:/, "") || "The source could not be captured");
  }
  const capturedContent = content.trim() || contentFromSnapshot(snapshot, sourceType);
  const embedded = await materializeEmbeddedAssets({ vault, notePath: target, rawBase, markdown: capturedContent, assets: embeddedAssets });
  const mirroredContent = shouldMirrorImages
    ? await mirrorMarkdownImages({ vault, notePath: target, noteSlug: rawBase, markdown: embedded.markdown, fetchMaxBytes, validateUrl })
    : { markdown: embedded.markdown, copied: 0, failures: [], replaced: [] };

  const explicitImages = await copyExplicitImages({
    vault,
    target,
    rawBase,
    imageInputs,
    shouldMirrorImages,
    fetchMaxBytes,
    validateUrl
  });
  const bodyContent = mirroredContent.markdown || originalFileNotice(snapshot?.path);
  const attachmentFailures = requireLocalAttachments
    ? await localImageAttachmentFailures(target, bodyContent)
    : [];
  const digestBasis = snapshot?.buffer || Buffer.from(bodyContent);
  const effectiveCaptureMethod = captureMethod || snapshot?.method || (content ? "agent-provided" : "manual");
  const followupReasons = [];
  if (extractionStatus && extractionStatus !== "complete") followupReasons.push(`extraction:${extractionStatus}`);
  if (initialStatus === "needs-followup" && followupReasons.length === 0) followupReasons.push("capture:needs-followup");
  for (const failure of attachmentFailures) followupReasons.push(`missing-attachment:${failure}`);
  const requiresFollowup = followupReasons.length > 0;
  const resolvedStatus = requiresFollowup ? "needs-followup" : "inbox";
  const tags = ["raw"];
  if (snapshot?.path) tags.push("snapshotted");
  if (mirroredContent.copied > 0 || explicitImages.length > 0 || embedded.copied > 0) tags.push("images");
  if (requiresFollowup) tags.push("needs-followup");
  const extractionFrontmatter = extractionStatus
    ? `extraction_status: ${yamlString(extractionStatus)}\nextraction_method: ${yamlString(extractionMethod)}\ntext_extraction: ${yamlString(textExtraction || extractionStatus)}\nextracted_pages: ${Number(extractedPages) || 0}\nextracted_characters: ${Number(extractedCharacters) || 0}\nextracted_units: ${Number(extractedUnits) || 0}\nextracted_unit_label: ${yamlString(extractedUnitLabel)}\nextraction_confidence: ${Number(extractionConfidence) || 0}\n`
    : "";
  const extractionNote = extractionStatus
    ? `- Content extraction: ${extractionStatus} via ${extractionMethod || "local-parser"} (${Number(extractedCharacters) || 0} characters)\n`
    : "";
  const warningsNote = extractionWarnings.length ? `- Extraction warnings: ${extractionWarnings.join("; ")}\n` : "";
  const attachmentNote = attachmentFailures.length ? `- Missing local attachments: ${attachmentFailures.join("; ")}\n` : "";

  const body = `---
title: ${yamlString(title)}
type: raw-source
source_type: ${yamlString(sourceType)}
collection: ${yamlString(resolvedCollection)}
status: ${resolvedStatus}
needs_followup: ${requiresFollowup}
followup_reasons:${followupReasons.length ? `\n${yamlList(followupReasons)}` : " []"}
author: ${yamlString(author)}
published: ${yamlString(published)}
captured: ${yamlString(capturedAt)}
source_url: ${yamlString(url)}
original_filename: ${yamlString(originalFilename)}
source_path: ${yamlString(sourcePath)}
snapshot_path: ${yamlString(snapshot?.path || "")}
${extractionFrontmatter}content_hash: ${yamlString(hashContent(digestBasis))}
capture_method: ${yamlString(effectiveCaptureMethod)}
source_quality: ${yamlString(sourceQuality)}
tags:
${yamlList(tags)}
related:
---

# ${title}

## Source

- Author: ${author}
- Published: ${published}
- URL: ${url}
- Captured: ${capturedAt}
- Source type: ${sourceType}
- Capture method: ${effectiveCaptureMethod}
- Snapshot: ${snapshot?.path || "not available"}

## Capture

${bodyContent}

## Images

${[...embedded.images, ...explicitImages].length ? [...embedded.images, ...explicitImages].join("\n") : "- Inline markdown images are preserved in Capture. Additional explicit images were not provided."}

## Extracted Claims

-

## Candidate Wiki Links

-

## Processing Notes

- Status: ${resolvedStatus}
- Follow-up reasons: ${followupReasons.length ? followupReasons.join("; ") : "none"}
${extractionNote}- Mirrored inline images: ${mirroredContent.copied}
- Embedded local assets: ${embedded.copied}
${warningsNote}${attachmentNote}- Image mirror failures: ${mirroredContent.failures.length}
- Next action: compile durable ideas into wiki pages, close core related links, then mark processed.
`;

  await fs.writeFile(target, body, "utf8");
  await appendLog(`CAPTURE_RAW source="${path.relative(vault, target)}" type="${sourceType}" snapshot="${snapshot?.path || ""}"`, vault);

  return {
    path: target,
    vaultRelative: path.relative(vault, target).replace(/\\/g, "/"),
    title,
    collection: resolvedCollection,
    originalFilename,
    sourcePath,
    snapshot: snapshot?.path || "",
    captureMethod: effectiveCaptureMethod,
    mirroredInlineImages: mirroredContent.copied,
    mirroredImageFailures: mirroredContent.failures,
    explicitImages: explicitImages.length,
    textExtraction: textExtraction || extractionStatus,
    extractionStatus,
    extractionMethod,
    extractedPages: Number(extractedPages) || 0,
    extractedCharacters: Number(extractedCharacters) || 0,
    extractedUnits: Number(extractedUnits) || 0,
    extractionConfidence: Number(extractionConfidence) || 0,
    embeddedAssets: embedded.copied,
    attachmentFailures,
    followupReasons,
    status: resolvedStatus
  };
}

async function saveSnapshot({ vault, rawBase, url, snapshotFile, snapshotReference, shouldSnapshot, fetchMaxBytes, validateUrl }) {
  const snapshotsDir = path.join(vault, "raw", "snapshots");
  await fs.mkdir(snapshotsDir, { recursive: true });
  if (snapshotReference) {
    const target = path.resolve(vault, snapshotReference);
    const relative = path.relative(snapshotsDir, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe snapshot reference: ${snapshotReference}`);
    const buffer = await fs.readFile(target);
    return {
      path: path.relative(vault, target).replace(/\\/g, "/"),
      buffer,
      contentType: contentTypeForExtension(path.extname(target)),
      method: "shared-snapshot"
    };
  }
  if (snapshotFile) {
    const resolved = path.resolve(snapshotFile);
    const ext = path.extname(resolved) || ".bin";
    const target = path.join(snapshotsDir, `${rawBase}${ext}`);
    await fs.copyFile(resolved, target);
    const buffer = await fs.readFile(target);
    return {
      path: path.relative(vault, target).replace(/\\/g, "/"),
      buffer,
      contentType: contentTypeForExtension(ext),
      method: "snapshot-file"
    };
  }
  if (!shouldSnapshot || !/^https?:\/\//i.test(url)) return null;
  try {
    const { buffer, contentType } = await fetchBuffer(url, fetchMaxBytes, validateUrl);
    const target = path.join(snapshotsDir, `${rawBase}${extensionForResponse(url, contentType)}`);
    await fs.writeFile(target, buffer);
    return {
      path: path.relative(vault, target).replace(/\\/g, "/"),
      buffer,
      contentType,
      method: "direct-fetch"
    };
  } catch (error) {
    return {
      path: "",
      buffer: null,
      contentType: "",
      method: `snapshot-failed:${error.message}`
    };
  }
}

async function copyExplicitImages({ vault, target, rawBase, imageInputs, shouldMirrorImages, fetchMaxBytes, validateUrl }) {
  const explicitImages = [];
  if (imageInputs.length === 0) return explicitImages;
  const assetDir = path.join(vault, "raw", "assets", rawBase);
  await fs.mkdir(assetDir, { recursive: true });
  for (const image of imageInputs) {
    if (/^https?:\/\//i.test(image) && shouldMirrorImages) {
      try {
        const { buffer, contentType } = await fetchBuffer(image, fetchMaxBytes, validateUrl);
        const basename = `${slugify(path.basename(new URL(image).pathname) || "image")}${guessImageExtension(image, contentType)}`;
        const copied = path.join(assetDir, basename);
        await fs.writeFile(copied, buffer);
        const relative = portableAssetReference(path.relative(path.dirname(target), copied));
        explicitImages.push(`![${basename}](${relative})`);
        continue;
      } catch {
        explicitImages.push(`![${path.basename(image)}](${image})`);
        continue;
      }
    }
    if (/^https?:\/\//i.test(image)) {
      explicitImages.push(`![${path.basename(image)}](${image})`);
      continue;
    }
    const resolved = path.resolve(image);
    if (!(await exists(resolved))) {
      explicitImages.push(`- Missing local image: \`${image}\``);
      continue;
    }
    const copied = path.join(assetDir, path.basename(resolved));
    await fs.copyFile(resolved, copied);
    const relative = portableAssetReference(path.relative(path.dirname(target), copied));
    explicitImages.push(`![${path.basename(resolved)}](${relative})`);
  }
  return explicitImages;
}

async function materializeEmbeddedAssets({ vault, notePath, rawBase, markdown, assets }) {
  if (!assets.length) return { markdown, copied: 0, images: [] };
  const assetDir = path.join(vault, "raw", "assets", rawBase);
  await fs.mkdir(assetDir, { recursive: true });
  const used = new Set();
  const images = [];
  let rewritten = markdown;
  let copied = 0;
  for (const [index, asset] of assets.entries()) {
    if (!asset?.buffer) continue;
    const basename = uniqueAssetName(safeAssetName(asset.name || `asset-${index + 1}.bin`), used);
    const target = path.join(assetDir, basename);
    await fs.writeFile(target, asset.buffer);
    const relative = portableAssetReference(path.relative(path.dirname(notePath), target));
    const references = [...new Set([asset.reference, ...(Array.isArray(asset.references) ? asset.references : [])].filter(Boolean).map(String))];
    const referencedInCapture = references.some((reference) => rewritten.includes(reference));
    for (const reference of references) rewritten = rewritten.split(reference).join(relative);
    if (!referencedInCapture) images.push(isImageFilename(basename) ? `![${basename}](${relative})` : `- [${basename}](${relative})`);
    copied += 1;
  }
  return { markdown: rewritten, copied, images };
}

async function localImageAttachmentFailures(notePath, markdown) {
  const references = [];
  for (const match of String(markdown).matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)) {
    references.push(match[1] || match[2] || "");
  }
  for (const match of String(markdown).matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    references.push(match[1] || match[2] || match[3] || "");
  }
  const failures = [];
  for (const value of [...new Set(references)]) {
    const target = localAttachmentTarget(value);
    if (!target) continue;
    const resolved = path.resolve(path.dirname(notePath), target);
    if (!(await exists(resolved))) failures.push(target);
  }
  return failures;
}

function localAttachmentTarget(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /^(?:https?:|data:|#|\/)/i.test(trimmed)) return "";
  const withoutAnchor = trimmed.split("#")[0].split("?")[0];
  try {
    return decodeURIComponent(withoutAnchor).replace(/\\/g, "/");
  } catch {
    return withoutAnchor.replace(/\\/g, "/");
  }
}

function portableAssetReference(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment === "." || segment === ".." ? segment : encodeURIComponent(segment))
    .join("/");
}

async function mirrorMarkdownImages({ vault, notePath, noteSlug, markdown, fetchMaxBytes, validateUrl }) {
  const assetDir = path.join(vault, "raw", "assets", noteSlug);
  await fs.mkdir(assetDir, { recursive: true });
  let copied = 0;
  const failures = [];
  const replaced = [];
  let index = 0;
  const rewritten = await replaceAsync(markdown, /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi, async (full, alt, url) => {
    index += 1;
    try {
      const { buffer, contentType } = await fetchBuffer(url, fetchMaxBytes, validateUrl);
      const basename = `${String(index).padStart(2, "0")}-${slugify(alt || "image")}${guessImageExtension(url, contentType)}`;
      const target = path.join(assetDir, basename);
      await fs.writeFile(target, buffer);
      const relative = portableAssetReference(path.relative(path.dirname(notePath), target));
      copied += 1;
      replaced.push(url);
      return `![${alt || basename}](${relative})`;
    } catch (error) {
      failures.push({ url, error: error.message });
      return full;
    }
  });
  return { markdown: rewritten, copied, failures, replaced };
}

async function fetchBuffer(url, maxBytes = DEFAULT_FETCH_BYTES, validateUrl = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    let currentUrl = url;
    let response = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (validateUrl) await validateUrl(currentUrl);
      response = await fetch(currentUrl, {
        headers: { "user-agent": "Mozilla/5.0 (My Wiki Local Capture)" },
        redirect: "manual",
        signal: controller.signal
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} has no location`);
      currentUrl = new URL(location, currentUrl).href;
      if (redirects === 5) throw new Error("Too many redirects");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
    return { buffer, contentType: response.headers.get("content-type") || "" };
  } finally {
    clearTimeout(timeout);
  }
}

function contentFromSnapshot(snapshot, sourceType) {
  if (!snapshot?.buffer) return originalFileNotice(snapshot?.path);
  const contentType = snapshot.contentType || "";
  if (/html/i.test(contentType) || /webpage|html/i.test(sourceType)) {
    return htmlToMarkdown(snapshot.buffer.toString("utf8"));
  }
  if (/^(?:text\/|application\/(?:json|xml))/i.test(contentType) || /markdown|text|json|xml/i.test(sourceType)) {
    return snapshot.buffer.toString("utf8").trim();
  }
  return originalFileNotice(snapshot.path);
}

function htmlToMarkdown(html) {
  const cleaned = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi, (_, a, b, c) => `\n![](${a || b || c})\n`)
    .replace(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi, (_, a, b, c, label) => `[${stripTags(label)}](${a || b || c})`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, value) => `\n${"#".repeat(Number(level))} ${stripTags(value)}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, value) => `\n- ${stripTags(value)}`)
    .replace(/<(?:p|div|section|article|main|header|footer|tr|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/[^>]+>/g, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(cleaned)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value) {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return named[entity.toLowerCase()] ?? full;
  });
}

function extensionForResponse(url, contentType = "") {
  if (/pdf/i.test(contentType) || /\.pdf(?:$|\?)/i.test(url)) return ".pdf";
  if (/json/i.test(contentType) || /\.json(?:$|\?)/i.test(url)) return ".json";
  return ".html";
}

function guessImageExtension(url, contentType = "") {
  const fromType = contentType.match(/image\/([a-z0-9.+-]+)/i)?.[1];
  if (fromType) return `.${fromType.replace("jpeg", "jpg")}`;
  const fromPath = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1];
  return fromPath ? `.${fromPath}` : ".img";
}

function contentTypeForExtension(extension) {
  const ext = String(extension).toLowerCase();
  if ([".md", ".markdown", ".txt", ".csv"].includes(ext)) return "text/plain";
  if ([".html", ".htm"].includes(ext)) return "text/html";
  if (ext === ".json") return "application/json";
  if (ext === ".xml") return "application/xml";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function safeAssetName(value) {
  return path.basename(String(value || "asset.bin")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 160) || "asset.bin";
}

function uniqueAssetName(value, used) {
  const extension = path.extname(value);
  const stem = path.basename(value, extension);
  let candidate = value;
  let index = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem}-${index++}${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function isImageFilename(value) {
  return /\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg)$/i.test(value);
}

function originalFileNotice(snapshotPath = "") {
  return snapshotPath
    ? `The original source file is preserved at \`${snapshotPath}\`. Read the original during knowledge maintenance.`
    : "Add source content here.";
}

async function replaceAsync(text, pattern, replacer) {
  const matches = [];
  text.replace(pattern, (...args) => {
    matches.push(args);
    return args[0];
  });
  const results = await Promise.all(matches.map((args) => replacer(...args)));
  let index = 0;
  return text.replace(pattern, () => results[index++]);
}
