#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { appendLog, exists, scanVault, stringifyFrontmatter, vaultPath } from "./wiki-lib.mjs";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function args(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

const title = arg("--title", "").trim();
const summaryFile = arg("--summary-file", "");
const sources = args("--source");
const tags = args("--tag");
if (!title || !summaryFile) {
  console.error('Usage: node src/distill-query.mjs --title "Page title" --summary-file /tmp/answer.md [--source references/sources/... --tag topic]');
  process.exit(2);
}

const vault = vaultPath();
const wikiDir = path.join(vault, "concepts");
await fs.mkdir(wikiDir, { recursive: true });
const target = path.join(wikiDir, `${title}.md`);
if (await exists(target)) {
  console.error(`Wiki page already exists: ${target}`);
  process.exit(1);
}
const summary = (await fs.readFile(path.resolve(summaryFile), "utf8")).trim();
const scan = await scanVault(vault);
const sourceEntries = sources.map((source) => {
  const normalized = source.replace(/^\[\[|\]\]$/g, "").replace(/\.md$/, "");
  const resolved = scan.resolve(normalized, "concepts/placeholder");
  const node = resolved ? scan.nodes.find((candidate) => candidate.id === resolved) : null;
  const resource = `/${node?.path || `${normalized}.md`}`;
  return {
    id: `source-${createHash("sha256").update(resource).digest("hex").slice(0, 12)}`,
    resource,
    title: node?.title || path.basename(normalized)
  };
});
const sourceLinks = sourceEntries.map((source) => `[${source.title}](${encodeURI(source.resource)})`);
const relationHints = sourceLinks.map((source) => `supports: ${source}`);
const frontmatter = stringifyFrontmatter({
  type: "topic",
  title,
  description: summary.replace(/\s+/g, " ").slice(0, 280),
  tags: ["topic", ...tags],
  sources: sourceEntries,
  generated: { by: "process:my-wiki-distill-query", at: new Date().toISOString() },
  status: "stable",
  aliases: [],
  reviewed_at: new Date().toISOString(),
  source_count: sources.length,
  relation_hints: relationHints
});
const body = `${frontmatter}

# ${title}

## Summary

${summary}

## Key Ideas

-

## Relations

-

## Contradictions

- None noted.

## Supersedes

- None.

## Sources

${sourceLinks.length ? sourceLinks.map((source) => `- ${source}`).join("\n") : "- "}
`;

await fs.writeFile(target, body, "utf8");
await appendLog(`DISTILL_QUERY wiki="${path.relative(vault, target)}" sources="${sources.join(",")}"`);
console.log(JSON.stringify({ path: target, title, sources }, null, 2));
