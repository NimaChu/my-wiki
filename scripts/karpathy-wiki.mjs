#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2] || "help";
const rest = process.argv.slice(3);

const commands = {
  status: ["vault-status.mjs"],
  lint: ["wiki-lint.mjs"],
  capture: ["quick-capture.mjs", ...rest],
  refresh: ["refresh-dashboard.mjs", ...rest],
  dashboard: ["refresh-dashboard.mjs", "--serve", ...rest],
  build: ["refresh-dashboard.mjs", "--build", ...rest],
  "build-dashboard": ["refresh-dashboard.mjs", "--serve", "--build", ...rest],
  garden: ["garden.mjs", ...rest],
  "repair-links": ["repair-links.mjs", ...rest],
  "distill-query": ["distill-query.mjs", ...rest],
  search: ["search.mjs", ...rest]
};

function printHelp() {
  const defaultVault = path.resolve(here, "..");
  console.log(`Knowledge Vault CLI

Usage:
  node scripts/karpathy-wiki.mjs status
  node scripts/karpathy-wiki.mjs lint
  node scripts/karpathy-wiki.mjs dashboard
  node scripts/karpathy-wiki.mjs refresh [--serve] [--build]
  node scripts/karpathy-wiki.mjs build-dashboard
  node scripts/karpathy-wiki.mjs capture --title "Title" --url "https://..." --type webpage
  node scripts/karpathy-wiki.mjs search "query terms"
  node scripts/karpathy-wiki.mjs garden
  node scripts/karpathy-wiki.mjs repair-links
  node scripts/karpathy-wiki.mjs distill-query --title "Durable answer" --summary-file /tmp/answer.md --source raw/...

Environment:
  KNOWLEDGE_VAULT_PATH=/path/to/vault
  KARPATHY_OBSIDIAN_VAULT=/path/to/vault
  OBSIDIAN_VAULT_PATH=/path/to/vault

Default vault:
  ${defaultVault}
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
