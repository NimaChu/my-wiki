import assert from "node:assert/strict";
import test from "node:test";
import {
  isUniverseOverviewMode,
  rankUniverseGroupsByConnectivity,
  shouldUseDegreeCenteredUniverseLayout
} from "../assets/dashboard/src/layout-mode.js";

test("a single galaxy still uses the degree-centered universe overview layout", () => {
  const isUniverseOverview = isUniverseOverviewMode({
    graphMode: "knowledge",
    graphScope: "global",
    focusedGroup: null
  });

  assert.equal(isUniverseOverview, true);
  assert.equal(shouldUseDegreeCenteredUniverseLayout({ isUniverseOverview, groupCount: 1 }), true);
});

test("an entered galaxy keeps the rotatable sphere layout", () => {
  const isUniverseOverview = isUniverseOverviewMode({
    graphMode: "knowledge",
    graphScope: "global",
    focusedGroup: "Wiki / AI"
  });

  assert.equal(isUniverseOverview, false);
  assert.equal(shouldUseDegreeCenteredUniverseLayout({ isUniverseOverview, groupCount: 1 }), false);
});

test("local and evidence views do not use the universe overview layout", () => {
  assert.equal(isUniverseOverviewMode({ graphMode: "knowledge", graphScope: "local", focusedGroup: null }), false);
  assert.equal(isUniverseOverviewMode({ graphMode: "evidence", graphScope: "global", focusedGroup: null }), false);
});

test("the galaxy connected to the most other galaxies ranks at the universe center", () => {
  const ranked = rankUniverseGroupsByConnectivity(
    ["Large isolated", "Hub", "Leaf A", "Leaf B", "Leaf C"],
    [
      { source: "Hub", target: "Leaf A", weight: 1 },
      { source: "Hub", target: "Leaf B", weight: 1 },
      { source: "Hub", target: "Leaf C", weight: 1 },
      { source: "Leaf A", target: "Leaf B", weight: 8 }
    ],
    { "Large isolated": 100, Hub: 4, "Leaf A": 8, "Leaf B": 8, "Leaf C": 3 }
  );

  assert.equal(ranked[0], "Hub");
  assert.equal(ranked.at(-1), "Large isolated");
});

test("connection strength breaks ties before galaxy size", () => {
  const ranked = rankUniverseGroupsByConnectivity(
    ["Big", "Strong", "Peer"],
    [
      { source: "Big", target: "Peer", weight: 1 },
      { source: "Strong", target: "Peer", weight: 6 }
    ],
    { Big: 80, Strong: 3, Peer: 5 }
  );

  assert.equal(ranked[0], "Peer");
  assert.ok(ranked.indexOf("Strong") < ranked.indexOf("Big"));
});
