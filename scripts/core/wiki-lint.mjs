#!/usr/bin/env node
import {
  frontmatterMetadataIssues,
  isWikiKnowledgeNode,
  processedRawIssues,
  rawAttachmentIssues,
  rawLayoutIssues,
  scanVault,
  statsFromScan,
  wikiTopicPeerMap
} from "./wiki-lib.mjs";
import { checkMarkdownFormulas, shouldGateExtractedFormulas } from "./formula-gate.mjs";
import { unicodeReplacementReport } from "./content-integrity.mjs";
import { auditOkfWiki } from "./okf-lib.mjs";

const scan = await scanVault();
const stats = statsFromScan(scan);
const reservedWiki = new Set(["index", "log"]);
const lintableNodes = scan.nodes.filter((node) => !reservedWiki.has(node.id));
const missingFrontmatter = lintableNodes.filter((node) => Object.keys(node.frontmatter).length === 0);
const missingStatus = lintableNodes.filter((node) => !node.frontmatter.status);
const missingType = lintableNodes.filter((node) => !node.frontmatter.type);
const malformedFrontmatterMetadata = frontmatterMetadataIssues(scan);
const missingClaimSources = scan.nodes.filter((node) =>
  isWikiKnowledgeNode(node) &&
  node.sourceLinks.length === 0
);
const wikiTopicPeers = wikiTopicPeerMap(scan);
const weakWiki = scan.nodes.filter((node) =>
  isWikiKnowledgeNode(node) &&
  wikiTopicPeers.get(node.id).size <= 1
);
const orphanedWiki = scan.nodes.filter((node) =>
  isWikiKnowledgeNode(node) &&
  wikiTopicPeers.get(node.id).size === 0
);
const formulaSyntaxIssues = [];
const formulaStrictIssues = [];
const unicodeReplacementIssues = [];
for (const node of scan.nodes.filter((candidate) => candidate.id.startsWith("references/sources/"))) {
  const result = unicodeReplacementReport(node.content, { captureOnly: true });
  if (!result.blocked) continue;
  unicodeReplacementIssues.push({
    source: node.path,
    count: result.count,
    pages: result.pages,
    affectedPages: result.affectedPages,
    unpagedCount: result.unpagedCount
  });
}
for (const node of scan.nodes.filter((candidate) =>
  candidate.content.includes("$") &&
  candidate.id.startsWith("references/sources/") &&
  shouldGateExtractedFormulas({
    extractionMethod: candidate.frontmatter.extraction_method,
    formulaRiskPages: candidate.frontmatter.extraction_formula_risk_pages
  })
)) {
  const result = await checkMarkdownFormulas(node.content);
  if (result.errors.length > 0) {
    formulaSyntaxIssues.push({
      source: node.path,
      count: result.errors.length,
      pages: result.syntaxErrorPages,
      errors: result.errors.slice(0, 20).map((error) => ({
        page: error.page || undefined,
        line: error.line,
        column: error.column,
        message: error.message
      })),
      truncated: result.errors.length > 20
    });
  }
  if (result.strictWarnings.length > 0) {
    formulaStrictIssues.push({
      source: node.path,
      count: result.strictWarnings.length,
      pages: result.strictWarningPages,
      warnings: result.strictWarnings.slice(0, 50).map((warning) => ({
        page: warning.page || undefined,
        line: warning.line,
        column: warning.column,
        code: warning.code,
        message: warning.message,
        tex: String(warning.tex || "").slice(0, 500)
      })),
      truncated: result.strictWarnings.length > 50
    });
  }
}

const report = {
  vault: scan.vault,
  stats,
  unresolved: scan.unresolved,
  invalidRelations: scan.invalidRelations,
  processedRawIssues: processedRawIssues(scan),
  rawLayoutIssues: rawLayoutIssues(scan),
  rawAttachmentIssues: await rawAttachmentIssues(scan),
  formulaSyntaxIssues,
  formulaStrictIssues,
  unicodeReplacementIssues,
  malformedFrontmatterMetadata,
  orphanedWiki: orphanedWiki.map((node) => node.path),
  weakWiki: weakWiki.map((node) => node.path),
  missingClaimSources: missingClaimSources.map((node) => node.path),
  missingFrontmatter: missingFrontmatter.map((node) => node.path),
  missingStatus: missingStatus.map((node) => node.path),
  missingType: missingType.map((node) => node.path)
};

report.okfIssues = (await auditOkfWiki(scan.vault)).issues;

console.log(JSON.stringify(report, null, 2));
