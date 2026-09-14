import { promises as fs } from "node:fs";
import path from "node:path";
import { referenceAssetBase } from "./vault-layout.mjs";
import { createHash, randomUUID } from "node:crypto";
import { parseFrontmatter, scanVault, stringifyFrontmatter, upsertFrontmatterValues } from "./wiki-lib.mjs";
import { normalizeReferenceNode } from "./okf-lib.mjs";
import { resolveDriveOriginal } from "./originals-drive.mjs";
import { hashFile } from "./universe-package-lib.mjs";

const locks = new Set();
const fail = (status, message) => Object.assign(new Error(message), { status, statusCode: status });
const documentId = (original) => createHash("sha256").update(original).digest("hex").slice(0, 32);
const validId = (id) => /^[a-f0-9-]{36}$/.test(String(id || ""));
const historyRoot = ".my-wiki/document-history";
const snapshotFields = ["snapshot_path", "snapshot_markdown_path", "snapshot_html_path", "snapshot_json_path"];
const normalizePath = (value) => String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");

async function safePath(vault, relative, evidence = false) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.includes("\0") || relative.split("/").some((part) => ["..", "."].includes(part)) || path.isAbsolute(relative)) throw fail(400, "Invalid document path");
  if (evidence && !/^(?:references\/(originals|sources|assets)|\.my-wiki\/extractions)\//.test(relative)) throw fail(400, "Invalid evidence path");
  const root = await fs.realpath(vault);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (stat?.isSymbolicLink()) throw fail(400, "Document history does not follow symbolic links");
  }
  return current;
}

async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, content, { flag: "wx", mode: 0o600 }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
async function atomicCopy(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  const temporary = `${to}.${randomUUID()}.tmp`;
  try { await fs.copyFile(from, temporary); await fs.rename(temporary, to); }
  finally { await fs.rm(temporary, { force: true }); }
}
const json = (file) => fs.readFile(file, "utf8").then(JSON.parse);
const writeJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2) + "\n");

export async function documentVersionContext(vault, original, filename = "") {
  await resolveDriveOriginal(vault, original);
  if (filename && path.extname(filename).toLowerCase() !== path.extname(original).toLowerCase()) throw fail(400, "Updated file must have the same extension as the original");
  const scan = await scanVault(vault);
  const references = scan.nodes.filter((node) => node.id.startsWith("references/sources/") && snapshotFields.some((field) => normalizePath(node.frontmatter[field]) === original));
  const directory = await safePath(vault, `${historyRoot}/${documentId(original)}`);
  const head = await json(path.join(directory, "current.json")).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  return { original, scan, references, directory, head };
}

