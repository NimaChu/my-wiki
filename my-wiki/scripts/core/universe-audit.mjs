#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { appendLog, asArray, isWikiKnowledgeNode, scanVault, upsertFrontmatterValues, wikiUniverseNames } from "./wiki-lib.mjs";
import { universeAudit } from "./universe-audit-lib.mjs";

const scan = await scanVault();
const audit = universeAudit(scan);
const apply = process.argv.includes("--apply");
const metadataPlan = scan.nodes
  .filter(isWikiKnowledgeNode)
  .filter((node) => asArray(node.frontmatter.universes).length === 0 && asArray(node.frontmatter.universe).length === 0)
  .map((node) => ({ node, universes: wikiUniverseNames(node) }));

if (apply) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(scan.vault, ".my-wiki", "backups", `universe-metadata-${timestamp}`);
  const filesRoot = path.join(backupRoot, "files");
  await fs.mkdir(filesRoot, { recursive: true });
  const changes = [];

  for (let index = 0; index < metadataPlan.length; index += 1) {
    const { node, universes } = metadataPlan[index];
    const backup = path.join(filesRoot, `${String(index + 1).padStart(4, "0")}.md`);
    await fs.writeFile(backup, node.content, "utf8");
    await fs.writeFile(node.file, upsertFrontmatterValues(node.content, { universes }), "utf8");
    changes.push({
      path: node.path,
      universes,
      backup: path.relative(backupRoot, backup).replace(/\\/g, "/")
    });
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    vault: scan.vault,
    changes
  };
  await fs.writeFile(path.join(backupRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await appendLog(`UNIVERSE_METADATA pages="${changes.length}" backup="${path.relative(scan.vault, backupRoot).replace(/\\/g, "/")}"`, scan.vault);
  console.log(JSON.stringify({
    vault: scan.vault,
    applied: true,
    pages: changes.length,
    backup: path.relative(scan.vault, backupRoot).replace(/\\/g, "/"),
    universes: Object.fromEntries(audit.summaries.map((summary) => [summary.group, summary.wikiPages]))
  }, null, 2));
  process.exit(0);
}

console.log("# Universe Taxonomy Audit");
console.log(`Vault: ${scan.vault}`);
console.log(`Wiki pages missing explicit universes metadata: ${metadataPlan.length}`);

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
