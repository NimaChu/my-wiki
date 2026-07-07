#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exists, slugify, vaultPath, yamlString } from "./wiki-lib.mjs";

const vault = vaultPath();
const rawImaDir = path.join(vault, "raw", "ima");
const defaultBaseUrl = "https://ima.qq.com";
const args = process.argv.slice(2);

function usage() {
  console.log(`IMA pointer sync

Usage:
  npm run wiki:sync-ima
  npm run wiki:sync-ima -- --kb "Agent应用与开发"
  npm run wiki:sync-ima -- --all-kbs --dry-run
  npm run wiki:sync-ima -- --max-items 100

Options:
  --kb <name>          Sync only knowledge bases whose names include this text.
  --all-kbs           Sync every visible knowledge base. This is the default.
  --dry-run           List planned changes without writing files.
  --max-items <n>     Stop after discovering n non-folder items.
  --delay-ms <n>      Delay between IMA API calls. Defaults to 750.
  --summary           Print counts only instead of every planned file.
  --base-url <url>    IMA OpenAPI base URL. Defaults to https://ima.qq.com.
`);
}

function readOption(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || "";
}

const dryRun = args.includes("--dry-run");
const help = args.includes("--help") || args.includes("-h");
const summaryOnly = args.includes("--summary");
const kbFilter = readOption("--kb");
const maxItems = Number(readOption("--max-items") || 0);
const delayMs = Number(readOption("--delay-ms") || 750);
const baseUrl = (readOption("--base-url") || process.env.IMA_OPENAPI_BASE_URL || defaultBaseUrl).replace(/\/+$/, "");

