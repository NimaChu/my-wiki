#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = process.argv.slice(2);

function extractVaultOption(values) {
  const args = [];
  let vault = "";
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--vault") {
      vault = values[index + 1] || "";
      index += 1;
    } else if (values[index].startsWith("--vault=")) {
      vault = values[index].slice("--vault=".length);
    } else {
      args.push(values[index]);
    }
  }
  return { args, vault };
}

const parsed = extractVaultOption(input);
if (parsed.vault) process.env.MY_WIKI_VAULT = parsed.vault;
const command = parsed.args[0] || "help";
const rest = parsed.args.slice(1);

const commands = {
  init: ["vault-manager.mjs", "init", ...rest],
  where: ["vault-manager.mjs", "where", ...rest],
  vault: ["vault-manager.mjs", ...rest],
  status: ["vault-status.mjs"],
  lint: ["wiki-lint.mjs"],
  capture: ["quick-capture.mjs", ...rest],
  reextract: ["reextract-source.mjs", ...rest],
  "organize-raw": ["raw-layout.mjs", ...rest],
  images: ["image-assets.mjs", ...rest],
  refresh: ["refresh-dashboard.mjs", ...rest],
  dashboard: ["refresh-dashboard.mjs", "--serve", ...rest],
  "open-dashboard": ["open-dashboard.mjs", ...rest],
  build: ["refresh-dashboard.mjs", "--build", ...rest],
  "build-dashboard": ["refresh-dashboard.mjs", "--build", ...rest],
  garden: ["garden.mjs", ...rest],
  universes: ["universe-audit.mjs", ...rest],
  "export-universe": ["export-universe.mjs", ...rest],
  "import-universe": ["import-universe.mjs", ...rest],
  "repair-links": ["repair-links.mjs", ...rest],
  "distill-query": ["distill-query.mjs", ...rest],
  "okf-audit": ["okf-audit.mjs", ...rest],
  "okf-migrate": ["okf-migrate.mjs", ...rest],
  "migrate-vault-v2": ["../migrations/vault-schema-v2.mjs", ...rest],
  "export-okf": ["export-okf.mjs", ...rest],
  "sync-ima": ["ima-sync.mjs", ...rest],
  "fetch-ima": ["ima-fetch.mjs", ...rest],
  search: ["search.mjs", ...rest]
};

function printHelp() {
  console.log(`My Wiki CLI

Usage:
  my-wiki init /path/to/vault [--name personal] [--use]
  my-wiki where [--vault personal]
  my-wiki vault list
  my-wiki vault add personal /path/to/vault [--use]
  my-wiki vault use personal
  my-wiki status
  my-wiki lint
  my-wiki dashboard
  my-wiki open-dashboard
  my-wiki refresh [--serve] [--build]
  my-wiki build-dashboard
  my-wiki capture --title "Title" --url "https://..." --type webpage
  my-wiki capture --file /path/to/document.pdf [--collection "Research"]
  my-wiki capture --directory /path/to/documents [--collection "Research"]
  my-wiki reextract --source references/sources/source-note.md
  my-wiki reextract --all-followup
  my-wiki organize-raw [--apply]
  my-wiki images --source references/sources/source-note.md
  my-wiki capture --title "Title" --url "https://..." --refresh-dashboard
  my-wiki capture --title "Title" --url "https://..." --serve-dashboard
  my-wiki search "query terms"
  my-wiki sync-ima [--kb "Knowledge base name"] [--no-images]
  my-wiki fetch-ima references/sources/source.md [--metadata|--force]
  my-wiki garden
  my-wiki universes [--apply]
  my-wiki export-universe "Universe Name" [--output package.mywiki]
  my-wiki import-universe package.mywiki [--as "Universe Name"] [--apply]
  my-wiki repair-links
  my-wiki distill-query --title "Durable answer" --summary-file /tmp/answer.md --source references/sources/...
  my-wiki okf-audit
  my-wiki okf-migrate [--apply]
  my-wiki migrate-vault-v2
  my-wiki export-okf [--galaxy "AI"] [--output /path/to/bundle]

Environment:
  MY_WIKI_VAULT=personal-or-/path/to/vault
  MY_WIKI_CONFIG_PATH=/path/to/config.json
  MY_WIKI_OCR_MAX_PDF_PAGES=1000 (0 disables the page limit)
  MY_WIKI_OCR_PDF_BATCH_PAGES=24
  MY_WIKI_PDF_ENGINE=auto|mineru|docling|pdfjs|tesseract
  MY_WIKI_DOCLING_MODE=auto|off
  MY_WIKI_DOCLING_PYTHON=/path/to/python
  MY_WIKI_VISUAL_REPAIR_MODE=auto|off|required
  MY_WIKI_VISUAL_REPAIR_PROVIDER=opencode|codex
  MY_WIKI_VISUAL_REPAIR_MODEL=provider/model
  MY_WIKI_VISUAL_REPAIR_MAX_PAGES=12
  MY_WIKI_PDF_VISUAL_GATE=1 (set 0 to disable blank/show-through candidate analysis)
  MY_WIKI_PDF_BLANK_PAGES=9,177 (explicit human-confirmed per-capture override)
  MY_WIKI_PDF_DIAGRAM_SCALE=1.8 (page-render fallback scale for sparse diagrams)
  MY_WIKI_MINERU_BACKEND=hybrid-engine|pipeline
  MY_WIKI_MINERU_EFFORT=medium|high
  MY_WIKI_MINERU_LANGUAGE=ch
  KNOWLEDGE_VAULT_PATH=/path/to/vault
  KARPATHY_OBSIDIAN_VAULT=/path/to/vault
  OBSIDIAN_VAULT_PATH=/path/to/vault
`);
}

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

const args = commands[command];
if (!args) {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(2);
}

const script = path.join(here, args[0]);
const result = spawnSync("node", [script, ...args.slice(1)], {
  stdio: "inherit",
  env: process.env
});

process.exit(result.status ?? 1);
