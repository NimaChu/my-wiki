#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { dashboardPath, exists, vaultPath } from "./wiki-lib.mjs";

const vault = vaultPath();
const dash = dashboardPath(vault);
const lockPath = path.join(dash, ".graph-watch.pid");
const logPath = path.join(dash, "graph-watch.log");
const roots = ["raw", "wiki"];
const intervalMs = Number(process.env.WIKI_GRAPH_WATCH_INTERVAL_MS || 5000);

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFile(logPath, line, "utf8").catch(() => {});
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  if (await exists(lockPath)) {
    const raw = await fs.readFile(lockPath, "utf8").catch(() => "");
    const pid = Number(raw.trim());
    if (pid && pid !== process.pid && pidAlive(pid)) {
      log(`watcher already running as pid ${pid}`);
      process.exit(0);
    }
  }
  await fs.writeFile(lockPath, String(process.pid), "utf8");
}

async function walkMarkdown(dir) {
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "_archive") return [];
    if (entry.isDirectory()) return walkMarkdown(full);
    if (entry.isFile() && entry.name.endsWith(".md")) return [full];
    return [];
  }));
  return nested.flat();
}

async function signature() {
  const files = (await Promise.all(roots.map((root) => walkMarkdown(path.join(vault, root))))).flat().sort();
  const parts = [];
  for (const file of files) {
    const stat = await fs.stat(file);
    parts.push(`${path.relative(vault, file)}:${stat.mtimeMs}:${stat.size}`);
  }
  return parts.join("\n");
}

function buildGraph() {
  const result = spawnSync("npm", ["--prefix", dash, "run", "graph"], {
    cwd: vault,
    shell: process.platform === "win32",
    encoding: "utf8"
  });
  if (result.status === 0) {
    log("graph refreshed");
  } else {
    log(`graph refresh failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
}

async function main() {
  await acquireLock();
  log(`watching ${vault}`);
  let last = await signature();

  process.on("exit", () => {
    try {
      fs.rm(lockPath, { force: true });
    } catch {
      // best effort
    }
  });

  setInterval(async () => {
    try {
      const next = await signature();
      if (next !== last) {
        last = next;
        buildGraph();
      }
    } catch (error) {
      log(`watch error: ${error.message || String(error)}`);
    }
  }, intervalMs).unref();

  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  log(`fatal: ${error.stack || error.message || String(error)}`);
  process.exit(1);
});
