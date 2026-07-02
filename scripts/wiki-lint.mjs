#!/usr/bin/env node
import { processedRawIssues, scanVault, statsFromScan } from "./wiki-lib.mjs";

const scan = await scanVault();
const stats = statsFromScan(scan);
const missingFrontmatter = scan.nodes.filter((node) => Object.keys(node.frontmatter).length === 0);
const missingStatus = scan.nodes.filter((node) => !node.frontmatter.status);
const missingType = scan.nodes.filter((node) => !node.frontmatter.type);
const missingClaimSources = scan.nodes.filter((node) =>
  node.id.startsWith("wiki/") &&
  !["wiki/index", "wiki/log", "wiki/README"].includes(node.id) &&
  node.sourceLinks.length === 0
);
const weakWiki = scan.nodes.filter((node) =>
  node.id.startsWith("wiki/") &&
  !["wiki/index", "wiki/log", "wiki/README"].includes(node.id) &&
  (scan.incoming.get(node.id) || 0) + (scan.outgoing.get(node.id) || 0) <= 1
);
const orphanedWiki = scan.nodes.filter((node) =>
  node.id.startsWith("wiki/") &&
  !["wiki/index", "wiki/log", "wiki/README"].includes(node.id) &&
  (scan.incoming.get(node.id) || 0) === 0 &&
  (scan.outgoing.get(node.id) || 0) === 0
);

const report = {
  vault: scan.vault,
  stats,
  unresolved: scan.unresolved,
  invalidRelations: scan.invalidRelations,
  processedRawIssues: processedRawIssues(scan),
  orphanedWiki: orphanedWiki.map((node) => node.path),
  weakWiki: weakWiki.map((node) => node.path),
  missingClaimSources: missingClaimSources.map((node) => node.path),
  missingFrontmatter: missingFrontmatter.map((node) => node.path),
  missingStatus: missingStatus.map((node) => node.path),
  missingType: missingType.map((node) => node.path)
};

console.log(JSON.stringify(report, null, 2));
