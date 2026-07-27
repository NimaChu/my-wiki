import { randomBytes, randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import { promises as fs, createReadStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import { captureSource } from "./capture-service.mjs";
import { exportUniverse } from "./export-universe.mjs";
import { importUniverse } from "./import-universe.mjs";
import {
  isWikiKnowledgeNode,
  scanVault,
  slugify,
  statsFromScan,
  textPreview,
  wikiUniverseNames
} from "./wiki-lib.mjs";

const JSON_LIMIT = 128 * 1024;
const FILE_LIMIT = Number(process.env.MY_WIKI_UPLOAD_LIMIT_BYTES || 1024 * 1024 * 1024);
const sessionToken = randomBytes(32).toString("hex");
const jobs = new Map();

export function createDashboardApi({ dashboardRoot, port }) {
  const runtimeFile = path.join(dashboardRoot, ".my-wiki-runtime.json");

  return async function handleDashboardApi(req, res) {
    try {
      const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (!requestUrl.pathname.startsWith("/api/v1/")) return false;

      if (requestUrl.pathname === "/api/v1/health" && req.method === "GET") {
        res.setHeader("x-my-wiki-api", "1");
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (requestUrl.pathname === "/api/v1/session" && req.method === "GET") {
        enforceOrigin(req, port);
        const vault = await activeVault(runtimeFile);
        sendJson(res, 200, { token: sessionToken, vault });
        return true;
      }

      enforceOrigin(req, port);
      enforceToken(req, requestUrl);
      const vault = await activeVault(runtimeFile);

      if (requestUrl.pathname === "/api/v1/vault" && req.method === "GET") {
        const scan = await scanVault(vault);
        sendJson(res, 200, { vault, stats: statsFromScan(scan) });
        return true;
      }
      if (requestUrl.pathname === "/api/v1/inbox" && req.method === "GET") {
        const scan = await scanVault(vault);
        const items = scan.nodes
          .filter((node) => node.id.startsWith("raw/sources/") && node.status === "inbox")
          .sort((a, b) => String(b.frontmatter.captured || "").localeCompare(String(a.frontmatter.captured || "")))
          .map((node) => ({
            id: node.id,
            path: node.path,
            title: node.title,
            status: node.status,
            sourceType: String(node.frontmatter.source_type || ""),
            sourceUrl: String(node.frontmatter.source_url || ""),
            snapshotPath: String(node.frontmatter.snapshot_path || ""),
            collection: String(node.frontmatter.collection || ""),
            captured: String(node.frontmatter.captured || ""),
            preview: textPreview(node.content, 280)
          }));
        sendJson(res, 200, { items });
        return true;
      }
      if (requestUrl.pathname === "/api/v1/collections" && req.method === "GET") {
        const scan = await scanVault(vault);
        const counts = new Map();
        for (const node of scan.nodes.filter((candidate) => candidate.id.startsWith("raw/sources/"))) {
          const collection = String(node.frontmatter.collection || "").trim();
          if (collection) counts.set(collection, (counts.get(collection) || 0) + 1);
        }
        const collections = [...counts]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        sendJson(res, 200, { collections });
        return true;
      }
      if (requestUrl.pathname === "/api/v1/universes" && req.method === "GET") {
        sendJson(res, 200, { universes: await universeSummaries(vault) });
        return true;
      }
      if (requestUrl.pathname === "/api/v1/inbox/url" && req.method === "POST") {
        const body = await readJson(req);
        const sourceUrl = String(body.url || "").trim();
        await validatePublicUrl(sourceUrl);
        const result = await captureSource({
          vault,
          title: String(body.title || titleFromUrl(sourceUrl)),
          url: sourceUrl,
          sourceType: "webpage",
          collection: String(body.collection || ""),
          captureMethod: "dashboard-url",
          shouldSnapshot: true,
          requireSnapshot: true,
          shouldMirrorImages: true,
          validateUrl: validatePublicUrl
        });
        sendJson(res, 201, result);
        return true;
      }
      if (requestUrl.pathname === "/api/v1/inbox/file" && req.method === "POST") {
        const filename = safeFilename(requestUrl.searchParams.get("filename") || "upload.bin");
        const title = String(requestUrl.searchParams.get("title") || path.basename(filename, path.extname(filename))).trim() || "Uploaded Source";
        const collection = String(requestUrl.searchParams.get("collection") || "");
        const temporary = await receiveUpload(req, vault, filename);
        try {
          const content = await readableUploadContent(temporary, filename);
          const result = await captureSource({
            vault,
            title,
            sourceType: sourceTypeForFile(filename),
            collection,
            snapshotFile: temporary,
            content,
            captureMethod: "dashboard-upload",
            shouldSnapshot: true,
            shouldMirrorImages: true,
            validateUrl: validatePublicUrl
          });
          sendJson(res, 201, result);
        } finally {
          await fs.rm(temporary, { force: true });
        }
        return true;
      }
      if (requestUrl.pathname === "/api/v1/universes/export" && req.method === "POST") {
        const body = await readJson(req);
        const universe = String(body.universe || "").trim();
        if (!universe) throw httpError(400, "Universe name is required");
        const job = createJob("export", { universe });
        runJob(job, async () => {
          const output = path.join(vault, ".my-wiki", "exports", `${slugify(universe)}-${timestamp()}-${job.id.slice(0, 8)}.mywiki`);
          const result = await exportUniverse({ vault, universeName: universe, output });
          job.outputFile = result.output;
          return result;
        });
        sendJson(res, 202, publicJob(job));
        return true;
      }
      if (requestUrl.pathname === "/api/v1/universe-imports" && req.method === "POST") {
        const filename = safeFilename(requestUrl.searchParams.get("filename") || "universe.mywiki");
        if (!filename.toLowerCase().endsWith(".mywiki")) throw httpError(400, "Only .mywiki packages can be imported");
        const as = String(requestUrl.searchParams.get("as") || "").trim();
        const packageFile = await receiveUpload(req, vault, filename, "imports-upload");
        const job = createJob("import-preview", { filename, as });
        job.packageFile = packageFile;
        runJob(job, () => importUniverse({ vault, packageFile, as, apply: false }));
        sendJson(res, 202, publicJob(job));
        return true;
      }

      const applyMatch = requestUrl.pathname.match(/^\/api\/v1\/universe-imports\/([^/]+)\/apply$/);
      if (applyMatch && req.method === "POST") {
        const preview = jobs.get(applyMatch[1]);
        if (!preview || preview.type !== "import-preview") throw httpError(404, "Import preview job not found");
        if (preview.status !== "complete") throw httpError(409, "Import preview is not complete");
        const body = await readJson(req);
        const as = String(body.as ?? preview.meta.as ?? "").trim();
        const job = createJob("import-apply", { filename: preview.meta.filename, as });
        job.packageFile = preview.packageFile;
        runJob(job, async () => {
          const result = await importUniverse({ vault, packageFile: preview.packageFile, as, apply: true });
          await fs.rm(preview.packageFile, { force: true });
          preview.packageFile = "";
          return result;
        });
        sendJson(res, 202, publicJob(job));
        return true;
      }

      const downloadMatch = requestUrl.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/download$/);
      if (downloadMatch && req.method === "GET") {
        const job = jobs.get(downloadMatch[1]);
        if (!job || job.status !== "complete" || !job.outputFile) throw httpError(404, "Export is not available");
        const stat = await fs.stat(job.outputFile);
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": stat.size,
          "content-disposition": `attachment; filename="${path.basename(job.outputFile).replace(/"/g, "")}"`,
          "cache-control": "no-store"
        });
        createReadStream(job.outputFile).pipe(res);
        return true;
      }

      const jobMatch = requestUrl.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
      if (jobMatch && req.method === "GET") {
        const job = jobs.get(jobMatch[1]);
        if (!job) throw httpError(404, "Job not found");
        sendJson(res, 200, publicJob(job));
        return true;
      }

      throw httpError(404, "API route not found");
    } catch (error) {
      if (!res.headersSent) sendJson(res, error.statusCode || 500, { error: error.message || String(error) });
      else res.destroy(error);
      return true;
    }
  };
}

