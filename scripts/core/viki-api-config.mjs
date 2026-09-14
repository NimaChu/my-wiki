import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const pendingWrites = new Map();

export const DEEPSEEK_MODELS = [
  { id: "deepseek-flash", label: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }
];

export function vikiProviderConfigPath(env = process.env) {
  return env.MY_WIKI_PROVIDERS_FILE || path.join(env.XDG_CONFIG_HOME || path.join(env.HOME || env.USERPROFILE || os.homedir(), ".config"), "my-wiki", "providers.json");
}

export async function readVikiApiConfig(env = process.env) {
  let saved = {};
  try { saved = JSON.parse(await fs.readFile(vikiProviderConfigPath(env), "utf8")).deepseek || {}; }
  catch (error) { if (error.code !== "ENOENT") throw new Error("Cannot read My Wiki provider configuration"); }
  const apiKey = String(env.DEEPSEEK_API_KEY || saved.apiKey || "").trim();
  return {
    apiKey,
    model: DEEPSEEK_MODELS.some((item) => item.id === saved.model) ? saved.model : "deepseek-flash",
    reasoningEffort: ["low", "high", "max"].includes(saved.reasoningEffort) ? saved.reasoningEffort : "high"
  };
}

export async function vikiApiProviderInfo(env = process.env) {
  const config = await readVikiApiConfig(env).catch(() => null);
  return config?.apiKey ? { provider: "deepseek-api", label: "DeepSeek API", defaultModel: config.model, models: DEEPSEEK_MODELS } : null;
}

export async function publicVikiApiSettings(env = process.env) {
  const config = await readVikiApiConfig(env);
  return { provider: "deepseek-api", label: "DeepSeek", configured: !!config.apiKey,
    keySource: env.DEEPSEEK_API_KEY?.trim() ? "environment" : config.apiKey ? "file" : "none",
    model: config.model, models: DEEPSEEK_MODELS, reasoningEffort: config.reasoningEffort };
}

export function updateVikiApiSettings(patch, env = process.env) {
  const file = path.resolve(vikiProviderConfigPath(env));
  const pending = (pendingWrites.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
    const invalid = (message) => Object.assign(new Error(message), { status: 400 });
    if (!patch || typeof patch !== "object" || Array.isArray(patch)
      || Object.keys(patch).some((key) => !["apiKey", "removeKey", "model", "reasoningEffort"].includes(key))) throw invalid("Invalid API settings");
    if (patch.apiKey !== undefined && (typeof patch.apiKey !== "string" || patch.apiKey.length > 4096 || /[\s\x00-\x1f\x7f]/.test(patch.apiKey))) throw invalid("Invalid API key format");
    if (patch.removeKey !== undefined && typeof patch.removeKey !== "boolean") throw invalid("Invalid key removal request");
    if (patch.removeKey && patch.apiKey) throw invalid("Cannot replace and remove a key together");
    if (patch.model !== undefined && !DEEPSEEK_MODELS.some((item) => item.id === patch.model)) throw invalid("Unsupported API model");
    if (patch.reasoningEffort !== undefined && !["low", "high", "max"].includes(patch.reasoningEffort)) throw invalid("Invalid reasoning effort");
    if (env.DEEPSEEK_API_KEY?.trim() && (patch.apiKey || patch.removeKey)) throw Object.assign(new Error("The API key is managed by the service environment"), { status: 409 });
    let saved = {};
    try { saved = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("Cannot read My Wiki provider configuration"); }
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid My Wiki provider configuration");
    const next = { ...saved.deepseek };
    if (patch.apiKey) next.apiKey = patch.apiKey;
    if (patch.removeKey) delete next.apiKey;
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.reasoningEffort !== undefined) next.reasoningEffort = patch.reasoningEffort;
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporary, `${JSON.stringify({ ...saved, deepseek: next }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
    return publicVikiApiSettings(env);
  });
  pendingWrites.set(file, pending);
  void pending.finally(() => { if (pendingWrites.get(file) === pending) pendingWrites.delete(file); }).catch(() => {});
  return pending;
}
