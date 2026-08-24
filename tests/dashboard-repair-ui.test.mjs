import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("needs-followup queue items expose the repair Agent action", async () => {
  const [main, api, styles, service, graph] = await Promise.all([
    readFile(new URL("../assets/dashboard/src/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../assets/dashboard/src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../assets/dashboard/src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/dashboard-api.mjs", import.meta.url), "utf8"),
    readFile(new URL("../assets/dashboard/scripts/generate-graph.mjs", import.meta.url), "utf8")
  ]);

  assert.match(main, /node\.status === "needs-followup"/);
  assert.match(main, /localApi\.repair\(node\.path, normalizedSettings\.repair\)/);
  assert.match(main, /setPendingPaths\(\(current\) => new Set\(current\)\.add\(node\.path\)\)/);
  assert.match(main, /pendingPaths\.has\(node\.path\).*LoaderCircle/);
  assert.match(main, /localApi\.captureJobs\(\)/);
  assert.doesNotMatch(main, /item\.jobId && item\.snapshotPath/);
  assert.match(main, /\["queued", "running", "failed"\]/);
  assert.match(main, /missing-visual-evidence:/);
  assert.match(main, /localizedVisualGap\(node\.visualGapPages, language\)/);
  assert.match(graph, /visualGapPages: visualGapPages\(frontmatter, content\)/);
  assert.match(main, /<Settings2 size=\{15\}/);
  assert.match(main, /my-wiki-queue-repair-provider/);
  assert.match(main, /my-wiki-queue-distill-provider/);
  assert.match(main, /<Wrench size=\{14\}/);
  assert.match(main, /queue-item-repair/);
  assert.match(api, /\/api\/v1\/agent\/repair/);
  assert.match(api, /\/api\/v1\/capture-jobs/);
  assert.match(api, /"agent-repair"/);
  assert.match(styles, /\.queue-panel \.queue-item-repair/);
  assert.match(service, /mode: "repair"/);
  assert.match(service, /repairModel/);
  assert.match(service, /distillModel/);
  assert.match(service, /reconcileRepairedRaw/);
  assert.match(service, /requestUrl\.pathname === "\/api\/v1\/capture-jobs"/);
  assert.match(service, /readDashboardGraph\(dashboardRoot, vault\)/);
});
