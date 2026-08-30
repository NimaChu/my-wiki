import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const PROVIDERS = new Set(["opencode", "qoder", "codex", "claude"]);
const pendingWrites = new Map();

export function emptyDashboardAgentPreferences() {
  return {
    version: 1,
    viki: { provider: "", models: {} },
    queue: {
      distill: { provider: "", model: "" },
      repair: { provider: "", model: "" }
    }
  };
}

export async function readDashboardAgentPreferences(vault) {
  try {
    const value = JSON.parse(await fs.readFile(preferencesFile(vault), "utf8"));
    return normalizeDashboardAgentPreferences(value);
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    return emptyDashboardAgentPreferences();
  }
}

export function updateDashboardAgentPreferences(vault, patch) {
  const key = path.resolve(vault);
  const previous = pendingWrites.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => writeDashboardAgentPreferences(vault, patch));
  pendingWrites.set(key, pending);
  void pending.finally(() => {
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key);
  }).catch(() => {});
  return pending;
}

async function writeDashboardAgentPreferences(vault, patch) {
  const current = await readDashboardAgentPreferences(vault);
  const next = normalizeDashboardAgentPreferences({
    ...current,
    ...(patch?.viki ? { viki: patch.viki } : {}),
    ...(patch?.queue ? { queue: patch.queue } : {})
  });
  const file = preferencesFile(vault);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
  return next;
}

export function normalizeDashboardAgentPreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const viki = source.viki && typeof source.viki === "object" && !Array.isArray(source.viki) ? source.viki : {};
  const models = viki.models && typeof viki.models === "object" && !Array.isArray(viki.models) ? viki.models : {};
  return {
    version: 1,
    viki: {
      provider: normalizeProvider(viki.provider),
      models: Object.fromEntries(Object.entries(models).flatMap(([provider, model]) => {
        const normalizedProvider = normalizeProvider(provider);
        const normalizedModel = normalizeModel(model);
        return normalizedProvider && normalizedModel ? [[normalizedProvider, normalizedModel]] : [];
      }))
    },
    queue: {
      distill: normalizeSelection(source.queue?.distill),
      repair: normalizeSelection(source.queue?.repair)
    }
  };
}

function normalizeSelection(value) {
  return {
    provider: normalizeProvider(value?.provider),
    model: normalizeModel(value?.model)
  };
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return PROVIDERS.has(provider) ? provider : "";
}

function normalizeModel(value) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 256);
}

function preferencesFile(vault) {
  return path.join(vault, ".my-wiki", "dashboard-agent-preferences.json");
}
