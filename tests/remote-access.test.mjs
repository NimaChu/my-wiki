import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRemoteAuth } from "../scripts/core/remote-auth.mjs";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";
import { declareUniverse, setUniverseHidden } from "../scripts/core/universe-registry.mjs";
import { browserLogin, remoteOrigin, runRemote } from "../my-wiki-skill/scripts/remote.mjs";

const verifier = "a".repeat(43);
const params = () => new URLSearchParams({
  redirect_uri: "http://127.0.0.1:23456/callback", state: "s".repeat(43),
  code_challenge: createHash("sha256").update(verifier).digest("base64url")
});
function grant(auth) {
  auth.bind("oauth-state", auth.begin(params()));
  return new URL(auth.complete("oauth-state", "NimaChu")).searchParams.get("code");
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-remote-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { directory: path.join(root, "devices"), vault: path.join(root, "vault"), owner: "NimaChu", enabled: true, root };
}

test("remote grants require PKCE and owner identity; devices persist and are revocable", async (t) => {
  const options = await fixture(t);
  let time = Date.now();
  const auth = createRemoteAuth({ ...options, now: () => time });
  const invalid = params();
  invalid.set("redirect_uri", "https://evil.example/callback");
  assert.throws(() => auth.begin(invalid), { status: 400 });
  auth.bind("wrong-owner", auth.begin(params()));
  assert.throws(() => auth.complete("wrong-owner", "other"), { status: 403 });
  const code = grant(auth);
  await assert.rejects(auth.exchange({ code, code_verifier: "b".repeat(43) }), { status: 401 });
  const result = await auth.exchange({ code, code_verifier: verifier, name: "Office" });
  await assert.rejects(auth.exchange({ code, code_verifier: verifier }), { status: 401 });
  const req = { headers: { authorization: `Bearer ${result.access_token}` } };
  const restarted = createRemoteAuth(options);
  assert.equal((await restarted.authorize(req)).vault, options.vault);
  const saved = await fs.readFile(path.join(options.directory, `${result.deviceId}.json`), "utf8");
  assert.ok(!saved.includes(result.access_token));
  if (process.platform !== "win32") assert.equal((await fs.stat(path.join(options.directory, `${result.deviceId}.json`))).mode & 0o777, 0o600);
  await restarted.revoke(result.deviceId);
  await assert.rejects(auth.authorize(req), { status: 401 });
  const expiredCode = grant(auth);
  time += 61000;
  await assert.rejects(auth.exchange({ code: expiredCode, code_verifier: verifier }), { status: 401 });
});

