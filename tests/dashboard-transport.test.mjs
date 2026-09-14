import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { packDashboardGraph, unpackDashboardGraph } from "../assets/dashboard/src/graph-transport.js";
import { sendRevalidatedJson } from "../scripts/core/http-json.mjs";

test("compact graph preserves topology and metadata while deferring document bodies", () => {
  const graph = { generatedAt: "now", hiddenUniverses: ["Hidden"], nodes: [
    { id: "concepts/A", title: "A", content: "long body", links: ["B"], out: ["references/sources/B"], backlinks: [] },
    { id: "references/sources/B", title: "B", snapshotPath: "references/originals/B.pdf", preview: "Evidence", out: [], backlinks: ["concepts/A"] }
  ], edges: [{ source: "concepts/A", target: "references/sources/B", kind: "wikilink" }] };
  const packet = packDashboardGraph(graph);
  assert.equal(packet.nodes[0].content, undefined);
  assert.deepEqual(packet.edges, [[0, 1, "wikilink"]]);
  const restored = unpackDashboardGraph(packet);
  assert.deepEqual(restored.edges, graph.edges);
  assert.deepEqual(restored.hiddenUniverses, graph.hiddenUniverses);
  for (let i = 0; i < graph.nodes.length; i++) {
    assert.deepEqual(restored.nodes[i].out, graph.nodes[i].out);
    assert.deepEqual(restored.nodes[i].backlinks, graph.nodes[i].backlinks);
  }
  assert.equal(restored.nodes[1].preview, "Evidence");
  assert.equal(graph.nodes[0].content, "long body");
  assert.strictEqual(unpackDashboardGraph(graph), graph);
});

test("private JSON is compressed, revalidated and never returned before authorization", async (t) => {
  let value = { text: "private content ".repeat(1000) };
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== "test") { res.writeHead(403); res.end(); return; }
    void sendRevalidatedJson(req, res, value);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const first = await fetch(url, { headers: { authorization: "test", "accept-encoding": "gzip" } });
  assert.equal(first.headers.get("content-encoding"), "gzip");
  assert.match(first.headers.get("cache-control"), /private/);
  assert.deepEqual(await first.json(), value);
  const etag = first.headers.get("etag");
  assert.equal((await fetch(url, { headers: { authorization: "test", "if-none-match": etag } })).status, 304);
  assert.equal((await fetch(url, { headers: { "if-none-match": etag } })).status, 403);
  const identity = await fetch(url, { headers: { authorization: "test", "accept-encoding": "gzip;q=0" } });
  assert.equal(identity.headers.get("content-encoding"), null);
  value = { text: "Changed" };
  const updated = await fetch(url, { headers: { authorization: "test", "if-none-match": etag } });
  assert.equal(updated.status, 200);
  assert.notEqual(updated.headers.get("etag"), etag);
});
