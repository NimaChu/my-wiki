import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { exportDriveOriginals, listOriginalsDrive, renameOriginalsDriveGalaxy, resolveDriveOriginal, updateOriginalsDrive } from "../scripts/core/originals-drive.mjs";
import { declareUniverse, setUniverseHidden } from "../scripts/core/universe-registry.mjs";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";

async function fixture(t) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-drive-test-"));
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  for (const directory of ["concepts", "references/sources", "references/originals/nested"]) await fs.mkdir(path.join(vault, directory), { recursive: true });
  await fs.writeFile(path.join(vault, "concepts/shared.md"), '---\ntitle: Shared\ntype: Concept\nuniverses: [AI, Math]\n---\n[Evidence](/references/sources/shared.md)');
  await fs.writeFile(path.join(vault, "references/sources/shared.md"), '---\ntitle: Shared evidence\nsnapshot_path: references/originals/nested/shared.pdf\nsnapshot_html_path: references/originals/shared.html\n---\nEvidence');
  await fs.writeFile(path.join(vault, "references/sources/pending.md"), '---\ntitle: Pending evidence\nsuggested_universe: Math\nsnapshot_path: references/originals/pending.txt\n---\nEvidence');
  for (const file of ["nested/shared.pdf", "shared.html", "pending.txt", "unlinked.txt", ".DS_Store"]) await fs.writeFile(path.join(vault, "references/originals", file), `original: ${file}`);
  await declareUniverse(vault, "Empty");
  await declareUniverse(vault, "Math");
  await setUniverseHidden(vault, "Math", true);
  return vault;
}

test("drive indexes every original, shared evidence, pending hints and hidden galaxies without inventing graph galaxies", async (t) => {
  const vault = await fixture(t);
  const listing = await listOriginalsDrive(vault);
  assert.equal(listing.files.length, 4);
  assert.deepEqual(listing.files.find((file) => file.name === "shared.pdf").galaxies.sort(), ["galaxy:ai", "galaxy:math"]);
  assert.deepEqual(listing.files.find((file) => file.name === "pending.txt").galaxies, ["galaxy:math"]);
  assert.deepEqual(listing.files.find((file) => file.name === "unlinked.txt").galaxies, ["unassigned"]);
  assert.equal(listing.galaxies.find((item) => item.id === "galaxy:empty").count, 0);
  assert.equal(listing.galaxies.find((item) => item.id === "galaxy:math").count, 3);
  assert.equal(listing.galaxies.find((item) => item.id === "galaxy:math").hidden, true);
  assert.equal(listing.galaxies.find((item) => item.id === "galaxy:math").wiki, 1);
  assert.equal(listing.galaxies.find((item) => item.id === "galaxy:math").raw, 2);
  await assert.rejects(fs.access(path.join(vault, ".my-wiki/originals-drive.json")), { code: "ENOENT" });
});

test("virtual folders persist, reject cycles and preserve original bytes and Reference paths", async (t) => {
  const vault = await fixture(t);
  const original = "references/originals/nested/shared.pdf";
  const before = await fs.readFile(path.join(vault, original));
  const reference = await fs.readFile(path.join(vault, "references/sources/shared.md"));
  const change = (input) => updateOriginalsDrive(vault, { galaxy: "galaxy:ai", ...input });
  const a = await change({ action: "create", name: "Books" });
  const b = await change({ action: "create", name: "Nested", parentId: a.id });
  await change({ action: "move", files: [original], folders: [], parentId: b.id });
  const listing = await listOriginalsDrive(vault);
  assert.equal(listing.placements[0].folderId, b.id);
  assert.equal(listing.placements[0].galaxy, "galaxy:ai");
  await assert.rejects(change({ action: "move", files: [], folders: [a.id], parentId: b.id }), { status: 400 });
  await assert.rejects(change({ action: "move", files: ["references/originals/pending.txt"], folders: [], parentId: b.id }), { status: 404 });
  await assert.rejects(change({ action: "create", name: "books" }), { status: 409 });
  await assert.rejects(change({ action: "create", name: "../bad" }), { status: 400 });
  await change({ action: "rename", id: b.id, name: "Research" });
  await change({ action: "delete", id: b.id });
  assert.equal((await listOriginalsDrive(vault)).placements[0].folderId, a.id);
  await change({ action: "delete", id: a.id });
  assert.deepEqual((await listOriginalsDrive(vault)).placements, []);
  assert.deepEqual(await fs.readFile(path.join(vault, original)), before);
  assert.deepEqual(await fs.readFile(path.join(vault, "references/sources/shared.md")), reference);
  assert.deepEqual((await listOriginalsDrive(vault)).files.map((file) => file.path).sort(), listing.files.map((file) => file.path).sort());
});

