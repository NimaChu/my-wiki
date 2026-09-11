import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { jwtVerify, SignJWT } from "jose";
import { createRemoteAuth, readRemoteJson } from "./remote-auth.mjs";
import { createGithubAllowlist } from "./github-allowlist.mjs";

const SESSION_COOKIE = "my_wiki_session";
const STATE_COOKIE = "my_wiki_oauth_state";

export async function createPublicAccess({ personalVault }) {
  const publicHosts = new Set(splitList(process.env.MY_WIKI_DASHBOARD_PUBLIC_HOSTS).map(normalizeHost));
  const canonicalHost = normalizeHost(process.env.MY_WIKI_DASHBOARD_PUBLIC_CANONICAL_HOST) || [...publicHosts][0] || "";
  const adminLogin = String(process.env.MY_WIKI_ADMIN_GITHUB_LOGIN || "").trim().toLowerCase();
  const configFile = String(process.env.MY_WIKI_GITHUB_OAUTH_CONFIG || "").trim();
  const oauth = configFile ? await readOauthConfig(configFile) : {};
  const enabled = Boolean(publicHosts.size && adminLogin && oauth.clientId && oauth.clientSecret && oauth.sessionSecret);
  const signingKey = enabled ? new TextEncoder().encode(oauth.sessionSecret) : null;
  const allowlist = await createGithubAllowlist({
    file: path.join(path.dirname(configFile || "."), "github-allowlist.json"),
    owner: String(process.env.MY_WIKI_ADMIN_GITHUB_LOGIN || "").trim(), enabled
  });
  const remote = createRemoteAuth({
    directory: path.join(path.dirname(configFile || "."), "remote-devices"),
    owner: adminLogin, vault: personalVault, enabled, isAllowed: allowlist.allowed
  });

  async function context(req) {
    const host = normalizeHost(req.headers.host);
    if (!publicHosts.has(host)) return { vault: personalVault, canManageAccess: enabled };
    if (!enabled) throw authError(503, "Public GitHub authentication is not configured");
    const token = requestCookies(req)[SESSION_COOKIE];
    if (!token) throw authError(401, "GitHub authentication is required");
    const { payload } = await jwtVerify(token, signingKey, { issuer: "my-wiki", audience: host })
      .catch(() => { throw authError(401, "GitHub session is missing or expired"); });
    const login = String(payload.login || "").trim();
    if (!login) throw authError(401, "GitHub session is incomplete");
    if (!allowlist.allowed(login)) throw authError(403, "This GitHub account is not authorized to access My Wiki");
    return { vault: personalVault, login, canManageAccess: login.toLowerCase() === adminLogin };
  }

  return {
    enabled,
    context,
    remote,
    allowlist,
    async handle(req, res) {
      const host = normalizeHost(req.headers.host);
      if (!publicHosts.has(host)) return false;
      const url = new URL(req.url || "/", `https://${host}`);
      if (canonicalHost && host !== canonicalHost) {
        res.writeHead(308, { location: `https://${canonicalHost}${url.pathname}${url.search}` });
        res.end();
        return true;
      }
      if (url.pathname.startsWith("/api/remote/v1/")) {
        if (req.headers.origin && req.headers.origin !== `https://${host}`) return sendAuthError(res, 403, "Origin is not allowed");
        if (url.pathname === "/api/remote/v1/token" && req.method === "POST") {
          try {
            const result = await remote.exchange(await readRemoteJson(req));
            res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify(result));
          } catch (error) { sendAuthError(res, error.status || 500, error.message); }
          return true;
        }
        // This namespace has its own bearer authentication inside the API handler.
        return false;
      }
      if (url.pathname === "/auth/cli" && req.method === "GET") {
        try {
          const id = remote.begin(url.searchParams);
          res.writeHead(302, { location: `/auth/github?cli=${id}`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
          res.end();
        } catch (error) { sendAuthError(res, error.status || 500, error.message); }
        return true;
      }
      if (url.pathname === "/auth/github" && req.method === "GET") {
        if (!enabled) return sendAuthError(res, 503, "GitHub login has not been configured yet.");
        const state = randomBytes(24).toString("hex");
        if (url.searchParams.has("cli")) {
          try { remote.bind(state, url.searchParams.get("cli")); }
          catch (error) { return sendAuthError(res, error.status || 400, error.message); }
        }
        const authorize = new URL("https://github.com/login/oauth/authorize");
        authorize.searchParams.set("client_id", oauth.clientId);
        authorize.searchParams.set("redirect_uri", `https://${host}/auth/github/callback`);
        authorize.searchParams.set("scope", "read:user user:email");
        authorize.searchParams.set("state", state);
        res.writeHead(302, {
          location: authorize.href,
          "set-cookie": cookieHeader(STATE_COOKIE, `${state}.${signState(state, oauth.sessionSecret)}`, 600)
        });
        res.end();
        return true;
      }
      if (url.pathname === "/auth/github/callback" && req.method === "GET") {
        if (!enabled) return sendAuthError(res, 503, "GitHub login has not been configured yet.");
        try {
          const state = String(url.searchParams.get("state") || "");
          const code = String(url.searchParams.get("code") || "");
          validateState(state, requestCookies(req)[STATE_COOKIE], oauth.sessionSecret);
          if (!code) throw authError(400, "GitHub did not return an authorization code");
          const identity = await exchangeGithubIdentity(oauth, code, `https://${host}/auth/github/callback`);
          if (!allowlist.allowed(identity.login)) throw authError(403, "This GitHub account is not authorized to access My Wiki");
          const token = await new SignJWT({ login: identity.login }).setProtectedHeader({ alg: "HS256" }).setIssuedAt()
            .setIssuer("my-wiki").setAudience(host).setExpirationTime("7d").sign(signingKey);
          res.writeHead(302, {
            location: remote.complete(state, identity.login) || "/",
            "set-cookie": [cookieHeader(SESSION_COOKIE, token, 7 * 24 * 60 * 60), cookieHeader(STATE_COOKIE, "", 0)]
          });
          res.end();
        } catch (error) {
          sendLoginPage(res, error.message || "GitHub login failed", 401);
        }
        return true;
      }
      try {
        req.myWikiContext = await context(req);
        return false;
      } catch (error) {
        if (url.pathname.startsWith("/api/")) return sendAuthError(res, error.status || 401, error.message);
        if (req.method === "GET" || req.method === "HEAD") {
          sendLoginPage(res, error.status === 503 ? error.message : "", error.status === 503 ? 503 : 200, req.method === "HEAD");
          return true;
        }
        return sendAuthError(res, error.status || 401, error.message);
      }
    }
  };
}

async function exchangeGithubIdentity(oauth, code, redirectUri) {
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "my-wiki" },
    body: JSON.stringify({ client_id: oauth.clientId, client_secret: oauth.clientSecret, code, redirect_uri: redirectUri })
  });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody.access_token) throw authError(401, "GitHub authorization could not be completed");
  const headers = { authorization: `Bearer ${tokenBody.access_token}`, accept: "application/vnd.github+json", "user-agent": "my-wiki" };
  const response = await fetch("https://api.github.com/user", { headers });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user.id || !user.login) throw authError(401, "GitHub identity could not be read");
  return { login: String(user.login) };
}

