#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  appendLog,
  exists,
  parseFrontmatter,
  stringifyFrontmatter,
  stripFrontmatter,
  vaultPath,
  walkMarkdown
} from "./wiki-lib.mjs";
import { ASSETS_DIR, ORIGINALS_DIR, SOURCES_DIR, sourceFrontmatter, vaultDirectory } from "./vault-layout.mjs";

const vault = vaultPath();
const apply = process.argv.includes("--apply");
const sources = await walkMarkdown(vaultDirectory(vault, SOURCES_DIR));
const changes = [];

for (const file of sources) {
  const content = await fs.readFile(file, "utf8");
  const current = parseFrontmatter(content);
  const normalized = sourceFrontmatter(current);
  if (current.type !== normalized.type || current.status !== normalized.status || current.workflow_status !== normalized.workflow_status) {
    changes.push({ file, path: path.relative(vault, file).replace(/\\/g, "/"), normalized });
  }
}

const required = [SOURCES_DIR, ASSETS_DIR, ORIGINALS_DIR, "concepts"];
const missingDirectories = [];
for (const relative of required) {
  if (!(await exists(vaultDirectory(vault, relative)))) missingDirectories.push(relative);
}

if (apply) {
  for (const change of changes) {
    const content = await fs.readFile(change.file, "utf8");
    await fs.writeFile(change.file, `${stringifyFrontmatter(change.normalized)}\n\n${stripFrontmatter(content).replace(/^\s+/, "").trimEnd()}\n`, "utf8");
  }
  if (changes.length) await appendLog(`NORMALIZE_REFERENCES sources="${changes.length}"`, vault);
}

console.log(JSON.stringify({
  vault,
  schema: "okf-v0.2",
  missingDirectories,
  sources: sources.length,
  metadataChanges: changes.map(({ path: sourcePath, normalized }) => ({
    path: sourcePath,
    type: normalized.type,
    status: normalized.status,
    workflow_status: normalized.workflow_status
  })),
  apply
}, null, 2));

if (missingDirectories.length) process.exitCode = 1;
