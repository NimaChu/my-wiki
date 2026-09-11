import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const digest = (value) => createHash("sha256").update(value).digest("base64url");
const secret = () => randomBytes(32).toString("base64url");
const fail = (status, message) => Object.assign(new Error(message), { status, statusCode: status });

// Pending grants are deliberately ephemeral; device credentials survive restarts.
export function createRemoteAuth({ directory, owner, vault, enabled, now = Date.now, isAllowed = (login) => login.toLowerCase() === owner.toLowerCase() }) {
  const pending = new Map();
  const oauthStates = new Map();
  const codes = new Map();
  function cleanup() {
    for (const map of [pending, oauthStates, codes]) {
      for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key);
    }
  }
  function requireEnabled() {
    if (!enabled) throw fail(503, "Remote GitHub authentication is not configured");
    cleanup();
  }
  function begin(params) {
    requireEnabled();
    if (pending.size + oauthStates.size + codes.size >= 100) throw fail(429, "Too many pending logins; try again later");
    const challenge = params.get("code_challenge") || "";
    const state = params.get("state") || "";
    let redirect;
    try { redirect = new URL(params.get("redirect_uri")); } catch { throw fail(400, "Invalid loopback callback"); }
    if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || !redirect.port
      || redirect.pathname !== "/callback" || redirect.search || redirect.hash || redirect.username || redirect.password) {
      throw fail(400, "Callback must be http://127.0.0.1:<port>/callback");
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw fail(400, "Invalid PKCE challenge or state");
    const id = secret();
    pending.set(id, { challenge, state, redirect: redirect.href, expiresAt: now() + 600000 });
    return id;
  }
  function bind(state, id) {
    requireEnabled();
    const flow = pending.get(id);
    if (!flow) throw fail(400, "CLI login expired; run remote login again");
    pending.delete(id);
    oauthStates.set(state, flow);
  }
  function complete(state, login) {
    cleanup();
    const flow = oauthStates.get(state);
    if (!flow) return null;
    oauthStates.delete(state);
    if (!isAllowed(login)) throw fail(403, "Account is not authorized");
    const code = secret();
    codes.set(digest(code), { ...flow, login, expiresAt: now() + 60000 });
    const redirect = new URL(flow.redirect);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", flow.state);
    return redirect.href;
  }
  async function exchange({ code, code_verifier: verifier, name }) {
    requireEnabled();
    if (typeof code !== "string" || typeof verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw fail(401, "Invalid login code");
    const key = digest(code);
    const flow = codes.get(key);
    if (!flow || digest(verifier) !== flow.challenge) throw fail(401, "Invalid or expired login code");
    if (!isAllowed(flow.login)) throw fail(403, "Account is no longer authorized");
    codes.delete(key);
    const token = `mw_${secret()}`;
    const id = digest(token);
    const record = { id, name: String(name || "CLI").slice(0, 100), login: flow.login, createdAt: now(), expiresAt: now() + 90 * 86400000 };
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify(record), { flag: "wx", mode: 0o600 });
    return { access_token: token, token_type: "Bearer", expiresAt: record.expiresAt, deviceId: id };
  }
  async function authorize(req) {
    requireEnabled();
    const header = String(req.headers.authorization || "");
    if (!/^Bearer mw_[A-Za-z0-9_-]{43}$/.test(header)) throw fail(401, "Run remote login to authorize this device");
    const id = digest(header.slice(7));
    const record = await fs.readFile(path.join(directory, `${id}.json`), "utf8").then(JSON.parse).catch(() => null);
    if (!record || record.expiresAt <= now() || !isAllowed(record.login)) throw fail(401, "Device authorization expired or was revoked; run remote login again");
    return { vault, deviceId: id, login: record.login, canManageAccess: record.login.toLowerCase() === owner.toLowerCase() };
  }
  async function revoke(id, context) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw fail(400, "Invalid device ID");
    if (context && !context.canManageAccess) {
      const record = await fs.readFile(path.join(directory, `${id}.json`), "utf8").then(JSON.parse).catch(() => null);
      if (!record || record.login.toLowerCase() !== context.login.toLowerCase()) throw fail(403, "Cannot revoke another account's device");
    }
    await fs.rm(path.join(directory, `${id}.json`), { force: true });
  }
  async function list(context) {
    const entries = await fs.readdir(directory).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    const records = [];
    for (const entry of entries.filter((entry) => /^[A-Za-z0-9_-]{43}\.json$/.test(entry))) {
      const record = JSON.parse(await fs.readFile(path.join(directory, entry), "utf8"));
      if (record.expiresAt > now() && (!context || context.canManageAccess || record.login.toLowerCase() === context.login.toLowerCase())) records.push(record);
    }
    return records;
  }
  return { begin, bind, complete, exchange, authorize, revoke, list };
}

export async function readRemoteJson(req, limit = 8192) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw fail(413, "Request too large");
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw fail(400, "Invalid JSON"); }
}
