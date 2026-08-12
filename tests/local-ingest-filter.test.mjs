import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ingestLocalFile, isIgnoredLocalEntry } from "../scripts/core/local-ingest.mjs";
import { captureSource } from "../scripts/core/capture-service.mjs";

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

test("recovered ingest reuses its preserved snapshot instead of creating a duplicate", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-wiki-ingest-recovery-"));
  const vault = path.join(root, "vault");
  const upload = path.join(root, "recovered.txt");
  const snapshotReference = "raw/snapshots/2026-08-12--recovered.txt";
  const snapshot = path.join(vault, ...snapshotReference.split("/"));
  const evidence = "Substantive recovered evidence remains readable after a Dashboard restart.";
  await mkdir(path.dirname(snapshot), { recursive: true });
  await mkdir(path.join(vault, "wiki"), { recursive: true });
  await writeFile(upload, evidence, "utf8");
  await writeFile(snapshot, evidence, "utf8");
  await writeFile(path.join(vault, "wiki", "log.md"), "# Log\n", "utf8");
  context.after(() => rm(root, { recursive: true, force: true }));
  let observedSnapshot = null;

  const result = await ingestLocalFile({
    vault,
    file: upload,
    filename: "recovered.txt",
    dependencyRoot: process.cwd(),
    snapshotReference,
    onSnapshot: (value) => { observedSnapshot = value; }
  });

  assert.equal(result.count, 1);
  assert.equal(observedSnapshot.relative, snapshotReference);
  assert.deepEqual(await readdir(path.join(vault, "raw", "snapshots")), ["2026-08-12--recovered.txt"]);
  const note = await readFile(result.items[0].path, "utf8");
  assert.match(note, /^snapshot_path: "raw\/snapshots\/2026-08-12--recovered\.txt"$/m);
});

test("captured raw evidence preserves an optional maintenance galaxy suggestion", async (context) => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "my-wiki-galaxy-suggestion-"));
  context.after(() => rm(vault, { recursive: true, force: true }));
  await mkdir(path.join(vault, "wiki"), { recursive: true });

  const result = await captureSource({
    vault,
    title: "Linear algebra notes",
    content: "A vector space is closed under vector addition and scalar multiplication.",
    suggestedUniverse: "数学",
    shouldSnapshot: false
  });

  const note = await readFile(result.path, "utf8");
  assert.match(note, /^suggested_universe: "数学"$/m);
  assert.match(note, /^- Suggested galaxy: 数学$/m);
  assert.equal(result.suggestedUniverse, "数学");
});
