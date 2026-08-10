import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeUniverseName } from "./wiki-lib.mjs";

const REGISTRY_VERSION = 1;

export function universeRegistryPath(vault) {
  return path.join(vault, ".my-wiki", "galaxies.json");
}

export async function readDeclaredUniverses(vault) {
  try {
    const parsed = JSON.parse(await fs.readFile(universeRegistryPath(vault), "utf8"));
    const values = Array.isArray(parsed) ? parsed : parsed.galaxies;
    if (!Array.isArray(values)) return [];
    return uniqueUniverseNames(values);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(`Invalid galaxy registry: ${error.message || error}`);
  }
}

export async function declareUniverse(vault, value) {
  const name = validateUniverseName(value);
  const current = await readDeclaredUniverses(vault);
  const existing = current.find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (existing) return { name: existing, created: false };

  const galaxies = uniqueUniverseNames([...current, name]);
  const target = universeRegistryPath(vault);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({ version: REGISTRY_VERSION, galaxies }, null, 2)}\n`, "utf8");
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
  }
  return { name, created: true };
}

export function validateUniverseName(value) {
  const name = normalizeUniverseName(String(value || ""));
  if (!name) throw new Error("Knowledge galaxy name is required");
  if (name.length > 80) throw new Error("Knowledge galaxy name must be 80 characters or fewer");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("Knowledge galaxy name contains unsupported characters");
  return name;
}

function uniqueUniverseNames(values) {
  const names = new Map();
  for (const value of values) {
    const name = normalizeUniverseName(String(value || ""));
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) continue;
    const key = name.toLocaleLowerCase();
    if (!names.has(key)) names.set(key, name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
