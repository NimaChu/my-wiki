#!/usr/bin/env node
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createDashboardApi } from "../../scripts/core/dashboard-api.mjs";
import { resolveVaultPath } from "../../scripts/core/vault-config.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.MY_WIKI_DASHBOARD_PORT || process.argv[2] || 5173);
const pidFile = path.join(root, ".dashboard-server.pid");
const runtimeFile = path.join(root, ".my-wiki-runtime.json");
if (process.env.MY_WIKI_VAULT) {
  await fs.writeFile(runtimeFile, `${JSON.stringify({ vault: resolveVaultPath({ specifier: process.env.MY_WIKI_VAULT }), updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}
const api = createDashboardApi({ dashboardRoot: root, port });
const vite = await createViteServer({
  root,
  appType: "spa",
  server: { middlewareMode: true, hmr: false }
});

const server = http.createServer(async (req, res) => {
  if (await api(req, res)) return;
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
  await vite.close();
  await fs.rm(pidFile, { force: true });
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  fs.rm(pidFile, { force: true }).catch(() => {});
});
