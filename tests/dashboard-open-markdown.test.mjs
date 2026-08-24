import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDashboardApi,
  dashboardAllowedOrigins,
  readMarkdownDocument,
  resolveMarkdownImageFile,
  resolveMarkdownVaultFile
} from "../scripts/core/dashboard-api.mjs";

async function request(port, method, route, { headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: "127.0.0.1", port, method, path: route, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => { chunks.push(chunk); });
      response.on("end", () => {
        const output = Buffer.concat(chunks);
        const contentType = response.headers["content-type"] || "";
        resolve({
          status: response.statusCode,
          body: contentType.includes("application/json") && output.length ? JSON.parse(output.toString("utf8")) : output,
          headers: response.headers
        });
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function createFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-wiki-markdown-"));
  const vault = path.join(root, "vault");
  const dashboard = path.join(root, "dashboard");
  const wikiFile = path.join(vault, "concepts", "note.md");
  const rawFile = path.join(vault, "references", "sources", "evidence.md");
  const imageFile = path.join(vault, "references", "assets", "capture", "image.png");
  await mkdir(path.dirname(wikiFile), { recursive: true });
  await mkdir(path.dirname(rawFile), { recursive: true });
  await mkdir(path.dirname(imageFile), { recursive: true });
  await mkdir(dashboard, { recursive: true });
  await writeFile(wikiFile, "---\ntitle: Note\nstatus: active\n---\n# Note\n\nOriginal body.\n", "utf8");
  await writeFile(rawFile, "# Evidence\n\n![Local](../assets/capture/image.png)\n", "utf8");
  await writeFile(imageFile, Buffer.from([137, 80, 78, 71]));
  await writeFile(path.join(dashboard, ".my-wiki-runtime.json"), `${JSON.stringify({ vault })}\n`, "utf8");
  context.after(async () => {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      const transientWindowsLock = process.platform === "win32" && ["ENOTEMPTY", "EBUSY", "EPERM"].includes(error?.code);
      if (!transientWindowsLock) throw error;
    }
  });
  return { vault, dashboard, wikiFile, rawFile, imageFile };
}

test("Markdown document access accepts vault Wiki and raw source notes only", async (context) => {
  const fixture = await createFixture(context);

  assert.equal(await resolveMarkdownVaultFile(fixture.vault, "concepts/note.md"), await realpath(fixture.wikiFile));
  assert.equal(await resolveMarkdownVaultFile(fixture.vault, "references/sources/evidence.md"), await realpath(fixture.rawFile));
  await assert.rejects(resolveMarkdownVaultFile(fixture.vault, "references/originals/secret.md"), /Only Concept and Reference Markdown/);
  await assert.rejects(resolveMarkdownVaultFile(fixture.vault, "../note.md"), /Only Concept and Reference Markdown/);

  const document = await readMarkdownDocument(fixture.vault, "concepts/note.md");
  assert.equal(document.title, "Note");
  assert.equal(document.body, "# Note\n\nOriginal body.\n");
  assert.match(document.version, /^[a-f0-9]{64}$/);
});

test("Markdown API reads and saves the body while preserving frontmatter and rejecting stale writes", async (context) => {
  const fixture = await createFixture(context);
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };

  const opened = await request(port, "GET", "/api/v1/markdown?path=concepts%2Fnote.md", { headers: auth });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.body, "# Note\n\nOriginal body.\n");

  const update = JSON.stringify({
    path: "concepts/note.md",
    body: "# Note\n\nUpdated body.",
    expectedVersion: opened.body.version
  });
  const saved = await request(port, "PUT", "/api/v1/markdown", {
    headers: {
      ...auth,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(update)
    },
    body: update
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.body, "# Note\n\nUpdated body.\n");
  assert.notEqual(saved.body.version, opened.body.version);
  assert.equal(
    await readFile(fixture.wikiFile, "utf8"),
    "---\ntitle: Note\nstatus: active\n---\n# Note\n\nUpdated body.\n"
  );

  const stale = await request(port, "PUT", "/api/v1/markdown", {
    headers: {
      ...auth,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(update)
    },
    body: update
  });
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /changed after it was opened/);
});

test("Maintenance queue items can be deleted with their unshared snapshot and owned assets", async (context) => {
  const fixture = await createFixture(context);
  const snapshotFile = path.join(fixture.vault, "references", "originals", "evidence.pdf");
  const ownedAssetFile = path.join(fixture.vault, "references", "assets", "evidence", "page.png");
  await mkdir(path.dirname(snapshotFile), { recursive: true });
  await mkdir(path.dirname(ownedAssetFile), { recursive: true });
  await writeFile(snapshotFile, Buffer.from("snapshot"));
  await writeFile(ownedAssetFile, Buffer.from("asset"));
  await writeFile(fixture.rawFile, "---\ntitle: Evidence\ntype: Reference\nstatus: stable\nworkflow_status: inbox\nsnapshot_path: references/originals/evidence.pdf\n---\n# Evidence\n\nDuplicate upload.\n", "utf8");

  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };

  const deleted = await request(port, "DELETE", "/api/v1/inbox/item?path=references%2Fsources%2Fevidence.md", { headers: auth });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.deepEqual(deleted.body.removedArtifacts.sort(), ["references/assets/evidence", "references/originals/evidence.pdf"]);
  await assert.rejects(readFile(fixture.rawFile), { code: "ENOENT" });
  await assert.rejects(readFile(snapshotFile), { code: "ENOENT" });
  await assert.rejects(readFile(ownedAssetFile), { code: "ENOENT" });
});

test("Maintenance queue deletion protects raw notes referenced by other knowledge", async (context) => {
  const fixture = await createFixture(context);
  await writeFile(fixture.rawFile, "---\ntitle: Evidence\ntype: Reference\nstatus: stable\nworkflow_status: inbox\n---\n# Evidence\n\nPending evidence.\n", "utf8");
  await writeFile(fixture.wikiFile, "---\ntitle: Note\nstatus: active\n---\n# Note\n\n[[Evidence]]\n", "utf8");

  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };

  const blocked = await request(port, "DELETE", "/api/v1/inbox/item?path=references%2Fsources%2Fevidence.md", { headers: auth });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /referenced by other knowledge/);
  assert.match(await readFile(fixture.rawFile, "utf8"), /Pending evidence/);
});

