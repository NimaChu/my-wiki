import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";

import { createLocalNoteBundle, deleteLocalNote, listLocalNotes, saveLocalNoteBundle } from "../scripts/core/note-service.mjs";
import { readMarkdownDocument, resolveMarkdownImageFile, saveMarkdownDocument } from "../scripts/core/dashboard-api.mjs";

test("local notes preserve portable Markdown and relative images outside the knowledge graph", async (context) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-note-"));
  context.after(() => fs.rm(vault, { recursive: true, force: true }));
  const source = new JSZip();
  source.file("note.md", "# Field note\n\n![Diagram](assets/diagram.png)\n");
  source.file("assets/diagram.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const saved = await saveLocalNoteBundle(vault, {
    title: "Field note",
    bytes: await source.generateAsync({ type: "nodebuffer" })
  });
  assert.match(saved.path, /^notes\/\d{4}-\d{2}-\d{2}-\d{6}-\d{3}--field-note\/note\.md$/);
  assert.deepEqual((await listLocalNotes(vault)).map(({ title }) => title), ["Field note"]);

  const document = await readMarkdownDocument(vault, saved.path);
  assert.match(document.body, /!\[Diagram\]\(assets\/diagram\.png\)/);
  assert.equal(await fs.readFile(await resolveMarkdownImageFile(vault, saved.path, "assets/diagram.png"), "hex"), "89504e47");

  const updated = await saveMarkdownDocument(vault, saved.path, "# Field note\n\nUpdated.\n", document.version);
  assert.match(updated.body, /Updated\./);
  const exported = await JSZip.loadAsync(await createLocalNoteBundle(vault, saved.path));
  assert.equal(await exported.file("note.md").async("string"), "# Field note\n\nUpdated.\n");
  assert.equal(Buffer.from(await exported.file("assets/diagram.png").async("uint8array")).toString("hex"), "89504e47");

  const removed = await deleteLocalNote(vault, saved.path);
  assert.equal(removed.directory, path.dirname(saved.path));
  assert.deepEqual(await listLocalNotes(vault), []);
  await assert.rejects(fs.stat(path.join(vault, removed.directory)), { code: "ENOENT" });
});

test("local note packages reject files outside note.md and assets", async (context) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-note-invalid-"));
  context.after(() => fs.rm(vault, { recursive: true, force: true }));
  const source = new JSZip();
  source.file("note.md", "# Unsafe\n");
  source.file("script.js", "alert(1)");
  await assert.rejects(
    saveLocalNoteBundle(vault, { title: "Unsafe", bytes: await source.generateAsync({ type: "nodebuffer" }) }),
    /Unsupported note package entry/
  );
});

test("local note deletion cannot escape the notes directory", async (context) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-note-delete-"));
  context.after(() => fs.rm(vault, { recursive: true, force: true }));
  await fs.writeFile(path.join(vault, "keep.md"), "keep", "utf8");
  await assert.rejects(deleteLocalNote(vault, "notes/../keep.md"), /Invalid local note path/);
  assert.equal(await fs.readFile(path.join(vault, "keep.md"), "utf8"), "keep");
});
