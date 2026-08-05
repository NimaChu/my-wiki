import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestLocalFile, isIgnoredLocalEntry } from "../scripts/core/local-ingest.mjs";

test("local ingest ignores operating-system and dependency metadata", () => {
  for (const value of [
    ".DS_Store",
    "notes/.DS_Store",
    "notes/._diagram.png",
    "__MACOSX/notes.md",
    "node_modules/package/index.js",
    "Thumbs.db",
    "desktop.ini",
    "~$draft.docx"
  ]) {
    assert.equal(isIgnoredLocalEntry(value), true, value);
  }

  assert.equal(isIgnoredLocalEntry("notes/article.md"), false);
  assert.equal(isIgnoredLocalEntry("assets/diagram.png"), false);
});

test("single-file ingest rejects ignored browser folder entries before creating vault data", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-wiki-ingest-filter-"));
  const vault = path.join(root, "vault");
  const upload = path.join(root, ".DS_Store");
  await mkdir(vault, { recursive: true });
  await writeFile(upload, "Finder metadata", "utf8");
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = await ingestLocalFile({
    vault,
    file: upload,
    filename: ".DS_Store",
    sourcePath: "uploaded-folder/.DS_Store",
    dependencyRoot: process.cwd()
  });

  assert.equal(result.count, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.ignored, ["uploaded-folder/.DS_Store"]);
  assert.deepEqual(await readdir(path.join(vault, "raw")).catch(() => []), []);
});
