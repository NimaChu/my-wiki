import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureSource } from "../scripts/core/capture-service.mjs";
import { unicodeReplacementFollowupReasons, unicodeReplacementReport } from "../scripts/core/content-integrity.mjs";
import { applyExtractionToRawNote } from "../scripts/core/reextract-source.mjs";

test("Unicode replacement gate reports final Capture pages but ignores Processing Notes", () => {
  const raw = `## Capture

### Page 2

正文�缺字。

### Page 5

另一处��缺字。

## Processing Notes

- Encoding gate mentions � only as an audit label.
`;
  const report = unicodeReplacementReport(raw, { captureOnly: true });
  assert.deepEqual(report, {
    blocked: true,
    count: 3,
    pages: [2, 5],
    affectedPages: 2,
    unpagedCount: 0
  });
  assert.deepEqual(unicodeReplacementFollowupReasons(report), [
    "encoding:unicode-replacement-character:count=3:pages=2,5"
  ]);
});

test("captured extracted content with U+FFFD is locked before the Raw is written", async (context) => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "my-wiki-unicode-capture-"));
  context.after(() => rm(vault, { recursive: true, force: true }));
  await mkdir(path.join(vault, "wiki"), { recursive: true });
  const result = await captureSource({
    vault,
    title: "Encoding damaged scan",
    sourceType: "pdf",
    content: "### Page 1\n\n可读正文�缺字。",
    extractionStatus: "complete",
    textExtraction: "complete",
    extractionMethod: "mineru",
    extractionEngine: "mineru",
    extractedPages: 1,
    extractedCharacters: 8,
    shouldSnapshot: false,
    shouldMirrorImages: false
  });
  const raw = await readFile(result.path, "utf8");
  assert.match(raw, /^status: needs-followup$/m);
  assert.match(raw, /^needs_followup: true$/m);
  assert.match(raw, /encoding:unicode-replacement-character:count=1:pages=1/);
  assert.match(raw, /^extraction_unicode_replacement_pages: "1"$/m);
  assert.match(raw, /^extraction_unicode_replacement_count: 1$/m);
  assert.match(raw, /- Encoding gate: blocked \(1 U\+FFFD characters across 1 pages \(1\)\)/);
});

test("re-extraction keeps U+FFFD output in needs-followup even when extraction and formulas pass", () => {
  const source = `---
title: Scan
type: raw-source
source_type: pdf
status: needs-followup
needs_followup: true
tags:
  - raw
  - needs-followup
---

# Scan

## Capture

Old content.

## Processing Notes

- Status: needs-followup
`;
  const updated = applyExtractionToRawNote(source, {
    status: "complete",
    method: "mineru",
    engine: "mineru",
    content: "### Page 3\n\n重新提取后仍有�缺字。",
    pages: 3,
    characters: 20,
    quality: { level: "good", score: 96 }
  });
  assert.match(updated, /^status: "needs-followup"$/m);
  assert.match(updated, /^needs_followup: true$/m);
  assert.match(updated, /^extraction_unicode_replacement_pages: "3"$/m);
  assert.match(updated, /^extraction_unicode_replacement_count: 1$/m);
  assert.match(updated, /encoding:unicode-replacement-character:count=1:pages=3/);
  assert.match(updated, /- Encoding gate: blocked/);
});
