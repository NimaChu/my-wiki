#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { captureSource } from "./capture-service.mjs";
import { vaultPath } from "./wiki-lib.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function args(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function has(name) {
  return process.argv.includes(name);
}

async function stdin() {
  if (process.stdin.isTTY) return "";
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

const vault = vaultPath();
const url = arg("--url", "");
const contentFile = arg("--content-file", "");
const content = contentFile ? await fs.readFile(contentFile, "utf8") : await stdin();
const result = await captureSource({
  vault,
  title: arg("--title", "Untitled Source"),
  url,
  sourceType: arg("--type", url ? "webpage" : "note"),
  author: arg("--author", ""),
  published: arg("--published", ""),
  sourceQuality: arg("--source-quality", url ? "primary-url" : "captured"),
  captureMethod: arg("--capture-method", ""),
  collection: arg("--collection", ""),
  snapshotFile: arg("--snapshot-file", ""),
  content,
  imageInputs: args("--image"),
  shouldSnapshot: !has("--no-snapshot"),
  shouldMirrorImages: !has("--no-mirror-images")
});

let refresh = null;
if (has("--refresh-dashboard") || has("--serve-dashboard")) {
  const refreshScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "refresh-dashboard.mjs");
  const refreshArgs = has("--serve-dashboard") ? ["--serve"] : [];
  const refreshed = spawnSync(process.execPath, [refreshScript, ...refreshArgs], {
    encoding: "utf8",
    env: { ...process.env, MY_WIKI_VAULT: vault },
    shell: false
  });
  const jsonStart = refreshed.stdout.indexOf('{\n  "vault"');
  refresh = {
    status: refreshed.status,
    stdout: jsonStart >= 0 ? JSON.parse(refreshed.stdout.slice(jsonStart)) : null,
    stderr: refreshed.stderr || ""
  };
}

console.log(JSON.stringify({
  ...result,
  refreshed: refresh?.status === 0,
  dashboard: refresh?.stdout?.url || "not requested",
  next: refresh?.status === 0
    ? "Read this raw note, synthesize wiki pages, close related links, mark processed only after wiki backlinks exist. Dashboard graph was refreshed because it was explicitly requested."
    : "Read this raw note, synthesize wiki pages, close related links, and mark processed only after wiki backlinks exist. Refresh or start the dashboard only when graph visualization is requested."
}, null, 2));
