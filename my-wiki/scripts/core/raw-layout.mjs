#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  appendLog,
  exists,
  parseFrontmatter,
  vaultPath,
  walkMarkdown
} from "./wiki-lib.mjs";

const vault = vaultPath();
const rawRoot = path.join(vault, "raw");
const apply = process.argv.includes("--apply");
const help = process.argv.includes("--help") || process.argv.includes("-h");

if (help) {
  console.log(`Usage:
  my-wiki organize-raw
  my-wiki organize-raw --apply

The default is a dry run. Source notes are normalized to
raw/sources/, article assets to raw/assets/<source>/, and snapshots to
raw/snapshots/. --apply writes a
local migration manifest and text backup under .my-wiki/backups/.`);
  process.exit(0);
}

function slash(value) {
  return String(value).replace(/\\/g, "/");
}

function relative(target) {
  return slash(path.relative(vault, target));
}

function absolute(value) {
  return path.join(vault, ...slash(value).split("/"));
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function walkFiles(root) {
  if (!(await exists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  }));
  return files.flat();
}

function unique(values) {
  return Array.from(new Set(values));
}

const rawMarkdown = await walkMarkdown(rawRoot);
const sourceNotes = [];
for (const file of rawMarkdown) {
  const noteRelative = relative(file);
  if (noteRelative === "raw/README.md" || noteRelative.startsWith("raw/assets/") || noteRelative.startsWith("raw/snapshots/")) continue;
  const content = await fs.readFile(file, "utf8");
  const frontmatter = parseFrontmatter(content);
  if (String(frontmatter.type || "") !== "raw-source") continue;
  sourceNotes.push({
    file,
    relative: noteRelative,
    content,
    frontmatter
  });
}

const claimedNotes = new Set();
for (const note of sourceNotes) {
  const basename = path.basename(note.file);
  let candidate = `raw/sources/${basename}`;
  let counter = 2;
  while (claimedNotes.has(candidate.toLowerCase()) || (candidate !== note.relative && await exists(absolute(candidate)))) {
    const extension = path.extname(basename);
    const stem = path.basename(basename, extension);
    candidate = `raw/sources/${stem}-${counter}${extension}`;
    counter += 1;
  }
  claimedNotes.add(candidate.toLowerCase());
  note.destination = candidate;
  note.oldBase = path.basename(note.file, ".md");
  note.newBase = path.basename(candidate, ".md");
}

const moves = [];
const exactMap = new Map();
const prefixMap = new Map();
const attachmentOwners = new Map();
const ownedAssetPrefixes = new Set();
const ownedAssetFiles = new Set();
const ownedSnapshotFiles = new Set();

function addExactMove(from, to, kind) {
  const oldRelative = slash(from);
  const newRelative = slash(to);
  if (oldRelative === newRelative) return;
  moves.push({ from: oldRelative, to: newRelative, kind });
  exactMap.set(oldRelative, newRelative);
}

function addPrefixMove(from, to, kind) {
  const oldRelative = slash(from).replace(/\/$/, "");
  const newRelative = slash(to).replace(/\/$/, "");
  if (oldRelative === newRelative) return;
  moves.push({ from: oldRelative, to: newRelative, kind, directory: true });
  prefixMap.set(oldRelative, newRelative);
}

