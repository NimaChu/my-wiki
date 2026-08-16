import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkMarkdownFormulas,
  formulaGateBlocked,
  formulaGateFollowupReasons,
  formulaStrictFollowupReason,
  formulaSyntaxFollowupReason,
  shouldGateExtractedFormulas
} from "../scripts/core/formula-gate.mjs";
import { applyExtractionToRawNote, formulaGatedMarkdown } from "../scripts/core/reextract-source.mjs";
import { captureSource } from "../scripts/core/capture-service.mjs";

test("formula gate safely unwraps a complete nested delimiter and revalidates it", async () => {
  const input = `### Page 17

$$
\\(|OP|=|x|,\\)
$$
`;
  const result = await checkMarkdownFormulas(input, { repairSafeDelimiters: true });

  assert.equal(result.checked, 1);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.repairPages, [17]);
  assert.equal(result.repairs[0].kind, "display-wrapped-inline-math");
  assert.match(result.markdown, /\$\$\n\|OP\|=\|x\|,\n\$\$/);
});

test("formula gate blocks deterministic KaTeX failures with page and line details", async () => {
  const input = `### Page 15

$$
\\frac{b_x}{a_x}=\\frac{b_y}{a_y}\\tag{①}\\tag{1-3}
$$
`;
  const result = await checkMarkdownFormulas(input, { repairSafeDelimiters: true });

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].page, 15);
  assert.match(result.errors[0].message, /Multiple \\tag/);
  assert.equal(formulaSyntaxFollowupReason(result), "formula-syntax-error:pages=15");
});

test("formula gate blocks strict array and unknown-character warnings with page and line details", async () => {
  const input = `### Page 34

$$
\\begin{array}{c c} 1 & 2 & 3 \\end{array}
$$

### Page 82

$x \u2013 y$
`;
  const result = await checkMarkdownFormulas(input);

  assert.equal(result.errors.length, 0);
  assert.equal(formulaGateBlocked(result), true);
  assert.deepEqual(result.strictWarningPages, [34, 82]);
  assert.ok(result.strictWarnings.some((warning) => warning.code === "textEnv" && warning.page === 34));
  assert.ok(result.strictWarnings.some((warning) => warning.code === "unknownSymbol" && warning.page === 82));
  assert.equal(formulaStrictFollowupReason(result), "formula-strict-warning:pages=34,82");
  assert.deepEqual(formulaGateFollowupReasons(result), ["formula-strict-warning:pages=34,82"]);
});

test("formula gate ignores code and accepts complex supported formulas", async () => {
  const input = `\`\`\`
$$\\bad{code}$$
\`\`\`

$$
\\iiint_{\\Omega} \\left(\\frac{\\partial P}{\\partial x}+\\frac{\\partial Q}{\\partial y}\\right)\\,\\mathrm{d}v\\tag{6-1}
$$
`;
  const result = await checkMarkdownFormulas(input);

  assert.equal(result.checked, 1);
  assert.equal(result.errors.length, 0);
});

test("code fences do not count as reviewed formula evidence", async () => {
  const input = `### Page 12

> Extracted formula awaiting source review.

\`\`\`text
\\begin{array}{l l} x & y & z \\end{array}
\`\`\`
`;
  const result = await checkMarkdownFormulas(input);

  assert.equal(result.checked, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(result.strictWarnings.length, 0);
});

test("hard formula gating is limited to formula-aware extraction", () => {
  assert.equal(shouldGateExtractedFormulas({ extractionMethod: "mineru" }), true);
  assert.equal(shouldGateExtractedFormulas({ extractionMethod: "mineru+agent-vision-repair" }), true);
  assert.equal(shouldGateExtractedFormulas({ extractionMethod: "docling" }), true);
  assert.equal(shouldGateExtractedFormulas({ extractionMethod: "pdf-text", extractionQuality: { formulaRiskPages: [3] } }), true);
  assert.equal(shouldGateExtractedFormulas({ extractionMethod: "docx", extractionQuality: { formulaRiskPages: [] } }), false);
});

test("non-formula re-extraction keeps the extracted Markdown when no formula gate runs", () => {
  assert.equal(formulaGatedMarkdown("plain extracted text", null), "plain extracted text");
  assert.equal(formulaGatedMarkdown("original", { markdown: "checked" }), "checked");
});

test("formula-aware capture records syntax metadata and enters follow-up", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "my-wiki-formula-capture-"));
  try {
    await mkdir(path.join(vault, "wiki"), { recursive: true });
    await writeFile(path.join(vault, "wiki", "log.md"), "# Log\n", "utf8");
    const result = await captureSource({
      vault,
      title: "Formula source",
      sourceType: "pdf",
      content: `### Page 4

$$
x\\tag{a}\\tag{b}
$$`,
      extractionStatus: "complete",
      extractionMethod: "mineru",
      extractionQuality: { formulaRiskPages: [4] },
      shouldSnapshot: false,
      shouldMirrorImages: false
    });
    const raw = await readFile(result.path, "utf8");

    assert.equal(result.status, "needs-followup");
    assert.deepEqual(result.followupReasons, ["formula-syntax-error:pages=4"]);
    assert.match(raw, /^extraction_formula_syntax_error_pages: "4"$/m);
    assert.match(raw, /^extraction_formula_syntax_error_count: 1$/m);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("formula-aware capture records strict warning metadata and enters follow-up", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "my-wiki-formula-strict-capture-"));
  try {
    await mkdir(path.join(vault, "wiki"), { recursive: true });
    await writeFile(path.join(vault, "wiki", "log.md"), "# Log\n", "utf8");
    const result = await captureSource({
      vault,
      title: "Strict formula source",
      sourceType: "pdf",
      content: `### Page 9

$$
\\begin{array}{c c} 1 & 2 & 3 \\end{array}
$$`,
      extractionStatus: "complete",
      extractionMethod: "mineru",
      extractionQuality: { formulaRiskPages: [9] },
      shouldSnapshot: false,
      shouldMirrorImages: false
    });
    const raw = await readFile(result.path, "utf8");

    assert.equal(result.status, "needs-followup");
    assert.deepEqual(result.followupReasons, ["formula-strict-warning:pages=9"]);
    assert.match(raw, /^extraction_formula_strict_warning_pages: "9"$/m);
    assert.match(raw, /^extraction_formula_strict_warning_count: 1$/m);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("re-extraction stays complete but locks maintenance when formula syntax fails", async () => {
  const source = `---
title: "Source"
type: raw-source
status: inbox
needs_followup: false
followup_reasons: []
tags:
  - "raw"
---

## Capture

old

## Processing Notes

- Status: inbox
`;
  const formulaGate = await checkMarkdownFormulas(`### Page 38

$$
x\\tag{①}\\tag{4-2}
$$`);
  const updated = applyExtractionToRawNote(source, {
    status: "complete",
    method: "mineru",
    content: formulaGate.markdown,
    pages: 1,
    characters: 20,
    quality: {},
    formulaGate
  });

  assert.match(updated, /^extraction_status: "complete"$/m);
  assert.match(updated, /^status: "needs-followup"$/m);
  assert.match(updated, /formula-syntax-error:pages=38/);
  assert.match(updated, /^extraction_formula_syntax_error_pages: "38"$/m);
});
