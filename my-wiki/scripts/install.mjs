#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..");
const args = new Set(process.argv.slice(2));
const mode = args.has("--link") ? "link" : "copy";
const codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");

const targets = [];
if (!args.has("--opencode-only")) targets.push({ agent: "codex", root: path.join(codexRoot, "skills") });
if (!args.has("--codex-only")) targets.push({ agent: "opencode", root: path.join(xdgConfig, "opencode", "skills") });

function stripExtendedPathPrefix(value) {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice(8)}`;
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  return value;
}

async function install({ agent, root }) {
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, "my-wiki");
  const expected = await fs.realpath(source);
  try {
    const existing = await fs.realpath(target);
    if (path.resolve(target) === path.resolve(source)) {
      return { agent, target, mode, status: "already-installed" };
    }
    if (path.resolve(existing) === path.resolve(expected) && mode === "link") {
      return { agent, target, mode, status: "already-installed" };
    }

    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || path.resolve(existing) === path.resolve(expected)) {
      try {
        await fs.unlink(target);
      } catch {
        await fs.rmdir(target);
      }
    } else {
      const marker = path.join(target, ".my-wiki-skill.json");
      try {
        const metadata = JSON.parse(await fs.readFile(marker, "utf8"));
        if (metadata.name !== "my-wiki") throw new Error("invalid marker");
      } catch {
        throw new Error(`Refusing to replace unmanaged skill directory: ${target}`);
      }
      if (path.dirname(path.resolve(target)) !== path.resolve(root) || path.basename(target) !== "my-wiki") {
        throw new Error(`Unsafe skill target: ${target}`);
      }
      await fs.rm(target, { recursive: true, force: true });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (mode === "link") {
    await fs.symlink(source, target, process.platform === "win32" ? "junction" : "dir");
  } else {
    const copyRoot = path.resolve(stripExtendedPathPrefix(source));
    await fs.cp(source, target, {
      recursive: true,
      filter(entry) {
        const normalizedEntry = path.resolve(stripExtendedPathPrefix(entry));
        const relative = path.relative(copyRoot, normalizedEntry).replace(/\\/g, "/");
        const parts = relative.split("/");
        if (parts[0] === "tests") return false;
        if (parts.includes("node_modules") || parts.includes("dist")) return false;
        const basename = path.basename(entry);
        if (basename.endsWith(".log") || basename.endsWith(".pid")) return false;
        return basename !== "wiki-graph.json" && basename !== ".my-wiki-runtime.json";
      }
    });
  }
  return { agent, target, mode, status: "installed" };
}

const results = [];
for (const target of targets) results.push(await install(target));
console.log(JSON.stringify({ source, mode, results, restartRequired: true }, null, 2));
