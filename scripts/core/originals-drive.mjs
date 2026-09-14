import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { asArray, isWikiKnowledgeNode, normalizeUniverseName, scanVault, wikiUniverseNames } from "./wiki-lib.mjs";
import { readUniverseRegistry } from "./universe-registry.mjs";
import { resolveReferencePathAlias } from "./reference-path-aliases.mjs";

const queues = new Map();
const fail = (status, message) => Object.assign(new Error(message), { status, statusCode: status });
const key = (name) => `galaxy:${name.toLocaleLowerCase()}`;
const stateFile = (vault) => path.join(vault, ".my-wiki", "originals-drive.json");
const within = (root, file) => file.startsWith(root + path.sep);

async function readState(vault) {
  try {
    const state = JSON.parse(await fs.readFile(stateFile(vault), "utf8"));
    if (state.version !== 1 || !Array.isArray(state.folders) || !Array.isArray(state.placements)) throw fail(500, "Invalid originals drive metadata");
    return state;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, folders: [], placements: [] };
  }
}

function mutate(vault, operation) {
  const root = path.resolve(vault);
  const previous = queues.get(root) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const state = await readState(root);
    const result = await operation(state);
    const file = stateFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
    return result;
  });
  queues.set(root, task);
  return task.finally(() => { if (queues.get(root) === task) queues.delete(root); });
}

export async function resolveDriveOriginal(vault, relative) {
  if (typeof relative !== "string" || !relative.startsWith("references/originals/") || relative.split(/[\\/]/).some((part) => part === "..") || relative.includes("\0")) throw fail(400, "Invalid original path");
  relative = await resolveReferencePathAlias(vault, relative);
  const root = await fs.realpath(vault);
  const originals = await fs.realpath(path.join(root, "references/originals")).catch(() => "");
  const file = await fs.realpath(path.join(root, relative)).catch(() => "");
  if (!within(root, originals) || !within(originals, file)) throw fail(404, "Original not found");
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw fail(404, "Original not found");
  return { file, stat };
}

const indexes = new Map();
const indexRequests = new Map();

async function librarySignature(vault) {
  const files = ["index.md", "log.md", ".my-wiki/galaxies.json", ".my-wiki/originals-drive.json"];
  const directories = ["concepts", "references/sources", "references/originals", "templates", "_archive"];
  for (let i = 0; i < directories.length; i++) {
    const directory = directories[i];
    const target = path.join(vault, directory);
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat || stat.isSymbolicLink()) { files.push(directory); continue; }
    for (const entry of await fs.readdir(target, { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory() && !["node_modules", "dist", "__MACOSX"].includes(entry.name)) directories.push(relative);
      else if (entry.isFile() && (relative.startsWith("references/originals/") || relative.endsWith(".md"))) files.push(relative);
    }
  }
  files.sort();
  const hash = createHash("sha256");
  for (let offset = 0; offset < files.length; offset += 48) {
    const rows = await Promise.all(files.slice(offset, offset + 48).map(async (relative) => {
      const stat = await fs.lstat(path.join(vault, relative)).catch(() => null);
      return `${relative}\0${stat ? `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.isSymbolicLink()}` : "missing"}\n`;
    }));
    rows.forEach((row) => hash.update(row));
  }
  return hash.digest("hex");
}

export async function listOriginalsDrive(vault) {
  const root = path.resolve(vault);
  if (indexRequests.has(root)) return indexRequests.get(root);
  const request = (async () => {
    const signature = await librarySignature(root);
    const file = path.join(root, ".my-wiki/library-index.json");
    let cached = indexes.get(root);
    if (!cached) cached = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => null);
    if (cached?.version === 2 && cached.signature === signature && Array.isArray(cached.data?.files)) {
      indexes.set(root, cached);
      return cached.data;
    }
    const data = await buildOriginalsDrive(root);
    const entry = { version: 2, signature, data };
    indexes.set(root, entry);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(entry), { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, file);
    } catch { /* A read-only vault can still use the in-memory index. */ }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    return data;
  })().finally(() => indexRequests.delete(root));
  indexRequests.set(root, request);
  return request;
}

