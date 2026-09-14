import { createReadStream } from "node:fs";
import path from "node:path";
import { resolveDriveOriginal } from "./originals-drive.mjs";

const types = {
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".bmp": "image/bmp", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8"
};

export async function serveOriginalReader(vault, requested, req, res) {
  const { file, stat } = await resolveDriveOriginal(vault, requested);
  const extension = path.extname(file).toLowerCase();
  const type = types[extension];
  if (!type) throw Object.assign(new Error("This file type cannot be read in the browser"), { status: 415, statusCode: 415 });
  const headers = {
    "content-type": type,
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "accept-ranges": "bytes"
  };
  // Captured HTML/SVG is evidence, never same-origin executable application code.
  if ([".html", ".htm", ".svg"].includes(extension)) {
    headers["content-security-policy"] = "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  }
  let start = 0;
  let end = stat.size - 1;
  const range = req.method === "GET" && req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
      res.writeHead(416, { ...headers, "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }
    headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
  }
  res.writeHead(range ? 206 : 200, { ...headers, "content-length": Math.max(0, end - start + 1) });
  if (req.method === "HEAD" || !stat.size) { res.end(); return; }
  const stream = createReadStream(file, { start, end });
  res.on("close", () => stream.destroy());
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
