#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRemoteConfig, remoteCli } from "../my-wiki-skill/scripts/remote.mjs";

const args = process.argv.slice(2);
const forceLocal = args.includes("--local") || args.includes("--vault");
if (args[0] === "remote" || (!forceLocal && (await readRemoteConfig())?.enabled)) {
  await remoteCli(args);
  process.exit(process.exitCode || 0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "core", "karpathy-wiki.mjs");
const result = spawnSync(process.execPath, [cli, ...args.filter((arg) => arg !== "--local")], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  shell: false
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
