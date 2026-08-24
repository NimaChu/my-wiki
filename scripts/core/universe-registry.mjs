import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeUniverseName } from "./wiki-lib.mjs";

const REGISTRY_VERSION = 1;

export function universeRegistryPath(vault) {
  return path.join(vault, ".my-wiki", "galaxies.json");
}

export async function readDeclaredUniverses(vault) {
  return (await readUniverseRegistry(vault)).galaxies;
}

export async function readHiddenUniverses(vault) {
  return (await readUniverseRegistry(vault)).hiddenGalaxies;
}

export async function readUniverseRegistry(vault) {
  try {
    const parsed = JSON.parse(await fs.readFile(universeRegistryPath(vault), "utf8"));
    const values = Array.isArray(parsed) ? parsed : parsed.galaxies;
    const hiddenValues = Array.isArray(parsed) ? [] : parsed.hiddenGalaxies;
    const galaxies = Array.isArray(values) ? uniqueUniverseNames(values) : [];
    const galaxyKeys = new Set(galaxies.map((name) => name.toLocaleLowerCase()));
    const hiddenGalaxies = Array.isArray(hiddenValues)
      ? uniqueUniverseNames(hiddenValues).filter((name) => galaxyKeys.has(name.toLocaleLowerCase()))
      : [];
    return { galaxies, hiddenGalaxies };
  } catch (error) {
    if (error?.code === "ENOENT") return { galaxies: [], hiddenGalaxies: [] };
    throw new Error(`Invalid galaxy registry: ${error.message || error}`);
  }
}

export async function declareUniverse(vault, value) {
  const name = validateUniverseName(value);
  const registry = await readUniverseRegistry(vault);
  const current = registry.galaxies;
  const existing = current.find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (existing) return { name: existing, created: false };

  const galaxies = uniqueUniverseNames([...current, name]);
  await writeUniverseRegistry(vault, { galaxies, hiddenGalaxies: registry.hiddenGalaxies });
  return { name, created: true };
}

export async function setUniverseHidden(vault, value, hidden) {
  const name = validateUniverseName(value);
  const registry = await readUniverseRegistry(vault);
  const existing = registry.galaxies.find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!existing) throw new Error("Knowledge galaxy not found");
  const hiddenKeys = new Set(registry.hiddenGalaxies.map((item) => item.toLocaleLowerCase()));
  if (hidden) hiddenKeys.add(existing.toLocaleLowerCase());
  else hiddenKeys.delete(existing.toLocaleLowerCase());
  const hiddenGalaxies = registry.galaxies.filter((item) => hiddenKeys.has(item.toLocaleLowerCase()));
  await writeUniverseRegistry(vault, { galaxies: registry.galaxies, hiddenGalaxies });
  return { name: existing, hidden: Boolean(hidden) };
}

export async function renameDeclaredUniverse(vault, currentValue, nextValue) {
  const currentName = validateUniverseName(currentValue);
  const nextName = validateUniverseName(nextValue);
  const registry = await readUniverseRegistry(vault);
  const existing = registry.galaxies.find((item) => item.toLocaleLowerCase() === currentName.toLocaleLowerCase());
  if (!existing) throw new Error("Knowledge galaxy not found");
  const conflict = registry.galaxies.find((item) => item.toLocaleLowerCase() === nextName.toLocaleLowerCase() && item.toLocaleLowerCase() !== existing.toLocaleLowerCase());
  if (conflict) throw new Error("A knowledge galaxy with that name already exists");
  const wasHidden = registry.hiddenGalaxies.some((item) => item.toLocaleLowerCase() === existing.toLocaleLowerCase());
  const galaxies = uniqueUniverseNames(registry.galaxies.map((item) => item.toLocaleLowerCase() === existing.toLocaleLowerCase() ? nextName : item));
  const hiddenGalaxies = uniqueUniverseNames(registry.hiddenGalaxies
    .filter((item) => item.toLocaleLowerCase() !== existing.toLocaleLowerCase())
    .concat(wasHidden ? [nextName] : []));
  await writeUniverseRegistry(vault, { galaxies, hiddenGalaxies });
  return { name: nextName, previousName: existing, hidden: wasHidden };
}

export async function removeDeclaredUniverse(vault, value) {
  const name = validateUniverseName(value);
  const registry = await readUniverseRegistry(vault);
  const existing = registry.galaxies.find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!existing) throw new Error("Knowledge galaxy not found");
  const key = existing.toLocaleLowerCase();
  await writeUniverseRegistry(vault, {
    galaxies: registry.galaxies.filter((item) => item.toLocaleLowerCase() !== key),
    hiddenGalaxies: registry.hiddenGalaxies.filter((item) => item.toLocaleLowerCase() !== key)
  });
  return { name: existing };
}

async function writeUniverseRegistry(vault, registry) {
  const target = universeRegistryPath(vault);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify({
    version: REGISTRY_VERSION,
    galaxies: uniqueUniverseNames(registry.galaxies),
    hiddenGalaxies: uniqueUniverseNames(registry.hiddenGalaxies)
  }, null, 2)}\n`, "utf8");
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
  }
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
