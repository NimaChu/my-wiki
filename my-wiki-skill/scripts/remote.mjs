#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs, createWriteStream } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const remoteConfigPath = () => process.env.MY_WIKI_REMOTE_CONFIG_PATH
  ? path.resolve(process.env.MY_WIKI_REMOTE_CONFIG_PATH) : path.join(os.homedir(), ".my-wiki", "remote.json");
export async function readRemoteConfig() {
  try { return JSON.parse(await fs.readFile(remoteConfigPath(), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw new Error("Cannot read remote configuration"); }
}
export function remoteOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Remote server must be an HTTPS origin, for example https://my-wiki.cloud");
  }
  return url.origin;
}
async function saveConfig(value) {
  const file = remoteConfigPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}
function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true, shell: false });
  child.on("error", () => process.stderr.write("Open the login URL above in this computer's browser.\n"));
  child.unref();
}

export async function browserLogin(origin, { open = openBrowser } = {}) {
  origin = remoteOrigin(origin);
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Attach immediately so a timeout during setup cannot become an unhandled rejection.
  codePromise.catch(() => {});
  let received = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/callback" || url.searchParams.get("state") !== state
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code") || "") || received) {
      res.writeHead(400).end("Invalid login callback");
      return;
    }
    received = true;
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
    res.end("GitHub login received. Return to your terminal to check authorization. You can close this tab.");
    resolveCode(url.searchParams.get("code"));
  });
  const timer = setTimeout(() => rejectCode(new Error("Login timed out; run remote login again")), 600000);
  const interrupt = () => rejectCode(new Error("Login cancelled"));
  process.once("SIGINT", interrupt);
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const url = new URL("/auth/cli", origin);
    url.searchParams.set("redirect_uri", `http://127.0.0.1:${server.address().port}/callback`);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("state", state);
    process.stderr.write(`Sign in with your authorized GitHub account:\n${url.href}\n`);
    open(url.href);
    const code = await codePromise;
    const response = await fetch(`${origin}/api/remote/v1/token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, name: os.hostname() })
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error(result.error || `Login failed: HTTP ${response.status}`);
    await saveConfig({ origin, token: result.access_token, expiresAt: result.expiresAt, deviceId: result.deviceId, enabled: true });
    return { authorized: true, origin, expiresAt: result.expiresAt };
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function remoteRequest(config, route, { method = "GET", json, bytes, binary = false } = {}) {
  const origin = remoteOrigin(config.origin);
  if (!config.token) throw new Error("Run remote login first");
  const headers = { authorization: `Bearer ${config.token}` };
  let body;
  if (json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
  if (bytes !== undefined) { headers["content-type"] = "application/octet-stream"; body = bytes; }
  const response = await fetch(`${origin}/api/remote/v1/${route}`, {
    method, headers, body, redirect: "error", signal: AbortSignal.timeout(180000)
  });
  if (binary && response.ok) return response;
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { status: response.status });
  return result;
}

function argumentsOf(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { positional.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`--${key} needs a value`);
    flags[key] = args[++i];
  }
  return { positional, flags };
}
export async function runRemote(args, { login = browserLogin } = {}) {
  if (args[0] === "remote") args = args.slice(1);
  const { positional: [command = "help", ...values], flags } = argumentsOf(args);
  if (command === "help") return { commands: ["connect [https://my-wiki.cloud]", "login [https://my-wiki.cloud]", "where", "status", "universes", "search <query> [--galaxy <name>]", "read <path>", "edit <path> --file <body.md> --version <version>", "download <path> --output <file>", "capture --url <url> | --file <file> [--title <title>] [--galaxy <name>]", "inbox", "job <id>", "devices", "revoke <deviceId>", "logout", "off", "on"] };
  if (command === "login" || command === "connect") {
    const saved = await readRemoteConfig();
    const origin = remoteOrigin(values[0] || saved?.origin || "https://my-wiki.cloud");
    if (command === "connect" && saved?.token && saved.origin === origin) {
      try {
        await remoteRequest(saved, "vault");
        await saveConfig({ ...saved, enabled: true });
        return { connected: true, origin, expiresAt: saved.expiresAt };
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }
    return login(origin);
  }
  const config = await readRemoteConfig();
  if (!config) throw new Error("No remote configured. Run remote login https://my-wiki.cloud");
  if (command === "where") return { mode: "remote", origin: config.origin, enabled: config.enabled, expiresAt: config.expiresAt };
  if (command === "off" || command === "on") { await saveConfig({ ...config, enabled: command === "on" }); return { enabled: command === "on" }; }
  const request = (route, options) => remoteRequest(config, route, options);
  if (command === "logout") {
    await request("devices", { method: "DELETE" });
    await fs.rm(remoteConfigPath(), { force: true });
    return { loggedOut: true };
  }
  if (command === "devices") return request("devices");
  if (command === "revoke") {
    if (!values[0]) throw new Error("A device ID is required");
    return request(`devices?id=${encodeURIComponent(values[0])}`, { method: "DELETE" });
  }
  if (command === "status") return request("vault");
  if (command === "universes") return request("universes");
  if (command === "inbox") return request("inbox");
  if (command === "job") {
    if (!values[0]) throw new Error("A job ID is required");
    return request(`jobs/${encodeURIComponent(values[0])}`);
  }
  if (command === "search") {
    const params = new URLSearchParams({ q: values.join(" "), limit: flags.limit || "20" });
    if (flags.galaxy) params.append("galaxy", flags.galaxy);
    return request(`search?${params}`);
  }
  if (command === "read" || command === "edit" || command === "download") {
    if (!values[0]) throw new Error("A vault-relative path is required");
    if (command === "read") return request(`markdown?${new URLSearchParams({ path: values[0] })}`);
    if (command === "edit") {
      if (!flags.file || !flags.version) throw new Error("edit needs --file <body.md> and --version from read");
      return request("markdown", { method: "PUT", json: { path: values[0], body: await fs.readFile(flags.file, "utf8"), expectedVersion: flags.version } });
    }
    if (!flags.output) throw new Error("download needs --output <local-file>");
    const response = await request(`download?${new URLSearchParams({ path: values[0] })}`, { binary: true });
    await pipeline(Readable.fromWeb(response.body), createWriteStream(flags.output, { flags: "wx", mode: 0o600 }));
    return { downloaded: path.resolve(flags.output) };
  }
  if (command === "capture") {
    if (Boolean(flags.url) === Boolean(flags.file)) throw new Error("Choose exactly one of --url or --file");
    const metadata = { title: flags.title || "", collection: flags.collection || "", suggestedUniverse: flags.galaxy || "" };
    if (flags.url) return request("inbox/url", { method: "POST", json: { ...metadata, url: flags.url } });
    const file = await fs.open(flags.file, "r");
    let upload;
    let completing = false;
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error("Upload must be a file");
      upload = await request("inbox/file/uploads", { method: "POST", json: { ...metadata, filename: path.basename(flags.file), size: stat.size } });
      let offset = 0;
      const chunk = Buffer.alloc(Math.min(upload.chunkSize, 4 * 1024 * 1024));
      while (offset < stat.size) {
        const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, stat.size - offset), offset);
        if (!bytesRead) throw new Error("File changed during upload");
        const result = await request(`inbox/file/uploads/${upload.id}?offset=${offset}`, { method: "PATCH", bytes: chunk.subarray(0, bytesRead) });
        offset = result.offset;
        process.stderr.write(`Uploaded ${offset}/${stat.size} bytes\n`);
      }
      completing = true;
      return await request(`inbox/file/uploads/${upload.id}/complete`, { method: "POST", json: {} });
    } catch (error) {
      if (upload && !completing) await request(`inbox/file/uploads/${upload.id}`, { method: "DELETE" }).catch(() => {});
      if (completing) error.message += "; submission may have succeeded. Check inbox before retrying.";
      throw error;
    } finally { await file.close(); }
  }
  throw new Error(`Remote command is not supported: ${command}. Run remote help. No local fallback was performed.`);
}

export async function remoteCli(args) {
  try { process.stdout.write(JSON.stringify(await runRemote(args), null, 2) + "\n"); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await remoteCli(process.argv.slice(2));
