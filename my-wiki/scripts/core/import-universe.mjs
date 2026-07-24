#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendLog,
  asArray,
  exists,
  normalizeUniverseName,
  parseFrontmatter,
  scanVault,
  upsertFrontmatterValues,
  vaultPath,
  wikiUniverseNames
} from "./wiki-lib.mjs";
import { extractUniverseArchive, hashBuffer, hashFile, walkFiles } from "./universe-package-lib.mjs";

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
      if (!args[index].includes("=") && ["--as"].includes(args[index])) index += 1;
      continue;
    }
    values.push(args[index]);
  }
  return values;
}

const packageFile = path.resolve(positional()[0] || "");
if (!positional()[0]) {
  console.error("Usage: my-wiki import-universe <package.mywiki> [--as universe-name] [--apply]");
  process.exit(2);
}
if (!(await exists(packageFile))) throw new Error(`Package not found: ${packageFile}`);

const apply = args.includes("--apply");
const vault = vaultPath();
const staging = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-universe-"));

try {
  const extracted = await extractUniverseArchive(packageFile, staging);
  const extractedByPath = new Map(extracted.map((entry) => [entry.path, entry]));
  const manifestEntry = extractedByPath.get("manifest.json");
  if (!manifestEntry) throw new Error("My Wiki package has no manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestEntry.file, "utf8"));
  if (manifest.format !== "my-wiki-universe" || manifest.version !== 1) {
    throw new Error(`Unsupported My Wiki package format: ${manifest.format || "unknown"} v${manifest.version || "unknown"}`);
  }

  for (const expected of manifest.files || []) {
    const entry = extractedByPath.get(expected.path);
    if (!entry) throw new Error(`Package file missing: ${expected.path}`);
    if (entry.bytes !== expected.bytes) throw new Error(`Package file size mismatch: ${expected.path}`);
    const actual = await hashFile(entry.file);
    if (actual.sha256 !== expected.sha256) throw new Error(`Package file checksum mismatch: ${expected.path}`);
  }

  const sourceUniverse = normalizeUniverseName(manifest.universe);
  const targetUniverse = normalizeUniverseName(option("--as") || sourceUniverse);
  if (!targetUniverse) throw new Error("Package universe name is empty");

  const scan = await scanVault(vault);
  const existingRawByHash = new Map();
  const existingRawBySourceUrl = new Map();
  const existingRawByPath = new Map();
  const existingWikiByTitle = new Map();
  for (const node of scan.nodes) {
    if (node.id.startsWith("raw/sources/")) {
      const contentHash = String(node.frontmatter.content_hash || "");
      if (contentHash) existingRawByHash.set(contentHash, node);
      const sourceUrl = String(node.frontmatter.source_url || "");
      if (sourceUrl) existingRawBySourceUrl.set(sourceUrl, node);
      existingRawByPath.set(node.path.toLowerCase(), node);
    }
    if (node.id.startsWith("wiki/")) {
      existingWikiByTitle.set(node.title.toLowerCase(), node);
      for (const alias of node.aliases) existingWikiByTitle.set(alias.toLowerCase(), node);
    }
  }

  const packageRaw = (manifest.files || []).filter((file) => file.kind === "raw");
  const packageWiki = (manifest.files || []).filter((file) => file.kind === "wiki");
  const packageAssets = (manifest.files || []).filter((file) => file.kind === "asset");
  const packageSnapshots = (manifest.files || []).filter((file) => file.kind === "snapshot");
  const reserved = new Set(scan.nodes.map((node) => node.path.toLowerCase()));
  const rawPathMap = new Map();
  const rawPlans = [];
  const snapshotOwners = new Map();
  const existingSnapshotTargets = new Map();

  for (const item of packageRaw) {
    const entry = extractedByPath.get(item.path);
    const content = await fs.readFile(entry.file, "utf8");
    const frontmatter = parseFrontmatter(content);
    for (const key of ["snapshot_path", "snapshot_markdown_path", "snapshot_html_path", "snapshot_json_path"]) {
      const snapshotPath = managedSnapshotPath(frontmatter[key]);
      if (!snapshotPath) continue;
      if (!snapshotOwners.has(snapshotPath)) snapshotOwners.set(snapshotPath, []);
      snapshotOwners.get(snapshotPath).push(item.path);
    }
    const contentHash = String(frontmatter.content_hash || "");
    const sourceUrl = String(frontmatter.source_url || "");
    const hashMatch = contentHash ? existingRawByHash.get(contentHash) : null;
    const fallbackCandidates = [
      sourceUrl ? existingRawBySourceUrl.get(sourceUrl) : null,
      existingRawByPath.get(item.path.toLowerCase())
    ].filter(Boolean);
    const duplicate = hashMatch || fallbackCandidates.find((node) => normalizeText(node.content) === normalizeText(content));
    if (duplicate) {
      for (const key of ["snapshot_path", "snapshot_markdown_path", "snapshot_html_path", "snapshot_json_path"]) {
        const packageSnapshot = managedSnapshotPath(frontmatter[key]);
        const existingSnapshot = managedSnapshotPath(duplicate.frontmatter[key]);
        if (packageSnapshot && existingSnapshot) existingSnapshotTargets.set(packageSnapshot, existingSnapshot);
      }
      rawPathMap.set(stripMarkdownExtension(item.path), duplicate.id);
      rawPlans.push({ source: item.path, target: duplicate.path, action: "deduplicate", content: "" });
      continue;
    }

    const target = await uniqueRawTarget(vault, item.path, reserved);
    reserved.add(target.toLowerCase());
    rawPathMap.set(stripMarkdownExtension(item.path), stripMarkdownExtension(target));
    rawPlans.push({ source: item.path, target, action: "write", content });
  }

  const assetPathMap = new Map();
  for (const [oldRaw, newRaw] of rawPathMap) {
    const oldBase = path.posix.basename(oldRaw);
    const newBase = path.posix.basename(newRaw);
    assetPathMap.set(`raw/assets/${oldBase}`, `raw/assets/${newBase}`);
  }

  const rawPlanBySource = new Map(rawPlans.map((plan) => [plan.source, plan]));
  const existingSnapshotFiles = await walkFiles(path.join(vault, "raw", "snapshots"));
  const reservedSnapshots = new Set(existingSnapshotFiles.map((file) => path.relative(vault, file).replace(/\\/g, "/").toLowerCase()));
  const snapshotPathMap = new Map();
  const snapshotPlans = [];
  for (const item of packageSnapshots) {
    const sourceEntry = extractedByPath.get(item.path);
    const requestedTarget = existingSnapshotTargets.get(item.path) || item.path;
    const target = vaultFile(vault, requestedTarget);
    if (!(await exists(target))) {
      reservedSnapshots.add(requestedTarget.toLowerCase());
      snapshotPathMap.set(item.path, requestedTarget);
      snapshotPlans.push({ source: item.path, target: requestedTarget, action: "write", file: sourceEntry.file });
      continue;
    }

    const current = await hashFile(target);
    if (current.sha256 === item.sha256) {
      snapshotPathMap.set(item.path, requestedTarget);
      snapshotPlans.push({ source: item.path, target: requestedTarget, action: "deduplicate", file: sourceEntry.file });
      continue;
    }

    const owners = snapshotOwners.get(item.path) || [];
    const canRewriteAllOwners = owners.every((owner) => rawPlanBySource.get(owner)?.action === "write");
    if (canRewriteAllOwners) {
      const uniqueTarget = await uniquePackageTarget(vault, requestedTarget, reservedSnapshots);
      reservedSnapshots.add(uniqueTarget.toLowerCase());
      snapshotPathMap.set(item.path, uniqueTarget);
      snapshotPlans.push({ source: item.path, target: uniqueTarget, action: "write", file: sourceEntry.file });
    } else {
      snapshotPathMap.set(item.path, requestedTarget);
      snapshotPlans.push({ source: item.path, target: requestedTarget, action: "conflict", file: sourceEntry.file });
    }
  }

  for (const plan of rawPlans.filter((item) => item.action === "write")) {
    plan.content = rewritePackagePaths(plan.content, rawPathMap, assetPathMap, snapshotPathMap);
  }

  const wikiPlans = [];
  const existingWikiUpdates = new Map();
  for (const item of packageWiki) {
    const entry = extractedByPath.get(item.path);
    let content = await fs.readFile(entry.file, "utf8");
    const frontmatter = parseFrontmatter(content);
    const universes = wikiUniverseNames(frontmatter, String(frontmatter.title || path.basename(item.path, ".md")), asArray(frontmatter.tags))
      .map((name) => name === sourceUniverse ? targetUniverse : name);
    if (!universes.some((name) => name.toLowerCase() === targetUniverse.toLowerCase())) universes.unshift(targetUniverse);
    content = upsertFrontmatterValues(content, { universes: Array.from(new Set(universes)) });
    content = rewritePackagePaths(content, rawPathMap, assetPathMap, snapshotPathMap);

    const title = String(parseFrontmatter(content).title || path.basename(item.path, ".md"));
    const pathMatch = scan.nodes.find((node) => node.path.toLowerCase() === item.path.toLowerCase() && node.id.startsWith("wiki/"));
    const titleMatch = existingWikiByTitle.get(title.toLowerCase());
    const existing = pathMatch || titleMatch;
    if (existing) {
      const existingUniverses = wikiUniverseNames(existing);
      if (!existingUniverses.some((name) => name.toLowerCase() === targetUniverse.toLowerCase())) {
        existingWikiUpdates.set(existing.id, {
          node: existing,
          content: upsertFrontmatterValues(existing.content, { universes: [...existingUniverses, targetUniverse] })
        });
      }
      const same = normalizeText(existing.content) === normalizeText(content);
      wikiPlans.push({ source: item.path, target: existing.path, action: same ? "deduplicate" : "conflict", content });
      continue;
    }
    wikiPlans.push({ source: item.path, target: item.path, action: "write", content });
  }

  const assetPlans = [];
  for (const item of packageAssets) {
    const sourceEntry = extractedByPath.get(item.path);
    const targetPath = remapPrefix(item.path, assetPathMap);
    const target = vaultFile(vault, targetPath);
    let buffer = null;
    if (item.path.endsWith(".json")) {
      const original = await fs.readFile(sourceEntry.file, "utf8");
      const rewritten = rewritePackagePaths(original, rawPathMap, assetPathMap);
      if (rewritten !== original) buffer = Buffer.from(rewritten, "utf8");
    }
    if (!(await exists(target))) {
      assetPlans.push({ source: item.path, target: targetPath, action: "write", file: sourceEntry.file, buffer });
      continue;
    }
    const current = await hashFile(target);
    const incomingHash = buffer ? hashBuffer(buffer) : item.sha256;
    assetPlans.push({
      source: item.path,
      target: targetPath,
      action: current.sha256 === incomingHash ? "deduplicate" : "conflict",
      file: sourceEntry.file,
      buffer
    });
  }

  const summary = {
    vault,
    package: packageFile,
    mode: apply ? "apply" : "dry-run",
    sourceUniverse,
    universe: targetUniverse,
    wiki: summarizePlans(wikiPlans),
    raw: summarizePlans(rawPlans),
    assets: summarizePlans(assetPlans),
    snapshots: summarizePlans(snapshotPlans),
    existingWikiMetadataUpdates: existingWikiUpdates.size
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    await fs.rm(staging, { recursive: true, force: true });
    process.exit(0);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const receiptRoot = path.join(vault, ".my-wiki", "imports", `${timestamp}-${safeName(targetUniverse)}`);
  const conflictsRoot = path.join(receiptRoot, "conflicts");
  const backupsRoot = path.join(receiptRoot, "backups");
  await fs.mkdir(receiptRoot, { recursive: true });

  for (const update of existingWikiUpdates.values()) {
    const backup = path.join(backupsRoot, ...update.node.path.split("/"));
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.writeFile(backup, update.node.content, "utf8");
    await fs.writeFile(update.node.file, update.content, "utf8");
  }

  for (const plan of [...wikiPlans, ...rawPlans]) {
    if (plan.action === "write") {
      const target = vaultFile(vault, plan.target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, plan.content, "utf8");
    } else if (plan.action === "conflict") {
      const target = path.join(conflictsRoot, ...plan.source.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, plan.content, "utf8");
    }
  }

  for (const plan of assetPlans) {
    if (plan.action === "write") {
      const target = vaultFile(vault, plan.target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (plan.buffer) await fs.writeFile(target, plan.buffer);
      else await fs.copyFile(plan.file, target);
    } else if (plan.action === "conflict") {
      const target = path.join(conflictsRoot, ...plan.source.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (plan.buffer) await fs.writeFile(target, plan.buffer);
      else await fs.copyFile(plan.file, target);
    }
  }

  for (const plan of snapshotPlans) {
    if (plan.action === "write") {
      const target = vaultFile(vault, plan.target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(plan.file, target);
    } else if (plan.action === "conflict") {
      const target = path.join(conflictsRoot, ...plan.source.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(plan.file, target);
    }
  }

  await fs.copyFile(manifestEntry.file, path.join(receiptRoot, "manifest.json"));
  const postScan = await scanVault(vault);
  const report = {
    ...summary,
    applied: true,
    completedAt: new Date().toISOString(),
    receipt: path.relative(vault, receiptRoot).replace(/\\/g, "/"),
    unresolvedAfterImport: postScan.unresolved.length,
    conflicts: wikiPlans.filter((plan) => plan.action === "conflict").length + assetPlans.filter((plan) => plan.action === "conflict").length + snapshotPlans.filter((plan) => plan.action === "conflict").length
  };
  await fs.writeFile(path.join(receiptRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await appendLog(`IMPORT_UNIVERSE universe="${targetUniverse}" wiki="${summary.wiki.write}" raw="${summary.raw.write}" assets="${summary.assets.write}" snapshots="${summary.snapshots.write}" conflicts="${report.conflicts}"`, vault);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}

async function uniqueRawTarget(vault, requested, reserved) {
  if (!reserved.has(requested.toLowerCase()) && !(await exists(vaultFile(vault, requested)))) return requested;
  const extension = path.posix.extname(requested);
  const stem = requested.slice(0, -extension.length);
  let counter = 2;
  while (true) {
    const candidate = `${stem}-${counter}${extension}`;
    if (!reserved.has(candidate.toLowerCase()) && !(await exists(vaultFile(vault, candidate)))) return candidate;
    counter += 1;
  }
}

async function uniquePackageTarget(vault, requested, reserved) {
  const extension = path.posix.extname(requested);
  const stem = requested.slice(0, -extension.length);
  let counter = 2;
  while (true) {
    const candidate = `${stem}-${counter}${extension}`;
    if (!reserved.has(candidate.toLowerCase()) && !(await exists(vaultFile(vault, candidate)))) return candidate;
    counter += 1;
  }
}

function rewritePackagePaths(content, rawPathMap, assetPathMap, snapshotPathMap = new Map()) {
  const replacements = [
    ...[...rawPathMap].flatMap(([from, to]) => [[from, to], [`${from}.md`, `${to}.md`]]),
    ...[...assetPathMap].flatMap(([from, to]) => {
      const fromBase = path.posix.basename(from);
      const toBase = path.posix.basename(to);
      return [[from, to], [`../assets/${fromBase}`, `../assets/${toBase}`]];
    }),
    ...snapshotPathMap
  ].filter(([from, to]) => from !== to).sort((a, b) => b[0].length - a[0].length);
  return replacements.reduce((updated, [from, to]) => updated.split(from).join(to), content);
}

function remapPrefix(value, mappings) {
  const prefix = [...mappings.keys()]
    .filter((candidate) => value === candidate || value.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? `${mappings.get(prefix)}${value.slice(prefix.length)}` : value;
}

function stripMarkdownExtension(value) {
  return value.replace(/\.md$/i, "");
}

function vaultFile(vault, relative) {
  return path.join(vault, ...relative.replace(/\\/g, "/").split("/"));
}

function normalizeText(value) {
  return String(value).replace(/\r\n/g, "\n").trim();
}

function summarizePlans(plans) {
  return {
    total: plans.length,
    write: plans.filter((plan) => plan.action === "write").length,
    deduplicate: plans.filter((plan) => plan.action === "deduplicate").length,
    conflicts: plans.filter((plan) => plan.action === "conflict").length
  };
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "universe";
}

function managedSnapshotPath(value) {
  const normalized = path.posix.normalize(String(value || "").trim().replace(/\\/g, "/"));
  return normalized.startsWith("raw/snapshots/") ? normalized : "";
}