test("Maintenance queue batch deletion removes eligible items and reports protected items", async (context) => {
  const fixture = await createFixture(context);
  const disposableFile = path.join(fixture.vault, "references", "sources", "disposable.md");
  await writeFile(fixture.rawFile, "---\ntitle: Evidence\ntype: Reference\nstatus: stable\nworkflow_status: inbox\n---\n# Evidence\n\nReferenced evidence.\n", "utf8");
  await writeFile(disposableFile, "---\ntitle: Disposable\ntype: Reference\nstatus: stable\nworkflow_status: inbox\n---\n# Disposable\n\nDuplicate upload.\n", "utf8");
  await writeFile(fixture.wikiFile, "---\ntitle: Note\nstatus: active\n---\n# Note\n\n[[Evidence]]\n", "utf8");

  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({ paths: ["references/sources/evidence.md", "references/sources/disposable.md"] });

  const result = await request(port, "DELETE", "/api/v1/inbox/items", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.count, 1);
  assert.deepEqual(result.body.deleted.map((item) => item.path), ["references/sources/disposable.md"]);
  assert.deepEqual(result.body.failed.map((item) => item.path), ["references/sources/evidence.md"]);
  await assert.rejects(readFile(disposableFile), { code: "ENOENT" });
  assert.match(await readFile(fixture.rawFile, "utf8"), /Referenced evidence/);
});

test("Markdown images resolve relative to the note but stay inside references/assets", async (context) => {
  const fixture = await createFixture(context);

  assert.equal(
    await resolveMarkdownImageFile(fixture.vault, "references/sources/evidence.md", "../assets/capture/image.png"),
    await realpath(fixture.imageFile)
  );
  assert.equal(
    await resolveMarkdownImageFile(fixture.vault, "concepts/note.md", "/references/assets/capture/image.png"),
    await realpath(fixture.imageFile)
  );
  await assert.rejects(
    resolveMarkdownImageFile(fixture.vault, "references/sources/evidence.md", "../../concepts/note.md"),
    /Only local vault images/
  );
  await assert.rejects(
    resolveMarkdownImageFile(fixture.vault, "references/sources/evidence.md", "https://example.com/image.png"),
    /Only local Markdown images/
  );
});

test("Markdown image API serves validated local image bytes", async (context) => {
  const fixture = await createFixture(context);
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const route = `/api/v1/markdown-image?note=${encodeURIComponent("references/sources/evidence.md")}&src=${encodeURIComponent("../assets/capture/image.png")}&token=${session.body.token}`;
  const response = await request(port, "GET", route);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "image/png");
  assert.deepEqual(response.body, Buffer.from([137, 80, 78, 71]));
});

test("Markdown image API stores validated pasted images in managed editor assets", async (context) => {
  const fixture = await createFixture(context);
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const uploaded = await request(
    port,
    "POST",
    "/api/v1/markdown-image?note=concepts%2Fnote.md&filename=Diagram.png",
    {
      headers: { ...auth, "content-type": "image/png", "content-length": png.length },
      body: png
    }
  );

  assert.equal(uploaded.status, 201);
  assert.match(uploaded.body.path, /^references\/assets\/editor\/note-[a-f0-9]{8}\/diagram-[a-f0-9]{8}\.png$/);
  assert.match(uploaded.body.source, /^\.\.\/references\/assets\/editor\//);
  assert.deepEqual(await readFile(path.join(fixture.vault, uploaded.body.path)), png);

  const invalid = await request(
    port,
    "POST",
    "/api/v1/markdown-image?note=concepts%2Fnote.md&filename=not-an-image.png",
    {
      headers: { ...auth, "content-type": "image/png", "content-length": 4 },
      body: Buffer.from("nope")
    }
  );
  assert.equal(invalid.status, 415);
});

test("Dashboard origins remain local by default and allow explicit public origins", async (context) => {
  const fixture = await createFixture(context);
  const allowedOrigins = dashboardAllowedOrigins(5173, "https://my-wiki.cloud, https://www.my-wiki.cloud/");
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 5173,
    allowedOrigins,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const publicSession = await request(port, "GET", "/api/v1/session", {
    headers: { origin: "https://my-wiki.cloud" }
  });
  assert.equal(publicSession.status, 200);
  assert.equal(typeof publicSession.body.token, "string");

  const evilSession = await request(port, "GET", "/api/v1/session", {
    headers: { origin: "https://example.com" }
  });
  assert.equal(evilSession.status, 403);
  assert.match(evilSession.body.error, /origin is not allowed/);

  assert.equal(allowedOrigins.has("http://127.0.0.1:5173"), true);
  assert.equal(allowedOrigins.has("https://www.my-wiki.cloud"), true);
});

test("Dashboard exposes the bundled smooth QoderWork pet manifest", async (context) => {
  const fixture = await createFixture(context);
  const petRoot = path.join(fixture.dashboard, "pets", "qoderwork--my-wiki");
  await mkdir(petRoot, { recursive: true });
  await writeFile(path.join(petRoot, "pet.json"), `${JSON.stringify({
    id: "qoderwork--my-wiki",
    displayName: "QoderWork",
    spritesheetPath: "spritesheet.png",
    spriteVersionNumber: 2,
    imageRendering: "smooth",
    displayScale: 1.5
  })}\n`, "utf8");
  await writeFile(path.join(petRoot, "spritesheet.png"), Buffer.from([137, 80, 78, 71]));

  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const pets = await request(port, "GET", "/api/v1/pets", { headers: auth });

  assert.equal(pets.status, 200);
  assert.deepEqual(pets.body.pets, [{
    id: "qoderwork--my-wiki",
    displayName: "QoderWork",
    spriteVersionNumber: 2,
    columns: 8,
    rows: 11,
    cellWidth: 192,
    cellHeight: 208,
    imageRendering: "smooth",
    displayScale: 1.5,
    spritesheetUrl: "/api/v1/pets/qoderwork--my-wiki/spritesheet"
  }]);
});

test("Dashboard can declare an empty knowledge galaxy without creating Wiki pages", async (context) => {
  const fixture = await createFixture(context);
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({ name: "数学" });

  const created = await request(port, "POST", "/api/v1/universes", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });
  assert.equal(created.status, 201);
  assert.deepEqual({ name: created.body.name, wiki: created.body.wiki, raw: created.body.raw, created: created.body.created }, {
    name: "数学",
    wiki: 0,
    raw: 0,
    created: true
  });

  const universes = await request(port, "GET", "/api/v1/universes", { headers: auth });
  assert.deepEqual(universes.body.universes.find((item) => item.name === "数学"), {
    name: "数学",
    wiki: 0,
    raw: 0,
    declared: true,
    hidden: false
  });
  const registry = JSON.parse(await readFile(path.join(fixture.vault, ".my-wiki", "galaxies.json"), "utf8"));
  assert.deepEqual(registry.galaxies, ["数学"]);
});