async function buildOriginalsDrive(vault) {
  const [scan, registry, state] = await Promise.all([scanVault(vault), readUniverseRegistry(vault), readState(vault)]);
  const hidden = new Set(registry.hiddenGalaxies.map(key));
  const galaxies = new Map();
  const addGalaxy = (value) => {
    const name = normalizeUniverseName(value);
    if (!name) return null;
    const id = key(name);
    if (!galaxies.has(id)) galaxies.set(id, { id, name, count: 0, wiki: 0, raw: 0, hidden: hidden.has(id) });
    return id;
  };
  registry.galaxies.forEach(addGalaxy);
  const concepts = new Map(scan.nodes.filter(isWikiKnowledgeNode).map((node) => [node.id, wikiUniverseNames(node).map(addGalaxy).filter(Boolean)]));
  for (const ids of concepts.values()) for (const id of new Set(ids)) galaxies.get(id).wiki++;
  const memberships = new Map();
  const link = (reference, values) => {
    if (!reference.startsWith("references/sources/")) return;
    if (!memberships.has(reference)) memberships.set(reference, new Set());
    values.forEach((id) => memberships.get(reference).add(id));
  };
  for (const edge of scan.edges) {
    if (concepts.has(edge.source)) link(edge.target, concepts.get(edge.source));
    if (concepts.has(edge.target)) link(edge.source, concepts.get(edge.target));
  }
  const evidence = new Map();
  for (const node of scan.nodes.filter((item) => item.id.startsWith("references/sources/"))) {
    const fm = node.frontmatter;
    const assigned = new Set(memberships.get(node.id) || []);
    [...asArray(fm.universes), ...asArray(fm.universe)].map(addGalaxy).filter(Boolean).forEach((id) => assigned.add(id));
    if (!assigned.size && fm.suggested_universe) assigned.add(addGalaxy(fm.suggested_universe));
    assigned.delete(null);
    for (const id of assigned) galaxies.get(id).raw++;
    for (const field of ["snapshot_path", "snapshot_markdown_path", "snapshot_html_path", "snapshot_json_path"]) {
      const relative = String(fm[field] || "").replace(/\\/g, "/").replace(/^\/?\.\//, "").replace(/^\//, "");
      if (!relative.startsWith("references/originals/")) continue;
      if (!evidence.has(relative)) evidence.set(relative, { galaxies: new Set(), references: [] });
      const item = evidence.get(relative);
      assigned.forEach((id) => item.galaxies.add(id));
      if (!item.references.some((ref) => ref.path === node.path)) item.references.push({ path: node.path, title: node.title });
    }
  }
  const files = [];
  const root = path.resolve(vault);
  const originals = path.join(root, "references/originals");
  // Do not traverse symlinks: the drive exposes originals, never arbitrary local files.
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ["__MACOSX", "Thumbs.db", "desktop.ini"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        const stat = await fs.stat(absolute).catch(() => null);
        if (!stat) continue;
        const linked = evidence.get(relative);
        const ids = linked?.galaxies.size ? [...linked.galaxies] : ["unassigned"];
        if (ids.includes("unassigned") && !galaxies.has("unassigned")) galaxies.set("unassigned", { id: "unassigned", name: "", count: 0, wiki: 0, raw: 0, hidden: false });
        ids.forEach((id) => galaxies.get(id).count++);
        files.push({ path: relative, name: entry.name, size: stat.size, modified: stat.mtime.toISOString(), galaxies: ids, references: linked?.references || [] });
      }
    }
  }
  const realRoot = await fs.realpath(root);
  const realOriginals = await fs.realpath(originals).catch(() => "");
  if (within(realRoot, realOriginals) && !(await fs.lstat(originals)).isSymbolicLink()) await walk(originals);
  const folders = state.folders.filter((folder) => galaxies.has(folder.galaxy));
  const folderIds = new Set(folders.map((folder) => folder.id));
  const fileMemberships = new Map(files.map((file) => [file.path, file.galaxies]));
  const placements = state.placements.filter((item) => folderIds.has(item.folderId) && fileMemberships.get(item.path)?.includes(item.galaxy));
  return { galaxies: [...galaxies.values()].sort((a, b) => a.id === "unassigned" ? 1 : b.id === "unassigned" ? -1 : a.name.localeCompare(b.name)), files, folders, placements };
}

