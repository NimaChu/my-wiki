#!/usr/bin/env node
import { closeSync, openSync } from "node:fs";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { DASHBOARD_PORT, DASHBOARD_URL, dashboardPath, exists, vaultPath } from "./wiki-lib.mjs";

const shouldServe = process.argv.includes("--serve");
const shouldBuild = process.argv.includes("--build");
const vault = vaultPath();
const dash = dashboardPath(vault);
const npmCommand = "npm";
const runtimeEnv = { ...process.env, MY_WIKI_VAULT: vault };
const npmOptions = { cwd: dash, shell: process.platform === "win32", env: runtimeEnv };

function run(command, args) {
  const result = spawnSync(command, args, { ...npmOptions, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

async function isServerAlive() {
  return new Promise((resolve) => {
    const req = http.get(new URL("/api/v1/health", DASHBOARD_URL), (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500 && res.headers["x-my-wiki-api"] === "1"));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

if (!(await exists(dash))) {
  console.error(`Dashboard not found: ${dash}`);
  process.exit(1);
}

async function isHttpRootAlive() {
  return new Promise((resolve) => {
    const req = http.get(DASHBOARD_URL, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function stopLegacyDashboard() {
  let processes = [];
  if (process.platform === "win32") {
    const script = `$items = Get-NetTCPConnection -LocalPort ${DASHBOARD_PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter \"ProcessId = $($_.OwningProcess)\"; [pscustomobject]@{ pid = $_.OwningProcess; commandLine = $p.CommandLine } }; $items | ConvertTo-Json -Compress`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
    if (result.status === 0 && result.stdout.trim()) {
      const parsed = JSON.parse(result.stdout);
      processes = Array.isArray(parsed) ? parsed : [parsed];
    }
  } else {
    const found = spawnSync("lsof", ["-nP", `-iTCP:${DASHBOARD_PORT}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    for (const value of found.stdout.trim().split(/\s+/).filter(Boolean)) {
      const pid = Number(value);
      const command = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
      processes.push({ pid, commandLine: command.stdout.trim() });
    }
  }

  const dashboardKey = path.resolve(dash).toLowerCase();
  for (const candidate of processes) {
    const commandLine = String(candidate.commandLine || "").toLowerCase();
    if (!commandLine.includes(dashboardKey) || !commandLine.includes("vite")) continue;
    try {
      process.kill(Number(candidate.pid));
    } catch {
      // The legacy process may exit after the port inspection.
    }
  }
  for (let attempt = 0; attempt < 20 && await isHttpRootAlive(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

await fs.writeFile(path.join(dash, ".my-wiki-runtime.json"), `${JSON.stringify({ vault, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");

const lockFile = path.join(dash, "package-lock.json");
const dependencyStamp = path.join(dash, "node_modules", ".my-wiki-package-lock.sha256");
const lockHash = createHash("sha256").update(await fs.readFile(lockFile)).digest("hex");
const installedHash = await fs.readFile(dependencyStamp, "utf8").catch(() => "");
if (!(await exists(path.join(dash, "node_modules"))) || installedHash.trim() !== lockHash) {
  run(npmCommand, ["install"]);
  await fs.writeFile(dependencyStamp, `${lockHash}\n`, "utf8");
}

run(npmCommand, ["run", "graph"]);
if (shouldBuild) run(npmCommand, ["run", "build"]);

if (shouldServe && !(await isServerAlive())) {
  if (await isHttpRootAlive()) await stopLegacyDashboard();
  const logPath = path.join(dash, "vite.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [path.join(dash, "server.mjs"), String(DASHBOARD_PORT)], {
    cwd: dash,
    env: runtimeEnv,
    detached: true,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  closeSync(logFd);

  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await isServerAlive()) break;
  }
  if (!(await isServerAlive())) {
    throw new Error(`My Wiki local service could not start at ${DASHBOARD_URL}. Stop an older Dashboard process using this port, then try again.`);
  }
}

if (shouldServe) {
  const watchLogPath = path.join(dash, "graph-watch.log");
  const watchLogFd = openSync(watchLogPath, "a");
  const watcher = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "watch-graph.mjs")], {
    cwd: vault,
    env: runtimeEnv,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", watchLogFd, watchLogFd],
    shell: false
  });
  watcher.unref();
  closeSync(watchLogFd);
}

const graphPath = path.join(dash, "public", "wiki-graph.json");
const graph = JSON.parse(await fs.readFile(graphPath, "utf8"));
console.log(JSON.stringify({
  vault,
  dashboard: dash,
  url: DASHBOARD_URL,
  graph: graph.stats,
  server: shouldServe ? await isServerAlive() : "not requested"
}, null, 2));
