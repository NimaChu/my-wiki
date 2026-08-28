import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { exportUniverse } from "./export-universe.mjs";
import { importUniverse } from "./import-universe.mjs";
import {
  appendLog,
  isWikiKnowledgeNode,
  parseFrontmatter,
  scanVault,
  slugify,
  upsertFrontmatterValues,
  wikiUniverseNames
} from "./wiki-lib.mjs";

const SNAPSHOT_FIELDS = ["snapshot_path", "snapshot_markdown_path", "snapshot_html_path", "snapshot_json_path"];

export async function listGalaxyTrash(vault) {
  const root = trashRoot(vault);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const receipt = await readTrashReceipt(directory).catch(() => null);
    if (!receipt) continue;
    const packageFile = path.join(directory, "galaxy.mywiki");
    const packageStat = await fs.stat(packageFile).catch(() => null);
    results.push({
      id: entry.name,
      galaxy: String(receipt.galaxy || ""),
      trashedAt: String(receipt.trashedAt || ""),
      archivedConcepts: Number(receipt.archivedConcepts || 0),
      archivedReferences: Number(receipt.archivedReferences || 0),
      packageBytes: packageStat?.isFile() ? packageStat.size : 0,
      recoverable: Boolean(packageStat?.isFile()),
      retainedBackups: Array.isArray(receipt.retainedBackups) ? receipt.retainedBackups.length : 0
    });
  }
  return results.sort((left, right) => right.trashedAt.localeCompare(left.trashedAt));
}

export async function restoreGalaxyFromTrash(vault, entryId) {
  const directory = await resolveTrashEntry(vault, entryId);
  const receipt = await readTrashReceipt(directory);
  const packageFile = path.join(directory, "galaxy.mywiki");
  const preview = await importUniverse({ vault, packageFile, apply: false });
  const conflicts = [preview.wiki, preview.raw, preview.assets, preview.snapshots]
    .reduce((total, summary) => total + Number(summary?.conflicts || 0), 0);
  if (conflicts > 0) throw Object.assign(new Error(`Restore has ${conflicts} conflicting files; import the recycle package manually to resolve them`), { code: "GALAXY_RESTORE_CONFLICT" });
  const imported = await importUniverse({ vault, packageFile, apply: true });
  await fs.rm(directory, { recursive: true, force: true });
  await appendLog(`RESTORE_GALAXY galaxy="${receipt.galaxy}" entry="${entryId}"`, vault);
  return { id: entryId, galaxy: receipt.galaxy, imported };
}

export async function purgeGalaxyTrash(vault, entryId, confirmation) {
  const directory = await resolveTrashEntry(vault, entryId);
  const receipt = await readTrashReceipt(directory);
  if (String(confirmation || "") !== String(receipt.galaxy || "")) {
    throw Object.assign(new Error("Type the exact knowledge galaxy name to permanently delete it"), { code: "GALAXY_TRASH_CONFIRMATION" });
  }
  await fs.rm(directory, { recursive: true, force: true });
  await appendLog(`PURGE_GALAXY_TRASH galaxy="${receipt.galaxy}" entry="${entryId}"`, vault);
  return { id: entryId, galaxy: receipt.galaxy, purged: true };
}

