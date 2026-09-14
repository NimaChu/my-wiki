import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { historicalOriginal, listDocumentVersions, recoverDocumentTransactions, updateDocumentVersion } from "../scripts/core/document-versions.mjs";
import { parseFrontmatter, upsertFrontmatterValues } from "../scripts/core/wiki-lib.mjs";
import { reextractSources } from "../scripts/core/reextract-source.mjs";

async function fixture(t) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-versions-"));
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const original = "references/originals/book.md";
  const source = "references/sources/book.md";
  const asset = "references/assets/book/image.png";
  for (const directory of ["references/originals", "references/sources", "references/assets/book", "concepts", ".my-wiki/uploads"]) await fs.mkdir(path.join(vault, directory), { recursive: true });
  await fs.writeFile(path.join(vault, original), "First original");
  await fs.writeFile(path.join(vault, asset), "First image");
  const content = `---\ntitle: Book\ntype: Reference\nstatus: stable\nworkflow_status: processed\nsnapshot_path: ${original}\nextraction_status: complete\nneeds_followup: false\nrelated:\n  - concepts/knowledge\n---\n\n# Book\n\n## Capture\n\nOriginal extracted and repaired evidence. ![Figure](../assets/book/image.png)\n\n## Processing Notes\n\n- Status: processed\n`;
  await fs.writeFile(path.join(vault, source), content);
  await fs.writeFile(path.join(vault, "concepts/knowledge.md"), "---\ntitle: Knowledge\ntype: Concept\nstatus: stable\n---\n\n[[references/sources/book]]\n");
  const temporary = path.join(vault, ".my-wiki/uploads/new.md");
  await fs.writeFile(temporary, "Second original");
  return { vault, original, source, asset, content, temporary };
}

test("document updates archive evidence; restore is a new version requiring distillation", async (t) => {
  const f = await fixture(t);
  const operationId = randomUUID();
  const next = await updateDocumentVersion({ ...f, filename: "new.md", operationId });
  assert.equal(next.number, 2);
  assert.equal(next.reusable, false);
  assert.equal(await fs.readFile(path.join(f.vault, f.original), "utf8"), "Second original");
  const pending = await fs.readFile(path.join(f.vault, f.source), "utf8");
  assert.equal(parseFrontmatter(pending).extraction_status, "pending");
  assert.ok(!pending.includes("Original extracted"));
  assert.match(parseFrontmatter(pending).document_asset_base, /book--/);
  assert.equal(await fs.stat(path.join(f.vault, f.asset)).catch(() => null), null);
  const history = await listDocumentVersions(f.vault, f.original);
  assert.equal(history.versions.length, 1);
  assert.equal(history.versions[0].reusable, true);
  assert.equal(await fs.readFile((await historicalOriginal(f.vault, f.original, history.versions[0].id)).file, "utf8"), "First original");
  assert.equal((await updateDocumentVersion({ ...f, filename: "new.md", operationId })).id, next.id);
  const restored = await updateDocumentVersion({ vault: f.vault, original: f.original, restoreId: history.versions[0].id });
  assert.equal(restored.number, 3);
  assert.equal(restored.reusable, true);
  assert.equal(await fs.readFile(path.join(f.vault, f.original), "utf8"), "First original");
  assert.equal(await fs.readFile(path.join(f.vault, f.asset), "utf8"), "First image");
  const source = await fs.readFile(path.join(f.vault, f.source), "utf8");
  assert.equal(parseFrontmatter(source).workflow_status, "inbox");
  assert.equal(parseFrontmatter(source).extraction_status, "complete");
  assert.match(source, /Original extracted and repaired evidence/);
  assert.equal((await listDocumentVersions(f.vault)).versions.length, 2);
  assert.match(await fs.readFile(path.join(f.vault, "concepts/knowledge.md"), "utf8"), /\[\[references\/sources\/book\]\]/);
});