test("File uploads enter the Inbox queue before extraction completes", async (context) => {
  const fixture = await createFixture(context);
  let finishExtraction;
  const extractionGate = new Promise((resolve) => { finishExtraction = resolve; });
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) },
    localFileIngestor: async (input) => {
      await input.onSnapshot({ relative: "references/originals/queued.pdf" });
      input.onProgress({ phase: "ocr", current: 12, total: 40, percent: 30, message: "Recognized page 12 of 40." });
      await extractionGate;
      return { kind: "file", count: 1, items: [{ status: "inbox", path: "references/sources/queued.md" }] };
    }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const uploaded = Buffer.from("%PDF-queued");

  const queued = await request(port, "POST", "/api/v1/inbox/file?filename=queued.pdf&title=Queued%20PDF", {
    headers: {
      ...auth,
      "content-type": "application/pdf",
      "content-length": uploaded.length
    },
    body: uploaded
  });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.type, "capture-file");
  assert.match(queued.body.status, /queued|running/);
  const receiptFile = path.join(fixture.vault, ".my-wiki", "capture-jobs", `${queued.body.id}.json`);
  const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  assert.equal(receipt.title, "Queued PDF");
  assert.match(receipt.temporary, /^\.my-wiki\/uploads\//);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await request(port, "GET", "/api/v1/inbox", { headers: auth });
    if (current.body.items.some((item) => item.jobId === queued.body.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const inbox = await request(port, "GET", "/api/v1/inbox", { headers: auth });
  const queueItem = inbox.body.items.find((item) => item.jobId === queued.body.id);
  assert.equal(queueItem.title, "Queued PDF");
  assert.equal(queueItem.status, "processing");
  assert.match(queueItem.jobStatus, /queued|running/);
  assert.deepEqual(queueItem.progress, {
    phase: "ocr",
    current: 12,
    total: 40,
    percent: 30,
    message: "Recognized page 12 of 40."
  });

  finishExtraction();
  let completed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(completed.body.status, "complete");
  await assert.rejects(readFile(receiptFile, "utf8"), /ENOENT/);
});

test("queued uploads are visible before an extraction slot preserves their snapshot", async (context) => {
  const fixture = await createFixture(context);
  let releaseExtraction;
  const extractionGate = new Promise((resolve) => { releaseExtraction = resolve; });
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) },
    localFileIngestor: async (input) => {
      await extractionGate;
      await input.onSnapshot({ relative: `references/originals/${input.filename}` });
      return { kind: "file", count: 1, items: [{ status: "inbox", path: `references/sources/${input.filename}.md` }] };
    }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };

  const queued = [];
  for (const filename of ["first.md", "second.md", "third.md"]) {
    const body = Buffer.from(`# ${filename}`);
    queued.push(await request(port, "POST", `/api/v1/inbox/file?filename=${filename}`, {
      headers: { ...auth, "content-type": "text/markdown", "content-length": body.length },
      body
    }));
  }
  const captures = await request(port, "GET", "/api/v1/capture-jobs", { headers: auth });
  const third = captures.body.items.find((item) => item.jobId === queued[2].body.id);
  assert.equal(third.jobStatus, "queued");
  assert.equal(third.snapshotPath, "");
  assert.match(third.preview, /Waiting for a local extraction slot/);

  releaseExtraction();
  for (const item of queued) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await request(port, "GET", `/api/v1/jobs/${item.body.id}`, { headers: auth });
      if (current.body.status === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
});

