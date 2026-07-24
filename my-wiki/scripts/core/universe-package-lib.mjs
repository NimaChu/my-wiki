import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

const TAR_BLOCK = 512;
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;

export async function hashFile(file) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

export function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function walkFiles(root) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  try {
    await walk(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return files;
}

export async function writeUniverseArchive(output, entries) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const target = createWriteStream(output);
  const gzip = createGzip({ level: 6 });
  gzip.pipe(target);

  let index = 0;
  for (const entry of entries) {
    index += 1;
    const archivePath = validateArchivePath(entry.path);
    const size = entry.buffer ? entry.buffer.length : (await fs.stat(entry.file)).size;
    const pax = Buffer.from(paxRecord("path", archivePath), "utf8");
    await writeChunk(gzip, tarHeader(`PaxHeaders/${index}`, pax.length, "x"));
    await writeChunk(gzip, pax);
    await writePadding(gzip, pax.length);
    await writeChunk(gzip, tarHeader(`entry-${index}`, size, "0"));

    if (entry.buffer) {
      await writeChunk(gzip, entry.buffer);
    } else {
      for await (const chunk of createReadStream(entry.file)) await writeChunk(gzip, chunk);
    }
    await writePadding(gzip, size);
  }

  await writeChunk(gzip, Buffer.alloc(TAR_BLOCK * 2));
  gzip.end();
  await Promise.all([finished(gzip), finished(target)]);
}

export async function extractUniverseArchive(packagePath, destination) {
  await fs.mkdir(destination, { recursive: true });
  const stream = createReadStream(packagePath).pipe(createGunzip());
  const reader = new ChunkReader(stream[Symbol.asyncIterator]());
  const extracted = [];
  let pendingPath = "";

  while (true) {
    const header = await reader.read(TAR_BLOCK, { allowEnd: true });
    if (!header) break;
    if (header.every((byte) => byte === 0)) break;
    verifyTarChecksum(header);
    const size = parseOctal(header.subarray(124, 136));
    if (size < 0 || size > MAX_ENTRY_BYTES) throw new Error(`Unsupported package entry size: ${size}`);
    const type = String.fromCharCode(header[156] || 48);
    const data = await reader.read(size);
    const padding = (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;
    if (padding) await reader.read(padding);

    if (type === "x") {
      pendingPath = parsePax(data).path || "";
      continue;
    }
    if (type !== "0" && type !== "\0") {
      pendingPath = "";
      continue;
    }

    const headerName = readString(header.subarray(0, 100));
    const archivePath = validateArchivePath(pendingPath || headerName);
    pendingPath = "";
    const target = path.join(destination, ...archivePath.split("/"));
    const resolvedRoot = path.resolve(destination);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`Package entry escapes extraction root: ${archivePath}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    extracted.push({ path: archivePath, file: target, bytes: data.length });
  }

  return extracted;
}

class ChunkReader {
  constructor(iterator) {
    this.iterator = iterator;
    this.buffer = Buffer.alloc(0);
    this.ended = false;
  }

  async read(size, { allowEnd = false } = {}) {
    if (size === 0) return Buffer.alloc(0);
    while (this.buffer.length < size && !this.ended) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    }
    if (this.buffer.length < size) {
      if (allowEnd && this.buffer.length === 0) return null;
      throw new Error("Truncated My Wiki package");
    }
    const result = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return result;
  }
}

function tarHeader(name, size, type) {
  const header = Buffer.alloc(TAR_BLOCK);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "my-wiki");
  writeString(header, 297, 32, "my-wiki");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const rendered = checksum.toString(8).padStart(6, "0");
  writeString(header, 148, 8, `${rendered}\0 `);
  return header;
}

function verifyTarChecksum(header) {
  const expected = parseOctal(header.subarray(148, 156));
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (expected !== actual) throw new Error("Invalid My Wiki package header checksum");
}

function writeString(buffer, offset, length, value) {
  const rendered = Buffer.from(String(value), "utf8");
  rendered.copy(buffer, offset, 0, Math.min(rendered.length, length));
}

function writeOctal(buffer, offset, length, value) {
  const rendered = Math.max(0, Number(value) || 0).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeString(buffer, offset, length, `${rendered}\0`);
}

function parseOctal(buffer) {
  const value = readString(buffer).trim().replace(/\0/g, "");
  return value ? Number.parseInt(value, 8) : 0;
}

function readString(buffer) {
  const zero = buffer.indexOf(0);
  return buffer.subarray(0, zero >= 0 ? zero : buffer.length).toString("utf8");
}

function paxRecord(key, value) {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body, "utf8") + 2;
  while (true) {
    const record = `${length} ${body}`;
    const actual = Buffer.byteLength(record, "utf8");
    if (actual === length) return record;
    length = actual;
  }
}

function parsePax(buffer) {
  const result = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number.parseInt(buffer.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > buffer.length) break;
    const record = buffer.subarray(space + 1, offset + length).toString("utf8").replace(/\n$/, "");
    const equals = record.indexOf("=");
    if (equals > 0) result[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return result;
}

function validateArchivePath(value) {
  const normalized = path.posix.normalize(String(value || "").replace(/\\/g, "/")).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid My Wiki package path: ${value}`);
  }
  if (normalized !== "manifest.json" && !normalized.startsWith("wiki/") && !normalized.startsWith("raw/sources/") && !normalized.startsWith("raw/assets/") && !normalized.startsWith("raw/snapshots/")) {
    throw new Error(`Unsupported My Wiki package entry: ${normalized}`);
  }
  return normalized;
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

async function writePadding(stream, size) {
  const padding = (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;
  if (padding) await writeChunk(stream, Buffer.alloc(padding));
}
