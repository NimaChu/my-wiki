#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const configPath = process.env.MY_WIKI_PROJECT_CONFIG_PATH
  ? path.resolve(process.env.MY_WIKI_PROJECT_CONFIG_PATH)
  : path.join(os.homedir(), ".my-wiki", "project.json");
const args = new Set(process.argv.slice(2));

async function verifyProject() {
  const marker = JSON.parse(await fs.readFile(path.join(projectRoot, ".my-wiki-project.json"), "utf8"));
  if (marker.name !== "my-wiki" || marker.kind !== "agent-project") {
    throw new Error(`Invalid My Wiki project marker: ${projectRoot}`);
  }
  await fs.access(path.join(projectRoot, "scripts", "my-wiki.mjs"));
  await fs.access(path.join(projectRoot, "assets", "dashboard", "server.mjs"));
}

await verifyProject();

if (args.has("--print")) {
  console.log(projectRoot);
  process.exit(0);
}

await fs.mkdir(path.dirname(configPath), { recursive: true });
if (args.has("--unregister")) {
  await fs.rm(configPath, { force: true });
  console.log(`Unregistered My Wiki project: ${projectRoot}`);
  process.exit(0);
}

await fs.writeFile(configPath, `${JSON.stringify({
  version: 1,
  projectRoot,
  registeredAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");

if (args.has("--install-skill")) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, "my-wiki-skill", "scripts", "install.mjs")], {
    stdio: "inherit",
    env: process.env,
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(JSON.stringify({
  projectRoot,
  projectConfig: configPath,
  skillInstalled: args.has("--install-skill"),
  next: "Create or select a separate vault with `npm run wiki -- init /path/to/vault --name personal --use`."
}, null, 2));