test("Dashboard recovers a persisted capture job after a service restart", async (context) => {
  const fixture = await createFixture(context);
  const jobId = "11111111-1111-4111-8111-111111111111";
  const uploadFile = path.join(fixture.vault, ".my-wiki", "uploads", `${jobId}-recovered.pdf`);
  const snapshotFile = path.join(fixture.vault, "references", "originals", "2026-08-12--recovered.pdf");
  const receiptFile = path.join(fixture.vault, ".my-wiki", "capture-jobs", `${jobId}.json`);
  await mkdir(path.dirname(uploadFile), { recursive: true });
  await mkdir(path.dirname(snapshotFile), { recursive: true });
  await mkdir(path.dirname(receiptFile), { recursive: true });
  await writeFile(uploadFile, Buffer.from("%PDF-recovered"));
  await writeFile(snapshotFile, Buffer.from("%PDF-recovered"));
  await writeFile(receiptFile, `${JSON.stringify({
    version: 1,
    id: jobId,
    createdAt: "2026-08-12T08:03:51.000Z",
    filename: "recovered.pdf",
    title: "Recovered PDF",
    collection: "",
    suggestedUniverse: "数学",
    sourcePath: "",
    temporary: `.my-wiki/uploads/${jobId}-recovered.pdf`,
    snapshotReference: "references/originals/2026-08-12--recovered.pdf"
  }, null, 2)}\n`, "utf8");

  let finishExtraction;
  let receivedInput;
  const extractionGate = new Promise((resolve) => { finishExtraction = resolve; });
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) },
    localFileIngestor: async (input) => {
      receivedInput = input;
      await input.onSnapshot({ relative: input.snapshotReference });
      await extractionGate;
      return { kind: "file", count: 1, items: [{ status: "inbox", path: "references/sources/recovered.md" }] };
    }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };

  const inbox = await request(port, "GET", "/api/v1/inbox", { headers: auth });
  const recovered = inbox.body.items.find((item) => item.jobId === jobId);
  assert.equal(recovered.title, "Recovered PDF");
  assert.match(recovered.jobStatus, /queued|running/);
  for (let attempt = 0; attempt < 20 && !receivedInput; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(receivedInput.snapshotReference, "references/originals/2026-08-12--recovered.pdf");

  finishExtraction();
  let completed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${jobId}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(completed.body.status, "complete");
  await assert.rejects(readFile(receiptFile, "utf8"), /ENOENT/);
  await assert.rejects(readFile(uploadFile), /ENOENT/);
});

test("Chunked uploads assemble the original bytes before entering the Inbox queue", async (context) => {
  const fixture = await createFixture(context);
  let received = null;
  let receivedInput = null;
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) },
    localFileIngestor: async (input) => {
      receivedInput = input;
      const { file } = input;
      received = await readFile(file);
      return { kind: "zip", count: 1, items: [{ status: "inbox", path: "references/sources/chunked.md" }] };
    }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const uploaded = Buffer.from("chunk-one::chunk-two::chunk-three");
  const metadata = JSON.stringify({
    filename: "notes.zip",
    title: "Chunked notes",
    suggestedUniverse: "数学",
    size: uploaded.length
  });

  const created = await request(port, "POST", "/api/v1/inbox/file/uploads", {
    headers: {
      ...auth,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(metadata)
    },
    body: metadata
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.offset, 0);
  assert.equal(created.body.chunkSize, 512 * 1024);

  const split = 12;
  const first = uploaded.subarray(0, split);
  const firstChunk = await request(port, "PATCH", `/api/v1/inbox/file/uploads/${created.body.id}?offset=0`, {
    headers: { ...auth, "content-type": "application/octet-stream", "content-length": first.length },
    body: first
  });
  assert.equal(firstChunk.status, 200);
  assert.equal(firstChunk.body.offset, split);

  const wrongOffset = await request(port, "PATCH", `/api/v1/inbox/file/uploads/${created.body.id}?offset=0`, {
    headers: { ...auth, "content-type": "application/octet-stream", "content-length": 1 },
    body: Buffer.from("x")
  });
  assert.equal(wrongOffset.status, 409);

  const remainder = uploaded.subarray(split);
  const finalChunk = await request(port, "PATCH", `/api/v1/inbox/file/uploads/${created.body.id}?offset=${split}`, {
    headers: { ...auth, "content-type": "application/octet-stream", "content-length": remainder.length },
    body: remainder
  });
  assert.equal(finalChunk.status, 200);
  assert.equal(finalChunk.body.complete, true);

  const queued = await request(port, "POST", `/api/v1/inbox/file/uploads/${created.body.id}/complete`, {
    headers: auth
  });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.type, "capture-file");

  let completed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(completed.body.status, "complete");
  assert.deepEqual(received, uploaded);
  assert.equal(receivedInput.suggestedUniverse, "数学");
});

test("Chunked knowledge package uploads bypass single-request proxy limits", async (context) => {
  const fixture = await createFixture(context);
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const payload = Buffer.alloc(700_000, 0x61);
  const createBody = JSON.stringify({ filename: "large.mywiki", as: "Imported", size: payload.length });

  const created = await request(port, "POST", "/api/v1/universe-imports/uploads", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(createBody) },
    body: createBody
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.chunkSize < payload.length);

  let offset = 0;
  while (offset < payload.length) {
    const end = Math.min(payload.length, offset + created.body.chunkSize);
    const chunk = payload.subarray(offset, end);
    const patched = await request(port, "PATCH", `/api/v1/universe-imports/uploads/${created.body.id}?offset=${offset}`, {
      headers: { ...auth, "content-type": "application/octet-stream", "content-length": chunk.length },
      body: chunk
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.offset, end);
    offset = end;
  }

  const completed = await request(port, "POST", `/api/v1/universe-imports/uploads/${created.body.id}/complete`, { headers: auth });
  assert.equal(completed.status, 202);
  assert.equal(completed.body.type, "import-preview");

  let terminal = completed;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    terminal = await request(port, "GET", `/api/v1/jobs/${completed.body.id}`, { headers: auth });
    if (["complete", "failed"].includes(terminal.body.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(terminal.body.status, "failed");
  assert.doesNotMatch(terminal.body.error, /ENOENT/);
});

test("Maintenance uses a total timeout without an idle timeout", async (context) => {
  const fixture = await createFixture(context);
  const sourceFile = path.join(fixture.vault, "references", "sources", "maintenance-source.md");
  await writeFile(sourceFile, `---
title: Maintenance Source
status: inbox
type: raw-source
source_type: webpage
capture_method: dashboard-url
captured: 2026-07-31T00:00:00.000Z
---
# Maintenance Source

## Capture

This source contains substantive readable evidence for a maintenance timeout test.
`, "utf8");
  let runOptions;
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "opencode",
      label: "OpenCode",
      defaultProvider: "opencode",
      providers: [{ provider: "opencode", label: "OpenCode" }],
      message: ""
    }),
    run: async (options) => {
      runOptions = options;
      return {
        summary: "No changes needed",
        processed: [],
        createdWiki: [],
        updatedWiki: [],
        remainingNotes: "Source remains in Inbox"
      };
    }
  };
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const missingProviderBody = JSON.stringify({
    paths: ["references/sources/maintenance-source.md"],
    batchSize: 1
  });
  const missingProvider = await request(port, "POST", "/api/v1/agent/maintenance", {
    headers: {
      ...auth,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(missingProviderBody)
    },
    body: missingProviderBody
  });
  assert.equal(missingProvider.status, 400);
  assert.match(missingProvider.body.error, /provider is required/i);
  const body = JSON.stringify({
    paths: ["references/sources/maintenance-source.md"],
    batchSize: 1,
    provider: "opencode"
  });
  const queued = await request(port, "POST", "/api/v1/agent/maintenance", {
    headers: {
      ...auth,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body)
    },
    body
  });
  assert.equal(queued.status, 202);

  let completed;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(completed.body.status, "complete");
  assert.equal(runOptions.timeoutMs, 20 * 60 * 1000);
  assert.equal(runOptions.idleTimeoutMs, 0);
  assert.match(runOptions.prompt, /no installed Agent Skill is required/);
  assert.doesNotMatch(runOptions.prompt, /Follow the installed My Wiki Skill/);
});