async function readOauthConfig(file) {
  try {
    const value = JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
    return { clientId: String(value.clientId || "").trim(), clientSecret: String(value.clientSecret || "").trim(), sessionSecret: String(value.sessionSecret || "").trim() };
  } catch { return {}; }
}

function validateState(state, cookie, secret) {
  const [saved, signature] = String(cookie || "").split(".");
  if (!state || !saved || state !== saved || !signature) throw authError(401, "GitHub login state is invalid or expired");
  const expected = signState(saved, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw authError(401, "GitHub login state is invalid or expired");
}

function signState(state, secret) { return createHmac("sha256", secret).update(state).digest("hex"); }
function requestCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [part, ""];
    try { return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; }
    catch { return [part.slice(0, index), ""]; }
  }));
}
function cookieHeader(name, value, maxAge) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }

function sendLoginPage(res, error = "", status = 200, head = false) {
  const message = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 My Wiki</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111516;color:#eef1ed;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.panel{width:min(420px,calc(100vw - 32px));border:1px solid #303638;border-radius:8px;background:#1a1f20;padding:36px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:30px}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:7px;background:#eef1ed;color:#121617;font-weight:800}.brand strong{font-size:21px}.brand span{display:block;margin-top:3px;color:#98a09d;font-size:13px}h1{margin:0 0 10px;font-size:25px;letter-spacing:0}p{color:#aeb5b2;line-height:1.6}.github{display:flex;justify-content:center;align-items:center;width:100%;min-height:46px;margin-top:26px;border:1px solid #444b4d;border-radius:7px;background:#f1f3ef;color:#121617;text-decoration:none;font-weight:700}.github:hover{background:#fff}.error{border-left:3px solid #d97865;padding-left:10px;color:#e7a596;font-size:13px}.privacy{margin:22px 0 0;color:#737c79;font-size:12px;text-align:center}</style></head><body><main class="panel"><div class="brand"><div class="mark">M</div><div><strong>My Wiki</strong><span>你的私有知识宇宙</span></div></div><h1>登录 My Wiki</h1><p>使用已授权的 GitHub 账号继续。</p>${message}<a class="github" href="/auth/github">使用 GitHub 登录</a><p class="privacy">GitHub 只用于确认访问权限。</p></main></body></html>`;
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  res.end(head ? "" : body);
}
function sendAuthError(res, status, message) { const body = JSON.stringify({ error: message }); res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) }); res.end(body); return true; }

function splitList(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function normalizeHost(value) { return String(value || "").trim().toLowerCase().replace(/:\d+$/, ""); }
function authError(status, message) { const error = new Error(message); error.status = status; return error; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
