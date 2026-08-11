import assert from "node:assert/strict";
import test from "node:test";
import { pdfOcrSettings } from "../scripts/core/document-extractor.mjs";
import { mineruEntriesToMarkdown } from "../scripts/core/mineru-extractor.mjs";
import { assessPdfPage, cleanExtractedPageText, summarizePdfQuality } from "../scripts/core/pdf-quality.mjs";
import { classifyPdfVisualPages, parsePageRanges, pdfVisualGateSettings } from "../scripts/core/pdf-visual-gate.mjs";
import { suppressRawPdfPages } from "../scripts/core/pdf-raw-suppression.mjs";
import { applyExtractionToRawNote } from "../scripts/core/reextract-source.mjs";

test("large PDF OCR defaults cover textbook-sized scans in resumable batches", () => {
  assert.deepEqual(pdfOcrSettings({}), {
    maxPages: 1000,
    batchPages: 24,
    scale: 1.8,
    languages: "eng+chi_sim"
  });
  assert.equal(pdfOcrSettings({ MY_WIKI_OCR_MAX_PDF_PAGES: "0" }).maxPages, 0);
  assert.equal(pdfOcrSettings({ MY_WIKI_OCR_PDF_BATCH_PAGES: "8" }).batchPages, 8);
});

test("PDF cleanup removes OCR spaces only between Chinese characters and punctuation", () => {
  assert.equal(cleanExtractedPageText("高 等 数 学 ， f (x) remains spaced"), "高等数学， f (x) remains spaced");
});

test("page quality gate reports sparse and noisy pages without hiding formula risk", () => {
  const good = assessPdfPage({ page: 1, text: "设函数在区间内连续，因此可以应用中值定理。这里保留正常的中文说明。", confidence: 91, method: "pdf-ocr" });
  const bad = assessPdfPage({ page: 2, text: "B® @@@ !!! ??? ### THEE", confidence: 31, method: "pdf-ocr" });
  const formula = assessPdfPage({ page: 3, text: "设函数在闭区间上连续并满足 f(x) = x^2 + 2x + 1，计算可得 ∫ f(x) dx = F(x)，以下讨论其性质。", confidence: 88, method: "pdf-ocr" });
  const summary = summarizePdfQuality([good, bad, formula], { method: "pdf-ocr" });
  assert.equal(bad.level, "poor");
  assert.equal(formula.formulaRisk, true);
  assert.equal(summary.level, "poor");
  assert.deepEqual(summary.lowQualityPages, [2]);
  assert.deepEqual(summary.formulaRiskPages, [2, 3]);
});

test("page quality gate suppresses extreme repetitive OCR hallucinations", () => {
  const hallucinated = assessPdfPage({
    page: 9,
    text: "求 x 与 y 的方程乘积。".repeat(600),
    method: "mineru"
  });
  const summary = summarizePdfQuality([hallucinated], { method: "mineru" });
  assert.equal(hallucinated.level, "poor");
  assert.equal(hallucinated.repetitiveHallucination, true);
  assert.match(hallucinated.text, /output suppressed/);
  assert.deepEqual(summary.repetitiveHallucinationPages, [9]);
});

test("page quality gate catches templated repetition with changing numbers", () => {
  const hallucinated = assessPdfPage({
    page: 9,
    text: Array.from({ length: 520 }, (_, index) => `therefore m is not equal to ${index}`).join(" , "),
    method: "mineru"
  });
  assert.equal(hallucinated.repetitiveHallucination, true);
  assert.equal(hallucinated.suppressedHallucination, true);
  assert.match(hallucinated.text, /templated repetition/);
});

test("visual page gate distinguishes blank noise, low contrast, and mirrored show-through", () => {
  const classified = classifyPdfVisualPages([
    { page: 1, darkCoverage: 0.022, inkCoverage: 0.027, contrast: 34 },
    { page: 2, darkCoverage: 0.024, inkCoverage: 0.029, contrast: 36 },
    { page: 3, darkCoverage: 0.021, inkCoverage: 0.026, contrast: 33 },
    { page: 9, darkCoverage: 0.0011, inkCoverage: 0.0022, contrast: 6.3 },
    { page: 177, darkCoverage: 0.0094, inkCoverage: 0.016, contrast: 19.3 }
  ]);
  assert.equal(classified.find((item) => item.page === 9).classification, "blank-noise");
  assert.equal(classified.find((item) => item.page === 177).classification, "low-contrast");

  const mirrored = classifyPdfVisualPages([
    { page: 176, width: 4, height: 2, darkCoverage: 0.025, inkCoverage: 0.032, contrast: 34, luminance: Uint8Array.from([255, 210, 60, 255, 255, 80, 220, 255]) },
    { page: 177, width: 4, height: 2, darkCoverage: 0.01, inkCoverage: 0.017, contrast: 20, luminance: Uint8Array.from([255, 191, 236, 255, 255, 239, 197, 255]) }
  ]);
  assert.equal(mirrored.find((item) => item.page === 177).classification, "reverse-side-showthrough");
});

test("visual and text signals suppress implausible output without hiding sparse strong pages", () => {
  const showthrough = assessPdfPage({
    page: 177,
    text: Array.from({ length: 160 }, (_, index) => `2023 company notice ${index} foreign exchange transaction`).join(" "),
    method: "mineru",
    visual: { classification: "low-contrast", darkCoverage: 0.0094 }
  });
  assert.equal(showthrough.showthroughPage, true);
  assert.equal(showthrough.level, "good");
  assert.match(showthrough.text, /reverse-side show-through/);

  const sparseTitle = assessPdfPage({
    page: 2,
    text: "Linear Algebra",
    method: "mineru",
    visual: { classification: "low-contrast", darkCoverage: 0.006 }
  });
  assert.equal(sparseTitle.suppressedHallucination, false);
  assert.equal(sparseTitle.text, "Linear Algebra");
});