test("mixed Raw maintenance runs independently with a shared concurrency limit of two", async (context) => {
  const fixture = await createFixture(context);
  const sources = [
    { name: "distill-a", status: "inbox", reasons: [] },
    { name: "repair-b", status: "needs-followup", reasons: ["manual-review:ambiguous-evidence"] },
    { name: "distill-c", status: "inbox", reasons: [] }
  ];
  for (const source of sources) {
    await writeFile(path.join(fixture.vault, "references", "sources", `${source.name}.md`), [
      "---",
      `title: ${source.name}`,
      "type: raw-source",
      `status: ${source.status}`,
      `needs_followup: ${source.status === "needs-followup"}`,
      source.reasons.length ? `followup_reasons:\n  - "${source.reasons[0]}"` : "followup_reasons: []",
      "source_type: webpage",
      "capture_method: dashboard-url",
      "captured: 2026-08-14T00:00:00.000Z",
      "---",
      `# ${source.name}`,
      "",
      "## Capture",
      "",
      `Substantive evidence for ${source.name}.`,
      ""
    ].join("\n"), "utf8");
  }

  const releases = [];
  let running = 0;
  let peak = 0;
  const started = [];
  let captureStarted = false;
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "opencode",
      label: "OpenCode",
      defaultProvider: "opencode",
      providers: [
        { provider: "opencode", label: "OpenCode", models: [{ id: "distill-model", label: "Distill model" }] },
        { provider: "codex", label: "Codex", models: [{ id: "repair-model", label: "Repair model" }] }
      ],
      message: ""
    }),
    run: async (options) => {
      running += 1;
      peak = Math.max(peak, running);
      started.push({ mode: options.mode, provider: options.provider, model: options.model });
      await new Promise((resolve) => releases.push(resolve));
      running -= 1;
      return options.mode === "repair"
        ? { summary: "Still needs review", repairedIssues: [], remainingIssues: ["manual review"] }
        : { summary: "Left in inbox", processed: [], createdWiki: [], updatedWiki: [], remainingNotes: "pending" };
    }
  };
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner,
    localFileIngestor: async (input) => {
      captureStarted = true;
      await input.onSnapshot({ relative: "references/originals/independent.md" });
      return { kind: "file", count: 1, items: [{ status: "inbox", path: "references/sources/independent.md" }] };
    }
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({
    paths: sources.map((source) => `references/sources/${source.name}.md`),
    batchSize: 3,
    distillProvider: "opencode",
    distillModel: "distill-model",
    repairProvider: "codex",
    repairModel: "repair-model"
  });
  const queued = await request(port, "POST", "/api/v1/agent/maintenance-batch", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.jobs.length, 3);

  for (let attempt = 0; attempt < 30 && started.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started.length, 2);
  assert.equal(peak, 2);
  assert.deepEqual(started.find((item) => item.mode === "maintenance"), { mode: "maintenance", provider: "opencode", model: "distill-model" });
  assert.deepEqual(started.find((item) => item.mode === "repair"), { mode: "repair", provider: "codex", model: "repair-model" });
  const agent = await request(port, "GET", "/api/v1/agent", { headers: auth });
  assert.equal(agent.body.rawTaskLimit, 2);
  assert.equal(agent.body.agentTaskLimit, 2);
  assert.equal(agent.body.extractionTaskLimit, 2);
  assert.equal(agent.body.activeRawJobs.length, 3);

  const upload = Buffer.from("# Independent extraction");
  const captured = await request(port, "POST", "/api/v1/inbox/file?filename=independent.md", {
    headers: { ...auth, "content-type": "text/markdown", "content-length": upload.length },
    body: upload
  });
  let captureJob;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    captureJob = await request(port, "GET", `/api/v1/jobs/${captured.body.id}`, { headers: auth });
    if (captureJob.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(captureStarted, true);
  assert.equal(captureJob.body.status, "complete");
  assert.equal(started.length, 2);

  const duplicateBody = JSON.stringify({ path: "references/sources/repair-b.md", provider: "opencode" });
  const duplicate = await request(port, "POST", "/api/v1/agent/repair", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(duplicateBody) },
    body: duplicateBody
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /active task/);

  releases.shift()();
  for (let attempt = 0; attempt < 100 && started.length < 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started.length, 3);
  assert.equal(peak, 2);
  while (releases.length) releases.shift()();
});

