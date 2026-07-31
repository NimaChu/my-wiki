#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectConfigPath = process.env.MY_WIKI_PROJECT_CONFIG_PATH
  ? path.resolve(process.env.MY_WIKI_PROJECT_CONFIG_PATH)
  : path.join(os.homedir(), ".my-wiki", "project.json");

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isProjectRoot(candidate) {
  if (!candidate) return false;
  try {
    const root = path.resolve(expandHome(String(candidate)));
    const marker = JSON.parse(fs.readFileSync(path.join(root, ".my-wiki-project.json"), "utf8"));
    return marker.name === "my-wiki" && marker.kind === "agent-project" &&
      fs.existsSync(path.join(root, "scripts", "my-wiki.mjs"));
  } catch {
    return false;
  }
}

function ancestorProject(start) {
  let current = path.resolve(start);
  while (true) {
    if (isProjectRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function configuredProject() {
  try {
    return JSON.parse(fs.readFileSync(projectConfigPath, "utf8")).projectRoot || "";
  } catch {
    return "";
  }
}

const candidates = [
  process.env.MY_WIKI_HOME,
  ancestorProject(process.cwd()),
  ancestorProject(bridgeRoot),
  configuredProject(),
  path.join(os.homedir(), "my-wiki"),
  path.join(os.homedir(), "Documents", "my-wiki"),
  path.join(os.homedir(), ".local", "share", "my-wiki")
];
const projectRoot = candidates.find(isProjectRoot);

if (!projectRoot) {
  console.error(`My Wiki Skill found no installed My Wiki project.

Install the project first, then register it:
  git clone https://github.com/NimaChu/my-wiki.git
  cd my-wiki
  npm run setup

Or point this Skill at an existing checkout with MY_WIKI_HOME=/path/to/my-wiki.
Afterward, create a separate local vault with:
  npm run wiki -- init /path/to/vault --name personal --use`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "my-wiki.mjs"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
  shell: false
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
