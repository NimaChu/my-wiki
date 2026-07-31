#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DASHBOARD_URL } from "./wiki-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    shell: process.platform === "win32",
    stdio: "inherit",
    windowsHide: true,
    ...options
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

function openUrl(url) {
  const opener =
    process.platform === "win32" ? ["cmd.exe", ["/d", "/c", "start", "", url]] :
    process.platform === "darwin" ? ["open", [url]] :
    ["xdg-open", [url]];
  const child = spawn(opener[0], opener[1], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    shell: false
  });
  child.unref();
}

run(process.execPath, [path.join(here, "refresh-dashboard.mjs"), "--serve"], { shell: false });

openUrl(DASHBOARD_URL);
console.log(`Opened My Wiki frontend: ${DASHBOARD_URL}`);
