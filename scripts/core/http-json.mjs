import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);
const representations = new WeakMap();

// Authentication must run before this helper, including for conditional requests.
export async function sendRevalidatedJson(req, res, value) {
  let representation = representations.get(value);
  if (!representation) {
    representation = (async () => {
      const body = Buffer.from(JSON.stringify(value));
      const etag = `W/"${createHash("sha256").update(body).digest("hex").slice(0, 24)}"`;
      return { body, etag, compressed: body.length > 1024 ? await compress(body) : null };
    })();
    representations.set(value, representation);
  }
  const { body, etag, compressed } = await representation;
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-cache", etag, vary: "Accept-Encoding", "x-content-type-options": "nosniff" };
  if (String(req.headers["if-none-match"] || "").split(/\s*,\s*/).includes(etag)) {
    res.writeHead(304, headers); res.end(); return;
  }
  const acceptsGzip = String(req.headers["accept-encoding"] || "").split(",").some((part) => /^\s*gzip\s*(?:;|$)/i.test(part) && !/;\s*q=0(?:\.0*)?\s*$/i.test(part));
  const result = compressed && acceptsGzip ? compressed : body;
  if (result === compressed) headers["content-encoding"] = "gzip";
  res.writeHead(200, { ...headers, "content-length": result.length });
  res.end(result);
}