export async function moveGalaxyToTrash(vault, galaxy) {
  const scan = await scanVault(vault);
  const galaxyKey = String(galaxy || "").trim().toLocaleLowerCase();
  const galaxyConcepts = scan.nodes.filter((node) => (
    isWikiKnowledgeNode(node) && wikiUniverseNames(node).some((name) => name.toLocaleLowerCase() === galaxyKey)
  ));
  const trashRoot = path.join(vault, ".my-wiki", "trash", "galaxies");
  await fs.mkdir(trashRoot, { recursive: true });
  const identity = `${timestamp()}-${slugify(galaxy) || "galaxy"}-${randomUUID().slice(0, 8)}`;
  const entryRoot = path.join(trashRoot, identity);
  const packageFile = path.join(entryRoot, "galaxy.mywiki");
  const receiptFile = path.join(entryRoot, "receipt.json");
  await fs.mkdir(entryRoot, { recursive: true });
  const retainedBackups = new Set();
  const backupRetainedFile = async (node) => {
    if (retainedBackups.has(node.path)) return;
    const target = path.join(entryRoot, "retained", ...node.path.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(node.file, target);
    retainedBackups.add(node.path);
  };

  let exported = null;
  if (galaxyConcepts.length > 0) {
    exported = await exportUniverse({ vault, universeName: galaxy, output: packageFile });
  }

  const galaxyConceptIds = new Set(galaxyConcepts.map((node) => node.id));
  const deletedConceptIds = new Set();
  const retainedConceptIds = new Set();
  for (const node of scan.nodes.filter(isWikiKnowledgeNode)) {
    if (!galaxyConceptIds.has(node.id)) {
      retainedConceptIds.add(node.id);
      continue;
    }
    const remaining = wikiUniverseNames(node).filter((name) => name.toLocaleLowerCase() !== galaxyKey);
    if (remaining.length === 0) deletedConceptIds.add(node.id);
    else retainedConceptIds.add(node.id);
  }

  const relatedReferenceIds = new Set();
  for (const edge of scan.edges) {
    if (galaxyConceptIds.has(edge.source) && edge.target.startsWith("references/sources/")) relatedReferenceIds.add(edge.target);
    if (galaxyConceptIds.has(edge.target) && edge.source.startsWith("references/sources/")) relatedReferenceIds.add(edge.source);
  }

  const allRelations = [...scan.edges, ...scan.typedRelations];
  const deletedReferenceIds = new Set([...relatedReferenceIds].filter((referenceId) => !allRelations.some((edge) => {
    const other = edge.source === referenceId ? edge.target : edge.target === referenceId ? edge.source : "";
    return retainedConceptIds.has(other);
  })));
  const retainedReferences = scan.nodes.filter((node) => node.id.startsWith("references/sources/") && !deletedReferenceIds.has(node.id));
  const protectedSnapshots = new Set(retainedReferences.flatMap((node) => snapshotPaths(node.frontmatter)));
  const protectedAssetDirectories = new Set(retainedReferences.flatMap(referenceAssetDirectories));

  let updatedConcepts = 0;
  let cleanedConcepts = 0;
  let removedConcepts = 0;
  let updatedReferences = 0;
  let removedReferences = 0;
  const removedArtifacts = [];

  const deletedConcepts = galaxyConcepts.filter((node) => deletedConceptIds.has(node.id));
  for (const node of scan.nodes.filter(isWikiKnowledgeNode)) {
    if (deletedConceptIds.has(node.id)) {
      await fs.rm(node.file, { force: true });
      removedConcepts += 1;
      continue;
    }
    let updated = node.content;
    if (galaxyConceptIds.has(node.id)) {
      const remaining = wikiUniverseNames(node).filter((name) => name.toLocaleLowerCase() !== galaxyKey);
      updated = upsertFrontmatterValues(updated, { universes: remaining });
      updatedConcepts += 1;
    }
    const cleaned = removeDeletedConceptLinks(updated, node.path, deletedConcepts);
    if (cleaned !== updated) cleanedConcepts += 1;
    updated = cleaned;
    if (updated !== node.content) {
      await backupRetainedFile(node);
      await fs.writeFile(node.file, updated, "utf8");
    }
  }

  for (const node of scan.nodes.filter((candidate) => candidate.id.startsWith("references/sources/"))) {
    if (deletedReferenceIds.has(node.id)) {
      await fs.rm(node.file, { force: true });
      removedReferences += 1;
      continue;
    }
    if (String(node.frontmatter.suggested_universe || "").trim().toLocaleLowerCase() !== galaxyKey) continue;
    await backupRetainedFile(node);
    await fs.writeFile(node.file, upsertFrontmatterValues(node.content, { suggested_universe: null }), "utf8");
    updatedReferences += 1;
  }

  for (const node of scan.nodes.filter((candidate) => deletedReferenceIds.has(candidate.id))) {
    for (const directory of referenceAssetDirectories(node)) {
      if (protectedAssetDirectories.has(directory)) continue;
      if (await removeManagedPath(vault, directory, true)) removedArtifacts.push(directory);
    }
    for (const snapshot of snapshotPaths(node.frontmatter)) {
      if (protectedSnapshots.has(snapshot)) continue;
      if (await removeManagedPath(vault, snapshot, false)) removedArtifacts.push(snapshot);
    }
  }

  const result = {
    galaxy,
    trashedAt: new Date().toISOString(),
    trashPackage: exported ? slash(path.relative(vault, packageFile)) : "",
    archiveSha256: exported?.archiveSha256 || "",
    archivedConcepts: exported?.wiki || 0,
    archivedReferences: exported?.raw || 0,
    removedConcepts,
    updatedConcepts,
    cleanedConcepts,
    removedReferences,
    updatedReferences,
    retainedBackups: [...retainedBackups].sort(),
    removedArtifacts: [...new Set(removedArtifacts)].sort(),
    trashReceipt: slash(path.relative(vault, receiptFile))
  };
  await fs.writeFile(receiptFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await appendLog(`TRASH_GALAXY galaxy="${galaxy}" concepts="${removedConcepts}" references="${removedReferences}" package="${result.trashPackage}"`, vault);
  return result;
}

function trashRoot(vault) {
  return path.join(vault, ".my-wiki", "trash", "galaxies");
}

async function resolveTrashEntry(vault, entryId) {
  const id = String(entryId || "").trim();
  if (!id || id !== path.basename(id) || !/^[\p{L}\p{N}._-]+$/u.test(id)) throw new Error("Invalid recycle-bin entry");
  const root = path.resolve(trashRoot(vault));
  const directory = path.resolve(root, id);
  if (!isWithin(root, directory)) throw new Error("Invalid recycle-bin entry");
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) throw Object.assign(new Error("Recycle-bin entry not found"), { code: "GALAXY_TRASH_NOT_FOUND" });
  return directory;
}

async function readTrashReceipt(directory) {
  return JSON.parse(await fs.readFile(path.join(directory, "receipt.json"), "utf8"));
}

function referenceAssetDirectories(node) {
  const directories = new Set([`references/assets/${path.posix.basename(node.id)}`]);
  const imageIndex = managedRelative(node.frontmatter.image_index_path, "references/assets/");
  if (imageIndex) directories.add(path.posix.dirname(imageIndex));
  return [...directories];
}

function snapshotPaths(frontmatter) {
  return SNAPSHOT_FIELDS.map((field) => managedRelative(frontmatter[field], "references/originals/")).filter(Boolean);
}

function managedRelative(value, prefix) {
  const normalized = path.posix.normalize(String(value || "").trim().replace(/\\/g, "/"));
  return normalized.startsWith(prefix) && !normalized.includes("../") ? normalized : "";
}

async function removeManagedPath(vault, relative, directory) {
  const root = path.resolve(vault);
  const target = path.resolve(root, ...relative.split("/"));
  if (!isWithin(root, target)) return false;
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return false;
  await fs.rm(target, { recursive: directory || stat.isDirectory(), force: true });
  return true;
}

function removeDeletedConceptLinks(content, sourcePath, deletedConcepts) {
  if (deletedConcepts.length === 0) return content;
  const deletedIds = new Set(deletedConcepts.map((node) => normalizeConceptTarget(node.id)));
  const deletedTitles = new Set(deletedConcepts.flatMap((node) => [node.title, ...(node.aliases || [])].map((value) => String(value).trim().toLocaleLowerCase())));
  let updated = content.replace(/(!?)\[([^\]]+)\]\(([^)]+)\)/g, (match, image, label, href) => {
    if (image || !deletedIds.has(resolveConceptTarget(sourcePath, href))) return match;
    return label;
  });
  updated = updated.replace(/\[\[([^\]]+)\]\]/g, (match, body) => {
    const [target, label] = String(body).split("|", 2);
    const normalized = normalizeConceptTarget(target.split("#", 1)[0]);
    const titleMatch = deletedTitles.has(target.split("#", 1)[0].trim().toLocaleLowerCase());
    if (!deletedIds.has(normalized) && !titleMatch) return match;
    return (label || path.posix.basename(target)).trim();
  });
  const frontmatter = parseFrontmatter(updated);
  if (Array.isArray(frontmatter.relation_hints)) {
    const hints = frontmatter.relation_hints.filter((hint) => !deletedIds.has(resolveConceptTarget(sourcePath, hint)));
    if (hints.length !== frontmatter.relation_hints.length) updated = upsertFrontmatterValues(updated, { relation_hints: hints });
  }
  return updated;
}

function resolveConceptTarget(sourcePath, value) {
  let target = String(value || "").trim().replace(/^<|>$/g, "").split("#", 1)[0].split("?", 1)[0];
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return "";
  try { target = decodeURIComponent(target); } catch { return ""; }
  target = target.replace(/\\/g, "/");
  const resolved = target.startsWith("/")
    ? target.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target));
  return normalizeConceptTarget(resolved);
}

function normalizeConceptTarget(value) {
  return String(value || "").trim().replace(/^\//, "").replace(/\.md$/i, "").toLocaleLowerCase();
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slash(value) {
  return String(value).replace(/\\/g, "/");
}