for (const note of sourceNotes) {
  addExactMove(note.relative, note.destination, "source-note");
  exactMap.set(note.relative.replace(/\.md$/i, ""), note.destination.replace(/\.md$/i, ""));

  const oldRawRelative = note.relative.slice("raw/".length).replace(/\.md$/i, "");
  const oldParts = oldRawRelative.split("/");
  const legacyStem = oldParts[0] === "sources" ? oldParts.slice(1).join("/") : oldRawRelative;
  const explicitImageIndex = slash(String(note.frontmatter.image_index_path || "")).replace(/^['"]|['"]$/g, "");
  const explicitAssetDirectory = explicitImageIndex.startsWith("raw/assets/")
    ? path.posix.dirname(explicitImageIndex)
    : "";
  const assetCandidates = unique([
    explicitAssetDirectory,
    `raw/assets/${legacyStem}`,
    `raw/assets/${note.oldBase}`
  ].filter(Boolean));
  const existingAssets = [];
  for (const candidate of assetCandidates) {
    if (await exists(absolute(candidate))) {
      const stat = await fs.stat(absolute(candidate));
      if (stat.isDirectory()) existingAssets.push(candidate);
    }
  }
  if (existingAssets.length > 1) throw new Error(`Ambiguous asset directories for ${note.relative}: ${existingAssets.join(", ")}`);
  if (existingAssets.length === 1) {
    const owner = attachmentOwners.get(existingAssets[0]);
    if (owner && owner !== note.relative) throw new Error(`Asset directory shared by ${owner} and ${note.relative}: ${existingAssets[0]}`);
    attachmentOwners.set(existingAssets[0], note.relative);
    ownedAssetPrefixes.add(existingAssets[0]);
    addPrefixMove(existingAssets[0], `raw/assets/${note.newBase}`, "asset-directory");
  }

  note.snapshotPrefixes = unique([legacyStem, note.oldBase]);
  note.explicitSnapshots = unique([
    "snapshot_path",
    "snapshot_markdown_path",
    "snapshot_html_path",
    "snapshot_json_path"
  ].map((key) => slash(String(note.frontmatter[key] || "")).replace(/^['"]|['"]$/g, "")).filter((value) => value.startsWith("raw/snapshots/")));
}

const snapshotFiles = await walkFiles(path.join(rawRoot, "snapshots"));
for (const snapshot of snapshotFiles) {
  const snapshotRelative = relative(snapshot);
  const underSnapshots = snapshotRelative.slice("raw/snapshots/".length);
  const matches = sourceNotes.filter((note) =>
    note.explicitSnapshots.includes(snapshotRelative) ||
    note.snapshotPrefixes.some((prefix) => underSnapshots === prefix || underSnapshots.startsWith(`${prefix}.`) || underSnapshots.startsWith(`${prefix}/`))
  );
  if (matches.length > 1) throw new Error(`Snapshot matches multiple source notes: ${snapshotRelative}`);
  if (matches.length === 0) continue;
  const note = matches[0];
  if (note.explicitSnapshots.includes(snapshotRelative) && !note.snapshotPrefixes.some((candidate) =>
    underSnapshots === candidate || underSnapshots.startsWith(`${candidate}.`) || underSnapshots.startsWith(`${candidate}/`)
  )) {
    ownedSnapshotFiles.add(snapshotRelative);
    addExactMove(snapshotRelative, `raw/snapshots/${path.basename(snapshotRelative)}`, "snapshot");
    attachmentOwners.set(snapshotRelative, note.relative);
    continue;
  }
  const prefix = note.snapshotPrefixes
    .filter((candidate) => underSnapshots === candidate || underSnapshots.startsWith(`${candidate}.`) || underSnapshots.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0];
  const suffix = underSnapshots.slice(prefix.length);
  ownedSnapshotFiles.add(snapshotRelative);
  addExactMove(snapshotRelative, `raw/snapshots/${note.newBase}${suffix}`, "snapshot");
  attachmentOwners.set(snapshotRelative, note.relative);
}

function basicRemapVaultPath(value) {
  const normalized = slash(path.posix.normalize(slash(value))).replace(/^\.\//, "");
  if (exactMap.has(normalized)) return exactMap.get(normalized);
  const prefix = Array.from(prefixMap.keys())
    .filter((candidate) => normalized === candidate || normalized.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!prefix) return normalized;
  return `${prefixMap.get(prefix)}${normalized.slice(prefix.length)}`;
}

const assetFiles = await walkFiles(path.join(rawRoot, "assets"));
for (const file of assetFiles) {
  const fileRelative = relative(file);
  if (Array.from(ownedAssetPrefixes).some((prefix) => fileRelative.startsWith(`${prefix}/`))) continue;
  const parts = fileRelative.split("/");
  if (parts.length === 3) {
    ownedAssetFiles.add(fileRelative);
    continue;
  }
  if (parts.length === 4) {
    ownedAssetFiles.add(fileRelative);
    addExactMove(fileRelative, `raw/assets/${parts[2]}--${parts[3]}`, "asset-file");
  }
}
const managedTargets = new Set([...snapshotFiles, ...assetFiles]
  .map(relative)
  .map(basicRemapVaultPath)
  .map((value) => value.toLowerCase()));

function remapVaultPath(value) {
  const mapped = basicRemapVaultPath(value);
  const parts = mapped.split("/");
  for (const kind of ["assets", "snapshots"]) {
    const index = parts.indexOf(kind);
    if (index < 0) continue;
    const candidate = `raw/${parts.slice(index).join("/")}`;
    if (managedTargets.has(candidate.toLowerCase())) return candidate;
  }
  return mapped;
}

const literalEntries = [];
for (const [from, to] of [...exactMap.entries(), ...prefixMap.entries()]) {
  literalEntries.push([from, to]);
}
literalEntries.sort((a, b) => b[0].length - a[0].length);
const literalLookup = new Map(literalEntries);
const literalPattern = literalEntries.length
  ? new RegExp(literalEntries.map(([from]) => escapePattern(from)).join("|"), "g")
  : null;

function replaceVaultPaths(content) {
  return literalPattern ? content.replace(literalPattern, (match) => literalLookup.get(match) || match) : content;
}

function splitLinkTarget(value) {
  const trimmed = value.trim();
  const wrapped = trimmed.startsWith("<") && trimmed.includes(">");
  if (wrapped) {
    const end = trimmed.indexOf(">");
    return { path: trimmed.slice(1, end), rest: trimmed.slice(end + 1), wrapped: true };
  }
  const match = trimmed.match(/^(\S+)([\s\S]*)$/);
  return { path: match?.[1] || trimmed, rest: match?.[2] || "", wrapped: false };
}

function rewriteLinkTarget(value, oldDocument, newDocument) {
  const target = splitLinkTarget(value);
  if (!target.path || /^(?:[a-z]+:|#|\/)/i.test(target.path)) return value;
  const anchorIndex = target.path.indexOf("#");
  const pathname = anchorIndex >= 0 ? target.path.slice(0, anchorIndex) : target.path;
  const anchor = anchorIndex >= 0 ? target.path.slice(anchorIndex) : "";
  const rootStyle = /^(?:raw|wiki|templates|_archive)\//.test(pathname);
  const oldTarget = rootStyle
    ? path.posix.normalize(pathname)
    : path.posix.normalize(path.posix.join(path.posix.dirname(oldDocument), pathname));
  const newTarget = remapVaultPath(oldTarget);
  if (newTarget === oldTarget && newDocument === oldDocument) return value;
  const rewritten = rootStyle
    ? newTarget
    : path.posix.relative(path.posix.dirname(newDocument), newTarget) || path.posix.basename(newTarget);
  const rendered = `${rewritten}${anchor}`;
  return `${target.wrapped ? `<${rendered}>` : rendered}${target.rest}`;
}

function rewriteMarkdown(content, oldDocument, newDocument) {
  let updated = replaceVaultPaths(content);
  updated = updated.replace(/(!?\[[^\]\r\n]*\]\()([^\)\r\n]+)(\))/g, (full, before, target, after) =>
    `${before}${rewriteLinkTarget(target, oldDocument, newDocument)}${after}`
  );
  updated = updated.replace(/\b(src|href)=("([^"]+)"|'([^']+)')/gi, (full, attribute, quoted, double, single) => {
    const quote = quoted[0];
    const target = double ?? single ?? "";
    return `${attribute}=${quote}${rewriteLinkTarget(target, oldDocument, newDocument)}${quote}`;
  });
  return updated;
}

const markdownFiles = unique((await Promise.all([
  walkMarkdown(path.join(vault, "raw")),
  walkMarkdown(path.join(vault, "wiki")),
  walkMarkdown(path.join(vault, "templates"))
])).flat());
const edits = [];
for (const file of markdownFiles) {
  const oldRelative = relative(file);
  const newRelative = remapVaultPath(oldRelative);
  const original = await fs.readFile(file, "utf8");
  let updated = rewriteMarkdown(original, oldRelative, newRelative);
  if (updated !== original || newRelative !== oldRelative) {
    edits.push({ from: oldRelative, to: newRelative, kind: "markdown", content: updated, original });
  }
}

const imageIndexes = assetFiles.filter((file) => path.basename(file) === "image-index.json");
for (const file of imageIndexes) {
  const oldRelative = relative(file);
  const newRelative = remapVaultPath(oldRelative);
  const original = await fs.readFile(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(original);
  } catch {
    continue;
  }
  const oldSource = slash(parsed.source_note || "");
  const newSource = remapVaultPath(oldSource);
  parsed.source_note = newSource;
  for (const image of parsed.images || []) {
    for (const key of ["local_path", "discovered_in"]) {
      if (typeof image[key] === "string") image[key] = replaceVaultPaths(image[key]);
    }
    if (image.local_note_path && oldSource) {
      const oldTarget = path.posix.normalize(path.posix.join(path.posix.dirname(oldSource), image.local_note_path));
      const newTarget = remapVaultPath(oldTarget);
      if (newTarget !== oldTarget || newSource !== oldSource) {
        image.local_note_path = path.posix.relative(path.posix.dirname(newSource), newTarget);
      }
    }
  }
  const updated = `${JSON.stringify(parsed, null, 2)}\n`;
  if (updated !== original || newRelative !== oldRelative) {
    edits.push({ from: oldRelative, to: newRelative, kind: "image-index", content: updated, original });
  }
}

const destinationOwners = new Map();
for (const move of moves) {
  const key = move.to.toLowerCase();
  if (destinationOwners.has(key) && destinationOwners.get(key) !== move.from) {
    throw new Error(`Migration destination collision: ${move.to}`);
  }
  destinationOwners.set(key, move.from);
  if (await exists(absolute(move.to))) throw new Error(`Migration destination already exists: ${move.to}`);
}

const orphanAttachments = [
  ...snapshotFiles.map(relative).filter((file) => !ownedSnapshotFiles.has(file)),
  ...assetFiles.map(relative).filter((file) =>
    !Array.from(ownedAssetPrefixes).some((prefix) => file === prefix || file.startsWith(`${prefix}/`)) &&
    !ownedAssetFiles.has(file)
  )
];

const summary = {
  vault,
  mode: apply ? "apply" : "dry-run",
  sourceNotes: sourceNotes.length,
  moves: moves.length,
  noteMoves: moves.filter((move) => move.kind === "source-note").length,
  assetMoves: moves.filter((move) => move.kind === "asset-directory").length,
  snapshotMoves: moves.filter((move) => move.kind === "snapshot").length,
  textEdits: edits.length,
  orphanAttachments: orphanAttachments.length,
  orphanAttachmentSamples: orphanAttachments.slice(0, 20),
  moveSamples: moves.slice(0, 20)
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.join(vault, ".my-wiki", "backups", `raw-layout-${timestamp}`);
const backupFiles = path.join(backupRoot, "files");
await fs.mkdir(backupFiles, { recursive: true });
for (let index = 0; index < edits.length; index += 1) {
  const edit = edits[index];
  edit.backup = `files/${String(index + 1).padStart(6, "0")}.bak`;
  const target = path.join(backupRoot, edit.backup);
  await fs.writeFile(target, edit.original, "utf8");
}

const manifestPath = path.join(backupRoot, "manifest.json");
await fs.writeFile(manifestPath, `${JSON.stringify({ ...summary, applied: false, moves, edits: edits.map(({ from, to, kind, backup }) => ({ from, to, kind, backup })) }, null, 2)}\n`, "utf8");

const completedMoves = [];
try {
  for (const move of moves.sort((a, b) => Number(Boolean(b.directory)) - Number(Boolean(a.directory)))) {
    await fs.mkdir(path.dirname(absolute(move.to)), { recursive: true });
    await fs.rename(absolute(move.from), absolute(move.to));
    completedMoves.push(move);
  }
  for (const edit of edits) {
    await fs.mkdir(path.dirname(absolute(edit.to)), { recursive: true });
    await fs.writeFile(absolute(edit.to), edit.content, "utf8");
  }
} catch (error) {
  for (const move of completedMoves.reverse()) {
    if (!(await exists(absolute(move.to)))) continue;
    await fs.mkdir(path.dirname(absolute(move.from)), { recursive: true });
    await fs.rename(absolute(move.to), absolute(move.from));
  }
  for (const edit of edits) {
    const backup = path.join(backupRoot, edit.backup);
    if (!(await exists(backup))) continue;
    await fs.mkdir(path.dirname(absolute(edit.from)), { recursive: true });
    await fs.copyFile(backup, absolute(edit.from));
  }
  throw error;
}

async function removeEmptyDirectories(root) {
  if (!(await exists(root))) return;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.join(root, entry.name);
    await removeEmptyDirectories(target);
    if ((await fs.readdir(target)).length === 0) await fs.rmdir(target);
  }
}

await removeEmptyDirectories(rawRoot);
await appendLog(`ORGANIZE_RAW sources="${sourceNotes.length}" moves="${moves.length}" text_edits="${edits.length}" backup="${relative(backupRoot)}"`, vault);
await fs.writeFile(manifestPath, `${JSON.stringify({ ...summary, applied: true, completedAt: new Date().toISOString(), moves, edits: edits.map(({ from, to, kind, backup }) => ({ from, to, kind, backup })) }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, applied: true, backup: relative(backupRoot), manifest: relative(manifestPath) }, null, 2));
