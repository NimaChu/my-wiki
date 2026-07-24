#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  exists,
  parseFrontmatter,
  vaultPath
} from "./wiki-lib.mjs";
import {
  createImaClient,
  defaultImaBaseUrl,
  extractMediaId,
  fetchImaOriginal,
  hasImageReferences,
  hasSubstantialCapture,
  logImaImport,
  materializeOriginal,
  readImaCredentials,
  replaceSection,
  runImageAssets,
  upsertFrontmatter
} from "./ima-local-lib.mjs";

const vault = vaultPath();
const args = process.argv.slice(2);
const rawArg = args.find((arg) => !arg.startsWith("--"));
const metadataOnly = args.includes("--metadata");
const stdoutOnly = args.includes("--stdout");
const force = args.includes("--force");
const shouldMirrorImages = !args.includes("--no-images");
const outputPath = readOption("--output");
const baseUrl = readOption("--base-url") || process.env.IMA_OPENAPI_BASE_URL || defaultImaBaseUrl;
const delayMs = Number(readOption("--delay-ms") || 750);

function usage() {
  console.log(`IMA local raw fetch

Usage:
  my-wiki fetch-ima raw/sources/source.md
  my-wiki fetch-ima raw/sources/source.md --metadata
  my-wiki fetch-ima raw/sources/source.md --force
  my-wiki fetch-ima raw/sources/source.md --stdout
  my-wiki fetch-ima raw/sources/source.md --output /tmp/source.md

Default behavior upgrades or refreshes one IMA raw note into local-first form:
status: inbox, source_type: ima, Capture filled with fetched text or a local
snapshot reference, and image references mirrored when possible.

Options:
  --metadata       Fetch and print metadata only; do not modify the vault.
  --stdout         Print fetched textual content to stdout; do not modify the vault.
  --output <path>  Write fetched textual content to a file; do not modify the vault.
  --force          Replace an existing substantial Capture section.
  --no-images      Skip image indexing and mirroring.
  --delay-ms <n>   Delay before IMA API calls. Defaults to 750.
  --base-url <url> IMA OpenAPI base URL. Defaults to https://ima.qq.com.
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

async function readRawImaNote(fileArg) {
  const absolute = path.isAbsolute(fileArg) ? fileArg : path.join(vault, fileArg);
  if (!(await exists(absolute))) fail(`Raw IMA note not found: ${fileArg}`);
  const content = await fs.readFile(absolute, "utf8");
  const mediaId = extractMediaId(content);
  if (!mediaId) fail(`No ima_source.media_id found in ${fileArg}`);
  return {
    absolute,
    relative: path.relative(vault, absolute).replace(/\\/g, "/"),
    content,
    frontmatter: parseFrontmatter(content),
    mediaId
  };
}

const auth = await readImaCredentials();
const client = createImaClient({ auth, baseUrl, delayMs });
const note = await readRawImaNote(rawArg);
const original = await fetchImaOriginal(client, note.mediaId);
const title = note.frontmatter.title || original.title || note.mediaId;

if (metadataOnly) {
  console.log(JSON.stringify({
    raw: note.relative,
    mediaId: note.mediaId,
    mediaType: original.mediaTypeLabel,
    contentType: original.contentType,
    sourceUrl: original.sourceUrl,
    textLength: original.content.length,
    binaryBytes: original.binary?.length || 0,
    output: outputPath || (stdoutOnly ? "stdout" : "vault"),
    sideEffects: "none"
  }, null, 2));
  process.exit(0);
}

if (stdoutOnly) {
  process.stdout.write(original.content || "");
  process.exit(0);
}

if (outputPath) {
  await fs.writeFile(outputPath, original.content || "", "utf8");
  console.log(JSON.stringify({ output: outputPath, contentLength: original.content.length }, null, 2));
  process.exit(0);
}

if (!force && hasSubstantialCapture(note.content)) {
  fail(`Refusing to replace existing Capture in ${note.relative}. Use --force to refresh it.`);
}

const materialized = await materializeOriginal({
  vault,
  notePath: note.absolute,
  title,
  original
});

let updated = upsertFrontmatter(note.content, {
  source_type: "ima",
  status: "inbox",
  source_url: original.sourceUrl || note.frontmatter.source_url || "",
  snapshot_path: materialized.snapshotPath || note.frontmatter.snapshot_path || "",
  content_hash: materialized.contentHash,
  capture_method: original.fetchMethod || "ima-openapi",
  source_quality: "imported"
});

updated = replaceSection(updated, "Capture", materialized.capture || "_IMA returned metadata but no local content body._");
updated = replaceSection(updated, "Images", materialized.imageMarkdown || "- Inline Markdown/HTML images are preserved in Capture. `wiki:images` mirrors remote images when image references are present.");
updated = replaceSection(updated, "Processing Notes", [
  "- Status: inbox",
  "- Imported locally from IMA; do not depend on the external platform during routine maintenance or query.",
  "- Next action: compile durable ideas into wiki pages, close core related links, then mark processed."
].join("\n"));

await fs.writeFile(note.absolute, updated, "utf8");
await logImaImport(note.relative, `media_id="${note.mediaId}" refresh="single"`);

let imageResult = { skipped: true, reason: "no image references" };
if (shouldMirrorImages && hasImageReferences(original.content || "")) {
  imageResult = runImageAssets({ source: note.relative, enabled: true });
}

console.log(JSON.stringify({
  raw: note.relative,
  status: "inbox",
  sourceType: "ima",
  mediaId: note.mediaId,
  mediaType: original.mediaTypeLabel,
  textLength: original.content.length,
  binaryBytes: original.binary?.length || 0,
  snapshotPath: materialized.snapshotPath,
  imageResult,
  next: "Maintain this raw like any other inbox source: distill durable wiki pages, close backlinks, then mark processed."
}, null, 2));
