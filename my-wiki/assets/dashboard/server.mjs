#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDashboardApi } from "../../scripts/core/dashboard-api.mjs";
import { resolveVaultPath } from "../../scripts/core/vault-config.mjs";

await configureNetworkProxy();

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === "production";
const host = process.env.MY_WIKI_DASHBOARD_HOST || "127.0.0.1";
const port = Number(process.env.MY_WIKI_DASHBOARD_PORT || process.argv[2] || 5173);
const allowedHosts = commaSeparated(process.env.MY_WIKI_DASHBOARD_PUBLIC_HOSTS);
const pidFile = path.join(root, ".dashboard-server.pid");
const runtimeFile = path.join(root, ".my-wiki-runtime.json");
if (process.env.MY_WIKI_VAULT) {
  await fs.writeFile(runtimeFile, `${JSON.stringify({ vault: resolveVaultPath({ specifier: process.env.MY_WIKI_VAULT }), updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}
const api = createDashboardApi({ dashboardRoot: root, port });
const vite = production
  ? null
  : await (await import("vite")).createServer({
      root,
      appType: "spa",
      server: {
        middlewareMode: true,
        hmr: false,
        ...(allowedHosts.length ? { allowedHosts } : {})
      }
    });

const server = http.createServer(async (req, res) => {
  if (await api(req, res)) return;
  if (!vite) {
    await serveProductionFile(req, res);
    return;
  }
  vite.middlewares(req, res, (error) => {
    if (error && !res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error.stack || error.message || String(error));
    }
  });
});

await fs.writeFile(pidFile, String(process.pid), "utf8");
server.listen(port, host, () => {
  console.log(`My Wiki local service: http://${host}:${port}/`);
});

async function shutdown() {
  server.close();
  await vite?.close();
  await fs.rm(pidFile, { force: true });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  fs.rm(pidFile, { force: true }).catch(() => {});
});

function commaSeparated(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function serveProductionFile(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Invalid URL");
    return;
  }

  const distRoot = path.join(root, "dist");
  const runtimeGraph = path.join(root, "public", "wiki-graph.json");
  const requested = pathname === "/wiki-graph.json"
    ? runtimeGraph
    : path.resolve(distRoot, pathname.replace(/^\/+/, ""));
  const file = await productionFile(distRoot, requested, pathname, runtimeGraph);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const stat = await fs.stat(file);
  res.writeHead(200, {
    "content-type": contentType(file),
    "content-length": stat.size,
    "cache-control": file === runtimeGraph
      ? "no-store"
      : pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    "x-content-type-options": "nosniff"
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

async function productionFile(distRoot, requested, pathname, runtimeGraph) {
  if (requested === runtimeGraph) {
    return await isFile(runtimeGraph) ? runtimeGraph : "";
  }
  if (!isWithin(distRoot, requested)) return "";
  if (await isFile(requested)) return requested;
  if (path.extname(pathname)) return "";
  const index = path.join(distRoot, "index.html");
  return await isFile(index) ? index : "";
}

async function isFile(file) {
  return (await fs.stat(file).catch(() => null))?.isFile() || false;
}

function isWithin(rootPath, candidate) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidate));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function contentType(file) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
  }[path.extname(file).toLowerCase()] || "application/octet-stream";
}

async function configureNetworkProxy() {
  if (!process.env.HTTP_PROXY && !process.env.http_proxy &&
      !process.env.HTTPS_PROXY && !process.env.https_proxy) return;
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
