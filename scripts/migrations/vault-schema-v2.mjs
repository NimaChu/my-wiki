#!/usr/bin/env node
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter, stringifyFrontmatter, stripFrontmatter, walkMarkdown } from "../core/wiki-lib.mjs";
import { migrateWikiToOkf } from "../core/okf-lib.mjs";

const vaultSpecifier = process.argv[2] || process.env.MY_WIKI_VAULT || "";
if (!vaultSpecifier) throw new Error("Usage: node scripts/migrations/vault-schema-v2.mjs /path/to/vault");
const vault = path.resolve(vaultSpecifier);
const vaultStat = await fs.stat(vault).catch(() => null);
if (!vaultStat || !vaultStat.isDirectory()) {
  throw new Error(`Vault path does not exist or is not a directory: ${vault}`);
}
if (vault === path.parse(vault).root) {
  throw new Error(`Refusing to operate on filesystem root: ${vault}`);
}

const legacy = {
  concepts: path.join(vault, "wiki"),
  sources: path.join(vault, "raw", "sources"),
  assets: path.join(vault, "raw", "assets"),
  originals: path.join(vault, "raw", "snapshots")
};
const current = {
  concepts: path.join(vault, "concepts"),
  sources: path.join(vault, "references", "sources"),
  assets: path.join(vault, "references", "assets"),
  originals: path.join(vault, "references", "originals")
};

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function moveDirectory(from, to) {
  if (!(await exists(from))) return false;
  if (await exists(to)) throw new Error(`Migration target already exists: ${to}`);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  return true;
}

function rewritePaths(value) {
  return String(value)
    .replaceAll("raw/sources/", "references/sources/")
    .replaceAll("raw/assets/", "references/assets/")
    .replaceAll("raw/snapshots/", "references/originals/")
    .replace(/(^|[^A-Za-z0-9_.-])wiki\//g, "$1concepts/");
}

async function walkFiles(root, predicate = () => true) {
  if (!(await exists(root))) return [];
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && predicate(target)) files.push(target);
    }
  }
  await walk(root);
  return files;
}

async function backupLegacyVault() {
  const hasLegacyLayout = await Promise.all(Object.values(legacy).map(exists)).then((values) => values.some(Boolean));
  if (!hasLegacyLayout) return "";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(path.dirname(vault), `${path.basename(vault)}-schema-v1-backup-${stamp}`);
  if (await exists(backup)) throw new Error(`Migration backup already exists: ${backup}`);
  await fs.cp(vault, backup, {
    recursive: true,
    errorOnExist: true,
    force: false,
    mode: constants.COPYFILE_FICLONE
  });
  return backup;
}

const backupPath = await backupLegacyVault();

const moved = {
  concepts: await moveDirectory(legacy.concepts, current.concepts),
  sources: await moveDirectory(legacy.sources, current.sources),
  assets: await moveDirectory(legacy.assets, current.assets),
  originals: await moveDirectory(legacy.originals, current.originals)
};

await fs.mkdir(current.concepts, { recursive: true });
await fs.mkdir(current.sources, { recursive: true });
await fs.mkdir(current.assets, { recursive: true });
await fs.mkdir(current.originals, { recursive: true });

for (const name of ["index.md", "log.md"]) {
  const from = path.join(current.concepts, name);
  const to = path.join(vault, name);
  if (await exists(from)) await fs.rename(from, to);
}
const legacyReadme = path.join(vault, "raw", "README.md");
if (await exists(legacyReadme)) {
  await fs.mkdir(path.join(vault, "references"), { recursive: true });
  await fs.rename(legacyReadme, path.join(vault, "references", "README.md"));
}

let markdownRewrites = 0;
for (const file of [
  ...await walkMarkdown(current.concepts),
  ...await walkMarkdown(current.sources),
  ...await walkMarkdown(path.join(vault, "templates")),
  ...["index.md", "log.md"].map((name) => path.join(vault, name)).filter((file) => true)
]) {
  if (!(await exists(file))) continue;
  const before = await fs.readFile(file, "utf8");
  let after = rewritePaths(before);
  if (file.startsWith(`${current.sources}${path.sep}`)) {
    const frontmatter = parseFrontmatter(after);
    const oldWorkflow = String(frontmatter.workflow_status || frontmatter.status || "inbox");
    frontmatter.type = "Reference";
    frontmatter.description = String(frontmatter.description || `Captured evidence for ${frontmatter.title || path.basename(file, ".md")}.`);
    frontmatter.status = ["draft", "stable", "deprecated"].includes(String(frontmatter.status)) ? frontmatter.status : "stable";
    frontmatter.workflow_status = oldWorkflow;
    after = `${stringifyFrontmatter(frontmatter)}\n\n${stripFrontmatter(after).replace(/^\s+/, "").trimEnd()}\n`;
  }
  if (after !== before) {
    await fs.writeFile(file, after, "utf8");
    markdownRewrites += 1;
  }
}

let jsonRewrites = 0;
for (const root of [current.assets, path.join(vault, ".my-wiki")]) {
  for (const file of await walkFiles(root, (target) => target.endsWith(".json") && !target.includes(`${path.sep}backups${path.sep}`) && !target.includes(`${path.sep}exports${path.sep}`))) {
    const before = await fs.readFile(file, "utf8");
    const after = rewritePaths(before);
    if (after !== before) {
      await fs.writeFile(file, after, "utf8");
      jsonRewrites += 1;
    }
  }
}

await fs.rm(path.join(vault, "raw"), { recursive: true, force: true });
await fs.writeFile(path.join(vault, ".my-wiki.json"), `${JSON.stringify({ version: 2, format: "okf", okf_version: "0.2" }, null, 2)}\n`, "utf8");
const normalization = await migrateWikiToOkf(vault, { apply: true, backup: false });

console.log(JSON.stringify({ vault, schema: 2, backupPath, moved, markdownRewrites, jsonRewrites, normalization }, null, 2));
