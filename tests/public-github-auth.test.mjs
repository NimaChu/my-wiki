import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SignJWT } from "jose";
import { createHash } from "node:crypto";
import { createPublicAccess } from "../scripts/core/public-access.mjs";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";

test("public hosts show GitHub-only login before any vault response", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-wiki-auth-"));
  const config = path.join(root, "oauth.json");
  await writeFile(config, JSON.stringify({ clientId: "client-id", clientSecret: "client-secret", sessionSecret: "a".repeat(64) }));
  context.after(() => rm(root, { recursive: true, force: true }));

  const previous = {
    hosts: process.env.MY_WIKI_DASHBOARD_PUBLIC_HOSTS,
    canonicalHost: process.env.MY_WIKI_DASHBOARD_PUBLIC_CANONICAL_HOST,
    config: process.env.MY_WIKI_GITHUB_OAUTH_CONFIG,
    admin: process.env.MY_WIKI_ADMIN_GITHUB_LOGIN
  };
  process.env.MY_WIKI_DASHBOARD_PUBLIC_HOSTS = "my-wiki.cloud,www.my-wiki.cloud";
  process.env.MY_WIKI_DASHBOARD_PUBLIC_CANONICAL_HOST = "my-wiki.cloud";
  process.env.MY_WIKI_GITHUB_OAUTH_CONFIG = config;
  process.env.MY_WIKI_ADMIN_GITHUB_LOGIN = "NimaChu";
  context.after(() => {
    setEnv("MY_WIKI_DASHBOARD_PUBLIC_HOSTS", previous.hosts);
    setEnv("MY_WIKI_DASHBOARD_PUBLIC_CANONICAL_HOST", previous.canonicalHost);
    setEnv("MY_WIKI_GITHUB_OAUTH_CONFIG", previous.config);
    setEnv("MY_WIKI_ADMIN_GITHUB_LOGIN", previous.admin);
  });

  const auth = await createPublicAccess({ personalVault: "/private/local-vault" });
  const dashboardApi = createDashboardApi({ dashboardRoot: root, port: 0, requestContext: auth.context, accessControl: auth.allowlist, remoteAccess: auth.remote });
  const server = http.createServer(async (req, res) => {
    if (await auth.handle(req, res)) return;
    if (await dashboardApi(req, res)) return;
    res.writeHead(200).end("private application");
  });
  context.after(() => server.close());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const login = await request(port, "/", { host: "my-wiki.cloud" });
  assert.equal(login.status, 200);
  assert.match(login.body, /使用 GitHub 登录/);
  assert.doesNotMatch(login.body, /private application/);
  assert.match(login.body, /viewport-fit=cover/);
  assert.match(login.body, /prefers-color-scheme:dark/);
  assert.match(login.body, /min-height:52px/);
  assert.doesNotMatch(login.body, /maximum-scale|user-scalable=no/);
  assert.equal(login.headers["cache-control"], "no-store");
  const mobileHeaders = { host: "my-wiki.cloud", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile" };
  assert.match((await request(port, "/", mobileHeaders)).body, /使用 GitHub 登录/);
  assert.equal((await request(port, "/api/v1/graph", mobileHeaders)).status, 401);
  assert.doesNotMatch((await request(port, "/assets/app.js", mobileHeaders)).body, /private application/);

  const api = await request(port, "/api/v1/vault", { host: "my-wiki.cloud" });
  assert.equal(api.status, 401);
  assert.deepEqual(JSON.parse(api.body), { error: "GitHub authentication is required" });

  const authorize = await request(port, "/auth/github", { host: "my-wiki.cloud" });
  assert.equal(authorize.status, 302);
  assert.match(authorize.headers.location, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  assert.match(String(authorize.headers["set-cookie"]), /my_wiki_oauth_state=.*HttpOnly; Secure; SameSite=Lax/);

  const www = await request(port, "/api/v1/vault?from=www", { host: "www.my-wiki.cloud" });
  assert.equal(www.status, 308);
  assert.equal(www.headers.location, "https://my-wiki.cloud/api/v1/vault?from=www");

  const untrustedToken = await new SignJWT({ login: "someone-else" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("my-wiki")
    .setAudience("my-wiki.cloud")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("a".repeat(64)));
  await assert.rejects(
    auth.context({ headers: { host: "my-wiki.cloud", cookie: `my_wiki_session=${encodeURIComponent(untrustedToken)}` } }),
    { status: 403 }
  );

  const local = await request(port, "/", { host: "127.0.0.1" });
  assert.equal(local.body, "private application");
  assert.equal((await auth.context({ headers: { host: "127.0.0.1" } })).canManageProviders, true);

  const verifier = "v".repeat(43);
  const params = new URLSearchParams({ redirect_uri: "http://127.0.0.1:54321/callback", state: "c".repeat(43),
    code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const start = await request(port, `/auth/cli?${params}`, { host: "my-wiki.cloud" });
  assert.equal(start.status, 302);
  const cliAuthorize = await request(port, start.headers.location, { host: "my-wiki.cloud" });
  assert.equal(cliAuthorize.status, 302);
  const state = new URL(cliAuthorize.headers.location).searchParams.get("state");
  const cookie = cliAuthorize.headers["set-cookie"][0].split(";")[0];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "github-test-token" });
    if (url === "https://api.github.com/user") return Response.json({ id: 123, login: "NimaChu" });
    throw new Error("Unexpected network request");
  };
  context.after(() => { globalThis.fetch = originalFetch; });
  const callback = await request(port, `/auth/github/callback?state=${state}&code=test`, { host: "my-wiki.cloud", cookie });
  assert.equal(callback.status, 302);
  const cliReturn = new URL(callback.headers.location);
  assert.equal(cliReturn.origin, "http://127.0.0.1:54321");
  assert.equal(cliReturn.searchParams.get("state"), "c".repeat(43));
  const exchangeBody = JSON.stringify({ code: cliReturn.searchParams.get("code"), code_verifier: verifier });
  const exchange = await request(port, "/api/remote/v1/token", { host: "my-wiki.cloud", "content-type": "application/json" }, "POST", exchangeBody);
  assert.equal(exchange.status, 200);
  const token = JSON.parse(exchange.body).access_token;
  assert.equal((await auth.remote.authorize({ headers: { authorization: `Bearer ${token}` } })).vault, "/private/local-vault");
  const reuse = await request(port, "/api/remote/v1/token", { host: "my-wiki.cloud", "content-type": "application/json" }, "POST", exchangeBody);
  assert.equal(reuse.status, 401);
  const browserWithCliToken = await request(port, "/", { host: "my-wiki.cloud", authorization: `Bearer ${token}` });
  assert.match(browserWithCliToken.body, /使用 GitHub 登录/);

  const ownerCookie = callback.headers["set-cookie"][0].split(";")[0];
  const browserStart = await request(port, "/auth/github", mobileHeaders);
  const browserState = new URL(browserStart.headers.location).searchParams.get("state");
  const browserCallback = await request(port, `/auth/github/callback?state=${browserState}&code=test`, {
    ...mobileHeaders, cookie: browserStart.headers["set-cookie"][0].split(";")[0]
  });
  assert.equal(browserCallback.status, 302);
  assert.equal(browserCallback.headers.location, "/");
  const authorizedMobile = await request(port, "/", { ...mobileHeaders, cookie: browserCallback.headers["set-cookie"][0].split(";")[0] });
  assert.equal(authorizedMobile.body, "private application");
  const session = await request(port, "/api/v1/session", { host: "my-wiki.cloud", cookie: ownerCookie });
  assert.equal(JSON.parse(session.body).canManageAccess, true);
  assert.equal(JSON.parse(session.body).canManageProviders, true);
  const ownerHeaders = { host: "my-wiki.cloud", cookie: ownerCookie, "x-my-wiki-token": JSON.parse(session.body).token, "content-type": "application/json" };
  const initial = await request(port, "/api/v1/access/allowlist", ownerHeaders);
  assert.deepEqual(JSON.parse(initial.body).accounts, [{ login: "NimaChu", owner: true }]);
  const added = await request(port, "/api/v1/access/allowlist", ownerHeaders, "POST", JSON.stringify({ login: "someone-else" }));
  assert.equal(added.status, 200);
  const guestHeaders = { ...ownerHeaders, cookie: `my_wiki_session=${untrustedToken}` };
  assert.equal((await auth.context({ headers: guestHeaders })).canManageAccess, false);
  assert.equal((await auth.context({ headers: guestHeaders })).canManageProviders, false);
  assert.equal((await request(port, "/api/v1/settings/api", guestHeaders)).status, 403);
  assert.equal((await request(port, "/api/v1/settings/api", guestHeaders, "PUT", JSON.stringify({ apiKey: "must-not-save" }))).status, 403);
  assert.equal((await request(port, "/api/v1/access/allowlist", guestHeaders)).status, 403);
  assert.equal((await request(port, "/api/v1/access/allowlist", guestHeaders, "POST", JSON.stringify({ login: "intruder" }))).status, 403);
  auth.remote.bind("guest-state", auth.remote.begin(params));
  const guestCode = new URL(auth.remote.complete("guest-state", "someone-else")).searchParams.get("code");
  const guestToken = await auth.remote.exchange({ code: guestCode, code_verifier: verifier });
  const guestReq = { headers: { authorization: `Bearer ${guestToken.access_token}` } };
  const guestContext = await auth.remote.authorize(guestReq);
  assert.equal(guestContext.login, "someone-else");
  assert.equal(guestContext.canManageAccess, false);
  assert.equal((await auth.remote.list(guestContext)).length, 1);
  const ownerDevice = (await auth.remote.list()).find((entry) => entry.login === "NimaChu");
  await assert.rejects(auth.remote.revoke(ownerDevice.id, guestContext), { status: 403 });
  const protectedOwner = await request(port, "/api/v1/access/allowlist", ownerHeaders, "DELETE", JSON.stringify({ login: "nimachu" }));
  assert.equal(protectedOwner.status, 400);
  assert.equal((await request(port, "/api/v1/access/allowlist", ownerHeaders, "DELETE", JSON.stringify({ login: "someone-else" }))).status, 200);
  await assert.rejects(auth.context({ headers: guestHeaders }), { status: 403 });
  await assert.rejects(auth.remote.authorize(guestReq), { status: 401 });
  const restarted = await createPublicAccess({ personalVault: "/private/local-vault" });
  assert.deepEqual(restarted.allowlist.list().accounts, [{ login: "NimaChu", owner: true }]);
});

function request(port, route, headers, method = "GET", data = "") {
  if (data) headers = { ...headers, "content-length": Buffer.byteLength(data) };
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: "127.0.0.1", port, path: route, headers, method }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on("error", reject);
    outgoing.end(data);
  });
}

function setEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
