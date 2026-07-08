#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { exists, slugify, vaultPath } from "./wiki-lib.mjs";
import {
  createImaClient,
  defaultImaBaseUrl,
  fetchImaOriginal,
  hasImageReferences,
  logImaImport,
  materializeOriginal,
  mediaTypeLabel,
  rawImaMarkdown,
  readImaCredentials,
  runImageAssets
} from "./ima-local-lib.mjs";

const vault = vaultPath();
const rawImaDir = path.join(vault, "raw", "ima");
const args = process.argv.slice(2);

function usage() {
  console.log(`IMA local raw sync

Usage:
  npm run wiki:sync-ima
  npm run wiki:sync-ima -- --kb "Agent applications"
  npm run wiki:sync-ima -- --all-kbs --dry-run
  npm run wiki:sync-ima -- --max-items 100

Options:
  --kb <name>          Sync only knowledge bases whose names include this text.
  --all-kbs           Sync every visible knowledge base. This is the default.
  --dry-run           List planned imports without writing files or fetching originals.
  --max-items <n>     Stop after discovering n non-folder items.
  --delay-ms <n>      Delay between IMA API calls. Defaults to 750.
  --summary           Print counts only instead of every planned file.
  --no-images         Do not run the image mirroring workflow after text import.
  --base-url <url>    IMA OpenAPI base URL. Defaults to https://ima.qq.com.

Default behavior is local-first: each imported IMA item becomes a normal
raw/ima/*.md source note with status: inbox. Text content is stored in Capture,
binary originals are mirrored under raw/snapshots/ima/, and image items are
mirrored under raw/assets/.
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
const shouldMirrorImages = !args.includes("--no-images");
const kbFilter = readOption("--kb");
const maxItems = Number(readOption("--max-items") || 0);
const delayMs = Number(readOption("--delay-ms") || 750);
const baseUrl = readOption("--base-url") || process.env.IMA_OPENAPI_BASE_URL || defaultImaBaseUrl;

if (help) {
  usage();
  process.exit(0);
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
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

async function listKnowledgeBases(client) {
  const bases = [];
  let cursor = "";
  do {
    const data = await client.call("openapi/wiki/v1/search_knowledge_base", {
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

async function listFolder(client, kb, folder) {
  const items = [];
  let cursor = "";
  do {
    const body = {
      knowledge_base_id: kbId(kb),
      cursor,
      limit: 50
    };
    if (folder?.id) body.folder_id = folder.id;
    const data = await client.call("openapi/wiki/v1/get_knowledge_list", body);
    items.push(...(data.knowledge_list || []));
    cursor = data.is_end ? "" : data.next_cursor || "";
  } while (cursor);
  return items;
}

function isQuotaError(error) {
  return /\u6b21\u6570\u5df2\u8fbe\u4e0a\u9650|frequency|rate|limit|too many/i.test(String(error?.message || error || ""));
}

async function collectItems(client, kb, onItem = null, shouldStop = null) {
  const seenFolders = new Set();
  const queue = [{ id: "", name: "", path: "" }];
  const docs = [];
  const errors = [];

  while (queue.length && !(shouldStop && shouldStop())) {
    const folder = queue.shift();
    const folderKey = folder.id || "<root>";
    if (seenFolders.has(folderKey)) continue;
    seenFolders.add(folderKey);

    let items = [];
    try {
      items = await listFolder(client, kb, folder);
    } catch (error) {
      errors.push({
        kb: kbName(kb),
        folder: folder.path || "root",
        error: error.message
      });
      if (isQuotaError(error)) break;
      continue;
    }

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
      const doc = {
        ...item,
        folder_id: folder.id,
        folder_name: folder.name,
        folder_path: folder.path
      };
      docs.push(doc);
      if (onItem) await onItem(doc);
      if ((shouldStop && shouldStop()) || (maxItems > 0 && docs.length >= maxItems)) return { docs, errors };
    }
  }

  return { docs, errors };
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

async function main() {
  const auth = await readImaCredentials();
  const client = createImaClient({ auth, baseUrl, delayMs });
  const knownIds = await existingMediaIds();
  await fs.mkdir(rawImaDir, { recursive: true });

  const bases = await listKnowledgeBases(client);
  const selected = kbFilter
    ? bases.filter((kb) => String(kbName(kb) || "").includes(kbFilter))
    : bases;

  if (!selected.length) {
    fail(kbFilter ? `No IMA knowledge bases matched "${kbFilter}".` : "No IMA knowledge bases returned.");
  }

  const planned = [];
  const written = [];
  const errors = [];
  const imageRuns = [];
  let discovered = 0;
  let skipped = 0;
  let stopEarly = false;

  for (const kb of selected) {
    const result = await collectItems(client, kb, async (item) => {
      const title = item.title || item.name || item.media_id;
      if (knownIds.has(item.media_id)) {
        skipped += 1;
        return;
      }
      const target = await uniqueFilePath(title, item.media_id);
      const relative = path.relative(vault, target).replace(/\\/g, "/");
      const plan = {
        kb: kbName(kb),
        title,
        mediaId: item.media_id,
        mediaType: mediaTypeLabel(item.media_type),
        path: relative
      };
      planned.push(plan);
      if (dryRun) return;

      try {
        const original = await fetchImaOriginal(client, item.media_id);
        const materialized = await materializeOriginal({ vault, notePath: target, title, original });
        await fs.writeFile(target, rawImaMarkdown({ kb, item, target, original, materialized }), "utf8");
        knownIds.add(item.media_id);
        written.push({ ...plan, snapshot: materialized.snapshotPath, localFiles: materialized.localFiles });
        await logImaImport(relative, `media_id="${item.media_id}"`);

        if (shouldMirrorImages && hasImageReferences(original.content || "")) {
          imageRuns.push({ source: relative, result: runImageAssets({ source: relative, enabled: true }) });
        }
      } catch (error) {
        errors.push({ ...plan, error: error.message });
        if (isQuotaError(error)) stopEarly = true;
      }
    }, () => stopEarly);
    discovered += result.docs.length;
    errors.push(...result.errors.map((error) => ({ phase: "list", ...error })));
    if (result.errors.some((error) => isQuotaError(error))) stopEarly = true;
    if (maxItems > 0 && discovered >= maxItems) break;
    if (stopEarly) break;
  }

  console.log(JSON.stringify({
    knowledgeBases: selected.length,
    discovered,
    skippedExisting: skipped,
    plannedImports: planned.length,
    createdRaw: written.length,
    imageMirroringRuns: imageRuns.length,
    errors,
    partial: errors.length > 0,
    dryRun,
    files: summaryOnly ? undefined : (dryRun ? planned : written),
    sampleFiles: summaryOnly ? (dryRun ? planned : written).slice(0, 20) : undefined,
    imageRuns: summaryOnly ? undefined : imageRuns
  }, null, 2));

  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail(error.stack || error.message || String(error));
});
