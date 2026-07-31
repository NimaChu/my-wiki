#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { appendLog, exists, slugify, vaultPath, yamlList, yamlString } from "./wiki-lib.mjs";

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
  console.error('Usage: node src/distill-query.mjs --title "Page title" --summary-file /tmp/answer.md [--source raw/... --tag topic]');
  process.exit(2);
}

const vault = vaultPath();
const wikiDir = path.join(vault, "wiki");
await fs.mkdir(wikiDir, { recursive: true });
const target = path.join(wikiDir, `${title}.md`);
if (await exists(target)) {
  console.error(`Wiki page already exists: ${target}`);
  process.exit(1);
}
const summary = (await fs.readFile(path.resolve(summaryFile), "utf8")).trim();
const sourceLinks = sources.map((source) => source.includes("[[") ? source : `[[${source}]]`);
const relationHints = sourceLinks.map((source) => `supports: ${source}`);
const body = `---
title: ${yamlString(title)}
type: topic
status: active
tags:
${yamlList(["topic", ...tags])}
aliases:
reviewed_at: ${yamlString(new Date().toISOString())}
source_count: ${sources.length}
relation_hints:
${yamlList(relationHints)}
sources:
${yamlList(sourceLinks)}
---

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
