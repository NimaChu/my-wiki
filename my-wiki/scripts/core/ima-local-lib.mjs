import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  appendLog,
  exists,
  hashContent,
  slugify,
  vaultPath,
  yamlString
} from "./wiki-lib.mjs";

export const defaultImaBaseUrl = "https://ima.qq.com";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function readImaCredentials() {
  const clientId = process.env.IMA_OPENAPI_CLIENTID || process.env.IMA_CLIENT_ID || await readConfigSecret("client_id");
  const apiKey = process.env.IMA_OPENAPI_APIKEY || process.env.IMA_API_KEY || await readConfigSecret("api_key");
  if (!clientId || !apiKey) {
    throw new Error("Missing IMA credentials. Set IMA_OPENAPI_CLIENTID/IMA_OPENAPI_APIKEY or ~/.config/ima/client_id and ~/.config/ima/api_key.");
  }
  return { clientId: clientId.trim(), apiKey: apiKey.trim() };
}

async function readConfigSecret(name) {
  const target = path.join(os.homedir(), ".config", "ima", name);
  try {
    return (await fs.readFile(target, "utf8")).trim();
  } catch {
    return "";
  }
}

export function createImaClient({ auth, baseUrl = defaultImaBaseUrl, delayMs = 750 } = {}) {
  const normalizedBaseUrl = String(baseUrl || defaultImaBaseUrl).replace(/\/+$/, "");

  async function call(apiPath, body) {
    const attempts = [0, 3000, 8000, 15000, 30000];
    let lastError = "";
    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      if (attempts[attempt]) await sleep(attempts[attempt]);
      if (delayMs > 0) await sleep(delayMs);
      const response = await fetch(`${normalizedBaseUrl}/${apiPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "ima-openapi-clientid": auth.clientId,
          "ima-openapi-apikey": auth.apiKey
        },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      const data = safeJson(text);
      const message = data?.msg || text.slice(0, 200);
      const rateLimited = response.status === 403 && /frequency|rate|limit|too many/i.test(message);
      if (!response.ok) {
        lastError = `IMA HTTP error ${response.status}: ${message}`;
        if (rateLimited && attempt < attempts.length - 1) continue;
        throw new Error(lastError);
      }
      if (!data) throw new Error(`IMA API returned non-JSON output for ${apiPath}.`);
      if (data.code !== 0) {
        lastError = `IMA API business error: ${data.msg || `code ${data.code}`}`;
        if (/frequency|rate|limit|too many/i.test(String(data.msg || "")) && attempt < attempts.length - 1) continue;
        throw new Error(lastError);
      }
      return data.data || {};
    }
    throw new Error(lastError || "IMA API call failed after retries.");
  }

  return { baseUrl: normalizedBaseUrl, call };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(value) {
  try {
    return JSON.parse(String(value || "").trim());
  } catch {
    return null;
  }
}

export function mediaTypeLabel(value) {
  const labels = new Map([
    [1, "PDF"],
    [2, "WEBPAGE"],
    [3, "WORD"],
    [4, "PPT"],
    [5, "EXCEL"],
    [6, "WECHAT_ARTICLE"],
    [7, "MARKDOWN"],
    [9, "IMAGE"],
    [11, "NOTE"],
    [12, "AI_SESSION"],
    [13, "TXT"],
    [14, "XMIND"],
    [15, "AUDIO"],
    [16, "VIDEO_PARSE"]
  ]);
  const numeric = Number(value);
  return labels.get(numeric) || String(value || "UNKNOWN");
}

export async function fetchImaOriginal(client, mediaId) {
  const info = await client.call("openapi/wiki/v1/get_media_info", { media_id: mediaId });
  if (Number(info.media_type) === 11 && info.notebook_ext_info?.notebook_id) {
    const note = await client.call("openapi/note/v1/get_doc_content", {
      note_id: info.notebook_ext_info.notebook_id,
      target_content_format: 0
    });
    return normalizeOriginal({
      info,
      sourceUrl: info.url_info?.url || "",
      content: note.content || "",
      contentType: "text/markdown; charset=utf-8",
      binary: null,
      fetchMethod: "ima-note-content"
    });
  }

  const urlInfo = info.url_info || {};
  if (!urlInfo.url) {
    return normalizeOriginal({
      info,
      sourceUrl: "",
      content: "",
      contentType: "",
      binary: null,
      fetchMethod: "ima-metadata-only",
      error: "IMA media has no accessible url_info.url."
    });
  }

  const response = await fetch(urlInfo.url, { headers: urlInfo.headers || {} });
  if (!response.ok) throw new Error(`IMA content fetch failed: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = isTextualMedia(info.media_type, contentType, urlInfo.url)
    ? buffer.toString("utf8")
    : "";
  return normalizeOriginal({
    info,
    sourceUrl: urlInfo.url,
    content: text,
    contentType,
    binary: text ? null : buffer,
    fetchMethod: "ima-url-fetch"
  });
}

function normalizeOriginal({ info, sourceUrl, content, contentType, binary, fetchMethod, error = "" }) {
  return {
    info,
    mediaType: Number(info.media_type),
    mediaTypeLabel: mediaTypeLabel(info.media_type),
    sourceUrl,
    content,
    contentType,
    binary,
    fetchMethod,
    error,
    title: info.title || info.name || info.file_name || "",
    fileName: info.file_name || info.name || ""
  };
}

function isTextualMedia(mediaType, contentType, url = "") {
  const type = String(contentType || "").toLowerCase();
  if (/^(text\/|application\/(json|xml|xhtml\+xml|markdown|javascript))/.test(type)) return true;
  if (/\b(html|markdown|md|plain|json|xml)\b/.test(type)) return true;
  if ([2, 6, 7, 11, 12, 13].includes(Number(mediaType))) return true;
  return /\.(md|markdown|txt|html|htm|json|xml)(?:$|\?)/i.test(url);
}

function extensionForOriginal(original) {
  const contentType = String(original.contentType || "").toLowerCase();
  const url = original.sourceUrl || original.fileName || "";
  const fromType = contentType.match(/(?:image|application|text)\/([a-z0-9.+-]+)/i)?.[1];
  if (contentType.includes("pdf")) return ".pdf";
  if (contentType.includes("html")) return ".html";
  if (contentType.includes("markdown")) return ".md";
  if (contentType.includes("plain")) return ".txt";
  if (contentType.includes("json")) return ".json";
  if (contentType.startsWith("image/")) return `.${fromType.replace("jpeg", "jpg").replace("svg+xml", "svg")}`;
  try {
    const ext = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1];
    if (ext) return `.${ext.toLowerCase()}`;
  } catch {
    const ext = String(url).match(/\.([a-z0-9]+)$/i)?.[1];
    if (ext) return `.${ext.toLowerCase()}`;
  }
  return ".bin";
}

export async function materializeOriginal({ vault = vaultPath(), notePath, title, original }) {
  const noteBase = path.basename(notePath, ".md");
  const result = {
    capture: original.content || "",
    snapshotPath: "",
    imageMarkdown: "",
    contentHash: "",
    localFiles: []
  };

  if (original.binary?.length) {
    const ext = extensionForOriginal(original);
    const isImage = String(original.contentType || "").toLowerCase().startsWith("image/") || Number(original.mediaType) === 9;
    if (isImage) {
      const assetDir = path.join(vault, "raw", "assets", noteBase);
      await fs.mkdir(assetDir, { recursive: true });
      const target = path.join(assetDir, `original${ext}`);
      await fs.writeFile(target, original.binary);
      const noteRelative = path.relative(path.dirname(notePath), target).replace(/\\/g, "/");
      const vaultRelative = path.relative(vault, target).replace(/\\/g, "/");
      result.imageMarkdown = `![${title || "IMA image"}](${noteRelative})`;
      result.capture = result.imageMarkdown;
      result.localFiles.push(vaultRelative);
    } else {
      const snapshotDir = path.join(vault, "raw", "snapshots");
      await fs.mkdir(snapshotDir, { recursive: true });
      const target = path.join(snapshotDir, `${noteBase}--original${ext}`);
      await fs.writeFile(target, original.binary);
      result.snapshotPath = path.relative(vault, target).replace(/\\/g, "/");
      result.capture = [
        "_No textual content was returned by IMA for this item._",
        "",
        `The original file was mirrored locally at \`${result.snapshotPath}\`.`,
        original.contentType ? `Content type: \`${original.contentType}\`.` : ""
      ].filter(Boolean).join("\n");
      result.localFiles.push(result.snapshotPath);
    }
  }

  const digest = original.binary?.length ? original.binary : Buffer.from(result.capture || "");
  result.contentHash = hashContent(digest);
  return result;
}

export function rawImaMarkdown({ kb, item, target, original, materialized }) {
  const title = item.title || item.name || original.title || item.media_id;
  const folderName = item.folder_path || item.folder_name || "";
  const capturedAt = new Date().toISOString();
  const sourceUrl = original.sourceUrl || item.url || "";
  const capture = materialized.capture || "_IMA returned metadata but no local content body._";
  const relativeTarget = path.relative(vaultPath(), target).replace(/\\/g, "/");
  const imageInstruction = materialized.imageMarkdown
    ? materialized.imageMarkdown
    : "- Inline Markdown/HTML images are preserved in Capture. `wiki:images` mirrors remote images when image references are present.";

  return `---
title: ${yamlString(title)}
type: raw-source
source_type: ima
collection: "ima"
status: inbox
author: ${yamlString(item.author || "")}
published: ${yamlString(item.published || item.create_time || "")}
captured: ${yamlString(capturedAt)}
source_url: ${yamlString(sourceUrl)}
snapshot_path: ${yamlString(materialized.snapshotPath || "")}
image_index_path: ""
image_count: ""
mirrored_image_count: ""
content_hash: ${yamlString(materialized.contentHash)}
capture_method: ${yamlString(original.fetchMethod || "ima-openapi")}
source_quality: imported
ima_source:
  knowledge_base_id: ${yamlString(kb.id || kb.knowledge_base_id || "")}
  knowledge_base_name: ${yamlString(kb.name || kb.knowledge_base_name || "")}
  folder_id: ${yamlString(item.folder_id || "")}
  folder_name: ${yamlString(folderName)}
  media_id: ${yamlString(item.media_id)}
  media_type: ${yamlString(original.mediaTypeLabel || mediaTypeLabel(item.media_type))}
  content_type: ${yamlString(original.contentType || "")}
tags:
  - raw
  - ima
  - external
related:
---

# ${title}

## Source

- Origin: IMA
- Knowledge base: ${kb.name || kb.knowledge_base_name || ""}
- Folder: ${folderName || "root"}
- Media ID: ${item.media_id}
- Media type: ${original.mediaTypeLabel || mediaTypeLabel(item.media_type)}
- URL: ${sourceUrl || "not available"}
- Captured: ${capturedAt}
- Local raw: ${relativeTarget}
- Snapshot: ${materialized.snapshotPath || "not needed"}

## IMA Source

- Knowledge base ID: ${kb.id || kb.knowledge_base_id || ""}
- Knowledge base name: ${kb.name || kb.knowledge_base_name || ""}
- Folder ID: ${item.folder_id || ""}
- Folder name: ${folderName || "root"}
- Media ID: ${item.media_id}
- Media type: ${original.mediaTypeLabel || mediaTypeLabel(item.media_type)}
- Content type: ${original.contentType || ""}

## Capture

${capture}

## Images

${imageInstruction}

## Extracted Claims

-

## Candidate Wiki Links

-

## Processing Notes

- Status: inbox
- Imported locally from IMA; do not depend on the external platform during routine maintenance or query.
- Next action: compile durable ideas into wiki pages, close core related links, then mark processed.
`;
}

export function extractMediaId(content) {
  return content.match(/media_id:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim() || "";
}

export function hasImageReferences(content) {
  return /!\[[^\]]*\]\([^)]+\)|<img\b/i.test(content);
}

