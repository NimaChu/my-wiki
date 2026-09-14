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
  assert.match(main, /localApi\.inbox\(\)/);
  assert.match(main, /maintenanceStageLabel/);
  assert.match(api, /\/api\/v1\/maintenance-queue/);
  assert.doesNotMatch(main, /item\.jobId && item\.snapshotPath/);
  assert.match(main, /item\.stage === "extract" && item\.jobStatus !== "failed"/);
  assert.match(main, /missing-visual-evidence:/);
  assert.match(main, /localizedVisualGap\(node\.visualGapPages, language\)/);
  assert.match(graph, /visualGapPages: visualGapPages\(frontmatter, content\)/);
  assert.doesNotMatch(main, /queue-settings-button|queue-agent-settings/);
  assert.match(main, /my-wiki-queue-repair-provider/);
  assert.match(main, /my-wiki-queue-distill-provider/);
  assert.match(main, /localApi\.agentPreferences\(\)/);
  assert.doesNotMatch(main, /localApi\.saveAgentPreferences/);
  assert.match(main, /my-wiki:agent-preferences-updated/);
  assert.match(main, /if \(selection\.provider\) return selection/);
  assert.match(api, /\/api\/v1\/agent\/preferences/);
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

test("Settings own execution tools while Viki only selects the model", async () => {
  const [settings, viki, options] = await Promise.all([
    readFile(new URL("../assets/dashboard/src/SettingsMenu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../assets/dashboard/src/Viki.tsx", import.meta.url), "utf8"),
    readFile(new URL("../assets/dashboard/src/VikiExecutionOptions.tsx", import.meta.url), "utf8")
  ]);
  assert.match(settings, /\["repair", "distill", "viki"\]/);
  assert.match(settings, /kind === "viki" \? localApi\.vikiAgent\(\) : localApi\.agent\(\)/);
  assert.match(settings, /viki: \{ provider \}/);
  assert.match(settings, /queue: \{ \[kind\]: \{ provider, model \} \}/);
  assert.match(settings, /my-wiki:agent-preferences-updated/);
  assert.doesNotMatch(viki, /<VikiExecutionOptions|<select[^>]+value=\{provider\}/);
  assert.doesNotMatch(viki, /<AgentModelOptions/);
  assert.match(viki, /role="menuitemradio"[\s\S]*changeModel\(item\.id\)/);
  assert.match(viki, /saveAgentPreferences\(\{ viki: \{ models:/);
  assert.match(options, /<option value="api">API<\/option><option value="cli">CLI<\/option>/);
});
