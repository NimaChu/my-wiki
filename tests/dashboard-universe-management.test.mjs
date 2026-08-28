import assert from "node:assert/strict";
import http from "node:http";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";
import { declareUniverse, readUniverseRegistry } from "../scripts/core/universe-registry.mjs";
import { scanVault } from "../scripts/core/wiki-lib.mjs";

async function request(port, method, route, token, payload) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: "127.0.0.1",
      port,
      method,
      path: route,
      headers: {
        ...(token ? { "x-my-wiki-token": token } : {}),
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
      }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-wiki-galaxy-"));
  const vault = path.join(root, "vault");
  const dashboard = path.join(root, "dashboard");
  await mkdir(path.join(vault, "concepts"), { recursive: true });
  await mkdir(path.join(vault, "references", "sources"), { recursive: true });
  await mkdir(path.join(vault, "references", "assets", "evidence-a"), { recursive: true });
  await mkdir(path.join(vault, "references", "assets", "evidence-shared"), { recursive: true });
  await mkdir(path.join(vault, "references", "originals"), { recursive: true });
  await mkdir(dashboard, { recursive: true });
  await writeFile(path.join(vault, "index.md"), "---\nokf_version: \"0.2\"\n---\n\n# Knowledge Index\n", "utf8");
  await writeFile(path.join(vault, "log.md"), "# Knowledge Update Log\n", "utf8");
  await writeFile(path.join(vault, "concepts", "alpha.md"), concept({
    title: "Alpha",
    universes: ["Galaxy A"],
    source: "evidence-a",
    body: "Exclusive evidence: [Evidence A](/references/sources/evidence-a.md)."
  }), "utf8");
  await writeFile(path.join(vault, "concepts", "shared.md"), concept({
    title: "Shared Concept",
    universes: ["Galaxy A", "Shared"],
    source: "evidence-shared",
    body: "Shared evidence: [Evidence Shared](/references/sources/evidence-shared.md)."
  }), "utf8");
  await writeFile(path.join(vault, "concepts", "gamma.md"), concept({
    title: "Gamma",
    universes: ["Shared"],
    body: "Gamma previously related to [Alpha](./alpha.md).",
    relationHint: "/concepts/alpha.md"
  }), "utf8");
  await writeFile(path.join(vault, "references", "sources", "evidence-a.md"), reference({
    title: "Evidence A",
    slug: "evidence-a",
    galaxy: "Galaxy A"
  }), "utf8");
  await writeFile(path.join(vault, "references", "sources", "evidence-shared.md"), reference({
    title: "Evidence Shared",
    slug: "evidence-shared",
    galaxy: "Galaxy A"
  }), "utf8");
  await writeFile(path.join(vault, "references", "assets", "evidence-a", "image.png"), "exclusive", "utf8");
  await writeFile(path.join(vault, "references", "assets", "evidence-shared", "image.png"), "shared", "utf8");
  await writeFile(path.join(vault, "references", "originals", "evidence-a.txt"), "exclusive original", "utf8");
  await writeFile(path.join(vault, "references", "originals", "evidence-shared.txt"), "shared original", "utf8");
  await writeFile(path.join(dashboard, ".my-wiki-runtime.json"), `${JSON.stringify({ vault })}\n`, "utf8");
  await declareUniverse(vault, "Galaxy A");
  await declareUniverse(vault, "Shared");
  context.after(() => rm(root, { recursive: true, force: true }));
  return { vault, dashboard };
}

