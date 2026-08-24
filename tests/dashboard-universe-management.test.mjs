import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";
import { declareUniverse, readUniverseRegistry } from "../scripts/core/universe-registry.mjs";

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
  await mkdir(dashboard, { recursive: true });
  await writeFile(path.join(vault, "concepts", "alpha.md"), "---\ntitle: Alpha\nstatus: active\nuniverses:\n  - Galaxy A\n---\n# Alpha\n", "utf8");
  await writeFile(path.join(vault, "references", "sources", "evidence.md"), "---\ntitle: Evidence\nworkflow_status: inbox\nsuggested_universe: Galaxy A\n---\n# Evidence\n", "utf8");
  await writeFile(path.join(dashboard, ".my-wiki-runtime.json"), `${JSON.stringify({ vault })}\n`, "utf8");
  await declareUniverse(vault, "Galaxy A");
  context.after(() => rm(root, { recursive: true, force: true }));
  return { vault, dashboard };
}

test("galaxy API hides, renames, and safely removes a galaxy classification", async (context) => {
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
  assert.match(await readFile(path.join(vault, "references", "sources", "evidence.md"), "utf8"), /suggested_universe: "Galaxy B"/);
  assert.deepEqual((await readUniverseRegistry(vault)).hiddenGalaxies, ["Galaxy B"]);

  const rejected = await request(port, "POST", "/api/v1/universes/delete", token, { name: "Galaxy B", confirmation: "wrong" });
  assert.equal(rejected.status, 400);

  const deleted = await request(port, "POST", "/api/v1/universes/delete", token, { name: "Galaxy B", confirmation: "Galaxy B" });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.reassignedConcepts, 1);
  assert.match(await readFile(path.join(vault, "concepts", "alpha.md"), "utf8"), /- "Uncategorized"/);
  assert.match(await readFile(path.join(vault, "references", "sources", "evidence.md"), "utf8"), /suggested_universe:\s*$/m);
  assert.deepEqual((await readUniverseRegistry(vault)).galaxies, ["Uncategorized"]);
});

test("maintenance UI confirms batch counts and labels distillation explicitly", async () => {
  const main = await readFile(new URL("../assets/dashboard/src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /maintainBatchConfirm/);
  assert.match(main, /selectedNodes\.filter\(\(node\) => node\.status === "needs-followup"\)\.length/);
  assert.match(main, /processNodes\(batchNodes, true\)/);
  assert.match(main, /awaitingDistillation: "待蒸馏"/);
  assert.match(main, /map\(galaxyKey\)/);
  assert.match(main, /hidden\.has\(galaxyKey\(name\)\)/);
});