async function archiveFiles(vault, context) {
  const files = new Set([context.original, ...context.references.map((node) => node.path)]);
  async function walk(relative) {
    const file = await safePath(vault, relative, true);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) return;
    if (stat.isFile()) { files.add(relative); return; }
    for (const entry of await fs.readdir(file, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw fail(400, "Cannot archive a symbolic-link attachment");
      await walk(`${relative}/${entry.name}`);
    }
  }
  for (const node of context.references) {
    const base = referenceAssetBase(node.frontmatter, node.path);
    await walk(`references/assets/${base}`);
    for (const field of [...snapshotFields, "extraction_report", "extraction_document_ir"]) {
      const relative = normalizePath(node.frontmatter[field]);
      if (/^(?:references\/(originals|assets)|\.my-wiki\/extractions)\//.test(relative)) await walk(relative);
    }
    // Include local attachments outside the source's generated asset directory.
    for (const match of node.content.matchAll(/(?:references\/assets\/|\.\.\/assets\/)[^\s)"'<>]+/g)) {
      let relative;
      try { relative = decodeURIComponent(match[0]).replace(/^\.\.\//, "references/").split("#")[0].split("?")[0]; } catch { continue; }
      await walk(relative);
    }
  }
  return [...files].sort();
}

async function readManifest(vault, original, id) {
  if (!validId(id)) throw fail(400, "Invalid version id");
  const directory = await safePath(vault, `${historyRoot}/${documentId(original)}/${id}`);
  const manifest = await json(path.join(directory, "manifest.json")).catch((error) => { if (error.code === "ENOENT") throw fail(404, "Historical version not found"); throw error; });
  if (manifest.original !== original || manifest.id !== id || !Array.isArray(manifest.files) || !Array.isArray(manifest.references)) throw fail(409, "Invalid historical document manifest");
  for (const item of manifest.files) await safePath(vault, item.path, true);
  return { directory, manifest };
}
async function verifyArchive(vault, original, id) {
  const archived = await readManifest(vault, original, id);
  for (const item of archived.manifest.files) {
    const file = await safePath(vault, `${historyRoot}/${documentId(original)}/${id}/files/${item.path}`);
    const hash = await hashFile(file);
    if (hash.sha256 !== item.sha256 || hash.bytes !== item.bytes) throw fail(409, "Historical document checksum mismatch; no current files were changed");
  }
  return archived;
}

export async function listDocumentVersions(vault, original = "") {
  const root = await safePath(vault, historyRoot);
  const directories = original ? [documentId(original)] : (await fs.readdir(root).catch((error) => { if (error.code === "ENOENT") return []; throw error; })).filter((id) => /^[a-f0-9]{32}$/.test(id));
  const versions = [];
  let current = null;
  for (const id of directories) {
    const directory = await safePath(vault, `${historyRoot}/${id}`);
    const head = await json(path.join(directory, "current.json")).catch(() => null);
    if (original) current = head;
    for (const entry of await fs.readdir(directory).catch(() => [])) {
      if (!validId(entry)) continue;
      const manifest = await json(await safePath(vault, `${historyRoot}/${id}/${entry}/manifest.json`));
      if (manifest.id === head?.id || (original && manifest.original !== original)) continue;
      versions.push({ id: manifest.id, original: manifest.original, filename: manifest.filename, number: manifest.number, createdAt: manifest.createdAt, archivedAt: manifest.archivedAt, restoredFrom: manifest.restoredFrom || "", reusable: manifest.reusable, bytes: manifest.files.reduce((sum, item) => sum + item.bytes, 0), referenceCount: manifest.references.length });
    }
  }
  return { current, versions: versions.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)) };
}

export async function historicalOriginal(vault, original, id) {
  const { manifest } = await readManifest(vault, original, id);
  const file = await safePath(vault, `${historyRoot}/${documentId(original)}/${id}/files/${original}`);
  return { file, filename: manifest.filename, stat: await fs.stat(file) };
}

export async function historicalEvidence(vault, original, id) {
  const { manifest } = await readManifest(vault, original, id);
  const files = [];
  for (const item of manifest.files) files.push({ path: item.path, file: await safePath(vault, `${historyRoot}/${documentId(original)}/${id}/files/${item.path}`) });
  return { manifest, files };
}

function pendingSource(node, original, filename, version, hash) {
  const fm = { ...node.frontmatter };
  delete fm.image_index_path;
  for (const key of Object.keys(fm)) if (/^(extraction_|extracted_|snapshot_)/.test(key)) delete fm[key];
  Object.assign(fm, {
    type: "Reference", status: "stable", workflow_status: "needs-followup",
    needs_followup: true, followup_reasons: ["extraction:pending"], extraction_status: "pending", text_extraction: "pending",
    snapshot_path: original, original_filename: filename, document_version: version.id,
    document_asset_base: `${path.basename(node.path, ".md")}--${version.id}`,
    content_hash: hash, updated: version.createdAt
  });
  if (version.sourceUrl) Object.assign(fm, { source_url: version.sourceUrl, resource: version.sourceUrl, source_type: "webpage", capture_method: "dashboard-url-version" });
  return `${stringifyFrontmatter(fm)}\n\n# ${node.title}\n\n## Source\n\n- Snapshot: ${original}\n\n## Capture\n\nExtraction pending for the updated original.\n\n## Processing Notes\n\n- Status: needs-followup\n- Follow-up reasons: extraction:pending\n`;
}

async function rollback(vault, original, journal, directory) {
  const archived = await verifyArchive(vault, original, journal.archiveId);
  for (const item of archived.manifest.files) await atomicCopy(path.join(archived.directory, "files", item.path), await safePath(vault, item.path, true));
  const previousPaths = new Set(archived.manifest.files.map((item) => item.path));
  for (const relative of journal.created || []) if (!previousPaths.has(relative)) await fs.rm(await safePath(vault, relative, true), { force: true });
  await writeJson(path.join(directory, "current.json"), journal.previousHead);
  await fs.rm(path.join(directory, "transaction.json"), { force: true });
  // The rollback restored this head; a later update takes a fresh snapshot of it.
  await fs.rm(archived.directory, { recursive: true, force: true });
}

export async function recoverDocumentTransactions(vault) {
  const root = await safePath(vault, historyRoot);
  for (const id of (await fs.readdir(root).catch(() => [])).filter((id) => /^[a-f0-9]{32}$/.test(id))) {
    const directory = await safePath(vault, `${historyRoot}/${id}`);
    const journal = await json(path.join(directory, "transaction.json")).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!journal) continue;
    if (documentId(journal.original) !== id || !validId(journal.archiveId) || !validId(journal.nextId)) throw fail(409, "Invalid document transaction");
    if (journal.staging && /^[a-f0-9-]{36}\.[a-f0-9-]{36}\.tmp$/.test(journal.staging)) await fs.rm(path.join(directory, journal.staging), { recursive: true, force: true });
    const head = await json(path.join(directory, "current.json")).catch(() => null);
    if (head?.id !== journal.nextId && journal.applying) await rollback(vault, journal.original, journal, directory);
    else {
      await fs.rm(path.join(directory, "transaction.json"), { force: true });
      if (head?.id !== journal.nextId) await fs.rm(path.join(directory, journal.archiveId), { recursive: true, force: true });
    }
  }
}

// Archives are complete and checksummed before current evidence is touched.
export async function updateDocumentVersion({ vault, original, filename = "", temporary = "", sourceUrl = "", restoreId = "", operationId = "", assertIdle = () => {}, beforeCommit = () => {} }) {
  const lock = `${path.resolve(vault)}:${original}`;
  if (locks.has(lock)) throw fail(409, "This document already has a version operation");
  locks.add(lock);
  let journal;
  let context;
  try {
    context = await documentVersionContext(vault, original, filename);
    if (operationId && context.head?.operationId === operationId) return context.head;
    await assertIdle(context.references.map((node) => node.path));
    const restored = restoreId ? await verifyArchive(vault, original, restoreId) : null;
    if (!restored && !temporary) throw fail(400, "An updated file is required");
    const input = restored ? path.join(restored.directory, "files", original) : temporary;
    const inputStat = await fs.stat(input);
    if (!inputStat.isFile() || inputStat.size === 0) throw fail(400, "Updated original is empty");
    const incomingHash = await hashFile(input);
    const now = new Date().toISOString();
    const previousHead = context.head || { id: randomUUID(), number: 1, original, filename: path.basename(original), createdAt: (await fs.stat(await safePath(vault, original, true))).mtime.toISOString() };
    const next = { id: randomUUID(), number: previousHead.number + 1, original, filename: restored?.manifest.filename || filename || path.basename(original), createdAt: now, restoredFrom: restoreId || "", operationId };
    if (sourceUrl) next.sourceUrl = sourceUrl;
    else if (restored?.manifest.sourceUrl) next.sourceUrl = restored.manifest.sourceUrl;
    const archivedPaths = await archiveFiles(vault, context);
    if (!validId(previousHead.id)) throw fail(409, "Invalid current document version");
    const archiveDirectory = path.join(context.directory, previousHead.id);
    const staging = `${archiveDirectory}.${randomUUID()}.tmp`;
    const manifest = { ...previousHead, archivedAt: now, references: context.references.map((node) => node.path), reusable: context.references.length > 0 && context.references.every((node) => node.frontmatter.extraction_status === "complete" && !node.frontmatter.needs_followup && node.status !== "needs-followup"), files: [] };
    journal = { original, archiveId: previousHead.id, previousHead, nextId: next.id, created: [], staging: path.basename(staging) };
    await writeJson(path.join(context.directory, "transaction.json"), journal);
    // A current-head archive can only be an uncommitted snapshot from an interrupted update.
    await fs.rm(archiveDirectory, { recursive: true, force: true });
    try {
      for (const relative of archivedPaths) {
        const source = await safePath(vault, relative, true);
        const target = path.join(staging, "files", relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
        manifest.files.push({ path: relative, ...await hashFile(target) });
      }
      await writeJson(path.join(staging, "manifest.json"), manifest);
      await fs.rename(staging, archiveDirectory);
    } finally { await fs.rm(staging, { recursive: true, force: true }); }

    let sources = context.references;
    if (!sources.length) {
      const sourcePath = `references/sources/document-${documentId(original)}.md`;
      if (await fs.stat(await safePath(vault, sourcePath, true)).catch(() => null)) throw fail(409, "Reference path is already occupied");
      const title = path.basename(original, path.extname(original));
      const draft = `${stringifyFrontmatter({ title, type: "Reference", status: "stable", workflow_status: "needs-followup", source_type: path.extname(original).slice(1), captured: now, snapshot_path: original })}\n\n# ${title}\n`;
      const content = normalizeReferenceNode({ id: sourcePath.slice(0, -3), path: sourcePath, title, content: draft }, { nodes: [], resolve: () => null }, { generatedBy: "process:my-wiki-version", generatedAt: now });
      sources = [{ path: sourcePath, title, content, frontmatter: parseFrontmatter(content) }];
    }
    const reusable = Boolean(restored?.manifest.reusable && sources.every((node) => restored.manifest.references.includes(node.path)));
    const restoreAssets = reusable ? restored.manifest.files.filter((item) => item.path !== original && !item.path.startsWith("references/sources/")) : [];
    for (const relative of [...sources.map((node) => node.path), ...restoreAssets.map((item) => item.path)]) {
      if (!(await fs.stat(await safePath(vault, relative, true)).catch(() => null))) journal.created.push(relative);
    }
    for (const item of restoreAssets) {
      const target = await safePath(vault, item.path, true);
      if (await fs.stat(target).catch(() => null)) {
        if ((await hashFile(target)).sha256 !== item.sha256) throw fail(409, "An attachment path is occupied by different content");
      }
    }
    await writeJson(path.join(context.directory, "transaction.json"), journal);
    await assertIdle(sources.map((node) => node.path));
    for (const item of manifest.files) if ((await hashFile(await safePath(vault, item.path, true))).sha256 !== item.sha256) throw fail(409, "Evidence changed while archiving; retry the version update");
    await beforeCommit();
    journal.applying = true;
    await writeJson(path.join(context.directory, "transaction.json"), journal);
    for (const item of restoreAssets) {
      const target = await safePath(vault, item.path, true);
      if (await fs.stat(target).catch(() => null)) {
        if ((await hashFile(target)).sha256 !== item.sha256) throw fail(409, "An attachment path is occupied by different content");
      } else await atomicCopy(path.join(restored.directory, "files", item.path), target);
    }
    await atomicCopy(input, await safePath(vault, original, true));
    for (const node of sources) {
      let content;
      if (reusable) {
        content = await fs.readFile(path.join(restored.directory, "files", node.path), "utf8");
        content = upsertFrontmatterValues(content, { workflow_status: "inbox", needs_followup: false, followup_reasons: [], snapshot_path: original, original_filename: next.filename, document_version: next.id, updated: now });
        content = content.replace(/^- Status: (?:processed|stale|needs-followup)\s*$/m, "- Status: inbox");
      } else {
        let pendingNode = node;
        if (restored?.manifest.references.includes(node.path)) {
          const previous = parseFrontmatter(await fs.readFile(path.join(restored.directory, "files", node.path), "utf8"));
          const frontmatter = { ...node.frontmatter };
          for (const key of ["source_url", "resource", "source_type", "capture_method"]) {
            if (previous[key] === undefined) delete frontmatter[key]; else frontmatter[key] = previous[key];
          }
          pendingNode = { ...node, frontmatter };
        }
        content = pendingSource(pendingNode, original, next.filename, { ...next, sourceUrl: restored ? "" : sourceUrl }, incomingHash.sha256);
      }
      await atomicWrite(await safePath(vault, node.path, true), content);
    }
    const selected = new Set(context.references.map((node) => node.id));
    const others = context.scan.nodes.filter((node) => !selected.has(node.id));
    const restoredPaths = new Set(restoreAssets.map((item) => item.path));
    for (const relative of archivedPaths) {
      if (relative === original || relative.startsWith("references/sources/") || restoredPaths.has(relative)) continue;
      const sharedNeedle = relative.startsWith("references/assets/") ? relative.split("/").slice(1, 3).join("/") + "/" : relative;
      if (others.some((node) => node.content.includes(sharedNeedle) || node.content.includes(encodeURI(sharedNeedle)))) continue;
      await fs.rm(await safePath(vault, relative, true), { force: true });
    }
    Object.assign(next, { paths: sources.map((node) => node.path), title: sources[0]?.title || next.filename, reusable });
    await writeJson(path.join(context.directory, "current.json"), next);
    journal = null;
    await fs.rm(path.join(context.directory, "transaction.json"), { force: true });
    return next;
  } catch (error) {
    if (journal?.applying) await rollback(vault, original, journal, context.directory);
    else if (journal) {
      await fs.rm(path.join(context.directory, "transaction.json"), { force: true });
      await fs.rm(path.join(context.directory, journal.archiveId), { recursive: true, force: true });
    }
    throw error;
  } finally { locks.delete(lock); }
}

export async function writeVersionReceipt(vault, receipt) {
  if (!validId(receipt.id)) throw fail(400, "Invalid version job id");
  await writeJson(await safePath(vault, `.my-wiki/version-jobs/${receipt.id}.json`), receipt);
}
export async function removeVersionReceipt(vault, id) {
  if (!validId(id)) throw fail(400, "Invalid version job id");
  await fs.rm(await safePath(vault, `.my-wiki/version-jobs/${id}.json`), { force: true });
}
export async function readVersionReceipts(vault) {
  const root = await safePath(vault, ".my-wiki/version-jobs");
  const receipts = [];
  for (const name of await fs.readdir(root).catch(() => [])) {
    if (!name.endsWith(".json") || !validId(name.slice(0, -5))) continue;
    const receipt = await json(await safePath(vault, `.my-wiki/version-jobs/${name}`));
    if (receipt.id !== name.slice(0, -5)) throw fail(409, "Invalid version recovery receipt");
    await safePath(vault, receipt.original, true);
    if (receipt.temporary && !receipt.temporary.startsWith(".my-wiki/uploads/")) throw fail(409, "Invalid version upload receipt");
    if (receipt.temporary) await safePath(vault, receipt.temporary);
    for (const source of receipt.committed?.paths || []) if (!source.startsWith("references/sources/")) throw fail(409, "Invalid version source receipt");
    receipts.push(receipt);
  }
  return receipts;
}
