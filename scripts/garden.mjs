#!/usr/bin/env node
import { processedRawIssues, scanVault, statsFromScan } from "./wiki-lib.mjs";

const scan = await scanVault();
const stats = statsFromScan(scan);
const inbox = scan.nodes.filter((node) => node.id.startsWith("raw/") && node.status === "inbox");
const imaPointers = scan.nodes.filter((node) => node.id.startsWith("raw/") && node.status === "ima-pointer");
const followup = scan.nodes.filter((node) => node.status === "needs-followup");
const weakWiki = scan.nodes.filter((node) =>
  node.id.startsWith("wiki/") &&
  !["wiki/index", "wiki/log", "wiki/README"].includes(node.id) &&
  (scan.incoming.get(node.id) || 0) + (scan.outgoing.get(node.id) || 0) <= 1
);

console.log(`# Knowledge Vault Garden Report`);
console.log(`Vault: ${scan.vault}`);
console.log("");
console.log(JSON.stringify(stats, null, 2));
console.log("\n## Priority Queue");
for (const node of [...inbox, ...imaPointers, ...followup].slice(0, 20)) console.log(`- ${node.status}: ${node.path} — ${node.title}`);
if (inbox.length + imaPointers.length + followup.length > 20) {
  console.log(`- ... ${inbox.length + imaPointers.length + followup.length - 20} more pending raw sources`);
}
console.log("\n## Processed Closure Issues");
for (const item of processedRawIssues(scan).slice(0, 20)) console.log(`- ${item.source}: ${item.reason}${item.target ? ` (${item.target})` : ""}`);
console.log("\n## Weakly Connected Wiki Pages");
for (const node of weakWiki.slice(0, 20)) console.log(`- ${node.path} — ${node.title}`);
console.log("\n## Unresolved Targets");
for (const item of scan.unresolved.slice(0, 30)) console.log(`- ${item.source} -> ${item.target}`);