export function replaceSection(content, heading, body) {
  const pattern = new RegExp(`\\n## ${escapeRegExp(heading)}\\n[\\s\\S]*?(?=\\n## |\\n?$)`);
  const section = `\n## ${heading}\n\n${String(body || "").trim()}\n`;
  if (pattern.test(content)) return content.replace(pattern, section);
  const marker = "\n## Extracted Claims";
  const index = content.indexOf(marker);
  if (index >= 0) return `${content.slice(0, index)}${section}${content.slice(index)}`;
  return `${content.trimEnd()}${section}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function upsertFrontmatter(content, updates) {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  const lines = content.slice(4, end).split("\n");
  const pending = new Map(Object.entries(updates).filter(([, value]) => value !== undefined));
  const next = [];
  for (const line of lines) {
    const key = line.match(/^([A-Za-z0-9_-]+):/)?.[1];
    if (!key || !pending.has(key)) {
      next.push(line);
      continue;
    }
    next.push(`${key}: ${yamlString(pending.get(key) ?? "")}`);
    pending.delete(key);
  }
  for (const [key, value] of pending) next.push(`${key}: ${yamlString(value ?? "")}`);
  return `---\n${next.join("\n")}\n---${content.slice(end + 4)}`;
}

export function hasSubstantialCapture(content) {
  const match = content.match(/\n## Capture\n([\s\S]*?)(?=\n## |\n?$)/);
  if (!match) return false;
  const body = match[1]
    .replace(/_No textual content was returned[\s\S]*/i, "")
    .replace(/Add source content here\./i, "")
    .trim();
  return body.length > 80;
}

export function runImageAssets({ source, enabled = true }) {
  if (!enabled) return { skipped: true, reason: "disabled" };
  const result = spawnSync(process.execPath, [path.join(here, "karpathy-wiki.mjs"), "images", "--source", source], {
    encoding: "utf8",
    env: process.env
  });
  if (result.status !== 0) {
    return {
      skipped: false,
      status: result.status,
      error: (result.stderr || result.stdout || "").trim().slice(0, 500)
    };
  }
  const jsonStart = result.stdout.indexOf("{");
  return {
    skipped: false,
    status: result.status,
    output: jsonStart >= 0 ? result.stdout.slice(jsonStart).trim() : result.stdout.trim()
  };
}

export async function logImaImport(source, extra = "") {
  await appendLog(`IMA_IMPORT source="${source}"${extra ? ` ${extra}` : ""}`);
}