test("concurrent folder writes do not get lost and galaxy renames preserve organization", async (t) => {
  const vault = await fixture(t);
  await Promise.all(["One", "Two", "Three"].map((name) => updateOriginalsDrive(vault, { galaxy: "galaxy:ai", action: "create", name })));
  assert.equal((await listOriginalsDrive(vault)).folders.length, 3);
  await renameOriginalsDriveGalaxy(vault, "AI", "Intelligence");
  const saved = JSON.parse(await fs.readFile(path.join(vault, ".my-wiki/originals-drive.json"), "utf8"));
  assert.ok(saved.folders.every((item) => item.galaxy === "galaxy:intelligence"));
  assert.equal(saved.folders.length, 3);
});

test("library cache is reused but detects original, Reference and folder changes", async (t) => {
  const vault = await fixture(t);
  const before = await listOriginalsDrive(vault);
  assert.strictEqual(await listOriginalsDrive(vault), before);
  assert.equal(JSON.parse(await fs.readFile(path.join(vault, ".my-wiki/library-index.json"), "utf8")).version, 2);
  await setUniverseHidden(vault, "Math", false);
  assert.equal((await listOriginalsDrive(vault)).galaxies.find((item) => item.id === "galaxy:math").hidden, false);
  await fs.writeFile(path.join(vault, "references/originals/new.txt"), "new evidence");
  const added = await listOriginalsDrive(vault);
  assert.equal(added.files.length, before.files.length + 1);
  await fs.appendFile(path.join(vault, "references/originals/new.txt"), " changes");
  assert.equal((await listOriginalsDrive(vault)).files.find((item) => item.name === "new.txt").size, 20);
  await fs.writeFile(path.join(vault, "references/sources/new.md"), '---\ntitle: New\nsuggested_universe: Math\nsnapshot_path: references/originals/new.txt\n---\nNew');
  assert.deepEqual((await listOriginalsDrive(vault)).files.find((item) => item.name === "new.txt").galaxies, ["galaxy:math"]);
  const folder = await updateOriginalsDrive(vault, { galaxy: "galaxy:math", action: "create", name: "New folder" });
  assert.ok((await listOriginalsDrive(vault)).folders.some((item) => item.id === folder.id));
  await fs.rm(path.join(vault, "references/originals/new.txt"));
  assert.equal((await listOriginalsDrive(vault)).files.length, before.files.length);
});

