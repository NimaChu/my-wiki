import { promises as fs } from "node:fs";
import path from "node:path";

function category(relative) {
  if (typeof relative !== "string" || /[\\\0]/.test(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return relative.match(/^references\/(sources|originals|assets)\/.+/)?.[1] || "";
}

// Retain saved evidence URLs after an explicit vault filename migration.
// Existing files always win, and aliases never cross evidence directories.
export async function resolveReferencePathAlias(vault, relative) {
  const kind = category(relative);
  if (!kind || await fs.lstat(path.join(vault, relative)).catch(() => null)) return relative;
  let state;
  try {
    state = JSON.parse(await fs.readFile(path.join(vault, ".my-wiki", "reference-path-aliases.json"), "utf8"));
  } catch {
    return relative;
  }
  if (state?.version !== 1 || !state.paths || typeof state.paths !== "object" || Array.isArray(state.paths)) return relative;
  const seen = new Set([relative]);
  let current = relative;
  for (let depth = 0; depth < 8; depth++) {
    let next = Object.hasOwn(state.paths, current) ? state.paths[current] : "";
    if (!next && kind === "assets") {
      const prefix = Object.keys(state.paths).filter((key) => current.startsWith(`${key}/`) && category(key) === kind).sort((a, b) => b.length - a.length)[0];
      if (prefix && typeof state.paths[prefix] === "string") next = state.paths[prefix] + current.slice(prefix.length);
    }
    if (!next || category(next) !== kind || seen.has(next)) return relative;
    seen.add(next);
    if (await fs.lstat(path.join(vault, next)).catch(() => null)) {
      const root = await fs.realpath(vault);
      const resolved = await fs.realpath(path.join(vault, next)).catch(() => "");
      const canonical = path.relative(root, resolved).split(path.sep).join("/");
      return category(canonical) === kind ? canonical : relative;
    }
    current = next;
  }
  return relative;
}
