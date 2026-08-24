#!/usr/bin/env node
import { promises as fs, appendFileSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DASHBOARD_URL, dashboardPath, exists, vaultPath } from "./wiki-lib.mjs";

const vault = vaultPath();
const dash = dashboardPath(vault);
const lockPath = path.join(dash, ".graph-watch.pid");
const logPath = path.join(dash, "graph-watch.log");
const dashboardPidPath = path.join(dash, ".dashboard-server.pid");
const roots = ["references", "concepts"];
const intervalMs = Number(process.env.WIKI_GRAPH_WATCH_INTERVAL_MS || 5000);

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    appendFileSync(logPath, line, "utf8");
  } catch {
    // Logging must never stop graph refreshes.
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isDashboardAlive() {
  return new Promise((resolve) => {
    const req = http.get(DASHBOARD_URL, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function isDashboardRunning() {
  const pid = Number(await fs.readFile(dashboardPidPath, "utf8").catch(() => ""));
  if (pid && pidAlive(pid)) return true;
  return isDashboardAlive();
}

async function acquireLock() {
  if (await exists(lockPath)) {
    const raw = await fs.readFile(lockPath, "utf8").catch(() => "");
    let lock = {};
    try {
      lock = JSON.parse(raw);
    } catch {
      lock = { pid: Number(raw.trim()), vault: "" };
    }
    const pid = Number(lock.pid);
    if (pid && pid !== process.pid && pidAlive(pid)) {
      if (path.resolve(lock.vault || vault) === path.resolve(vault)) {
        log(`watcher already running as pid ${pid}`);
        process.exit(0);
      }
      log(`switching watcher from ${lock.vault || "unknown vault"} to ${vault}`);
      try {
        process.kill(pid);
      } catch {
        // The stale watcher may exit between the liveness check and termination.
      }
      for (let attempt = 0; attempt < 20 && pidAlive(pid); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
  await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, vault }), "utf8");
}

function ownsLock() {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    return Number(lock.pid) === process.pid;
  } catch {
    return false;
  }
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
    env: { ...process.env, MY_WIKI_VAULT: vault },
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

  process.on("exit", () => {
    try {
      if (ownsLock()) rmSync(lockPath, { force: true });
    } catch {
      // best effort
    }
  });

  if (!(await isDashboardRunning())) {
    log("dashboard is offline; watcher exiting");
    process.exit(0);
  }

  log(`watching ${vault}`);
  let last = await signature();
  let checking = false;

  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      if (!(await isDashboardRunning())) {
        log("dashboard stopped; watcher exiting");
        process.exit(0);
      }
      const next = await signature();
      if (next !== last) {
        last = next;
        buildGraph();
      }
    } catch (error) {
      log(`watch error: ${error.message || String(error)}`);
    } finally {
      checking = false;
    }
  }, intervalMs);
}

main().catch((error) => {
  log(`fatal: ${error.stack || error.message || String(error)}`);
  process.exit(1);
});