test("drive API requires authentication and downloads only actual originals", async (t) => {
  const vault = await fixture(t);
  const server = http.createServer(createDashboardApi({ dashboardRoot: vault, port: 0, requestContext: async () => ({ vault }) }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/v1/drive`)).status, 403);
  assert.equal((await fetch(`${base}/api/v1/drive`, { method: "POST", body: "{}" })).status, 403);
  assert.equal((await fetch(`${base}/api/v1/drive/downloads`, { method: "POST", body: "{}" })).status, 403);
  const { token } = await fetch(`${base}/api/v1/session`).then((res) => res.json());
  const headers = { "x-my-wiki-token": token };
  const list = await fetch(`${base}/api/v1/drive`, { headers }).then((res) => res.json());
  assert.equal(list.files.length, 4);
  const post = (route, body) => fetch(`${base}/api/v1/${route}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  const created = await post("drive", { action: "create", galaxy: "galaxy:math", name: "Books" }).then((res) => res.json());
  assert.equal((await post("universes/rename", { name: "Math", newName: "Mathematics" })).status, 200);
  const renamed = await fetch(`${base}/api/v1/drive`, { headers }).then((res) => res.json());
  assert.equal(renamed.folders.find((item) => item.id === created.id).galaxy, "galaxy:mathematics");
  assert.ok(!renamed.galaxies.some((item) => item.id === "galaxy:math"));
  assert.equal(renamed.files.length, 4);
  const download = await fetch(`${base}/api/v1/drive/download?path=references/originals/shared.html`, { headers });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal(await download.text(), "original: shared.html");
  const batch = await post("drive/downloads", { galaxy: "galaxy:ai", files: ["references/originals/shared.html", "references/originals/nested/shared.pdf"] });
  assert.equal(batch.status, 202);
  let job = await batch.json();
  for (let attempts = 0; attempts < 100 && ["queued", "running"].includes(job.status); attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    job = await fetch(`${base}/api/v1/jobs/${job.id}`, { headers }).then((res) => res.json());
  }
  assert.equal(job.status, "complete", JSON.stringify(job));
  assert.equal((await fetch(`${base}${job.downloadUrl}`)).status, 403);
  const archiveResponse = await fetch(`${base}${job.downloadUrl}`, { headers });
  assert.equal(archiveResponse.status, 200);
  const archive = await JSZip.loadAsync(await archiveResponse.arrayBuffer());
  assert.equal(await archive.file("shared.html").async("string"), "original: shared.html");
  assert.equal(await archive.file("shared.pdf").async("string"), "original: nested/shared.pdf");
  await assert.rejects(resolveDriveOriginal(vault, "references/originals/../../index.md"), { status: 400 });
  if (process.platform !== "win32") {
    await fs.symlink(path.join(vault, "references/sources/shared.md"), path.join(vault, "references/originals/escape.md"));
    assert.equal((await listOriginalsDrive(vault)).files.length, 4);
    await assert.rejects(resolveDriveOriginal(vault, "references/originals/escape.md"), { status: 404 });
  }
});

test("batch original downloads retain virtual paths, duplicate names and bytes without moving stored files", async (t) => {
  const vault = await fixture(t);
  const first = "references/originals/nested/shared.pdf";
  const second = "references/originals/shared.pdf";
  const contents = Buffer.alloc(256 * 1024, 123);
  await fs.writeFile(path.join(vault, second), contents);
  await fs.writeFile(path.join(vault, "references/sources/second.md"), `---\nsuggested_universe: AI\nsnapshot_path: ${second}\n---\nEvidence`);
  const folder = await updateOriginalsDrive(vault, { galaxy: "galaxy:ai", action: "create", name: "Books" });
  await updateOriginalsDrive(vault, { galaxy: "galaxy:ai", action: "move", files: [first, second], folders: [], parentId: folder.id });
  const output = path.join(vault, ".my-wiki/downloads/test.zip");
  const progress = [];
  const result = await exportDriveOriginals(vault, { galaxy: "galaxy:ai", files: [first, second, first] }, output, (value) => progress.push(value));
  const archive = await JSZip.loadAsync(await fs.readFile(output));
  assert.equal(result.count, 2);
  assert.equal(await archive.file("Books/shared.pdf").async("string"), "original: nested/shared.pdf");
  assert.deepEqual(await archive.file("Books/shared (2).pdf").async("nodebuffer"), contents);
  assert.equal(progress.at(-1).percent, 100);
  assert.deepEqual(await fs.readFile(path.join(vault, second)), contents);
  const another = path.join(vault, ".my-wiki/downloads/invalid.zip");
  await assert.rejects(exportDriveOriginals(vault, { galaxy: "galaxy:ai", files: [] }, another), { status: 400 });
  await assert.rejects(exportDriveOriginals(vault, { galaxy: "galaxy:ai", files: ["references/originals/pending.txt"] }, another), { status: 404 });
  await assert.rejects(exportDriveOriginals(vault, { galaxy: "galaxy:ai", files: ["references/originals/../../index.md"] }, another), { status: 404 });
  await assert.rejects(fs.access(another), { code: "ENOENT" });
});
