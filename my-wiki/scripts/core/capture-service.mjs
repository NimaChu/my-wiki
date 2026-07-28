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
  content = "",
  textExtraction = "",
  extractedPages = 0,
  extractedCharacters = 0,
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
  const snapshot = await saveSnapshot({ vault, rawBase, url, snapshotFile, shouldSnapshot, fetchMaxBytes, validateUrl });
  if (requireSnapshot && !snapshot?.path) {
    throw new Error(snapshot?.method?.replace(/^snapshot-failed:/, "") || "The source could not be captured");
  }
  const capturedContent = content.trim() || contentFromSnapshot(snapshot, sourceType);
  const mirroredContent = shouldMirrorImages
    ? await mirrorMarkdownImages({ vault, notePath: target, noteSlug: rawBase, markdown: capturedContent, fetchMaxBytes, validateUrl })
    : { markdown: capturedContent, copied: 0, failures: [], replaced: [] };

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
  const digestBasis = snapshot?.buffer || Buffer.from(bodyContent);
  const effectiveCaptureMethod = captureMethod || snapshot?.method || (content ? "agent-provided" : "manual");
  const tags = ["raw"];
  if (snapshot?.path) tags.push("snapshotted");
  if (mirroredContent.copied > 0 || explicitImages.length > 0) tags.push("images");
  const extractionFrontmatter = textExtraction
    ? `text_extraction: ${yamlString(textExtraction)}\nextracted_pages: ${Number(extractedPages) || 0}\nextracted_characters: ${Number(extractedCharacters) || 0}\n`
    : "";
  const extractionNote = textExtraction
    ? `- Text extraction: ${textExtraction} (${Number(extractedPages) || 0} pages, ${Number(extractedCharacters) || 0} characters)\n`
    : "";

  const body = `---
title: ${yamlString(title)}
type: raw-source
source_type: ${yamlString(sourceType)}
collection: ${yamlString(resolvedCollection)}
status: inbox
author: ${yamlString(author)}
published: ${yamlString(published)}
captured: ${yamlString(capturedAt)}
source_url: ${yamlString(url)}
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

${explicitImages.length ? explicitImages.join("\n") : "- Inline markdown images are preserved in Capture. Additional explicit images were not provided."}

## Extracted Claims

-

## Candidate Wiki Links

-

## Processing Notes

- Status: inbox
${extractionNote}- Mirrored inline images: ${mirroredContent.copied}
- Image mirror failures: ${mirroredContent.failures.length}
- Next action: compile durable ideas into wiki pages, close core related links, then mark processed.
`;

  await fs.writeFile(target, body, "utf8");
  await appendLog(`CAPTURE_RAW source="${path.relative(vault, target)}" type="${sourceType}" snapshot="${snapshot?.path || ""}"`, vault);

  return {
    path: target,
    vaultRelative: path.relative(vault, target).replace(/\\/g, "/"),
    title,
    collection: resolvedCollection,
    snapshot: snapshot?.path || "",
    captureMethod: effectiveCaptureMethod,
    mirroredInlineImages: mirroredContent.copied,
    mirroredImageFailures: mirroredContent.failures,
    explicitImages: explicitImages.length,
    textExtraction,
    extractedPages: Number(extractedPages) || 0,
    extractedCharacters: Number(extractedCharacters) || 0,
    status: "inbox"
  };
}

async function saveSnapshot({ vault, rawBase, url, snapshotFile, shouldSnapshot, fetchMaxBytes, validateUrl }) {
  const snapshotsDir = path.join(vault, "raw", "snapshots");
  await fs.mkdir(snapshotsDir, { recursive: true });
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
        const relative = path.relative(path.dirname(target), copied).replace(/\\/g, "/");
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
    const relative = path.relative(path.dirname(target), copied).replace(/\\/g, "/");
    explicitImages.push(`![${path.basename(resolved)}](${relative})`);
  }
  return explicitImages;
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
      const relative = path.relative(path.dirname(notePath), target).replace(/\\/g, "/");
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
