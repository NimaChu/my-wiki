import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  frontmatterMetadataIssues,
  normalizeEscapedFrontmatterQuotes,
  processedRawIssues,
  rawLayoutIssues,
  scanVault
} from "../scripts/core/wiki-lib.mjs";

async function writeMarkdown(file, title, type = "raw-source") {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\ntitle: ${title}\ntype: ${type}\nstatus: active\n---\n# ${title}\n`, "utf8");
}

test("vault scans knowledge notes but excludes Markdown snapshots and assets", async (context) => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "my-wiki-scan-boundaries-"));
  context.after(() => rm(vault, { recursive: true, force: true }));

  await writeMarkdown(path.join(vault, "raw", "sources", "source.md"), "Source");
  await writeMarkdown(path.join(vault, "raw", "snapshots", "original.md"), "Original snapshot");
  await writeMarkdown(path.join(vault, "raw", "assets", "source", "caption.md"), "Asset metadata");
  await writeMarkdown(path.join(vault, "raw", "legacy.md"), "Misplaced source");
  await writeMarkdown(path.join(vault, "wiki", "topic.md"), "Topic", "concept");

  const scan = await scanVault(vault);
  assert.deepEqual(scan.nodes.map((node) => node.id).sort(), [
    "raw/legacy",
    "raw/sources/source",
    "wiki/topic"
  ]);
  assert.deepEqual(rawLayoutIssues(scan), [{ source: "raw/legacy", reason: "misplaced-source" }]);
});

test("processed Raw notes with U+FFFD in Capture fail evidence closure", () => {
  const content = `---
title: Damaged scan
type: raw-source
status: processed
needs_followup: false
extraction_status: complete
extracted_characters: 120
related:
---

# Damaged scan

## Capture

### Page 7

正文�缺字。

## Processing Notes

- Encoding gate: mentions � outside Capture and must not change the count.
`;
  const node = {
    id: "raw/sources/damaged-scan",
    path: "raw/sources/damaged-scan.md",
    content,
    status: "processed",
    frontmatter: { extraction_status: "complete", extracted_characters: 120 },
    relatedLinks: [],
    links: []
  };
  assert.deepEqual(processedRawIssues({ nodes: [node], resolve: () => null }), [
    { source: "raw/sources/damaged-scan", reason: "missing-related" },
    { source: "raw/sources/damaged-scan", reason: "unicode-replacement-character", count: 1, pages: [7] }
  ]);
});

test("frontmatter metadata normalization repairs escaped wrappers and the gate rejects residual boundary slashes", () => {
  const malformed = [
    "---",
    "title: \\\"Calculus\\\"",
    "type: concept",
    "status: active",
    "universes:",
    "  - \\\"数学\\\"",
    "---",
    "# Calculus",
    ""
  ].join("\n");
  const node = { id: "wiki/Calculus", path: "wiki/Calculus.md", content: malformed };
  assert.deepEqual(frontmatterMetadataIssues({ nodes: [node] }), [
    { source: "wiki/Calculus.md", field: "title", value: '\\"Calculus\\"', reason: "escaped-quote" },
    { source: "wiki/Calculus.md", field: "universes", value: '\\"数学\\"', reason: "escaped-quote" }
  ]);

  const normalized = normalizeEscapedFrontmatterQuotes(malformed);
  assert.match(normalized, /^title: "Calculus"$/m);
  assert.match(normalized, /^  - "数学"$/m);
  assert.deepEqual(frontmatterMetadataIssues({ nodes: [{ ...node, content: normalized }] }), []);

  const residual = normalized.replace('title: "Calculus"', "title: \\\\Calculus");
  assert.deepEqual(frontmatterMetadataIssues({ nodes: [{ ...node, content: residual }] }), [
    { source: "wiki/Calculus.md", field: "title", value: "\\\\Calculus", reason: "boundary-backslash" }
  ]);

  const inline = normalized.replace("universes:\n  - \"数学\"", 'universes: ["数学]');
  assert.deepEqual(frontmatterMetadataIssues({ nodes: [{ ...node, content: inline }] }), [
    { source: "wiki/Calculus.md", field: "universes", value: '["数学]', reason: "unbalanced-quote" }
  ]);
});
