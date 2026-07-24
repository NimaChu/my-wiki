#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLog,
  exists,
  parseFrontmatter,
  slugify,
  vaultPath,
  yamlString
} from "./wiki-lib.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function has(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Usage:
  my-wiki images --source raw/sources/source-note.md [--limit 40] [--no-download] [--no-update-note]

Extract image evidence from a raw note and its snapshots, mirror remote images into
raw/assets/<source-note>/, write image-index.json, and update the raw note's Images section.`);
}

function stripFrontmatter(content) {
  const range = frontmatterRange(content);
  return range ? content.slice(range.blockEnd) : content;
}

function frontmatterRange(content) {
  const offset = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  const start = content.slice(offset).match(/^---\r?\n/);
  if (!start) return null;
  const dataStart = offset + start[0].length;
  const rest = content.slice(dataStart);
  const end = rest.match(/\r?\n---(?=\r?\n|$)/);
  if (!end) return null;
  const dataEnd = dataStart + end.index;
  return { dataStart, dataEnd, blockEnd: dataEnd + end[0].length };
}

function stripImagesSections(content) {
  return content.replace(/\r?\n## Images\r?\n[\s\S]*?(?=\r?\n## |\s*$)/g, "");
}

function toVaultRelative(vault, target) {
  return path.relative(vault, target).replace(/\\/g, "/");
}

function normalizePathForFrontmatter(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^["']|["']$/g, "");
}

function resolveVaultFile(vault, value) {
  const cleaned = normalizePathForFrontmatter(value);
  if (!cleaned) return "";
  return path.isAbsolute(cleaned) ? cleaned : path.join(vault, cleaned);
}

function sectionBefore(text, index) {
  const before = text.slice(0, index);
  const matches = Array.from(before.matchAll(/^#{1,6}\s+(.+)$/gm));
  return matches.length ? matches.at(-1)[1].trim() : "";
}

function contextAround(text, index, length) {
  return text
    .slice(Math.max(0, index - 260), Math.min(text.length, index + length + 320))
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, (match) => match.replace(/^\[|\]\([^)]+\)$/g, ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function attr(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match ? (match[2] || match[3] || match[4] || "").trim() : "";
}

function absolutize(url, baseUrl) {
  const cleaned = String(url || "").trim();
  if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("#")) return "";
  if (/^(?:raw|wiki|templates|_archive)\//.test(cleaned) || /^\.\.?\//.test(cleaned)) return cleaned;
  try {
    return new URL(cleaned, baseUrl || undefined).href;
  } catch {
    return cleaned;
  }
}

function extractImages(text, { baseUrl = "", source = "" } = {}) {
  const images = [];
  const markdownPattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of text.matchAll(markdownPattern)) {
    const url = absolutize(match[2], baseUrl);
    if (!url) continue;
    images.push({
      url,
      alt: match[1].trim(),
      section: sectionBefore(text, match.index),
      context: contextAround(text, match.index, match[0].length),
      source,
      syntax: "markdown"
    });
  }

  const htmlPattern = /<img\b[^>]*>/gi;
  for (const match of text.matchAll(htmlPattern)) {
    const url = absolutize(attr(match[0], "src"), baseUrl);
    if (!url) continue;
    images.push({
      url,
      alt: attr(match[0], "alt"),
      section: sectionBefore(text, match.index),
      context: contextAround(text, match.index, match[0].length),
      source,
      syntax: "html"
    });
  }
  return images;
}

function guessImageExtension(url, contentType = "") {
  const type = contentType.match(/image\/([a-z0-9.+-]+)/i)?.[1];
  if (type) return `.${type.replace("jpeg", "jpg").replace("svg+xml", "svg")}`;
  try {
    const ext = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1];
    if (ext) return `.${ext.toLowerCase()}`;
  } catch {
    // Fall through to the generic extension.
  }
  return ".img";
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Codex My Wiki Image Capture)"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || ""
  };
}

async function readCandidateTexts({ vault, notePath, noteContent, frontmatter, includeSnapshots }) {
  const candidates = [{
    source: toVaultRelative(vault, notePath),
    text: stripImagesSections(stripFrontmatter(noteContent))
  }];
  if (!includeSnapshots) return candidates;

  const snapshotKeys = [
    "snapshot_markdown_path",
    "snapshot_html_path",
    "snapshot_path"
  ];
  const seen = new Set();
  for (const key of snapshotKeys) {
    const resolved = resolveVaultFile(vault, frontmatter[key]);
    if (!resolved || seen.has(resolved) || !(await exists(resolved))) continue;
    seen.add(resolved);
    const ext = path.extname(resolved).toLowerCase();
    if (![".md", ".markdown", ".txt", ".html", ".htm"].includes(ext)) continue;
    candidates.push({
      source: toVaultRelative(vault, resolved),
      text: await fs.readFile(resolved, "utf8")
    });
  }
  return candidates;
}

function dedupeImages(images, limit) {
  const byUrl = new Map();
  for (const image of images) {
    const key = image.url.replace(/#.*$/, "");
    if (!byUrl.has(key)) byUrl.set(key, image);
    else {
      const existing = byUrl.get(key);
      if (!existing.alt && image.alt) existing.alt = image.alt;
      if (!existing.section && image.section) existing.section = image.section;
      if (!existing.context && image.context) existing.context = image.context;
    }
  }
  return Array.from(byUrl.values()).slice(0, limit);
}

function upsertFrontmatter(content, updates) {
  const range = frontmatterRange(content);
  if (!range) return content;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.slice(range.dataStart, range.dataEnd).split(/\r?\n/);
  const next = [];
  const pending = new Map(Object.entries(updates));
  for (let i = 0; i < lines.length; i += 1) {
    const key = lines[i].match(/^([A-Za-z0-9_-]+):/)?.[1];
    if (!key || !pending.has(key)) {
      next.push(lines[i]);
      continue;
    }
    next.push(`${key}: ${yamlString(pending.get(key))}`);
    pending.delete(key);
  }
  for (const [key, value] of pending) next.push(`${key}: ${yamlString(value)}`);
  return `${content.slice(0, range.dataStart)}${next.join(newline)}${content.slice(range.dataEnd)}`;
}

function replaceImagesSection(content, section) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const withoutImages = stripImagesSections(content);
  const marker = withoutImages.match(/\r?\n## Extracted Claims/);
  if (marker?.index !== undefined) {
    return `${withoutImages.slice(0, marker.index)}${newline}${section.trim().replace(/\n/g, newline)}${newline}${withoutImages.slice(marker.index)}`;
  }
  return `${withoutImages.trimEnd()}${newline}${newline}${section.trim().replace(/\n/g, newline)}${newline}`;
}

function imagesSection({ images, indexPath, generatedAt }) {
  const lines = [
    "## Images",
    "",
    `Image inventory generated at ${generatedAt}. Full machine-readable index: \`${indexPath}\`.`,
    "",
    "| # | Preview | Section | Notes |",
    "| --- | --- | --- | --- |"
  ];
  if (!images.length) {
    lines.push("| - | - | - | No images found in note or snapshots. |");
    return lines.join("\n");
  }
  for (const image of images) {
    const preview = image.local_note_path
      ? `![${image.alt || image.id}](${image.local_note_path})`
      : `[remote image](${image.url})`;
    const notes = [
      image.alt ? `alt: ${image.alt}` : "",
      image.context || ""
    ].filter(Boolean).join(" - ").replace(/\|/g, "\\|");
    lines.push(`| ${image.index} | ${preview} | ${image.section || "source"} | ${notes || image.url} |`);
  }
  return lines.join("\n");
}

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = vaultPath();
const sourceArg = arg("--source");
if (!sourceArg || has("--help") || has("-h")) {
  usage();
  process.exit(sourceArg ? 0 : 2);
}

const limit = Number(arg("--limit", "60"));
const shouldDownload = !has("--no-download");
const shouldUpdateNote = !has("--no-update-note");
const includeSnapshots = !has("--no-snapshots");
const sourcePath = path.isAbsolute(sourceArg) ? sourceArg : path.join(vault, sourceArg);
const noteContent = await fs.readFile(sourcePath, "utf8");
const frontmatter = parseFrontmatter(noteContent);
const baseUrl = arg("--base-url", frontmatter.source_url || "");
const sourceBase = path.basename(sourcePath, ".md");
const assetDir = path.join(vault, "raw", "assets", sourceBase);
await fs.mkdir(assetDir, { recursive: true });

const candidates = await readCandidateTexts({
  vault,
  notePath: sourcePath,
  noteContent,
  frontmatter,
  includeSnapshots
});
const extracted = dedupeImages(
  candidates.flatMap((candidate) => extractImages(candidate.text, { baseUrl, source: candidate.source })),
  limit
);

const mirrored = [];
for (let i = 0; i < extracted.length; i += 1) {
  const image = extracted[i];
  const index = i + 1;
  const id = `${String(index).padStart(2, "0")}-${slugify(image.alt || image.section || "image")}`;
  const record = {
    index,
    id,
    url: image.url,
    alt: image.alt,
    section: image.section,
    context: image.context,
    discovered_in: image.source,
    syntax: image.syntax,
    local_path: "",
    local_note_path: "",
    content_type: "",
    bytes: 0,
    status: shouldDownload ? "pending" : "remote-only",
    error: ""
  };
  if (!/^https?:\/\//i.test(image.url)) {
    const rootStyle = /^(?:raw|wiki|templates|_archive)\//.test(image.url);
    const discoveredIn = image.source ? path.join(vault, ...image.source.split("/")) : sourcePath;
    const resolved = rootStyle ? path.join(vault, ...image.url.split("/")) : path.resolve(path.dirname(discoveredIn), image.url);
    if (await exists(resolved)) {
      const stat = await fs.stat(resolved);
      record.local_path = toVaultRelative(vault, resolved);
      record.local_note_path = path.relative(path.dirname(sourcePath), resolved).replace(/\\/g, "/");
      record.bytes = stat.size;
      record.status = "local";
    } else {
      record.status = "missing-local";
      record.error = `Local image not found: ${image.url}`;
    }
  } else if (shouldDownload) {
    try {
      const { buffer, contentType } = await fetchBuffer(image.url);
      const target = path.join(assetDir, `${id}${guessImageExtension(image.url, contentType)}`);
      await fs.writeFile(target, buffer);
      record.local_path = toVaultRelative(vault, target);
      record.local_note_path = path.relative(path.dirname(sourcePath), target).replace(/\\/g, "/");
      record.content_type = contentType;
      record.bytes = buffer.length;
      record.status = "mirrored";
    } catch (error) {
      record.status = "failed";
      record.error = error.message;
    }
  }
  mirrored.push(record);
}

const generatedAt = new Date().toISOString();
const availableImages = mirrored.filter((image) => image.status === "mirrored" || image.status === "local");
const indexPathAbs = path.join(assetDir, "image-index.json");
const indexPath = toVaultRelative(vault, indexPathAbs);
await fs.writeFile(indexPathAbs, JSON.stringify({
  source_note: toVaultRelative(vault, sourcePath),
  source_url: frontmatter.source_url || "",
  generated_at: generatedAt,
  images: mirrored
}, null, 2) + "\n", "utf8");

if (shouldUpdateNote) {
  let updated = upsertFrontmatter(noteContent, {
    image_index_path: indexPath,
    image_count: String(mirrored.length),
    mirrored_image_count: String(availableImages.length)
  });
  updated = replaceImagesSection(updated, imagesSection({ images: mirrored, indexPath, generatedAt }));
  await fs.writeFile(sourcePath, updated, "utf8");
  await appendLog(`IMAGE_ASSETS source="${toVaultRelative(vault, sourcePath)}" images="${mirrored.length}" local="${availableImages.length}"`, vault);
}

console.log(JSON.stringify({
  vault,
  source: toVaultRelative(vault, sourcePath),
  assetDir: toVaultRelative(vault, assetDir),
  indexPath,
  discovered: extracted.length,
  mirrored: mirrored.filter((image) => image.status === "mirrored").length,
  local: availableImages.length,
  failed: mirrored.filter((image) => image.status === "failed").map((image) => ({ url: image.url, error: image.error })),
  updatedNote: shouldUpdateNote,
  script: path.relative(vault, path.join(here, "image-assets.mjs")).replace(/\\/g, "/")
}, null, 2));
