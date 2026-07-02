#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  appendLog,
  exists,
  hashContent,
  slugify,
  vaultPath,
  yamlList,
  yamlString
} from "./wiki-lib.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function args(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

function has(name) {
  return process.argv.includes(name);
}

async function stdin() {
  if (process.stdin.isTTY) return "";
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
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

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Codex Karpathy Wiki Capture)"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType: response.headers.get("content-type") || "" };
}

async function saveSnapshot({ vault, rawBase, url, snapshotFile, shouldSnapshot }) {
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
      method: "snapshot-file"
    };
  }
  if (!shouldSnapshot || !/^https?:\/\//i.test(url)) return null;
  try {
    const { buffer, contentType } = await fetchBuffer(url);
    const target = path.join(snapshotsDir, `${rawBase}${extensionForResponse(url, contentType)}`);
    await fs.writeFile(target, buffer);
    return {
      path: path.relative(vault, target).replace(/\\/g, "/"),
      buffer,
      method: "direct-fetch"
    };
  } catch (error) {
    return {
      path: "",
      buffer: null,
      method: `snapshot-failed:${error.message}`
    };
  }
}

async function mirrorMarkdownImages({ vault, notePath, noteSlug, markdown }) {
  const assetDir = path.join(vault, "raw", "assets", noteSlug);
  await fs.mkdir(assetDir, { recursive: true });
  let copied = 0;
  const failures = [];
  const replaced = [];
  let index = 0;
  const rewritten = await replaceAsync(markdown, /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi, async (full, alt, url) => {
    index += 1;
    const imageIndex = index;
    try {
      const { buffer, contentType } = await fetchBuffer(url);
      const basename = `${String(imageIndex).padStart(2, "0")}-${slugify(alt || "image")}${guessImageExtension(url, contentType)}`;
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

async function replaceAsync(text, pattern, replacer) {
  const matches = [];
  text.replace(pattern, (...args) => {
    matches.push(args);
    return args[0];
  });
  const results = await Promise.all(matches.map((args) => replacer(...args)));
  let i = 0;
  return text.replace(pattern, () => results[i++]);
}

const vault = vaultPath();
const title = arg("--title", "Untitled Source");
const url = arg("--url", "");
const sourceType = arg("--type", url ? "webpage" : "note");
const author = arg("--author", "");
const published = arg("--published", "");
const sourceQuality = arg("--source-quality", url ? "primary-url" : "captured");
const captureMethod = arg("--capture-method", "");
const snapshotFile = arg("--snapshot-file", "");
const contentFile = arg("--content-file", "");
const inputContent = contentFile ? await fs.readFile(contentFile, "utf8") : await stdin();
const imageInputs = args("--image");
const shouldSnapshot = !has("--no-snapshot");
const shouldMirrorImages = !has("--no-mirror-images");
const date = new Date().toISOString().slice(0, 10);
const capturedAt = new Date().toISOString();
const rawDir = path.join(vault, "raw");
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
const snapshot = await saveSnapshot({ vault, rawBase, url, snapshotFile, shouldSnapshot });
const mirroredContent = shouldMirrorImages
  ? await mirrorMarkdownImages({ vault, notePath: target, noteSlug: rawBase, markdown: inputContent.trim() })
  : { markdown: inputContent.trim(), copied: 0, failures: [], replaced: [] };

const explicitImages = [];
if (imageInputs.length > 0) {
  const assetDir = path.join(rawDir, "assets", rawBase);
  await fs.mkdir(assetDir, { recursive: true });
  for (const image of imageInputs) {
    if (/^https?:\/\//i.test(image) && shouldMirrorImages) {
      try {
        const { buffer, contentType } = await fetchBuffer(image);
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
}

const bodyContent = mirroredContent.markdown || "Add source content here.";
const digestBasis = snapshot?.buffer || Buffer.from(bodyContent);
const effectiveCaptureMethod = captureMethod || snapshot?.method || (contentFile || inputContent ? "agent-provided" : "manual");
const tags = ["raw"];
if (snapshot?.path) tags.push("snapshotted");
if (mirroredContent.copied > 0 || explicitImages.length > 0) tags.push("images");

const body = `---
title: ${yamlString(title)}
type: raw-source
source_type: ${yamlString(sourceType)}
status: inbox
author: ${yamlString(author)}
published: ${yamlString(published)}
captured: ${yamlString(capturedAt)}
source_url: ${yamlString(url)}
snapshot_path: ${yamlString(snapshot?.path || "")}
content_hash: ${yamlString(hashContent(digestBasis))}
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
- Mirrored inline images: ${mirroredContent.copied}
- Image mirror failures: ${mirroredContent.failures.length}
- Next action: compile durable ideas into wiki pages, close core related links, then mark processed.
`;

await fs.writeFile(target, body, "utf8");
await appendLog(`CAPTURE_RAW source="${path.relative(vault, target)}" type="${sourceType}" snapshot="${snapshot?.path || ""}"`);

let refresh = null;
if (!has("--no-refresh")) {
  const refreshScript = new URL("./refresh-dashboard.mjs", import.meta.url).pathname;
  const result = spawnSync("node", [refreshScript, "--serve"], { encoding: "utf8" });
  const jsonStart = result.stdout.indexOf('{\n  "vault"');
  refresh = {
    status: result.status,
    stdout: jsonStart >= 0 ? JSON.parse(result.stdout.slice(jsonStart)) : null,
    stderr: result.stderr || ""
  };
}

console.log(JSON.stringify({
  path: target,
  vaultRelative: path.relative(vault, target).replace(/\\/g, "/"),
  title,
  snapshot: snapshot?.path || "",
  captureMethod: effectiveCaptureMethod,
  mirroredInlineImages: mirroredContent.copied,
  mirroredImageFailures: mirroredContent.failures,
  explicitImages: explicitImages.length,
  refreshed: refresh?.status === 0,
  dashboard: refresh?.stdout?.url || "not refreshed",
  next: refresh?.status === 0
    ? "Read this raw note, synthesize wiki pages, close related links, mark processed only after wiki backlinks exist. Dashboard graph has already been refreshed."
    : "Read this raw note, synthesize wiki pages, close related links, mark processed only after wiki backlinks exist, then refresh the dashboard."
}, null, 2));