test("remote API scopes search and denies browser sessions, traversal, and privileged operations", async (t) => {
  const options = await fixture(t);
  const dashboardRoot = path.join(options.root, "dashboard");
  await fs.mkdir(dashboardRoot);
  await fs.mkdir(path.join(options.vault, "concepts"), { recursive: true });
  await fs.writeFile(path.join(options.vault, "concepts", "ai.md"), "---\ntitle: AI\ntype: Concept\nuniverses: [AI]\n---\nShared knowledge AI");
  await fs.writeFile(path.join(options.vault, "concepts", "flex.md"), "---\ntitle: Flex\ntype: Concept\nuniverses: [FlexSim]\n---\nShared knowledge FlexSim");
  await declareUniverse(options.vault, "FlexSim");
  await setUniverseHidden(options.vault, "FlexSim", true);
  const remoteAccess = createRemoteAuth(options);
  const { access_token: token } = await remoteAccess.exchange({ code: grant(remoteAccess), code_verifier: verifier });
  let uploadedBytes;
  const server = http.createServer(createDashboardApi({ dashboardRoot, port: 0, remoteAccess,
    localFileIngestor: async ({ file }) => {
      uploadedBytes = await fs.readFile(file);
      return { kind: "markdown", count: 1, items: [{ status: "inbox", path: "references/sources/uploaded.md" }] };
    }
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = async (route, { authorized = true, method = "GET", body, bytes, origin } = {}) => {
    const headers = { "content-type": "application/json" };
    if (authorized) headers.authorization = `Bearer ${token}`;
    if (origin) headers.origin = origin;
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/remote/v1/${route}`, { method, headers, body: bytes || (body && JSON.stringify(body)) });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await request("vault", { authorized: false })).status, 401);
  assert.equal((await request("vault", { origin: "https://evil.example" })).status, 403);
  for (const route of ["session", "agent", "graph"]) assert.equal((await request(route)).status, 403);
  assert.equal((await request("agent/maintenance", { method: "POST", body: {} })).status, 403);
  const search = await request("search?q=Shared");
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.results.map((x) => x.path), ["concepts/ai.md"]);
  const explicit = await request("search?q=Shared&galaxy=FlexSim");
  assert.deepEqual(explicit.body.results.map((x) => x.path), ["concepts/flex.md"]);
  const doc = await request("markdown?path=concepts%2Fai.md");
  assert.equal(doc.status, 200);
  const edited = await request("markdown", { method: "PUT", body: { path: "concepts/ai.md", body: "Updated knowledge", expectedVersion: doc.body.version } });
  assert.equal(edited.status, 200);
  assert.equal((await request("markdown", { method: "PUT", body: { path: "concepts/ai.md", body: "Stale", expectedVersion: doc.body.version } })).status, 409);
  assert.notEqual((await request("markdown?path=..%2Fsecret.md")).status, 200);
  assert.notEqual((await request("download?path=..%2Fsecret.md")).status, 200);
  const upload = await request("inbox/file/uploads", { method: "POST", body: { filename: "test.md", size: 5 } });
  assert.equal(upload.status, 201);
  const base = `inbox/file/uploads/${upload.body.id}`;
  assert.equal((await request(`${base}/complete`, { method: "POST", body: {} })).status, 409);
  assert.equal((await request(`${base}?offset=0`, { method: "PATCH", bytes: Buffer.from("hello") })).status, 200);
  const job = await request(`${base}/complete`, { method: "POST", body: {} });
  assert.equal(job.status, 202);
  let done;
  for (let i = 0; i < 50; i++) {
    done = await request(`jobs/${job.body.id}`);
    if (done.body.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(done.body.status, "complete");
  assert.equal(uploadedBytes.toString(), "hello");
  assert.deepEqual((await request("devices")).body.devices.map((x) => x.id).length, 1);
  assert.equal((await request("devices", { method: "DELETE" })).status, 200);
  assert.equal((await request("vault")).status, 401);
});

test("lightweight bridge works without project and does not fall back on unsupported remote operations", async (t) => {
  const options = await fixture(t);
  const config = path.join(options.root, "remote.json");
  await fs.writeFile(config, JSON.stringify({ enabled: true, origin: "https://my-wiki.cloud", token: "fake" }));
  const bridge = path.resolve("my-wiki-skill/scripts/my-wiki.mjs");
  const env = { ...process.env, MY_WIKI_REMOTE_CONFIG_PATH: config };
  const { stdout } = await promisify(execFile)(process.execPath, [bridge, "where"], { cwd: options.root, env });
  assert.equal(JSON.parse(stdout).mode, "remote");
  await assert.rejects(promisify(execFile)(process.execPath, [bridge, "init", "should-not-exist"], { cwd: options.root, env }), (error) => /No local fallback/.test(error.stderr));
  await assert.rejects(fs.stat(path.join(options.root, "should-not-exist")), { code: "ENOENT" });
  assert.throws(() => remoteOrigin("http://my-wiki.cloud"));
  assert.throws(() => remoteOrigin("https://someone:secret@my-wiki.cloud"));
});

test("remote connect defaults to the public service, reuses authorization, and preserves network failures", async (t) => {
  const options = await fixture(t);
  const previous = process.env.MY_WIKI_REMOTE_CONFIG_PATH;
  const originalFetch = globalThis.fetch;
  const configFile = path.join(options.root, "remote.json");
  process.env.MY_WIKI_REMOTE_CONFIG_PATH = configFile;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.MY_WIKI_REMOTE_CONFIG_PATH;
    else process.env.MY_WIKI_REMOTE_CONFIG_PATH = previous;
  });
  const logins = [];
  const login = async (origin) => { logins.push(origin); return { authorized: true, origin }; };
  await runRemote(["remote", "connect"], { login });
  assert.deepEqual(logins, ["https://my-wiki.cloud"]);
  const config = { origin: "https://saved.example", token: "saved-token", enabled: false };
  await fs.writeFile(configFile, JSON.stringify(config));
  globalThis.fetch = async (url) => { assert.equal(url, "https://saved.example/api/remote/v1/vault"); return Response.json({}); };
  assert.equal((await runRemote(["remote", "connect"], { login })).connected, true);
  assert.equal(JSON.parse(await fs.readFile(configFile, "utf8")).enabled, true);
  assert.equal(logins.length, 1);
  globalThis.fetch = async () => Response.json({ error: "Offline" }, { status: 503 });
  await assert.rejects(runRemote(["remote", "connect"], { login }), { status: 503 });
  assert.equal(logins.length, 1);
  globalThis.fetch = async () => Response.json({ error: "Expired" }, { status: 401 });
  await runRemote(["remote", "connect"], { login });
  assert.equal(logins[1], "https://saved.example");
  await runRemote(["remote", "connect", "https://explicit.example"], { login });
  assert.equal(logins[2], "https://explicit.example");
});

test("CLI browser login validates state and saves only exchanged device credentials", async (t) => {
  const options = await fixture(t);
  const previousConfig = process.env.MY_WIKI_REMOTE_CONFIG_PATH;
  process.env.MY_WIKI_REMOTE_CONFIG_PATH = path.join(options.root, "remote.json");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousConfig === undefined) delete process.env.MY_WIKI_REMOTE_CONFIG_PATH;
    else process.env.MY_WIKI_REMOTE_CONFIG_PATH = previousConfig;
  });
  let challenge;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
    assert.equal(url, "https://my-wiki.cloud/api/remote/v1/token");
    const body = JSON.parse(init.body);
    assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), challenge);
    assert.equal(init.redirect, "error");
    return Response.json({ access_token: "test-device-token", expiresAt: Date.now() + 10000, deviceId: "test-device" });
  };
  let callback;
  const result = await browserLogin("https://my-wiki.cloud", { open: (value) => {
    const url = new URL(value);
    challenge = url.searchParams.get("code_challenge");
    callback = (async () => {
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      redirect.searchParams.set("code", "c".repeat(43));
      redirect.searchParams.set("state", "wrong");
      assert.equal((await originalFetch(redirect)).status, 400);
      redirect.searchParams.set("state", url.searchParams.get("state"));
      assert.equal((await originalFetch(redirect)).status, 200);
    })();
  } });
  await callback;
  assert.equal(result.authorized, true);
  const stored = JSON.parse(await fs.readFile(process.env.MY_WIKI_REMOTE_CONFIG_PATH, "utf8"));
  assert.equal(stored.token, "test-device-token");
  assert.equal(stored.enabled, true);
  assert.ok(!JSON.stringify(result).includes(stored.token));
});
