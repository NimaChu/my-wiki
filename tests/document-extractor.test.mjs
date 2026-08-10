import assert from "node:assert/strict";
import test from "node:test";
import { pdfOcrSettings } from "../scripts/core/document-extractor.mjs";
import { mineruEntriesToMarkdown } from "../scripts/core/mineru-extractor.mjs";
import { assessPdfPage, cleanExtractedPageText, summarizePdfQuality } from "../scripts/core/pdf-quality.mjs";
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
    quality: { level: "good", score: 92, lowQualityPages: [], degradedPages: [2], formulaRiskPages: [4], repetitiveHallucinationPages: [9] }
  });

  assert.match(updated, /^status: "inbox"$/m);
  assert.match(updated, /^needs_followup: false$/m);
  assert.match(updated, /^followup_reasons: \[\]$/m);
  assert.match(updated, /^extraction_status: "complete"$/m);
  assert.match(updated, /^extraction_engine: "mineru"$/m);
  assert.match(updated, /^extraction_quality: "good"$/m);
  assert.match(updated, /^extraction_degraded_pages: "2"$/m);
  assert.match(updated, /^extraction_repetitive_hallucination_pages: "9"$/m);
  assert.match(updated, /^extracted_characters: 12000$/m);
  assert.match(updated, /\[\[大学数学教材\]\]/);
  assert.match(updated, /### Page 1\n\nReadable text/);
  assert.doesNotMatch(updated, /The PDF was too large/);
  assert.doesNotMatch(updated, /"needs-followup"/);
});