async function activeVault(runtimeFile) {
  let runtime;
  try {
    runtime = JSON.parse(await fs.readFile(runtimeFile, "utf8"));
  } catch {
    throw httpError(503, "No active My Wiki vault. Open the Dashboard from an agent first.");
  }
  const vault = path.resolve(String(runtime.vault || ""));
  if (!vault) throw httpError(503, "Active vault is not configured");
  await fs.access(path.join(vault, "raw"));
  await fs.access(path.join(vault, "wiki"));
  return vault;
}

async function universeSummaries(vault) {
  const scan = await scanVault(vault);
  const summaries = new Map();
  for (const node of scan.nodes.filter(isWikiKnowledgeNode)) {
    for (const universe of wikiUniverseNames(node)) {
      if (!summaries.has(universe)) summaries.set(universe, { name: universe, wikiIds: new Set(), rawIds: new Set() });
      summaries.get(universe).wikiIds.add(node.id);
    }
  }
  for (const summary of summaries.values()) {
    for (const edge of scan.edges) {
      if (summary.wikiIds.has(edge.source) && edge.target.startsWith("raw/sources/")) summary.rawIds.add(edge.target);
      if (summary.wikiIds.has(edge.target) && edge.source.startsWith("raw/sources/")) summary.rawIds.add(edge.source);
    }
  }
  return [...summaries.values()]
    .map((summary) => ({ name: summary.name, wiki: summary.wikiIds.size, raw: summary.rawIds.size }))
    .sort((a, b) => b.wiki - a.wiki || a.name.localeCompare(b.name));
}