test("Maintenance normalizes escaped Wiki metadata and rejects residual malformed frontmatter", async (context) => {
  const fixture = await createFixture(context);
  const sourceFile = path.join(fixture.vault, "references", "sources", "metadata-gate-source.md");
  const normalizedWikiFile = path.join(fixture.vault, "concepts", "normalized-topic.md");
  const rejectedWikiFile = path.join(fixture.vault, "concepts", "rejected-topic.md");
  await writeFile(sourceFile, [
    "---",
    "title: Metadata Gate Source",
    "type: Reference",
    "status: stable",
    "workflow_status: inbox",
    "source_type: webpage",
    "capture_method: dashboard-url",
    "captured: 2026-08-12T00:00:00.000Z",
    "---",
    "# Metadata Gate Source",
    "",
    "## Capture",
    "",
    "This source contains substantive readable evidence for metadata postflight testing.",
    ""
  ].join("\n"), "utf8");
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "opencode",
      label: "OpenCode",
      defaultProvider: "opencode",
      providers: [{ provider: "opencode", label: "OpenCode" }],
      message: ""
    }),
    run: async () => {
      const raw = await readFile(sourceFile, "utf8");
      await writeFile(sourceFile, raw.replace("workflow_status: inbox", "workflow_status: processed"), "utf8");
      await writeFile(normalizedWikiFile, [
        "---",
        "title: \\\"Calculus\\\"",
        "type: concept",
        "status: active",
        "universes:",
        "  - \\\"数学\\\"",
        "sources:",
        "  - \\\"[[references/sources/metadata-gate-source]]\\\"",
        "---",
        "# Calculus",
        ""
      ].join("\n"), "utf8");
      await writeFile(rejectedWikiFile, [
        "---",
        "title: \\\\Rejected",
        "type: concept",
        "status: active",
        "universes:",
        "  - \"数学\"",
        "---",
        "# Rejected",
        ""
      ].join("\n"), "utf8");
      return {
        summary: "Created Wiki pages.",
        processed: ["references/sources/metadata-gate-source.md"],
        createdWiki: ["concepts/normalized-topic.md", "concepts/rejected-topic.md"],
        updatedWiki: [],
        remainingNotes: ""
      };
    }
  };
  const server = http.createServer(createDashboardApi({ dashboardRoot: fixture.dashboard, port: 0, agentRunner }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({ paths: ["references/sources/metadata-gate-source.md"], batchSize: 1, provider: "opencode" });
  const queued = await request(port, "POST", "/api/v1/agent/maintenance", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });

  let completed;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    completed = await request(port, "GET", "/api/v1/jobs/" + queued.body.id, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(completed.body.status, "complete");
  assert.equal(completed.body.result.postflightPassed, false);
  assert.deepEqual(completed.body.result.processed, []);
  assert.deepEqual(completed.body.result.createdWiki, []);
  assert.equal(completed.body.result.frontmatterMetadataIssues.length, 1);
  assert.equal(completed.body.result.frontmatterMetadataIssues[0].reason, "boundary-backslash");
  assert.match(completed.body.result.summary, /postflight rejected malformed Wiki frontmatter/);
  assert.match(await readFile(sourceFile, "utf8"), /^workflow_status: "inbox"$|^workflow_status: inbox$/m);

  const normalized = await readFile(normalizedWikiFile, "utf8");
  assert.match(normalized, /^title: "Calculus"$/m);
  assert.match(normalized, /^  - "数学"$/m);
  assert.match(normalized, /^  - "\[\[references\/sources\/metadata-gate-source\]\]"$/m);
  assert.doesNotMatch(normalized, /\\"/);
});

test("Repair Agent fixes a needs-followup Raw and unlocks it only after formula revalidation", async (context) => {
  const fixture = await createFixture(context);
  const sourceFile = path.join(fixture.vault, "references", "sources", "formula-repair.md");
  const snapshotFile = path.join(fixture.vault, "references", "originals", "formula-repair.pdf");
  await mkdir(path.dirname(snapshotFile), { recursive: true });
  await writeFile(snapshotFile, Buffer.from("preserved-pdf"));
  await writeFile(sourceFile, `---
title: Formula Repair
type: raw-source
source_type: pdf
status: needs-followup
needs_followup: true
followup_reasons:
  - "formula-strict-warning:pages=4"
  - "encoding:unicode-replacement-character:count=1:pages=4"
extraction_status: complete
extraction_method: mineru
extracted_characters: 240
extraction_formula_risk_pages: "4"
extraction_formula_strict_warning_pages: "4"
extraction_formula_strict_warning_count: 1
capture_method: dashboard-upload
snapshot_path: references/originals/formula-repair.pdf
tags:
  - raw
  - needs-followup
---

# Formula Repair

## Capture

This page contains a substantive matrix exa�mple whose OCR layout must be repaired before maintenance.

### Page 4

$$
\\begin{array}{c c} 1 & 2 & 3 \\end{array}
$$

## Processing Notes

- Status: needs-followup
- Follow-up reasons: formula-strict-warning:pages=4
`, "utf8");

  let runOptions;
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "opencode",
      label: "OpenCode",
      defaultProvider: "opencode",
      providers: [{ provider: "opencode", label: "OpenCode" }],
      message: ""
    }),
    run: async (options) => {
      runOptions = options;
      const current = await readFile(sourceFile, "utf8");
      await writeFile(sourceFile, current
        .replace("\\begin{array}{c c}", "\\begin{array}{c c c}")
        .replace("exa�mple", "example"), "utf8");
      return {
        summary: "Corrected the matrix column declaration.",
        repairedIssues: ["Page 4 array column count"],
        remainingIssues: []
      };
    }
  };
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    formulaDependencyRoot: path.resolve("assets", "dashboard"),
    port: 0,
    agentRunner
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({ path: "references/sources/formula-repair.md", provider: "opencode" });
  const queued = await request(port, "POST", "/api/v1/agent/repair", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.type, "agent-repair");

  let completed;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(completed.body.status, "complete");
  assert.equal(completed.body.status, "complete", JSON.stringify(completed.body));
  assert.equal(completed.body.result.unlocked, true, JSON.stringify(completed.body.result));
  assert.equal(completed.body.result.status, "inbox");
  assert.deepEqual(completed.body.result.remainingReasons, []);
  assert.equal(runOptions.mode, "repair");
  assert.equal(runOptions.idleTimeoutMs, 0);
  assert.match(runOptions.prompt, /strict-warning/);
  assert.match(runOptions.prompt, /Too few columns/);
  assert.match(runOptions.prompt, /Structured evidence-gate context/);
  assert.match(runOptions.prompt, /Edit only references\/sources\/formula-repair\.md/);

  const repaired = await readFile(sourceFile, "utf8");
  assert.match(repaired, /^workflow_status: "?inbox"?$/m);
  assert.match(repaired, /^needs_followup: false$/m);
  assert.match(repaired, /^followup_reasons: \[\]$/m);
  assert.match(repaired, /^extraction_formula_strict_warning_pages:\s*$/m);
  assert.match(repaired, /^extraction_formula_strict_warning_count: 0$/m);
  assert.match(repaired, /^extraction_unicode_replacement_pages:\s*$/m);
  assert.match(repaired, /^extraction_unicode_replacement_count: 0$/m);
  assert.match(repaired, /- Encoding gate: passed \(0 U\+FFFD characters\)/);
  assert.match(repaired, /- Repair gate: passed and unlocked for maintenance/);
});

