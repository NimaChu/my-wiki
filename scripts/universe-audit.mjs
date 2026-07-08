#!/usr/bin/env node
import { scanVault } from "./wiki-lib.mjs";
import { universeAudit } from "./universe-audit-lib.mjs";

const scan = await scanVault();
const audit = universeAudit(scan);

console.log("# Universe Taxonomy Audit");
console.log(`Vault: ${scan.vault}`);

console.log("\n## Universes");
for (const summary of audit.summaries) {
  console.log(`\n### ${summary.group}`);
  console.log(`- wiki pages: ${summary.wikiPages}`);
  console.log(`- raw evidence: ${summary.rawEvidence}`);
  if (summary.topTags.length) console.log(`- top tags: ${summary.topTags.map(([tag, count]) => `${tag} (${count})`).join(", ")}`);
  if (summary.topTypes.length) console.log(`- page types: ${summary.topTypes.map(([type, count]) => `${type} (${count})`).join(", ")}`);
  if (summary.relatedGroups.length) console.log(`- linked universes: ${summary.relatedGroups.map(([group, count]) => `${group} (${count})`).join(", ")}`);
  console.log(`- central pages: ${summary.topPages.join(", ")}`);
}

console.log("\n## Cross-Universe Wiki Links");
if (!audit.crossGroupPairs.length) console.log("- none");
for (const pair of audit.crossGroupPairs.slice(0, 12)) console.log(`- ${pair.pair}: ${pair.count}`);

console.log("\n## Review Suggestions");
if (!audit.suggestions.length) console.log("- no obvious universe taxonomy issues");
for (const item of audit.suggestions) {
  console.log(`- ${item.kind}: ${item.group} — ${item.reason}${item.evidence ? ` (${item.evidence})` : ""}`);
}
