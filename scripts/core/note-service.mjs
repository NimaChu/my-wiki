import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const NOTE_PATH = /^notes\/([^/]+)\/note\.md$/i;
const ASSET_PATH = /^assets\/(.+\.(?:png|jpe?g|gif|webp|svg))$/i;
const MAX_ENTRIES = 1000;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export async function listLocalNotes(vault) {
  const root = path.join(vault, "notes");
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const notes = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = path.join(root, entry.name, "note.md");
    const [content, stat] = await Promise.all([
      fs.readFile(file, "utf8").catch(() => ""),
      fs.stat(file).catch(() => null)
    ]);
    if (!stat?.isFile()) continue;
    notes.push({
      path: `notes/${entry.name}/note.md`,
      title: markdownTitle(content) || entry.name,
      updatedAt: stat.mtime.toISOString(),
      bytes: stat.size
    });
  }
  return notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveLocalNoteBundle(vault, { title, bytes, existingPath = "" }) {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  if (entries.length === 0 || entries.length > MAX_ENTRIES) throw new Error("The note package has an invalid number of files");
  const markdownEntry = archive.file("note.md");
  if (!markdownEntry) throw new Error("A standard note package must contain note.md at its root");
  const normalizedTitle = String(title || "").trim().slice(0, 200) || "Quick note";
  const markdown = await markdownEntry.async("string");
  let total = Buffer.byteLength(markdown, "utf8");
  const assets = [];
  for (const entry of entries) {
    const name = normalizeArchivePath(entry.name);
    if (name === "note.md") continue;
    if (!ASSET_PATH.test(name)) throw new Error(`Unsupported note package entry: ${entry.name}`);
    const buffer = await entry.async("nodebuffer");
    total += buffer.length;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error("The expanded note package is too large");
    assets.push({ name, buffer });
  }

  const notesRoot = path.join(vault, "notes");
  await fs.mkdir(notesRoot, { recursive: true });
  const existingId = noteId(existingPath);
  const id = existingId || await uniqueNoteId(notesRoot, normalizedTitle);
  const target = path.join(notesRoot, id);
  const staging = path.join(notesRoot, `.note-${randomUUID()}`);
  const backup = path.join(notesRoot, `.backup-${randomUUID()}`);
  await fs.mkdir(staging, { recursive: true });
  try {
    const body = markdown.trim() ? markdown : `# ${normalizedTitle}\n`;
    await fs.writeFile(path.join(staging, "note.md"), body.endsWith("\n") ? body : `${body}\n`, "utf8");
    for (const asset of assets) {
      const file = path.resolve(staging, asset.name);
      if (!isWithin(staging, file)) throw new Error("Note package entry escapes its note directory");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, asset.buffer, { flag: "wx" });
    }
    const targetExists = await fs.stat(target).then((stat) => stat.isDirectory()).catch(() => false);
    if (targetExists) await fs.rename(target, backup);
    try {
      await fs.rename(staging, target);
      await fs.rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (targetExists) await fs.rename(backup, target).catch(() => {});
      throw error;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    await fs.rm(backup, { recursive: true, force: true });
  }
  return { path: `notes/${id}/note.md`, title: markdownTitle(markdown) || normalizedTitle };
}

export async function createLocalNoteBundle(vault, requested) {
  const id = noteId(requested);
  if (!id) throw new Error("Invalid local note path");
  const root = path.join(vault, "notes", id);
  const stat = await fs.stat(path.join(root, "note.md")).catch(() => null);
  if (!stat?.isFile()) throw new Error("Local note not found");
  const zip = new JSZip();
  await addDirectory(zip, root, root);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function deleteLocalNote(vault, requested) {
  const id = noteId(requested);
  if (!id) throw new Error("Invalid local note path");
  const notesRoot = path.join(vault, "notes");
  const target = path.join(notesRoot, id);
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) throw new Error("Local note not found");
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid local note directory");
  await fs.rm(target, { recursive: true, force: false });
  return { deleted: true, path: `notes/${id}/note.md`, directory: `notes/${id}` };
}

export function isLocalNotePath(value) {
  return NOTE_PATH.test(String(value || "").replace(/\\/g, "/"));
}

function noteId(value) {
  return String(value || "").replace(/\\/g, "/").match(NOTE_PATH)?.[1] || "";
}

async function uniqueNoteId(root, title) {
  const base = `${noteTimestamp()}--${slug(title) || "note"}`;
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    if (!await fs.stat(path.join(root, candidate)).catch(() => null)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function noteTimestamp(now = new Date()) {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((value) => String(value).padStart(2, "0")).join("-");
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, "0")).join("");
  return `${date}-${time}-${String(now.getMilliseconds()).padStart(3, "0")}`;
}

async function addDirectory(zip, root, current) {
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
    const file = path.join(current, entry.name);
    if (entry.isDirectory()) await addDirectory(zip, root, file);
    else if (entry.isFile()) zip.file(path.relative(root, file).replace(/\\/g, "/"), await fs.readFile(file));
  }
}

function markdownTitle(content) {
  return String(content || "").match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 200) || "";
}

function normalizeArchivePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("Invalid note package path");
  return normalized;
}

function slug(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
