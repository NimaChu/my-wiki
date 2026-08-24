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
    node("index"),
    node("log"),
    node("concepts/reference/README"),
    node("concepts/Only Evidence"),
    node("concepts/Reciprocal A"),
    node("concepts/Reciprocal B"),
    node("concepts/Typed Relation"),
    node("references/sources/evidence", "raw-source")
  ];
  return {
    nodes,
    edges: [
      { source: "references/sources/evidence", target: "concepts/Only Evidence", kind: "wikilink" },
      { source: "concepts/Only Evidence", target: "references/sources/evidence", kind: "wikilink" },
      { source: "index", target: "concepts/Only Evidence", kind: "wikilink" },
      { source: "concepts/Reciprocal A", target: "concepts/Reciprocal B", kind: "wikilink" },
      { source: "concepts/Reciprocal B", target: "concepts/Reciprocal A", kind: "wikilink" }
    ],
    typedRelations: [
      { source: "concepts/Typed Relation", target: "concepts/Reciprocal A", kind: "supports" }
    ],
    unresolved: [],
    invalidRelations: []
  };
}

test("connectivity counts unique Wiki topic peers only", () => {
  const peers = wikiTopicPeerMap(fixture());

  assert.deepEqual([...peers.keys()].sort(), [
    "concepts/Only Evidence",
    "concepts/Reciprocal A",
    "concepts/Reciprocal B",
    "concepts/Typed Relation"
  ]);
  assert.equal(peers.get("concepts/Only Evidence").size, 0);
  assert.deepEqual([...peers.get("concepts/Reciprocal A")].sort(), [
    "concepts/Reciprocal B",
    "concepts/Typed Relation"
  ]);
  assert.deepEqual([...peers.get("concepts/Reciprocal B")], ["concepts/Reciprocal A"]);
});

test("vault stats report Wiki pages linked only to raw or utility pages as orphaned", () => {
  const stats = statsFromScan(fixture());

  assert.equal(stats.orphanedWiki, 1);
});