test("Repair re-extracts missing PDF visual evidence with the selected CLI before invoking the text Agent", async (context) => {
  const fixture = await createFixture(context);
  const sourceFile = path.join(fixture.vault, "references", "sources", "visual-repair.md");
  const snapshotFile = path.join(fixture.vault, "references", "originals", "visual-repair.pdf");
  await mkdir(path.dirname(snapshotFile), { recursive: true });
  await writeFile(snapshotFile, Buffer.from("preserved-pdf"));
  await writeFile(sourceFile, `---
title: Visual Repair
type: raw-source
source_type: pdf
status: needs-followup
needs_followup: true
followup_reasons:
  - "extraction:low-quality"
extraction_status: low-quality
extraction_method: mineru
extracted_characters: 240
extraction_low_quality_pages: "13,15"
extraction_missing_visual_pages: "13,15"
capture_method: dashboard-upload
snapshot_path: references/originals/visual-repair.pdf
tags:
  - raw
  - needs-followup
---

# Visual Repair

## Capture

The main body contains substantial readable evidence; only two figure-only pages were omitted by the parser and require page-level visual preservation.

### Page 13

13

### Page 15

15
`, "utf8");

  let reextractOptions;
  let agentCalls = 0;
  const sourceReextractor = async (options) => {
    reextractOptions = options;
    const current = await readFile(sourceFile, "utf8");
    await writeFile(sourceFile, current
      .replace("status: needs-followup", "status: inbox")
      .replace("needs_followup: true", "needs_followup: false")
      .replace(/followup_reasons:\n  - \"extraction:low-quality\"/, "followup_reasons:")
      .replace("extraction_status: low-quality", "extraction_status: complete")
      .replace("extraction_low_quality_pages: \"13,15\"", "extraction_low_quality_pages: \"\"")
      .replace("extraction_missing_visual_pages: \"13,15\"", "extraction_missing_visual_pages: \"\"\nextraction_rendered_visual_pages: \"13,15\""), "utf8");
    return { count: 1, results: [{ path: "references/sources/visual-repair.md", status: "inbox" }] };
  };
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "codex",
      label: "Codex",
      providers: [{ provider: "codex", label: "Codex", models: [{ id: "vision-model", label: "Vision model" }] }]
    }),
    run: async () => { agentCalls += 1; return {}; }
  };
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    formulaDependencyRoot: path.resolve("assets", "dashboard"),
    sourceReextractor,
    port: 0,
    agentRunner
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({ path: "references/sources/visual-repair.md", provider: "codex", model: "vision-model" });
  const queued = await request(port, "POST", "/api/v1/agent/repair", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  let completed;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(completed.body.status, "complete", JSON.stringify(completed.body));
  assert.equal(completed.body.result.unlocked, true, JSON.stringify(completed.body.result));
  assert.equal(agentCalls, 0);
  assert.equal(reextractOptions.environment.MY_WIKI_VISUAL_REPAIR_PROVIDER, "codex");
  assert.equal(reextractOptions.environment.MY_WIKI_VISUAL_REPAIR_MODEL, "vision-model");
  assert.match(completed.body.result.repairedIssues.join(" "), /13, 15/);
});

test("Repair revalidation clears stale managed reasons without invoking an Agent", async (context) => {
  const fixture = await createFixture(context);
  const sourceFile = path.join(fixture.vault, "references", "sources", "stale-repair.md");
  const snapshotFile = path.join(fixture.vault, "references", "originals", "stale-repair.pdf");
  await mkdir(path.dirname(snapshotFile), { recursive: true });
  await writeFile(snapshotFile, Buffer.from("preserved-pdf"));
  await writeFile(sourceFile, `---
title: Stale Repair
type: raw-source
source_type: pdf
status: needs-followup
needs_followup: true
followup_reasons:
  - "formula-strict-warning:pages=4"
  - "missing-attachment:images/no-longer-referenced.jpg"
extraction_status: complete
extraction_method: mineru
extracted_characters: 240
extraction_formula_risk_pages: "4"
capture_method: dashboard-upload
snapshot_path: references/originals/stale-repair.pdf
tags:
  - raw
  - needs-followup
---

# Stale Repair

## Capture

### Page 4

The current extracted evidence is readable and its formula $a^2+b^2=c^2$ is valid.
`, "utf8");

  let agentRuns = 0;
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "opencode",
      label: "OpenCode",
      defaultProvider: "opencode",
      providers: [{ provider: "opencode", label: "OpenCode" }],
      message: ""
    }),
    run: async () => {
      agentRuns += 1;
      throw new Error("The Agent should not run for stale managed reasons");
    }
  };
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    formulaDependencyRoot: path.resolve("assets", "dashboard"),
    port: 0,
    agentRunner
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({ path: "references/sources/stale-repair.md", provider: "opencode" });
  const queued = await request(port, "POST", "/api/v1/agent/repair", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });

  let completed;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(completed.body.status, "complete");
  assert.equal(completed.body.result.unlocked, true);
  assert.equal(agentRuns, 0);
  const repaired = await readFile(sourceFile, "utf8");
  assert.match(repaired, /^workflow_status: "?inbox"?$/m);
  assert.match(repaired, /^followup_reasons: \[\]$/m);
  assert.match(repaired, /- Missing local attachments: none/);
});