if (help) {
  usage();
  process.exit(0);
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function credentials() {
  const clientId = process.env.IMA_OPENAPI_CLIENTID || await readConfigSecret("client_id");
  const apiKey = process.env.IMA_OPENAPI_APIKEY || await readConfigSecret("api_key");
  if (!clientId || !apiKey) {
    fail("Missing IMA credentials. Set IMA_OPENAPI_CLIENTID/IMA_OPENAPI_APIKEY or ~/.config/ima/client_id and ~/.config/ima/api_key.");
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

async function callIma(auth, apiPath, body) {
  const attempts = [0, 3000, 8000, 15000, 30000];
  let lastError = "";
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    if (attempts[attempt]) await sleep(attempts[attempt]);
    if (delayMs > 0) await sleep(delayMs);
    const response = await fetch(`${baseUrl}/${apiPath}`, {
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
    const limited = response.status === 403 && /频率|rate|limit/i.test(message);
    if (!response.ok) {
      lastError = `IMA HTTP error ${response.status}: ${message}`;
      if (limited && attempt < attempts.length - 1) continue;
      fail(lastError);
    }
    if (!data) fail(`IMA API returned non-JSON output for ${apiPath}.`);
    if (data.code !== 0) {
      lastError = `IMA API business error: ${data.msg || `code ${data.code}`}`;
      if (/频率|rate|limit/i.test(String(data.msg || "")) && attempt < attempts.length - 1) continue;
      fail(lastError);
    }
    return data.data || {};
  }
  fail(lastError || "IMA API call failed after retries.");
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

function kbId(kb) {
  return kb.id || kb.kb_id || kb.knowledge_base_id || "";
}

function kbName(kb) {
  return kb.name || kb.kb_name || kb.knowledge_base_name || kbId(kb);
}

async function existingMediaIds() {
  const ids = new Set();
  if (!(await exists(rawImaDir))) return ids;
  const entries = await fs.readdir(rawImaDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const content = await fs.readFile(path.join(rawImaDir, entry.name), "utf8");
    for (const match of content.matchAll(/media_id:\s*["']?([^"'\n]+)["']?/g)) {
      ids.add(match[1].trim());
    }
  }
  return ids;
}

async function listKnowledgeBases(auth) {
  const bases = [];
  let cursor = "";
  do {
    const data = await callIma(auth, "openapi/wiki/v1/search_knowledge_base", {
      query: kbFilter || "",
      cursor,
      limit: 20
    });
    bases.push(...(data.info_list || []));
    cursor = data.is_end ? "" : data.next_cursor || "";
  } while (cursor);
  return bases.map((kb) => ({ ...kb, id: kbId(kb), name: kbName(kb) })).filter((kb) => kb.id);
}

function isFolder(entry) {
  return Boolean(entry.folder_id) ||
    String(entry.media_id || "").startsWith("folder_") ||
    Number(entry.media_type) === 0 ||
    Number.isFinite(Number(entry.folder_number)) ||
    Number.isFinite(Number(entry.file_number));
}

function mediaTypeLabel(value) {
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

async function listFolder(auth, kb, folder) {
  const items = [];
  let cursor = "";
  do {
    const body = {
      knowledge_base_id: kbId(kb),
      cursor,
      limit: 50
    };
    if (folder?.id) body.folder_id = folder.id;
    const data = await callIma(auth, "openapi/wiki/v1/get_knowledge_list", body);
    items.push(...(data.knowledge_list || []));
    cursor = data.is_end ? "" : data.next_cursor || "";
  } while (cursor);
  return items;
}

async function collectItems(auth, kb) {
  const seenFolders = new Set();
  const queue = [{ id: "", name: "", path: "" }];
  const docs = [];

  while (queue.length) {
    const folder = queue.shift();
    const folderKey = folder.id || "<root>";
    if (seenFolders.has(folderKey)) continue;
    seenFolders.add(folderKey);

    const items = await listFolder(auth, kb, folder);
    for (const item of items) {
      if (isFolder(item)) {
        const folderId = item.folder_id || item.media_id;
        if (!folderId) continue;
        const folderName = item.name || item.title || folderId;
        queue.push({
          id: folderId,
          name: folderName,
          path: [folder.path, folderName].filter(Boolean).join("/")
        });
        continue;
      }
      if (!item.media_id) continue;
      docs.push({
        ...item,
        folder_id: folder.id,
        folder_name: folder.name,
        folder_path: folder.path
      });
      if (maxItems > 0 && docs.length >= maxItems) return docs;
    }
  }

  return docs;
}

async function uniqueFilePath(title, mediaId) {
  const date = new Date().toISOString().slice(0, 10);
  const base = `${date}--${slugify(title)}`;
  let file = path.join(rawImaDir, `${base}.md`);
  if (!(await exists(file))) return file;
  const suffix = slugify(mediaId).slice(0, 12);
  file = path.join(rawImaDir, `${base}-${suffix}.md`);
  if (!(await exists(file))) return file;
  for (let i = 2; ; i += 1) {
    const candidate = path.join(rawImaDir, `${base}-${suffix}-${i}.md`);
    if (!(await exists(candidate))) return candidate;
  }
}

function pointerMarkdown(kb, item) {
  const title = item.title || item.name || item.media_id;
  const mediaType = mediaTypeLabel(item.media_type);
  const folderName = item.folder_path || item.folder_name || "";
  return `---
title: ${yamlString(title)}
type: raw-source
source_type: ima-reference
status: ima-pointer
author:
published:
captured: ${yamlString(new Date().toISOString().slice(0, 10))}
source_url:
ima_source:
  knowledge_base_id: ${yamlString(kbId(kb))}
  knowledge_base_name: ${yamlString(kbName(kb))}
  folder_id: ${yamlString(item.folder_id || "")}
  folder_name: ${yamlString(folderName)}
  media_id: ${yamlString(item.media_id)}
  media_type: ${yamlString(mediaType)}
tags:
  - raw
  - ima-reference
related:
---

# ${title}

> **IMA 指针条目**：原文档存放在 IMA 知识库，本地仅保留元数据和引用。查询原文请通过 \`ima-mcp\` 的 \`fetch_media_content\` 工具，或 IMA OpenAPI 的 \`get_media_info\` 获取。

## IMA Source

- **知识库**: ${kbName(kb)}
- **文件夹**: ${folderName || "根目录"}
- **Media 类型**: ${mediaType}
- **可获取原文**: 通过 IMA connector / OpenAPI 获取

## 摘要

待提取。此条目目前只表示 IMA 原文已进入本地维护索引，完整内容仍保留在 IMA。

## 提取的关键概念

- 

## 对应 Wiki 页面

- 

## 处理记录

- Status: ima-pointer
- 本条目不存储原文，原文在 IMA 知识库中
- 后续维护时获取原文，提取关键概念，再更新对应 wiki 页面
`;
}

async function main() {
  const auth = await credentials();
  const knownIds = await existingMediaIds();
  await fs.mkdir(rawImaDir, { recursive: true });

  const bases = await listKnowledgeBases(auth);
  const selected = kbFilter
    ? bases.filter((kb) => String(kbName(kb) || "").includes(kbFilter))
    : bases;

  if (!selected.length) {
    fail(kbFilter ? `No IMA knowledge bases matched "${kbFilter}".` : "No IMA knowledge bases returned.");
  }

  const written = [];
  let discovered = 0;
  let skipped = 0;

  for (const kb of selected) {
    const docs = await collectItems(auth, kb);
    discovered += docs.length;
    for (const item of docs) {
      if (knownIds.has(item.media_id)) {
        skipped += 1;
        continue;
      }
      const target = await uniqueFilePath(item.title || item.name || item.media_id, item.media_id);
      const relative = path.relative(vault, target).replace(/\\/g, "/");
      written.push({ kb: kbName(kb), title: item.title || item.name || item.media_id, path: relative });
      if (!dryRun) {
        await fs.writeFile(target, pointerMarkdown(kb, item), "utf8");
        knownIds.add(item.media_id);
      }
    }
    if (maxItems > 0 && discovered >= maxItems) break;
  }

  console.log(JSON.stringify({
    knowledgeBases: selected.length,
    discovered,
    skippedExisting: skipped,
    createdPointers: written.length,
    dryRun,
    files: summaryOnly ? undefined : written,
    sampleFiles: summaryOnly ? written.slice(0, 20) : undefined
  }, null, 2));
}

main().catch((error) => {
  fail(error.stack || error.message || String(error));
});
