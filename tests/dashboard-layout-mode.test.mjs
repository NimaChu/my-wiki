import assert from "node:assert/strict";
import test from "node:test";
import {
  isUniverseOverviewMode,
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
