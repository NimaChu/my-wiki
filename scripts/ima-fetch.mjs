#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exists, vaultPath } from "./wiki-lib.mjs";

const vault = vaultPath();
const args = process.argv.slice(2);
const rawArg = args.find((arg) => !arg.startsWith("--"));
const metadataOnly = args.includes("--metadata");
const outputPath = readOption("--output");
const baseUrl = (readOption("--base-url") || process.env.IMA_OPENAPI_BASE_URL || "https://ima.qq.com").replace(/\/+$/, "");

function usage() {
  console.log(`IMA pointer content fetch

Usage:
  npm run wiki:fetch-ima -- raw/ima/source.md
  npm run wiki:fetch-ima -- raw/ima/source.md --metadata
  npm run wiki:fetch-ima -- raw/ima/source.md --output /tmp/source.md

This reads the IMA original for maintenance and writes it to stdout by default.
It does not store full IMA originals in the vault.
`);
}

function readOption(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || "";
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

if (!rawArg) {
  usage();
  process.exit(2);
}

async function readConfigSecret(name) {
  try {
    return (await fs.readFile(path.join(os.homedir(), ".config", "ima", name), "utf8")).trim();
  } catch {
    return "";
  }
}

async function credentials() {
  const clientId = await readConfigSecret("client_id") || process.env.IMA_OPENAPI_CLIENTID || process.env.IMA_CLIENT_ID || "";
  const apiKey = await readConfigSecret("api_key") || process.env.IMA_OPENAPI_APIKEY || process.env.IMA_API_KEY || "";
  if (!clientId || !apiKey) {
    fail("Missing IMA credentials. Configure ~/.config/ima/client_id and ~/.config/ima/api_key, or set IMA_OPENAPI_CLIENTID/IMA_OPENAPI_APIKEY.");
  }
  return { clientId: clientId.trim(), apiKey: apiKey.trim() };
}

async function callIma(auth, apiPath, body) {
  const response = await fetch(`${baseUrl}/${apiPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ima-openapi-clientid": auth.clientId,
      "ima-openapi-apikey": auth.apiKey
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail(`IMA API returned non-JSON output for ${apiPath}.`);
  }
  if (!response.ok) fail(`IMA HTTP error ${response.status}: ${data?.msg || text.slice(0, 200)}`);
  if (data.code !== 0) fail(`IMA API business error: ${data.msg || `code ${data.code}`}`);
  return data.data || {};
}

async function readRawPointer(fileArg) {
  const absolute = path.isAbsolute(fileArg) ? fileArg : path.join(vault, fileArg);
  if (!(await exists(absolute))) fail(`Raw pointer not found: ${fileArg}`);
  const content = await fs.readFile(absolute, "utf8");
  const mediaId = content.match(/media_id:\s*["']?([^"'\n]+)["']?/)?.[1]?.trim();
  if (!mediaId) fail(`No ima_source.media_id found in ${fileArg}`);
  return { absolute, mediaId };
}

async function fetchOriginal(auth, mediaId) {
  const info = await callIma(auth, "openapi/wiki/v1/get_media_info", { media_id: mediaId });
  if (Number(info.media_type) === 11 && info.notebook_ext_info?.notebook_id) {
    const note = await callIma(auth, "openapi/note/v1/get_doc_content", {
      note_id: info.notebook_ext_info.notebook_id,
      target_content_format: 0
    });
    return { mediaType: info.media_type, content: note.content || "" };
  }

  const urlInfo = info.url_info || {};
  if (!urlInfo.url) fail("IMA media has no accessible url_info.url. Use the IMA desktop client to inspect the original.");
  const response = await fetch(urlInfo.url, { headers: urlInfo.headers || {} });
  if (!response.ok) fail(`IMA content fetch failed: HTTP ${response.status}`);
  return { mediaType: info.media_type, content: await response.text() };
}

const auth = await credentials();
const pointer = await readRawPointer(rawArg);
const original = await fetchOriginal(auth, pointer.mediaId);

if (metadataOnly) {
  console.log(JSON.stringify({
    raw: path.relative(vault, pointer.absolute).replace(/\\/g, "/"),
    mediaType: original.mediaType,
    contentLength: original.content.length,
    output: outputPath || "stdout"
  }, null, 2));
  process.exit(0);
}

if (outputPath) {
  await fs.writeFile(outputPath, original.content, "utf8");
  console.log(JSON.stringify({ output: outputPath, contentLength: original.content.length }, null, 2));
} else {
  process.stdout.write(original.content);
}
