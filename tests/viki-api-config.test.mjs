import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { publicVikiApiSettings, readVikiApiConfig, updateVikiApiSettings } from "../scripts/core/viki-api-config.mjs";
import { createVikiApiRunner } from "../scripts/core/viki-api-agent.mjs";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mywiki-api-settings-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, env: { MY_WIKI_PROVIDERS_FILE: path.join(root, "private", "providers.json") } };
}

test("API settings keep keys private, preserve unrelated configuration and persist without restart", async (t) => {
  const { env } = await fixture(t);
  assert.equal((await publicVikiApiSettings(env)).configured, false);
  const key = "fixture-key-not-a-real-credential";
  const saved = await updateVikiApiSettings({ apiKey: key, model: "deepseek-v4-pro" }, env);
  assert.equal(saved.configured, true);
  assert.equal(saved.keySource, "file");
  assert.equal(saved.model, "deepseek-v4-pro");
  assert.ok(!JSON.stringify(saved).includes(key));
  const file = env.MY_WIKI_PROVIDERS_FILE;
  if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const original = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(file, JSON.stringify({ ...original, other: { enabled: true } }));
  await Promise.all([updateVikiApiSettings({ apiKey: "", reasoningEffort: "low" }, env), updateVikiApiSettings({ model: "deepseek-flash" }, env)]);
  assert.equal((await readVikiApiConfig(env)).apiKey, key);
  assert.equal((await readVikiApiConfig(env)).reasoningEffort, "low");
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).other, { enabled: true });
  const runner = createVikiApiRunner({ env });
  assert.equal((await runner.info()).available, true);
  assert.ok(!JSON.stringify(await runner.info()).includes(key));
  await updateVikiApiSettings({ removeKey: true }, env);
  assert.equal((await runner.info()).available, false);
  assert.equal((await publicVikiApiSettings(env)).keySource, "none");
});

test("API settings validate mutations and respect environment-managed credentials", async (t) => {
  const { env } = await fixture(t);
  const environment = { ...env, DEEPSEEK_API_KEY: "environment-fixture-key" };
  assert.equal((await publicVikiApiSettings(environment)).keySource, "environment");
  for (const patch of [{ apiKey: "replacement" }, { removeKey: true }]) await assert.rejects(updateVikiApiSettings(patch, environment), { status: 409 });
  for (const patch of [{ apiKey: "bad\nvalue" }, { model: "unknown" }, { reasoningEffort: "invalid" }, { removeKey: "true" }, { baseURL: "http://localhost" }, { apiKey: "replacement", removeKey: true }]) {
    await assert.rejects(updateVikiApiSettings(patch, env), { status: 400 });
  }
  await updateVikiApiSettings({ reasoningEffort: "max" }, environment);
  assert.equal((await readVikiApiConfig(environment)).apiKey, environment.DEEPSEEK_API_KEY);
  assert.equal((await publicVikiApiSettings(environment)).reasoningEffort, "max");
  assert.ok(!(await fs.readFile(env.MY_WIKI_PROVIDERS_FILE, "utf8")).includes(environment.DEEPSEEK_API_KEY));
});

test("API configuration requires owner authorization, session token and same-origin access", async (t) => {
  const { root, env } = await fixture(t);
  let owner = false;
  const allowedOrigins = new Set();
  const server = http.createServer(createDashboardApi({ dashboardRoot: root, port: 0, allowedOrigins,
    requestContext: async () => ({ vault: root, canManageProviders: owner }),
    vikiApiRunner: createVikiApiRunner({ env }), agentRunner: { info: async () => ({ available: false, providers: [] }) },
    remoteAccess: { authorize: async () => ({ vault: root, canManageProviders: true }) }
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  allowedOrigins.add(base);
  const { token } = await (await fetch(base + "/api/v1/session")).json();
  const headers = { "x-my-wiki-token": token, "content-type": "application/json" };
  const endpoint = base + "/api/v1/settings/api";
  assert.equal((await fetch(endpoint, { headers })).status, 403);
  owner = true;
  assert.equal((await fetch(endpoint)).status, 403);
  assert.equal((await fetch(endpoint, { headers: { ...headers, origin: "https://evil.example" } })).status, 403);
  const saved = await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify({ apiKey: "http-fixture-key", model: "deepseek-v4-pro" }) });
  assert.equal(saved.status, 200);
  assert.ok(!(await saved.text()).includes("http-fixture-key"));
  const data = await (await fetch(endpoint, { headers })).json();
  assert.equal(data.configured, true);
  assert.equal(data.model, "deepseek-v4-pro");
  assert.equal(data.apiKey, undefined);
  const agent = await (await fetch(base + "/api/v1/agent", { headers })).json();
  assert.equal(agent.answerProviders[0].executionMode, "api");
  assert.equal(agent.providers.length, 0);
  assert.equal((await fetch(base + "/api/remote/v1/settings/api", { headers })).status, 403);
  owner = false;
  assert.equal((await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify({ removeKey: true }) })).status, 403);
  assert.equal((await readVikiApiConfig(env)).apiKey, "http-fixture-key");
});