test("type checks, busy guards and archive failures preserve current evidence", async (t) => {
  const f = await fixture(t);
  await assert.rejects(updateDocumentVersion({ ...f, filename: "new.pdf" }), /same extension/);
  await assert.rejects(updateDocumentVersion({ ...f, filename: "new.md", assertIdle: () => { throw new Error("busy"); } }), /busy/);
  await assert.rejects(updateDocumentVersion({ ...f, filename: "new.md", beforeCommit: () => { throw new Error("simulated failure"); } }), /simulated/);
  assert.equal(await fs.readFile(path.join(f.vault, f.source), "utf8"), f.content);
  assert.equal(await fs.readFile(path.join(f.vault, f.original), "utf8"), "First original");
  const result = await updateDocumentVersion({ ...f, filename: "new.md" });
  assert.equal(result.number, 2);
  const history = await listDocumentVersions(f.vault, f.original);
  const file = (await historicalOriginal(f.vault, f.original, history.versions[0].id)).file;
  await fs.writeFile(file, "corrupted");
  await assert.rejects(updateDocumentVersion({ vault: f.vault, original: f.original, restoreId: history.versions[0].id }), /checksum/);
  assert.equal(await fs.readFile(path.join(f.vault, f.original), "utf8"), "Second original");
});

test("shared attachments remain active and incomplete historical extraction is not trusted", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.vault, "concepts/knowledge.md"), "\n![Shared](../references/assets/book/image.png)\n");
  await fs.writeFile(path.join(f.vault, f.source), upsertFrontmatterValues(f.content, { workflow_status: "needs-followup", needs_followup: true }));
  await updateDocumentVersion({ ...f, filename: "new.md" });
  assert.equal(await fs.readFile(path.join(f.vault, f.asset), "utf8"), "First image");
  const history = await listDocumentVersions(f.vault, f.original);
  assert.equal(history.versions[0].reusable, false);
  const restored = await updateDocumentVersion({ vault: f.vault, original: f.original, restoreId: history.versions[0].id });
  assert.equal(restored.reusable, false);
  assert.equal(parseFrontmatter(await fs.readFile(path.join(f.vault, f.source), "utf8")).extraction_status, "pending");
});

test("interrupted replacement rolls back evidence and can be retried", async (t) => {
  const f = await fixture(t);
  await updateDocumentVersion({ ...f, filename: "new.md" });
  const history = await listDocumentVersions(f.vault, f.original);
  const archived = await historicalOriginal(f.vault, f.original, history.versions[0].id);
  const archive = path.resolve(path.dirname(archived.file), "../../..");
  const directory = path.dirname(archive);
  const manifest = JSON.parse(await fs.readFile(path.join(archive, "manifest.json"), "utf8"));
  const previousHead = { id: manifest.id, number: manifest.number, original: manifest.original, filename: manifest.filename, createdAt: manifest.createdAt };
  await fs.writeFile(path.join(directory, "current.json"), JSON.stringify(previousHead));
  await fs.writeFile(path.join(directory, "transaction.json"), JSON.stringify({ original: f.original, archiveId: manifest.id, previousHead, nextId: randomUUID(), applying: true, created: ["references/assets/partial.png"] }));
  await fs.writeFile(path.join(f.vault, f.original), "Interrupted partial replacement");
  await fs.writeFile(path.join(f.vault, "references/assets/partial.png"), "partial");
  await recoverDocumentTransactions(f.vault);
  assert.equal(await fs.readFile(path.join(f.vault, f.original), "utf8"), "First original");
  assert.equal(await fs.readFile(path.join(f.vault, f.source), "utf8"), f.content);
  await assert.rejects(fs.stat(path.join(f.vault, "references/assets/partial.png")), /ENOENT/);
  assert.equal((await updateDocumentVersion({ ...f, filename: "new.md" })).number, 2);
});

test("historical attachment conflicts leave current evidence and shared files intact", async (t) => {
  const f = await fixture(t);
  await updateDocumentVersion({ ...f, filename: "new.md" });
  const history = await listDocumentVersions(f.vault, f.original);
  await fs.writeFile(path.join(f.vault, f.asset), "Different shared asset");
  const current = await fs.readFile(path.join(f.vault, f.source), "utf8");
  await assert.rejects(updateDocumentVersion({ vault: f.vault, original: f.original, restoreId: history.versions[0].id }), /occupied/);
  assert.equal(await fs.readFile(path.join(f.vault, f.asset), "utf8"), "Different shared asset");
  assert.equal(await fs.readFile(path.join(f.vault, f.source), "utf8"), current);
  assert.equal((await listDocumentVersions(f.vault, f.original)).versions.length, 1);
});