test("galaxy API moves a complete galaxy to trash without creating Uncategorized", async (context) => {
  const { vault, dashboard } = await fixture(context);
  const server = http.createServer(createDashboardApi({ dashboardRoot: dashboard, port: 0, agentRunner: { info: async () => ({}) } }));
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const session = await request(port, "GET", "/api/v1/session");
  const token = session.body.token;

  const hidden = await request(port, "POST", "/api/v1/universes/visibility", token, { name: "Galaxy A", hidden: true });
  assert.equal(hidden.status, 200);
  assert.deepEqual((await readUniverseRegistry(vault)).hiddenGalaxies, ["Galaxy A"]);

  const renamed = await request(port, "POST", "/api/v1/universes/rename", token, { name: "Galaxy A", newName: "Galaxy B" });
  assert.equal(renamed.status, 200);
  assert.match(await readFile(path.join(vault, "concepts", "alpha.md"), "utf8"), /- "Galaxy B"/);
  assert.match(await readFile(path.join(vault, "references", "sources", "evidence-a.md"), "utf8"), /suggested_universe: "Galaxy B"/);
  assert.deepEqual((await readUniverseRegistry(vault)).hiddenGalaxies, ["Galaxy B"]);

  const rejected = await request(port, "POST", "/api/v1/universes/delete", token, { name: "Galaxy B", confirmation: "wrong" });
  assert.equal(rejected.status, 400);

  const deleted = await request(port, "POST", "/api/v1/universes/delete", token, { name: "Galaxy B", confirmation: "Galaxy B" });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.removedConcepts, 1);
  assert.equal(deleted.body.updatedConcepts, 1);
  assert.equal(deleted.body.removedReferences, 1);
  assert.match(deleted.body.trashPackage, /^\.my-wiki\/trash\/galaxies\/.+\/galaxy\.mywiki$/);
  await access(path.join(vault, ...deleted.body.trashPackage.split("/")));
  await access(path.join(vault, ...deleted.body.trashReceipt.split("/")));
  await assert.rejects(access(path.join(vault, "concepts", "alpha.md")), { code: "ENOENT" });
  await assert.rejects(access(path.join(vault, "references", "sources", "evidence-a.md")), { code: "ENOENT" });
  await assert.rejects(access(path.join(vault, "references", "assets", "evidence-a")), { code: "ENOENT" });
  await assert.rejects(access(path.join(vault, "references", "originals", "evidence-a.txt")), { code: "ENOENT" });
  const shared = await readFile(path.join(vault, "concepts", "shared.md"), "utf8");
  assert.doesNotMatch(shared, /Galaxy B/);
  assert.match(shared, /- "Shared"/);
  const gamma = await readFile(path.join(vault, "concepts", "gamma.md"), "utf8");
  assert.doesNotMatch(gamma, /\]\(\.\/alpha\.md\)|\/concepts\/alpha\.md/);
  await access(path.join(vault, "references", "sources", "evidence-shared.md"));
  await access(path.join(vault, "references", "assets", "evidence-shared", "image.png"));
  await access(path.join(vault, "references", "originals", "evidence-shared.txt"));
  assert.deepEqual((await readUniverseRegistry(vault)).galaxies, ["Shared"]);
  assert.equal((await scanVault(vault)).unresolved.length, 0);

  const trash = await request(port, "GET", "/api/v1/universes/trash", token);
  assert.equal(trash.status, 200);
  assert.equal(trash.body.entries.length, 1);
  assert.equal(trash.body.entries[0].galaxy, "Galaxy B");
  assert.equal(trash.body.entries[0].recoverable, true);
  const restored = await request(port, "POST", "/api/v1/universes/trash/restore", token, { id: trash.body.entries[0].id });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.galaxy, "Galaxy B");
  assert.equal(restored.body.imported.conflicts, 0);
  await access(path.join(vault, "concepts", "alpha.md"));
  await access(path.join(vault, "references", "sources", "evidence-a.md"));
  await assert.rejects(access(path.join(vault, "references", "sources", "evidence-shared-2.md")), { code: "ENOENT" });
  assert.match(await readFile(path.join(vault, "concepts", "shared.md"), "utf8"), /- "Galaxy B"/);
  assert.equal((await request(port, "GET", "/api/v1/universes/trash", token)).body.entries.length, 0);

  const deletedAgain = await request(port, "POST", "/api/v1/universes/delete", token, { name: "Galaxy B", confirmation: "Galaxy B" });
  assert.equal(deletedAgain.status, 200);
  const secondTrash = await request(port, "GET", "/api/v1/universes/trash", token);
  const entryId = secondTrash.body.entries[0].id;
  const rejectedPurge = await request(port, "POST", "/api/v1/universes/trash/purge", token, { id: entryId, confirmation: "wrong" });
  assert.equal(rejectedPurge.status, 400);
  const purged = await request(port, "POST", "/api/v1/universes/trash/purge", token, { id: entryId, confirmation: "Galaxy B" });
  assert.equal(purged.status, 200);
  assert.equal(purged.body.purged, true);
  assert.equal((await request(port, "GET", "/api/v1/universes/trash", token)).body.entries.length, 0);
});

function concept({ title, universes, source = "", body, relationHint = "" }) {
  const sources = source ? `sources:\n  - id: ${source}\n    resource: /references/sources/${source}.md\n` : "sources: []\n";
  const relation = relationHint ? `relation_hints:\n  - ${relationHint}\n` : "";
  return `---\ntype: Concept\ntitle: ${title}\ndescription: Test concept.\nstatus: stable\ntags:\n  - test\nuniverses:\n${universes.map((name) => `  - ${name}`).join("\n")}\n${sources}${relation}generated:\n  by: process:test\n  at: 2026-08-28T00:00:00.000Z\n---\n\n# ${title}\n\n${body}\n`;
}

function reference({ title, slug, galaxy }) {
  return `---\ntype: Reference\ntitle: ${title}\ndescription: Test evidence.\nstatus: stable\nworkflow_status: processed\nsuggested_universe: ${galaxy}\nsnapshot_path: references/originals/${slug}.txt\nimage_index_path: references/assets/${slug}/index.json\ngenerated:\n  by: process:test\n  at: 2026-08-28T00:00:00.000Z\n---\n\n# ${title}\n\nEvidence body.\n`;
}

test("maintenance UI confirms batch counts and labels distillation explicitly", async () => {
  const main = await readFile(new URL("../assets/dashboard/src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /maintainBatchConfirm/);
  assert.match(main, /selectedNodes\.filter\(\(node\) => node\.status === "needs-followup"\)\.length/);
  assert.match(main, /processNodes\(batchNodes, true\)/);
  assert.match(main, /awaitingDistillation: "待蒸馏"/);
  assert.match(main, /map\(galaxyKey\)/);
  assert.match(main, /hidden\.has\(galaxyKey\(name\)\)/);
});
