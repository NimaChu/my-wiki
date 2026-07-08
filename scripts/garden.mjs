#!/usr/bin/env node
import { processedRawIssues, scanVault, statsFromScan } from "./wiki-lib.mjs";
import { universeAudit } from "./universe-audit-lib.mjs";

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
const universe = universeAudit(scan);

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
console.log("\n## Universe Taxonomy Review");
for (const summary of universe.summaries) {
  console.log(`- ${summary.group}: ${summary.wikiPages} wiki, ${summary.rawEvidence} raw evidence${summary.topTags.length ? `; top tags: ${summary.topTags.slice(0, 4).map(([tag, count]) => `${tag}(${count})`).join(", ")}` : ""}`);
}
if (universe.suggestions.length) {
  console.log("\nUniverse review suggestions:");
  for (const item of universe.suggestions.slice(0, 12)) {
    console.log(`- ${item.kind}: ${item.group} — ${item.reason}${item.evidence ? ` (${item.evidence})` : ""}`);
  }
}
console.log("\n## Unresolved Targets");
for (const item of scan.unresolved.slice(0, 30)) console.log(`- ${item.source} -> ${item.target}`);