function createJob(type, meta) {
  const job = {
    id: randomUUID(),
    type,
    meta,
    status: "queued",
    createdAt: new Date().toISOString(),
    completedAt: "",
    result: null,
    error: "",
    outputFile: "",
    packageFile: ""
  };
  jobs.set(job.id, job);
  return job;
}

function runJob(job, work) {
  setTimeout(async () => {
    job.status = "running";
    try {
      job.result = await work();
      job.status = "complete";
    } catch (error) {
      job.status = "failed";
      job.error = error.message || String(error);
    } finally {
      job.completedAt = new Date().toISOString();
    }
  }, 0);
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    meta: job.meta,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
    downloadUrl: job.status === "complete" && job.outputFile ? `/api/v1/jobs/${job.id}/download` : ""
  };
}

async function receiveUpload(req, vault, filename, directory = "uploads") {
  const root = path.join(vault, ".my-wiki", directory);
  await fs.mkdir(root, { recursive: true });
  await cleanupOldUploads(root);
  const target = path.join(root, `${randomUUID()}-${safeFilename(filename)}`);
  const handle = await fs.open(target, "wx");
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > FILE_LIMIT) throw httpError(413, `Upload exceeds ${FILE_LIMIT} bytes`);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await fs.rm(target, { force: true });
    throw error;
  }
  await handle.close();
  if (bytes === 0) {
    await fs.rm(target, { force: true });
    throw httpError(400, "Uploaded file is empty");
  }
  return target;
}

async function cleanupOldUploads(root) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const target = path.join(root, entry.name);
    const stat = await fs.stat(target).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.rm(target, { force: true });
  }
}

async function readableUploadContent(file, filename) {
  const extension = path.extname(filename).toLowerCase();
  if (![".md", ".markdown", ".txt", ".csv", ".json", ".xml", ".html", ".htm"].includes(extension)) return "";
  const stat = await fs.stat(file);
  if (stat.size > 10 * 1024 * 1024) return "";
  return fs.readFile(file, "utf8");
}

async function readJson(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > JSON_LIMIT) throw httpError(413, "JSON request is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Invalid JSON request");
  }
}

async function validatePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw httpError(400, "Enter a valid webpage URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw httpError(400, "Only HTTP and HTTPS URLs are supported");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw httpError(400, "Local network URLs are not allowed");
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw httpError(400, "Private or local network URLs are not allowed");
  }
  return url;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

function enforceOrigin(req, port) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (!allowed.has(origin)) throw httpError(403, "Dashboard origin is not allowed");
}

function enforceToken(req, requestUrl) {
  const provided = req.headers["x-my-wiki-token"] || requestUrl.searchParams.get("token");
  if (provided !== sessionToken) throw httpError(403, "Dashboard session token is missing or invalid");
}

function sourceTypeForFile(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if ([".md", ".markdown", ".txt"].includes(extension)) return "note";
  if ([".html", ".htm"].includes(extension)) return "webpage";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) return "image";
  if ([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(extension)) return "document";
  return "file";
}

function titleFromUrl(value) {
  const url = new URL(value);
  const tail = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "").replace(/[-_]+/g, " ").trim();
  return tail || url.hostname.replace(/^www\./, "");
}

function safeFilename(value) {
  return path.basename(String(value || "upload.bin")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 180) || "upload.bin";
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sendJson(res, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
