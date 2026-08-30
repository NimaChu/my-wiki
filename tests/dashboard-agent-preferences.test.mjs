import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  emptyDashboardAgentPreferences,
  readDashboardAgentPreferences,
  updateDashboardAgentPreferences
} from "../scripts/core/dashboard-agent-preferences.mjs";

test("Dashboard agent selections persist in vault runtime state across restarts", async (context) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-agent-preferences-"));
  context.after(() => fs.rm(vault, { recursive: true, force: true }));

  assert.deepEqual(await readDashboardAgentPreferences(vault), emptyDashboardAgentPreferences());

  await updateDashboardAgentPreferences(vault, {
    viki: { provider: "opencode", models: { opencode: "deepseek/deepseek-v4-pro" } }
  });
  await updateDashboardAgentPreferences(vault, {
    queue: {
      distill: { provider: "qoder", model: "powerful" },
      repair: { provider: "codex", model: "gpt-5.6-luna" }
    }
  });

  const restored = await readDashboardAgentPreferences(vault);
  assert.equal(restored.viki.provider, "opencode");
  assert.equal(restored.viki.models.opencode, "deepseek/deepseek-v4-pro");
  assert.deepEqual(restored.queue.distill, { provider: "qoder", model: "powerful" });
  assert.deepEqual(restored.queue.repair, { provider: "codex", model: "gpt-5.6-luna" });
  await fs.access(path.join(vault, ".my-wiki", "dashboard-agent-preferences.json"));
});

test("Dashboard agent preferences reject unknown providers and control characters", async (context) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-agent-preferences-invalid-"));
  context.after(() => fs.rm(vault, { recursive: true, force: true }));

  const stored = await updateDashboardAgentPreferences(vault, {
    viki: { provider: "shell", models: { shell: "secret", codex: "gpt\n-5" } },
    queue: {
      distill: { provider: "OPENCODE", model: " provider/model " },
      repair: { provider: "unknown", model: "model" }
    }
  });

  assert.deepEqual(stored.viki, { provider: "", models: { codex: "gpt-5" } });
  assert.deepEqual(stored.queue.distill, { provider: "opencode", model: "provider/model" });
  assert.deepEqual(stored.queue.repair, { provider: "", model: "model" });
});

test("concurrent Viki and queue preference writes preserve both sections", async (context) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-agent-preferences-concurrent-"));
  context.after(() => fs.rm(vault, { recursive: true, force: true }));

  await Promise.all([
    updateDashboardAgentPreferences(vault, {
      viki: { provider: "codex", models: { codex: "gpt-5.6-luna" } }
    }),
    updateDashboardAgentPreferences(vault, {
      queue: {
        distill: { provider: "opencode", model: "deepseek/deepseek-v4-pro" },
        repair: { provider: "qoder", model: "powerful" }
      }
    })
  ]);

  const restored = await readDashboardAgentPreferences(vault);
  assert.equal(restored.viki.models.codex, "gpt-5.6-luna");
  assert.equal(restored.queue.repair.model, "powerful");
});