test("unlinked originals create a Reference; extraction reports are archived with evidence", async (t) => {
  const f = await fixture(t);
  const report = ".my-wiki/extractions/book.report.json";
  await fs.mkdir(path.dirname(path.join(f.vault, report)), { recursive: true });
  await fs.writeFile(path.join(f.vault, report), '{"quality":"passed"}');
  await fs.writeFile(path.join(f.vault, f.source), upsertFrontmatterValues(f.content, { extraction_report: report }));
  await updateDocumentVersion({ ...f, filename: "new.md" });
  const history = await listDocumentVersions(f.vault, f.original);
  const archived = await historicalOriginal(f.vault, f.original, history.versions[0].id);
  const files = path.resolve(path.dirname(archived.file), "../..");
  assert.equal(await fs.readFile(path.join(files, report), "utf8"), '{"quality":"passed"}');
  await assert.rejects(fs.stat(path.join(f.vault, report)), /ENOENT/);
  await updateDocumentVersion({ vault: f.vault, original: f.original, restoreId: history.versions[0].id });
  assert.equal(await fs.readFile(path.join(f.vault, report), "utf8"), '{"quality":"passed"}');
  const unlinked = "references/originals/unlinked.md";
  await fs.writeFile(path.join(f.vault, unlinked), "Unlinked");
  const next = await updateDocumentVersion({ vault: f.vault, original: unlinked, temporary: f.temporary, filename: "new.md" });
  assert.equal(next.paths.length, 1);
  assert.equal(parseFrontmatter(await fs.readFile(path.join(f.vault, next.paths[0]), "utf8")).extraction_status, "pending");
});

test("the real Markdown extractor processes the replacement without reusing old body or images", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.temporary, "# Updated chapter\n\nThis revised chapter contains new evidence and replaces the first edition.\n");
  await updateDocumentVersion({ ...f, filename: "new.md" });
  const result = await reextractSources({ vault: f.vault, source: f.source });
  assert.equal(result.results[0].extractionStatus, "complete");
  const content = await fs.readFile(path.join(f.vault, f.source), "utf8");
  assert.match(content, /This revised chapter/);
  assert.doesNotMatch(content, /Original extracted and repaired evidence|\.\.\/assets\/book\/image/);
  assert.equal(parseFrontmatter(content).workflow_status, "inbox");
});

test("uploaded HTML versions extract readable article content without page chrome or scripts", async (t) => {
  const f = await fixture(t);
  const original = "references/originals/book.htm";
  await fs.rename(path.join(f.vault,f.original),path.join(f.vault,original));
  const note = path.join(f.vault,f.source);
  await fs.writeFile(note, (await fs.readFile(note,"utf8")).replaceAll(f.original,original));
  const html = '<html><body><nav>Page chrome</nav><div id="js_content" class="rich_media_content" style="visibility: hidden; opacity: 0"><h1>Article title</h1><p>This updated article contains substantive evidence, not its surrounding website interface.</p><script>hiddenScript()</script><img data-src="https://example.com/figure.png"></div><footer>Website footer</footer></body></html>';
  await fs.writeFile(f.temporary,html);
  await updateDocumentVersion({...f,original,filename:"new.htm"});
  await reextractSources({vault:f.vault,source:f.source});
  assert.equal(await fs.readFile(path.join(f.vault,original),"utf8"),html);
  const content = await fs.readFile(note,"utf8");
  assert.match(content,/# Article title/);
  assert.match(content,/!\[\]\(https:\/\/example.com\/figure.png\)/);
  assert.doesNotMatch(content,/Page chrome|Website footer|hiddenScript\(\)|<script>/);
  assert.equal(parseFrontmatter(content).extraction_method,"html-markdown");
});
