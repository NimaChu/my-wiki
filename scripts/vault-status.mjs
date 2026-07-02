#!/usr/bin/env node
import { processedRawIssues, scanVault, statsFromScan } from "./wiki-lib.mjs";

const scan = await scanVault();
const stats = statsFromScan(scan);
const inbox = scan.nodes.filter((node) => node.id.startsWith("raw/") && node.status === "inbox");
const followup = scan.nodes.filter((node) => node.status === "needs-followup");
const processedIssues = processedRawIssues(scan);

console.log(`# Knowledge Vault Status`);
console.log(`Vault: ${scan.vault}`);
console.log("");
console.log(JSON.stringify(stats, null, 2));
if (inbox.length) {
  console.log("\nInbox raw sources:");
  for (const node of inbox) console.log(`- ${node.path} — ${node.title}`);
}
if (followup.length) {
  console.log("\nNeeds follow-up:");
  for (const node of followup) console.log(`- ${node.path} — ${node.title}`);
}
if (processedIssues.length) {
  console.log("\nProcessed raws with closure issues:");
  for (const item of processedIssues) console.log(`- ${item.source} -> ${item.reason}${item.target ? ` (${item.target})` : ""}`);
}
if (scan.unresolved.length) {
  console.log("\nUnresolved wikilinks:");
  for (const item of scan.unresolved) console.log(`- ${item.source} -> ${item.target}`);
}
if (scan.invalidRelations.length) {
  console.log("\nInvalid relation hints:");
  for (const item of scan.invalidRelations) console.log(`- ${item.source} -> ${item.relation} (${item.reason})`);
}
