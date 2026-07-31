import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const TOOL_ROOT = path.resolve(here, "..", "..");
export const VAULT_MARKER = ".my-wiki.json";

export function userConfigPath() {
  return process.env.MY_WIKI_CONFIG_PATH
    ? path.resolve(process.env.MY_WIKI_CONFIG_PATH)
    : path.join(os.homedir(), ".my-wiki", "config.json");
}

export function readUserConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(userConfigPath(), "utf8"));
    return {
      version: 1,
      defaultVault: parsed.defaultVault || "",
      vaults: parsed.vaults && typeof parsed.vaults === "object" ? parsed.vaults : {}
    };
  } catch {
    return { version: 1, defaultVault: "", vaults: {} };
  }
}

export async function writeUserConfig(config) {
  const target = userConfigPath();
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${JSON.stringify({
    version: 1,
    defaultVault: config.defaultVault || "",
    vaults: config.vaults || {}
  }, null, 2)}\n`, "utf8");
  return target;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function resolveVaultSpecifier(specifier, { cwd = process.cwd(), config = readUserConfig() } = {}) {
  const value = String(specifier || "").trim();
  if (!value) return "";
  const registered = config.vaults[value];
  return path.resolve(cwd, expandHome(String(registered || value)));
}

export function looksLikeVault(target) {
  return fs.existsSync(path.join(target, VAULT_MARKER)) || (
    fs.existsSync(path.join(target, "raw")) && fs.existsSync(path.join(target, "wiki"))
  );
}

function configuredFromAncestors(start) {
  let current = path.resolve(start);
  while (true) {
    const marker = path.join(current, VAULT_MARKER);
    if (fs.existsSync(marker)) {
      try {
        const config = JSON.parse(fs.readFileSync(marker, "utf8"));
        return config.vault ? path.resolve(current, expandHome(String(config.vault))) : current;
      } catch {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function legacyVaultFromAncestors(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, "raw")) && fs.existsSync(path.join(current, "wiki"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

export function resolveVaultPath({ specifier = "", cwd = process.cwd(), required = true } = {}) {
  const config = readUserConfig();
  const explicit = specifier || process.env.MY_WIKI_VAULT || process.env.KNOWLEDGE_VAULT_PATH ||
    process.env.KARPATHY_OBSIDIAN_VAULT || process.env.OBSIDIAN_VAULT_PATH;
  if (explicit) return resolveVaultSpecifier(explicit, { cwd, config });

  const nearby = configuredFromAncestors(cwd);
  if (nearby) return nearby;

  if (config.defaultVault) return resolveVaultSpecifier(config.defaultVault, { cwd, config });
  const legacy = legacyVaultFromAncestors(cwd);
  if (legacy) return legacy;
  if (looksLikeVault(TOOL_ROOT)) return TOOL_ROOT;
  if (!required) return "";

  throw new Error(
    "No My Wiki vault is configured. Run `my-wiki init <path>` or pass `--vault <name-or-path>`."
  );
}