test("Viki binds a question to its dispatched provider and pauses only the matching job", async (context) => {
  const fixture = await createFixture(context);
  let runOptions;
  let markAborted;
  const aborted = new Promise((resolve) => { markAborted = resolve; });
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "opencode",
      label: "OpenCode",
      defaultProvider: "opencode",
      providers: [
        {
          provider: "opencode",
          label: "OpenCode",
          defaultModel: "internal/default",
          models: [
            { id: "internal/default", label: "Default model" },
            { id: "internal/chosen", label: "Chosen model" }
          ]
        },
        { provider: "qoder", label: "Qoder CN", defaultModel: "auto", models: [{ id: "auto", label: "Auto" }] }
      ],
      message: ""
    }),
    run: async (options) => {
      runOptions = options;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          markAborted();
          reject(new Error("Local agent request was cancelled"));
        }, { once: true });
      });
    }
  };
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const conversationId = "conversation_test_01";
  const body = JSON.stringify({
    question: "What is in this vault?",
    history: [],
    language: "en",
    provider: "opencode",
    model: "internal/chosen",
    conversationId
  });
  const queued = await request(port, "POST", "/api/v1/agent/ask", {
    headers: {
      ...auth,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body)
    },
    body
  });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.meta.provider, "opencode");
  assert.equal(queued.body.meta.model, "internal/chosen");
  assert.equal(queued.body.meta.modelLabel, "Chosen model");
  assert.equal(queued.body.meta.conversationId, conversationId);

  for (let attempt = 0; attempt < 20 && !runOptions; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(runOptions.provider, "opencode");
  assert.equal(runOptions.model, "internal/chosen");

  const wrongPause = await request(port, "DELETE", "/api/v1/agent/query?job=another-job", { headers: auth });
  assert.equal(wrongPause.status, 409);

  const active = await request(port, "GET", "/api/v1/agent", { headers: auth });
  assert.equal(active.body.activeJob.id, queued.body.id);
  assert.equal(active.body.activeJob.meta.provider, "opencode");
  assert.equal(active.body.activeJob.meta.model, "internal/chosen");
  assert.equal(active.body.activeJob.meta.conversationId, conversationId);

  const paused = await request(port, "DELETE", `/api/v1/agent/query?job=${queued.body.id}`, { headers: auth });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.cancelled, true);
  assert.equal(paused.body.job.status, "cancelled");
  await aborted;
});

test("Viki preserves image block placement and rejects invalid answer images", async (context) => {
  const fixture = await createFixture(context);
  let runOptions;
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "opencode",
      label: "OpenCode",
      defaultProvider: "opencode",
      providers: [{
        provider: "opencode",
        label: "OpenCode",
        defaultModel: "internal/default",
        models: [{ id: "internal/default", label: "Default model" }]
      }],
      message: ""
    }),
    run: async (options) => {
      runOptions = options;
      return {
        answerMarkdown: "First supporting claim.\n\nSecond supporting claim.",
        sources: [{ path: "concepts/note.md", title: "Note" }],
        images: [
          { path: "references/assets/capture/image.png", caption: "Supporting diagram", afterBlock: 99 },
          { path: "concepts/not-an-image.png", caption: "Rejected", afterBlock: 0 }
        ]
      };
    }
  };
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner
  }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({
    question: "Show the supporting image",
    history: [],
    language: "en",
    provider: "opencode",
    model: "internal/default",
    conversationId: "conversation_image_01"
  });
  const queued = await request(port, "POST", "/api/v1/agent/ask", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });
  assert.equal(queued.status, 202);

  let completed;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(completed.body.status, "complete");
  assert.deepEqual(completed.body.result.images, [{
    path: "references/assets/capture/image.png",
    caption: "Supporting diagram",
    afterBlock: 1
  }]);
  assert.deepEqual(completed.body.result.sources, [{ path: "concepts/note.md", title: "Note" }]);
  assert.equal(runOptions.model, "internal/default");
  assert.match(runOptions.prompt, /afterBlock/);
});

test("Viki promotes valid Markdown image tags into authenticated answer images", async (context) => {
  const fixture = await createFixture(context);
  const agentRunner = {
    info: async () => ({
      available: true,
      provider: "opencode",
      label: "OpenCode",
      defaultProvider: "opencode",
      providers: [{ provider: "opencode", label: "OpenCode", defaultModel: "", models: [] }],
      message: ""
    }),
    run: async () => ({
      answerMarkdown: [
        "First supporting claim.",
        "![Agent workflow](references/assets/capture/image.png)",
        "Second supporting claim.",
        "![Rejected](concepts/not-an-image.png)"
      ].join("\n\n"),
      sources: [],
      images: []
    })
  };
  const server = http.createServer(createDashboardApi({ dashboardRoot: fixture.dashboard, port: 0, agentRunner }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const auth = { "x-my-wiki-token": session.body.token };
  const body = JSON.stringify({
    question: "Show the image",
    history: [],
    language: "en",
    provider: "opencode",
    model: "",
    conversationId: "conversation_markdown_image_01"
  });
  const queued = await request(port, "POST", "/api/v1/agent/ask", {
    headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body
  });

  let completed;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(completed.body.result.answerMarkdown, [
    "First supporting claim.",
    "Second supporting claim.",
    "![Rejected](concepts/not-an-image.png)"
  ].join("\n\n"));
  assert.deepEqual(completed.body.result.images, [{
    path: "references/assets/capture/image.png",
    caption: "Agent workflow",
    afterBlock: 0
  }]);
});
