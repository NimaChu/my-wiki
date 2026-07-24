#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  TOOL_ROOT,
  VAULT_MARKER,
  looksLikeVault,
  readUserConfig,
  resolveVaultPath,
  resolveVaultSpecifier,
  userConfigPath,
  writeUserConfig
} from "./vault-config.mjs";

const args = process.argv.slice(2);
const command = args[0] || "list";

function option(name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] || "";
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function positional(start = 1) {
  const values = [];
  for (let index = start; index < args.length; index += 1) {
    if (args[index].startsWith("--")) {
      if (!args[index].includes("=") && ["--name"].includes(args[index])) index += 1;
      continue;
    }
    values.push(args[index]);
  }
  return values;
}

async function writeIfMissing(target, content) {
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, content, "utf8");
  }
}

async function copyTemplates(target) {
  const source = path.join(TOOL_ROOT, "assets", "templates");
  const destination = path.join(target, "templates");
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const output = path.join(destination, entry.name);
    try {
      await fs.access(output);
    } catch {
      await fs.copyFile(path.join(source, entry.name), output);
    }
  }
}

async function copyRawReadme(target) {
  const source = path.join(TOOL_ROOT, "assets", "raw-README.md");
  await writeIfMissing(path.join(target, "raw", "README.md"), await fs.readFile(source, "utf8"));
}

async function initVault() {
  const requested = positional()[0] || process.cwd();
  const target = path.resolve(requested);
  await fs.mkdir(path.join(target, "raw", "sources"), { recursive: true });
  await fs.mkdir(path.join(target, "raw", "assets"), { recursive: true });
  await fs.mkdir(path.join(target, "raw", "snapshots"), { recursive: true });
  await fs.mkdir(path.join(target, "wiki"), { recursive: true });
  await fs.mkdir(path.join(target, ".my-wiki", "cache"), { recursive: true });
  await copyTemplates(target);
  await copyRawReadme(target);

  await writeIfMissing(path.join(target, VAULT_MARKER), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
  await writeIfMissing(path.join(target, "wiki", "index.md"), "---\ntitle: Knowledge Index\ntype: index\nstatus: active\n---\n\n# Knowledge Index\n\nAdd durable wiki pages here as the vault grows.\n");
  await writeIfMissing(path.join(target, "wiki", "log.md"), "---\ntitle: Knowledge Maintenance Log\ntype: log\nstatus: active\n---\n\n# Knowledge Maintenance Log\n");

  const config = readUserConfig();
  const name = option("--name");
  if (name) config.vaults[name] = target;
  if (args.includes("--use") || !config.defaultVault) config.defaultVault = name || target;
  const configPath = await writeUserConfig(config);

  console.log(JSON.stringify({ vault: target, name: name || null, default: config.defaultVault, config: configPath }, null, 2));
}

async function addVault() {
  const [name, requested] = positional();
  if (!name || !requested) throw new Error("Usage: my-wiki vault add <name> <path> [--use]");
  const target = path.resolve(requested);
  if (!looksLikeVault(target)) throw new Error(`Not a My Wiki vault: ${target}`);
  const config = readUserConfig();
  config.vaults[name] = target;
  if (args.includes("--use") || !config.defaultVault) config.defaultVault = name;
  await writeUserConfig(config);
  console.log(JSON.stringify({ name, vault: target, default: config.defaultVault === name }, null, 2));
}

async function useVault() {
  const requested = positional()[0];
  if (!requested) throw new Error("Usage: my-wiki vault use <name-or-path>");
  const config = readUserConfig();
  const target = resolveVaultSpecifier(requested, { config });
  if (!looksLikeVault(target)) throw new Error(`Not a My Wiki vault: ${target}`);
  config.defaultVault = config.vaults[requested] ? requested : target;
  await writeUserConfig(config);
  console.log(JSON.stringify({ default: config.defaultVault, vault: target }, null, 2));
}

async function removeVault() {
  const name = positional()[0];
  if (!name) throw new Error("Usage: my-wiki vault remove <name>");
  const config = readUserConfig();
  if (!config.vaults[name]) throw new Error(`Unknown vault: ${name}`);
  delete config.vaults[name];
  if (config.defaultVault === name) config.defaultVault = "";
  await writeUserConfig(config);
  console.log(JSON.stringify({ removed: name, knowledgeDeleted: false }, null, 2));
}

function listVaults() {
  const config = readUserConfig();
  const entries = Object.entries(config.vaults).map(([name, vault]) => ({
    name,
    vault: path.resolve(vault),
    default: config.defaultVault === name,
    exists: looksLikeVault(path.resolve(vault))
  }));
  console.log(JSON.stringify({ config: userConfigPath(), default: config.defaultVault || null, vaults: entries }, null, 2));
}

if (command === "init") await initVault();
else if (command === "where") console.log(resolveVaultPath({ specifier: positional()[0] || "" }));
else if (command === "list") listVaults();
else if (command === "add") await addVault();
else if (command === "use") await useVault();
else if (command === "remove") await removeVault();
else throw new Error(`Unknown vault command: ${command}`);
