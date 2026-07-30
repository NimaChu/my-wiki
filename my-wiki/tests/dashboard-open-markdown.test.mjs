import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  const wikiFile = path.join(vault, "wiki", "note.md");
  const rawFile = path.join(vault, "raw", "sources", "evidence.md");
  const imageFile = path.join(vault, "raw", "assets", "capture", "image.png");
  await mkdir(path.dirname(wikiFile), { recursive: true });
  await mkdir(path.dirname(rawFile), { recursive: true });
  await mkdir(path.dirname(imageFile), { recursive: true });
  await mkdir(dashboard, { recursive: true });
  await writeFile(wikiFile, "---\ntitle: Note\nstatus: active\n---\n# Note\n\nOriginal body.\n", "utf8");
  await writeFile(rawFile, "# Evidence\n\n![Local](../assets/capture/image.png)\n", "utf8");
  await writeFile(imageFile, Buffer.from([137, 80, 78, 71]));
  await writeFile(path.join(dashboard, ".my-wiki-runtime.json"), `${JSON.stringify({ vault })}\n`, "utf8");
  context.after(() => rm(root, { recursive: true, force: true }));
  return { vault, dashboard, wikiFile, rawFile, imageFile };
}

test("Markdown document access accepts vault Wiki and raw source notes only", async (context) => {
  const fixture = await createFixture(context);

  assert.equal(await resolveMarkdownVaultFile(fixture.vault, "wiki/note.md"), await realpath(fixture.wikiFile));
  assert.equal(await resolveMarkdownVaultFile(fixture.vault, "raw/sources/evidence.md"), await realpath(fixture.rawFile));
  await assert.rejects(resolveMarkdownVaultFile(fixture.vault, "raw/snapshots/secret.md"), /Only Wiki and raw source Markdown/);
  await assert.rejects(resolveMarkdownVaultFile(fixture.vault, "../note.md"), /Only Wiki and raw source Markdown/);

  const document = await readMarkdownDocument(fixture.vault, "wiki/note.md");
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

  const opened = await request(port, "GET", "/api/v1/markdown?path=wiki%2Fnote.md", { headers: auth });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.body, "# Note\n\nOriginal body.\n");

  const update = JSON.stringify({
    path: "wiki/note.md",
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

test("Markdown images resolve relative to the note but stay inside raw/assets", async (context) => {
  const fixture = await createFixture(context);

  assert.equal(
    await resolveMarkdownImageFile(fixture.vault, "raw/sources/evidence.md", "../assets/capture/image.png"),
    await realpath(fixture.imageFile)
  );
  assert.equal(
    await resolveMarkdownImageFile(fixture.vault, "wiki/note.md", "/raw/assets/capture/image.png"),
    await realpath(fixture.imageFile)
  );
  await assert.rejects(
    resolveMarkdownImageFile(fixture.vault, "raw/sources/evidence.md", "../../wiki/note.md"),
    /Only local vault images/
  );
  await assert.rejects(
    resolveMarkdownImageFile(fixture.vault, "raw/sources/evidence.md", "https://example.com/image.png"),
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
  const route = `/api/v1/markdown-image?note=${encodeURIComponent("raw/sources/evidence.md")}&src=${encodeURIComponent("../assets/capture/image.png")}&token=${session.body.token}`;
  const response = await request(port, "GET", route);

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "image/png");
  assert.deepEqual(response.body, Buffer.from([137, 80, 78, 71]));
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
    imageRendering: "smooth"
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
    spritesheetUrl: "/api/v1/pets/qoderwork--my-wiki/spritesheet"
  }]);
});

test("File uploads enter the Inbox queue before extraction completes", async (context) => {
  const fixture = await createFixture(context);
  let finishExtraction;
  const extractionGate = new Promise((resolve) => { finishExtraction = resolve; });
  const server = http.createServer(createDashboardApi({
    dashboardRoot: fixture.dashboard,
    port: 0,
    agentRunner: { info: async () => ({}) },
    localFileIngestor: async () => {
      await extractionGate;
      return { kind: "file", count: 1, items: [{ status: "inbox", path: "raw/sources/queued.md" }] };
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

  const inbox = await request(port, "GET", "/api/v1/inbox", { headers: auth });
  const queueItem = inbox.body.items.find((item) => item.jobId === queued.body.id);
  assert.equal(queueItem.title, "Queued PDF");
  assert.equal(queueItem.status, "processing");
  assert.match(queueItem.jobStatus, /queued|running/);

  finishExtraction();
  let completed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    completed = await request(port, "GET", `/api/v1/jobs/${queued.body.id}`, { headers: auth });
    if (completed.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(completed.body.status, "complete");
});

test("Maintenance uses a total timeout without an idle timeout", async (context) => {
  const fixture = await createFixture(context);
  const sourceFile = path.join(fixture.vault, "raw", "sources", "maintenance-source.md");
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
  const body = JSON.stringify({
    paths: ["raw/sources/maintenance-source.md"],
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
});
