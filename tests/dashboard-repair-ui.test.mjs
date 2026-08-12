import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("needs-followup queue items expose the repair Agent action", async () => {
  const [main, api, styles, service] = await Promise.all([
    readFile(new URL("../assets/dashboard/src/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../assets/dashboard/src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../assets/dashboard/src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/dashboard-api.mjs", import.meta.url), "utf8")
  ]);

  assert.match(main, /node\.status === "needs-followup"/);
  assert.match(main, /localApi\.repair\(node\.path, provider\)/);
  assert.match(main, /<Wrench size=\{14\}/);
  assert.match(main, /queue-item-repair/);
  assert.match(api, /\/api\/v1\/agent\/repair/);
  assert.match(api, /"agent-repair"/);
  assert.match(styles, /\.queue-panel \.queue-item-repair/);
  assert.match(service, /mode: "repair"/);
  assert.match(service, /reconcileRepairedRaw/);
});