export async function updateOriginalsDrive(vault, input) {
  const listing = await listOriginalsDrive(vault);
  if (!listing.galaxies.some((galaxy) => galaxy.id === input.galaxy)) throw fail(404, "Galaxy not found");
  return mutate(vault, (state) => {
    const galaxy = input.galaxy;
    const find = (id) => {
      const folder = state.folders.find((item) => item.id === id && item.galaxy === galaxy);
      if (!folder) throw fail(404, "Folder not found");
      return folder;
    };
    const parentId = input.parentId || null;
    if (parentId) find(parentId);
    const validName = (value, parent, exclude = "") => {
      const name = String(value || "").trim();
      if (!name || name.length > 160 || /[\\/\x00-\x1f]/.test(name) || [".", ".."].includes(name)) throw fail(400, "Invalid folder name");
      if (state.folders.some((item) => item.galaxy === galaxy && item.parentId === parent && item.id !== exclude && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw fail(409, "A folder with this name already exists");
      return name;
    };
    if (input.action === "create") {
      const folder = { id: randomUUID(), galaxy, parentId, name: validName(input.name, parentId) };
      state.folders.push(folder);
      return folder;
    }
    if (input.action === "rename") {
      const folder = find(input.id);
      folder.name = validName(input.name, folder.parentId, folder.id);
      return folder;
    }
    if (input.action === "delete") {
      const folder = find(input.id);
      const children = state.folders.filter((item) => item.parentId === folder.id);
      children.forEach((child) => validName(child.name, folder.parentId, child.id));
      children.forEach((child) => { child.parentId = folder.parentId; });
      for (const placement of state.placements.filter((item) => item.folderId === folder.id)) placement.folderId = folder.parentId;
      state.placements = state.placements.filter((item) => item.folderId);
      state.folders = state.folders.filter((item) => item.id !== folder.id);
      return { deleted: true };
    }
    if (input.action !== "move" || !Array.isArray(input.files) || !Array.isArray(input.folders)) throw fail(400, "Invalid drive operation");
    if (input.files.length + input.folders.length > 5000) throw fail(400, "Too many selected items");
    const moved = input.folders.map(find);
    for (const folder of moved) {
      let ancestor = parentId;
      while (ancestor) {
        if (ancestor === folder.id) throw fail(400, "Cannot move a folder into itself or a descendant");
        ancestor = find(ancestor).parentId;
      }
      validName(folder.name, parentId, folder.id);
    }
    if (new Set(moved.map((folder) => folder.name.toLocaleLowerCase())).size !== moved.length) throw fail(409, "Duplicate folder names at destination");
    for (const relative of input.files) {
      if (!listing.files.some((file) => file.path === relative && file.galaxies.includes(galaxy))) throw fail(404, "Original not in this galaxy");
    }
    moved.forEach((folder) => { folder.parentId = parentId; });
    const selected = new Set(input.files);
    state.placements = state.placements.filter((item) => item.galaxy !== galaxy || !selected.has(item.path));
    if (parentId) for (const relative of selected) state.placements.push({ galaxy, path: relative, folderId: parentId });
    return { moved: moved.length + selected.size };
  });
}

export async function renameOriginalsDriveGalaxy(vault, name, newName) {
  if (key(name) === key(newName)) return;
  await mutate(vault, (state) => {
    for (const item of [...state.folders, ...state.placements]) if (item.galaxy === key(name)) item.galaxy = key(newName);
  });
}

export async function exportDriveOriginals(vault, input, output, onProgress = () => {}) {
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 1000 || input.files.some((file) => typeof file !== "string")) throw fail(400, "Select between 1 and 1000 original files");
  const listing = await listOriginalsDrive(vault);
  const files = new Map(listing.files.filter((file) => file.galaxies.includes(input.galaxy)).map((file) => [file.path, file]));
  const folders = new Map(listing.folders.filter((folder) => folder.galaxy === input.galaxy).map((folder) => [folder.id, folder]));
  const placements = new Map(listing.placements.filter((item) => item.galaxy === input.galaxy).map((item) => [item.path, item.folderId]));
  const segment = (value) => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "") || "file";
  const selected = [];
  const names = new Set();
  let total = 0;
  for (const relative of new Set(input.files)) {
    const item = files.get(relative);
    if (!item) throw fail(404, "Original not in this galaxy");
    const resolved = await resolveDriveOriginal(vault, relative);
    total += resolved.stat.size;
    if (total > 2 * 1024 ** 3) throw fail(413, "Selected originals exceed the 2 GB ZIP limit; download in smaller batches");
    const parents = [];
    let folder = folders.get(placements.get(relative));
    const seen = new Set();
    while (folder && !seen.has(folder.id)) { seen.add(folder.id); parents.unshift(segment(folder.name)); folder = folders.get(folder.parentId); }
    const originalName = [...parents, segment(item.name)].join("/");
    let name = originalName;
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) {
      const ext = path.posix.extname(originalName);
      name = `${originalName.slice(0, originalName.length - ext.length)} (${suffix})${ext}`;
    }
    names.add(name.toLowerCase());
    selected.push({ ...resolved, name });
  }
  const zip = new JSZip();
  const streams = [];
  let current = 0;
  await fs.mkdir(path.dirname(output), { recursive: true });
  try {
    for (const item of selected) {
      const stream = createReadStream(item.file);
      streams.push(stream);
      stream.on("data", (chunk) => { current += chunk.length; onProgress({ phase: "packing", current, total, percent: Math.round(current / Math.max(1, total) * 100) }); });
      zip.file(item.name, stream, { binary: true, date: item.stat.mtime });
    }
    await pipeline(zip.generateNodeStream({ streamFiles: true, compression: "STORE" }), createWriteStream(output, { flags: "wx", mode: 0o600 }));
    return { count: selected.length, bytes: total };
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  } finally { streams.forEach((stream) => stream.destroy()); }
}
