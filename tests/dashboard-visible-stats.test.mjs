import assert from "node:assert/strict";
import test from "node:test";
import { visibleGalaxyStats } from "../assets/dashboard/src/overview-stats.js";

function fixture(hiddenUniverses = ["FlexSim", "数学"]) {
  return {
    hiddenUniverses,
    nodes: [
      { id: "concepts/ai", group: "Wiki / AI", universes: ["Wiki / AI"], status: "stable" },
      { id: "concepts/shared", group: "Wiki / AI", universes: ["Wiki / AI", "Wiki / 数学"], status: "stable" },
      { id: "concepts/flexsim", group: "Wiki / FlexSim", universes: ["Wiki / FlexSim"], status: "stable" },
      { id: "references/sources/ai", status: "processed" },
      { id: "references/sources/shared", status: "inbox" },
      { id: "references/sources/flexsim", status: "processed" }
    ],
    edges: [
      { source: "concepts/ai", target: "references/sources/ai" },
      { source: "concepts/shared", target: "references/sources/shared" },
      { source: "concepts/flexsim", target: "references/sources/flexsim" }
    ],
    unresolved: [
      { source: "concepts/ai", target: "concepts/missing" },
      { source: "concepts/flexsim", target: "concepts/other-missing" }
    ]
  };
}

test("overview stats include only concepts and references from visible galaxies", () => {
  assert.deepEqual(visibleGalaxyStats(fixture()), {
    wikiPages: 2,
    rawSources: 2,
    unresolved: 1,
    inbox: 1,
    processed: 1
  });
});

test("overview stats restore the full graph when every galaxy is visible", () => {
  assert.deepEqual(visibleGalaxyStats(fixture([])), {
    wikiPages: 3,
    rawSources: 3,
    unresolved: 2,
    inbox: 1,
    processed: 2
  });
});
