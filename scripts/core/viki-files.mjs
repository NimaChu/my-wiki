import { promises as fs } from "node:fs";
import path from "node:path";

// Symlinks inside the vault are also rejected: a selected path must not be an
// alias for a hidden document, an original, runtime state or a host file.
export async function resolveVikiFile(root, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\")
    || path.posix.isAbsolute(relative) || /^[a-z]:/i.test(relative)
    || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("File is outside the selected knowledge scope");
  }
  const expected = path.join(root, relative);
  const actual = await fs.realpath(expected);
  if (actual !== expected || !actual.startsWith(root + path.sep)
    || !(await fs.stat(actual)).isFile()) throw new Error("File is outside the selected knowledge scope");
  return actual;
}
