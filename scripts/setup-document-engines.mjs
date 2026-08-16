#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCLING_VERSION = "2.113.0";
const root = path.dirname(fileURLToPath(import.meta.url));

run(process.execPath, [path.join(root, "setup-pdf-engine.mjs")]);
requireCommand("uv", ["--version"], "Install uv from https://docs.astral.sh/uv/getting-started/installation/ and rerun this command.");

console.log(`Installing Docling ${DOCLING_VERSION} as an isolated uv tool.`);
run("uv", ["tool", "install", "--force", "--python", "3.11", `docling==${DOCLING_VERSION}`]);

run(process.execPath, [path.join(root, "document-doctor.mjs")]);

function requireCommand(command, args, message) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(message);
    process.exit(1);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32", stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