test("visual gate supports explicit blank page ranges", () => {
  assert.deepEqual(parsePageRanges("9, 177, 180-182"), [9, 177, 180, 181, 182]);
  assert.deepEqual(pdfVisualGateSettings({ MY_WIKI_PDF_VISUAL_GATE: "0", MY_WIKI_PDF_BLANK_PAGES: "9,177" }), {
    enabled: false,
    scale: 0.35,
    forcedBlankPages: [9, 177]
  });
});

test("manual PDF page suppression preserves anchors and records audit metadata", () => {
  const source = `---
title: "Textbook"
type: raw-source
extracted_characters: 999
extraction_repetitive_hallucination_pages: ""
---

# Textbook

## Capture

### Page 8

Valid content.

### Page 9

Hallucinated content repeated many times.

### Page 10

Valid content continues.

### Page 177

Reverse-side text hallucination.

### Page 178

Back cover.

## Images

- None.

## Processing Notes

- Status: inbox
`;
  const updated = suppressRawPdfPages(source, { blankPages: [9], showthroughPages: [177] });
  assert.match(updated, /^### Page 9\n\n_Page omitted after manual review confirmed that it contains only blank-page noise\._$/m);
  assert.match(updated, /^### Page 177\n\n_Page omitted after manual review confirmed that it contains only reverse-side show-through\._$/m);
  assert.match(updated, /^extraction_repetitive_hallucination_pages: "9"$/m);
  assert.match(updated, /^extraction_suppressed_hallucination_pages: "9,177"$/m);
  assert.match(updated, /^extraction_blank_pages: "9"$/m);
  assert.match(updated, /^extraction_showthrough_pages: "177"$/m);
  assert.match(updated, /Manual PDF page suppression: blank pages 9; reverse-side show-through pages 177/);
  assert.doesNotMatch(updated, /Hallucinated content repeated/);
  assert.doesNotMatch(updated, /Reverse-side text hallucination/);
  assert.match(updated, /Valid content continues/);
});

test("MinerU content list preserves page anchors and LaTeX blocks", () => {
  const result = mineruEntriesToMarkdown([
    { page_idx: 0, type: "text", text: "第一章 极限" },
    { page_idx: 0, type: "equation", text: "f(x)=x^2" },
    { page_idx: 0, type: "table", table_caption: ["常用极限"], table_body: "<table><tr><td>x</td><td>0</td></tr></table>" },
    { page_idx: 0, type: "image", image_caption: ["图 1-1 函数曲线"] },
    { page_idx: 1, type: "text", text: "第二页正文" }
  ], 2);
  assert.equal(result.pages, 2);
  assert.match(result.content, /### Page 1/);
  assert.match(result.content, /\$\$\nf\(x\)=x\^2\n\$\$/);
  assert.match(result.content, /\*\*常用极限\*\*/);
  assert.match(result.content, /<table>/);
  assert.match(result.content, /图 1-1 函数曲线/);
  assert.match(result.content, /### Page 2/);
});

test("re-extraction updates an existing raw note in place without losing relations", () => {
  const source = `---
title: "Scanned textbook"
type: raw-source
source_type: "pdf"
status: needs-followup
needs_followup: true
followup_reasons:
  - "extraction:skipped-large"
extraction_status: "skipped-large"
extraction_method: "pdf-ocr"
text_extraction: "skipped-large"
extracted_pages: 400
extracted_characters: 0
extracted_units: 400
extracted_unit_label: "items"
extraction_confidence: 0
tags:
  - "raw"
  - "snapshotted"
  - "needs-followup"
related:
  - "[[大学数学教材]]"
---

# Scanned textbook

## Capture

> The PDF was too large.

## Images

- None.

## Processing Notes

- Status: needs-followup
- Follow-up reasons: extraction:skipped-large
- Content extraction: skipped-large via pdf-ocr (0 characters)
`;
  const updated = applyExtractionToRawNote(source, {
    status: "complete",
    method: "pdf-ocr",
    content: "> OCR complete.\n\n### Page 1\n\nReadable text",
    pages: 400,
    characters: 12000,
    units: 400,
    unitLabel: "pages",
    confidence: 88,
    engine: "mineru",
    quality: {
      level: "good",
      score: 92,
      lowQualityPages: [],
      degradedPages: [2],
      formulaRiskPages: [4],
      repetitiveHallucinationPages: [9],
      suppressedHallucinationPages: [9, 177],
      blankPages: [9],
      showthroughPages: [177]
    }
  });

  assert.match(updated, /^status: "inbox"$/m);
  assert.match(updated, /^needs_followup: false$/m);
  assert.match(updated, /^followup_reasons: \[\]$/m);
  assert.match(updated, /^extraction_status: "complete"$/m);
  assert.match(updated, /^extraction_engine: "mineru"$/m);
  assert.match(updated, /^extraction_quality: "good"$/m);
  assert.match(updated, /^extraction_degraded_pages: "2"$/m);
  assert.match(updated, /^extraction_repetitive_hallucination_pages: "9"$/m);
  assert.match(updated, /^extraction_suppressed_hallucination_pages: "9,177"$/m);
  assert.match(updated, /^extraction_blank_pages: "9"$/m);
  assert.match(updated, /^extraction_showthrough_pages: "177"$/m);
  assert.match(updated, /^extracted_characters: 12000$/m);
  assert.match(updated, /\[\[大学数学教材\]\]/);
  assert.match(updated, /### Page 1\n\nReadable text/);
  assert.doesNotMatch(updated, /The PDF was too large/);
  assert.doesNotMatch(updated, /"needs-followup"/);
});
