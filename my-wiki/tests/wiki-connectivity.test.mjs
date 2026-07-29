import assert from "node:assert/strict";
import test from "node:test";
import { statsFromScan, wikiTopicPeerMap } from "../scripts/core/wiki-lib.mjs";

function node(id, type = "wiki") {
  return {
    id,
    type,
    status: type === "raw-source" ? "processed" : "evergreen"
  };
}

function fixture() {
  const nodes = [
    node("wiki/index"),
    node("wiki/log"),
    node("wiki/reference/README"),
    node("wiki/Only Evidence"),
    node("wiki/Reciprocal A"),
    node("wiki/Reciprocal B"),
    node("wiki/Typed Relation"),
    node("raw/sources/evidence", "raw-source")
  ];
  return {
    nodes,
    edges: [
      { source: "raw/sources/evidence", target: "wiki/Only Evidence", kind: "wikilink" },
      { source: "wiki/Only Evidence", target: "raw/sources/evidence", kind: "wikilink" },
      { source: "wiki/index", target: "wiki/Only Evidence", kind: "wikilink" },
      { source: "wiki/Reciprocal A", target: "wiki/Reciprocal B", kind: "wikilink" },
      { source: "wiki/Reciprocal B", target: "wiki/Reciprocal A", kind: "wikilink" }
    ],
    typedRelations: [
      { source: "wiki/Typed Relation", target: "wiki/Reciprocal A", kind: "supports" }
    ],
    unresolved: [],
    invalidRelations: []
  };
}

test("connectivity counts unique Wiki topic peers only", () => {
  const peers = wikiTopicPeerMap(fixture());

  assert.deepEqual([...peers.keys()].sort(), [
    "wiki/Only Evidence",
    "wiki/Reciprocal A",
    "wiki/Reciprocal B",
    "wiki/Typed Relation"
  ]);
  assert.equal(peers.get("wiki/Only Evidence").size, 0);
  assert.deepEqual([...peers.get("wiki/Reciprocal A")].sort(), [
    "wiki/Reciprocal B",
    "wiki/Typed Relation"
  ]);
  assert.deepEqual([...peers.get("wiki/Reciprocal B")], ["wiki/Reciprocal A"]);
});

test("vault stats report Wiki pages linked only to raw or utility pages as orphaned", () => {
  const stats = statsFromScan(fixture());

  assert.equal(stats.orphanedWiki, 1);
});
