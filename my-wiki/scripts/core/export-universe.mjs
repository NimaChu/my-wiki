#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  appendLog,
  isWikiKnowledgeNode,
  normalizeUniverseName,
  parseFrontmatter,
  scanVault,
  slugify,
  upsertFrontmatterValues,
  vaultPath,
  wikiUniverseNames
} from "./wiki-lib.mjs";
import { hashBuffer, hashFile, walkFiles, writeUniverseArchive } from "./universe-package-lib.mjs";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] || "";
  const prefix = `${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function positional() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith("--")) {
      if (!args[index].includes("=") && ["--name", "--output"].includes(args[index])) index += 1;
      continue;
    }
    values.push(args[index]);
  }
  return values;
}

const requestedUniverse = normalizeUniverseName(option("--name") || positional()[0]);
if (!requestedUniverse) {
  console.error("Usage: my-wiki export-universe <universe-name> [--output package.mywiki]");
  process.exit(2);
}

const vault = vaultPath();
const scan = await scanVault(vault);
const availableUniverses = Array.from(new Set(scan.nodes.filter(isWikiKnowledgeNode).flatMap((node) => wikiUniverseNames(node))));
const universe = availableUniverses.find((name) => name.localeCompare(requestedUniverse, undefined, { sensitivity: "accent" }) === 0) ||
  availableUniverses.find((name) => name.toLowerCase() === requestedUniverse.toLowerCase());
if (!universe) {
  throw new Error(`Unknown universe: ${requestedUniverse}. Available: ${availableUniverses.join(", ") || "none"}`);
}

const wikiNodes = scan.nodes.filter((node) => isWikiKnowledgeNode(node) && wikiUniverseNames(node).includes(universe));
const wikiIds = new Set(wikiNodes.map((node) => node.id));
const nodeById = new Map(scan.nodes.map((node) => [node.id, node]));
const rawIds = new Set();
const externalWiki = new Set();
for (const edge of scan.edges) {
  const other = wikiIds.has(edge.source) ? edge.target : wikiIds.has(edge.target) ? edge.source : "";
  if (other.startsWith("raw/sources/")) rawIds.add(other);
  else if (other.startsWith("wiki/") && !wikiIds.has(other) && isWikiKnowledgeNode(nodeById.get(other))) externalWiki.add(other);
}

const rawNodes = [...rawIds]
  .map((id) => scan.nodes.find((node) => node.id === id))
  .filter(Boolean);
const packageEntries = new Map();

for (const node of wikiNodes) {
  const content = upsertFrontmatterValues(node.content, { universes: wikiUniverseNames(node) });
  packageEntries.set(node.path, { path: node.path, buffer: Buffer.from(content, "utf8"), kind: "wiki" });
}

const sources = [];
const assetDirectories = new Set();
const snapshotPaths = new Set();
const missingSnapshots = [];
for (const node of rawNodes) {
  const frontmatter = parseFrontmatter(node.content);
  packageEntries.set(node.path, { path: node.path, buffer: Buffer.from(node.content, "utf8"), kind: "raw" });
  const sourceSnapshots = [];
  for (const key of ["snapshot_path", "snapshot_markdown_path", "snapshot_html_path", "snapshot_json_path"]) {
    const snapshotPath = managedSnapshotPath(frontmatter[key]);
    if (!snapshotPath) continue;
    sourceSnapshots.push(snapshotPath);
    snapshotPaths.add(snapshotPath);
  }
  sources.push({
    path: node.path,
    source_url: String(frontmatter.source_url || ""),
    content_hash: String(frontmatter.content_hash || ""),
    snapshots: sourceSnapshots
  });

  const base = path.basename(node.id);
  assetDirectories.add(`raw/assets/${base}`);
  const imageIndex = String(frontmatter.image_index_path || "").replace(/\\/g, "/");
  if (imageIndex.startsWith("raw/assets/")) assetDirectories.add(path.posix.dirname(imageIndex));
}

for (const snapshotPath of snapshotPaths) {
  const absolute = path.join(vault, ...snapshotPath.split("/"));
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
      missingSnapshots.push(snapshotPath);
      continue;
    }
    packageEntries.set(snapshotPath, { path: snapshotPath, file: absolute, kind: "snapshot" });
  } catch (error) {
    if (error?.code === "ENOENT") missingSnapshots.push(snapshotPath);
    else throw error;
  }
}
if (missingSnapshots.length) {
  throw new Error(`Cannot export universe with missing snapshot evidence:\n${missingSnapshots.map((item) => `- ${item}`).join("\n")}`);
}

for (const directory of assetDirectories) {
  const absolute = path.join(vault, ...directory.split("/"));
  for (const file of await walkFiles(absolute)) {
    const relative = path.relative(vault, file).replace(/\\/g, "/");
    packageEntries.set(relative, { path: relative, file, kind: "asset" });
  }
}

const files = [];
let totalBytes = 0;
for (const entry of packageEntries.values()) {
  const details = entry.buffer
    ? { bytes: entry.buffer.length, sha256: hashBuffer(entry.buffer) }
    : await hashFile(entry.file);
  totalBytes += details.bytes;
  files.push({ path: entry.path, kind: entry.kind, ...details });
}
files.sort((a, b) => a.path.localeCompare(b.path));
sources.sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  format: "my-wiki-universe",
  version: 1,
  universe,
  exported_at: new Date().toISOString(),
  contents: {
    wiki: wikiNodes.length,
    raw: rawNodes.length,
    assets: files.filter((file) => file.kind === "asset").length,
    snapshots: files.filter((file) => file.kind === "snapshot").length,
    bytes: totalBytes
  },
  sources,
  external_wiki_references: [...externalWiki].sort(),
  files
};
const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const requestedOutput = option("--output");
const now = new Date();
const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const output = path.resolve(requestedOutput || path.join(vault, ".my-wiki", "exports", `${slugify(universe)}-${timestamp}.mywiki`));
await writeUniverseArchive(output, [
  { path: "manifest.json", buffer: manifestBuffer },
  ...[...packageEntries.values()].sort((a, b) => a.path.localeCompare(b.path))
]);
const archive = await hashFile(output);
await appendLog(`EXPORT_UNIVERSE universe="${universe}" wiki="${wikiNodes.length}" raw="${rawNodes.length}" assets="${manifest.contents.assets}" snapshots="${manifest.contents.snapshots}" output="${path.relative(vault, output).replace(/\\/g, "/")}"`, vault);

console.log(JSON.stringify({
  vault,
  universe,
  output,
  archiveBytes: archive.bytes,
  archiveSha256: archive.sha256,
  ...manifest.contents,
  sources: sources.length,
  externalWikiReferences: externalWiki.size,
  snapshotsIncluded: true
}, null, 2));

function managedSnapshotPath(value) {
  const normalized = path.posix.normalize(String(value || "").trim().replace(/\\/g, "/"));
  return normalized.startsWith("raw/snapshots/") ? normalized : "";
}
