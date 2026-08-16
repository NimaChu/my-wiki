import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractPdfWithOcrFallback, pdfOcrSettings } from "../scripts/core/document-extractor.mjs";
import { insertPageAssetReferences, mergeMineruBatches, mineruBatchRanges, mineruEntriesToMarkdown, readMineruOutput, relationshipDiagramPages, shiftMineruBatch } from "../scripts/core/mineru-extractor.mjs";
import {
  applyVisualEvidenceCoverage,
  assessPdfPage,
  cleanExtractedPageText,
  compactPageRanges,
  findMissingVisualEvidencePages,
  summarizePdfQuality
} from "../scripts/core/pdf-quality.mjs";
import { classifyPdfVisualPages, parsePageRanges, pdfVisualGateSettings } from "../scripts/core/pdf-visual-gate.mjs";
import { suppressRawPdfPages } from "../scripts/core/pdf-raw-suppression.mjs";
import { applyExtractionToRawNote, reinsertIndexedPageAssets } from "../scripts/core/reextract-source.mjs";
import { materializeEmbeddedAssets } from "../scripts/core/capture-service.mjs";

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

test("MinerU splits long documents into bounded zero-based page ranges", () => {
  assert.deepEqual(mineruBatchRanges(1071, {}), [
    ...Array.from({ length: 16 }, (_, index) => ({ start: index * 64, end: index * 64 + 63 })),
    { start: 1024, end: 1070 }
  ]);
  assert.deepEqual(mineruBatchRanges(512, {}), []);
  assert.deepEqual(mineruBatchRanges(513, { MY_WIKI_MINERU_BATCH_PAGES: "128" }), [
    { start: 0, end: 127 }, { start: 128, end: 255 }, { start: 256, end: 383 }, { start: 384, end: 511 }, { start: 512, end: 512 }
  ]);
  assert.deepEqual(mineruBatchRanges(900, { MY_WIKI_MINERU_BATCH_PAGES: "0" }), []);
});

test("MinerU batch merge shifts page anchors and namespaces embedded assets", () => {
  const first = shiftMineruBatch({
    content: "### Page 1\n\n![Map](my-wiki-asset:mineru-image-1.png)",
    pages: 64,
    pageResults: [{ page: 1, text: "first" }],
    assets: [{ reference: "my-wiki-asset:mineru-image-1.png", id: "mineru-image-1", name: "page-001-map.png", page: 1 }]
  }, 0, 1);
  const second = shiftMineruBatch({
    content: "### Page 1\n\n![Map](my-wiki-asset:mineru-image-1.png)",
    pages: 47,
    pageResults: [{ page: 1, text: "last" }],
    assets: [{ reference: "my-wiki-asset:mineru-image-1.png", id: "mineru-image-1", name: "page-001-map.png", page: 1 }]
  }, 1024, 17);
  const merged = mergeMineruBatches([first, second], 1071);
  assert.match(merged.content, /^### Page 1/m);
  assert.match(merged.content, /^### Page 1025/m);
  assert.match(merged.content, /my-wiki-asset:mineru-batch-17-mineru-image-1\.png/);
  assert.deepEqual(merged.pageResults.map((item) => item.page), [1, 1025]);
  assert.deepEqual(merged.assets.map((item) => item.page), [1, 1025]);
  assert.notEqual(merged.assets[0].reference, merged.assets[1].reference);
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

test("page quality gate distinguishes omitted visual evidence from a genuinely blank page", () => {
  const omitted = assessPdfPage({
    page: 13,
    text: "13",
    method: "mineru",
    visual: { classification: "low-contrast", darkCoverage: 0.002, inkCoverage: 0.035, contrast: 14.8 }
  });
  assert.deepEqual(findMissingVisualEvidencePages([omitted], []), [13]);
  assert.deepEqual(findMissingVisualEvidencePages([omitted], [13]), []);

  const unresolved = applyVisualEvidenceCoverage([omitted], { missingPages: [13] });
  assert.equal(unresolved[0].missingVisualEvidence, true);
  assert.match(unresolved[0].reasons.join(" "), /missing-visual-evidence/);

  const preserved = applyVisualEvidenceCoverage([omitted], { preservedPages: [13] });
  const summary = summarizePdfQuality(preserved, { method: "mineru" });
  assert.equal(preserved[0].visualEvidencePreserved, true);
  assert.equal(preserved[0].level, "good");
  assert.deepEqual(summary.preservedVisualEvidencePages, [13]);
  assert.deepEqual(summary.missingVisualEvidencePages, []);
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

test("automatic PDF extraction prefers an available MinerU result even when PDF.js reports good text", async () => {
  const calls = [];
  const progress = [];
  const result = await extractPdfWithOcrFallback({
    file: "textbook.pdf",
    dependencyRoot: "dependencies",
    cacheRoot: "cache",
    environment: {},
    onProgress: (value) => progress.push(value),
    extractPdf: async () => {
      calls.push("pdfjs");
      return {
        status: "complete",
        content: "Readable but structurally flattened PDF.js textbook content.",
        pages: 10,
        quality: { level: "good" }
      };
    },
    extractMineru: async ({ pages, environment, onProgress }) => {
      calls.push("mineru");
      assert.equal(pages, 10);
      assert.deepEqual(environment, {});
      onProgress({ phase: "mineru", current: 5, total: 10, percent: 48 });
      return {
        status: "complete",
        method: "mineru",
        engine: "mineru",
        content: "## Structured MinerU textbook content with formulas and tables.",
        pages: 10,
        characters: 58,
        quality: { level: "good", score: 96 }
      };
    }
  });

  assert.deepEqual(calls, ["pdfjs", "mineru"]);
  assert.equal(result.status, "complete");
  assert.equal(result.engine, "mineru");
  assert.equal(result.method, "mineru");
  assert.match(result.content, /Structured MinerU/);
  assert.deepEqual(progress.map((item) => item.phase), ["pdf-analysis", "mineru"]);
});

test("automatic PDF extraction does not hide a MinerU failure behind PDF.js text", async () => {
  const result = await extractPdfWithOcrFallback({
    file: "textbook.pdf",
    dependencyRoot: "dependencies",
    cacheRoot: "cache",
    environment: {},
    extractPdf: async () => ({
      status: "complete",
      content: "A large but layout-free PDF.js text stream.",
      pages: 1071,
      characters: 3_620_390,
      quality: { level: "degraded", score: 85.1 }
    }),
    extractMineru: async () => ({
      status: "failed",
      method: "mineru",
      engine: "mineru",
      message: "MinerU failed (1): processing window stopped"
    })
  });

  assert.equal(result.status, "failed");
  assert.equal(result.method, "mineru");
  assert.equal(result.engine, "mineru");
  assert.equal(result.characters, 0);
  assert.match(result.message, /MinerU failed \(1\)/);
  assert.doesNotMatch(result.content, /layout-free PDF\.js/);
});

test("automatic PDF extraction does not replace low-quality MinerU output with PDF.js text", async () => {
  const result = await extractPdfWithOcrFallback({
    file: "textbook.pdf",
    dependencyRoot: "dependencies",
    cacheRoot: "cache",
    environment: {},
    extractPdf: async () => ({
      status: "complete",
      content: "Readable but layout-free PDF.js text.",
      pages: 300,
      characters: 800_000,
      quality: { level: "good", score: 90 }
    }),
    extractMineru: async () => ({
      status: "low-quality",
      method: "mineru",
      engine: "mineru",
      content: "Partial structured evidence for review.",
      pages: 300,
      characters: 38,
      quality: { level: "poor", score: 41 },
      message: "MinerU output did not meet the page-quality threshold."
    })
  });

  assert.equal(result.status, "low-quality");
  assert.equal(result.method, "mineru");
  assert.equal(result.engine, "mineru");
  assert.match(result.content, /Partial structured evidence/);
  assert.doesNotMatch(result.content, /layout-free PDF\.js/);
});

test("automatic PDF extraction still uses PDF.js when MinerU is unavailable", async () => {
  const result = await extractPdfWithOcrFallback({
    file: "textbook.pdf",
    dependencyRoot: "dependencies",
    cacheRoot: "cache",
    environment: {},
    extractPdf: async () => ({
      status: "complete",
      content: "Readable text-layer evidence.",
      pages: 12,
      characters: 29,
      quality: { level: "good", score: 90 },
      warnings: []
    }),
    extractMineru: async () => ({
      status: "unavailable",
      method: "mineru",
      message: "MinerU command is not available"
    })
  });

  assert.equal(result.status, "complete");
  assert.equal(result.method, "pdf-text");
  assert.equal(result.engine, "pdfjs");
  assert.match(result.warnings.join(" "), /MinerU is not installed/);
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

test("automatic visual blank and show-through candidates preserve substantive front-side text", () => {
  const substantive = "本页是矩阵分解章节首页，介绍三角分解、正交三角分解、满秩分解与奇异值分解，并说明这些结构在数值计算中的用途。".repeat(3);
  for (const classification of ["blank-noise", "reverse-side-showthrough"]) {
    const result = assessPdfPage({ page: 90, text: substantive, method: "mineru", visual: { classification, darkCoverage: 0.002 } });
    assert.equal(result.suppressedHallucination, false);
    assert.equal(result.visualReviewCandidate, true);
    assert.equal(result.text, substantive);
  }
  const empty = assessPdfPage({ page: 9, text: "", method: "mineru", visual: { classification: "blank-noise", darkCoverage: 0.001 } });
  assert.equal(empty.suppressedHallucination, true);
  assert.match(empty.text, /blank-page noise/);
  const diagram = assessPdfPage({
    page: 21,
    text: "四、内容结构框图\n\n![第一章内容结构框图](my-wiki-asset:map.png)",
    method: "mineru",
    visual: { classification: "blank-noise", darkCoverage: 0.001 }
  });
  assert.equal(diagram.suppressedHallucination, false);
  assert.equal(diagram.visualReviewCandidate, true);
  assert.match(diagram.text, /my-wiki-asset:map\.png/);
});

test("page range metadata remains complete beyond one hundred review pages", () => {
  assert.equal(compactPageRanges(Array.from({ length: 150 }, (_, index) => index + 1), 0), "1-150");
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

test("MinerU image blocks retain their files as referenced embedded assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-mineru-test-"));
  try {
    await fs.mkdir(path.join(root, "images"), { recursive: true });
    await fs.writeFile(path.join(root, "images", "map.png"), Buffer.from("png-bytes"));
    await fs.writeFile(path.join(root, "book_content_list.json"), JSON.stringify([
      { page_idx: 20, type: "text", text: "四、内容结构框图" },
      { page_idx: 20, type: "image", img_path: "images/map.png", image_caption: ["第一章内容结构框图"] }
    ]));
    const result = await readMineruOutput(root, 21);
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0].page, 21);
    assert.equal(result.assets[0].status, "extracted-by-mineru");
    assert.match(result.content, /!\[第一章内容结构框图\]\(my-wiki-asset:mineru-image-1\.png\)/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("sparse relationship diagrams are detected and page assets are inserted in place", () => {
  assert.deepEqual(relationshipDiagramPages([
    { page: 21, text: "四、内容结构框图" },
    { page: 22, text: "普通正文，不是关系图。" }
  ]), [21]);
  const updated = insertPageAssetReferences("### Page 21\n\n四、内容结构框图\n\n### Page 22\n\n正文", [
    { page: 21, reference: "my-wiki-asset:page-21.png", alt: "第一章内容结构框图" }
  ]);
  assert.match(updated, /^### Page 21\n\n!\[第一章内容结构框图\]\(my-wiki-asset:page-21\.png\)/m);
});

test("embedded page assets write an image index and re-extraction can restore their page references", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-asset-test-"));
  try {
    const notePath = path.join(vault, "raw", "sources", "book.md");
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    const materialized = await materializeEmbeddedAssets({
      vault,
      notePath,
      rawBase: "book",
      markdown: "### Page 21\n\n![框图](my-wiki-asset:map.png)",
      assets: [{ reference: "my-wiki-asset:map.png", name: "page-021-content-map.png", buffer: Buffer.from("image"), page: 21, alt: "第一章内容结构框图", status: "rendered-diagram-fallback" }]
    });
    assert.match(materialized.markdown, /\.\.\/assets\/book\/page-021-content-map\.png/);
    const index = JSON.parse(await fs.readFile(path.join(vault, "raw", "assets", "book", "image-index.json"), "utf8"));
    assert.equal(index.images[0].page, 21);
    const restored = reinsertIndexedPageAssets("### Page 21\n\n四、内容结构框图", index.images);
    assert.equal(restored.inserted, 1);
    assert.match(restored.content, /!\[第一章内容结构框图\]\(\.\.\/assets\/book\/page-021-content-map\.png\)/);
    assert.equal(reinsertIndexedPageAssets(restored.content, index.images).inserted, 0);
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
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
      showthroughPages: [177],
      visualReviewPages: [45, 90]
    },
    warnings: ["Degraded PDF pages: 2", "Preserved visual review candidates: 45,90"]
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
  assert.match(updated, /^extraction_visual_review_pages: "45,90"$/m);
  assert.match(updated, /^extracted_characters: 12000$/m);
  assert.match(updated, /\[\[大学数学教材\]\]/);
  assert.match(updated, /### Page 1\n\nReadable text/);
  assert.doesNotMatch(updated, /The PDF was too large/);
  assert.doesNotMatch(updated, /"needs-followup"/);
  assert.match(updated, /Extraction warnings: Degraded PDF pages: 2; Preserved visual review candidates: 45,90/);
});

test("re-extraction replaces stale warnings and stores complete compressed page ranges", () => {
  const source = `---
title: "Book"
type: raw-source
status: inbox
tags:
  - "raw"
related:
---

# Book

## Capture

Old text.

## Processing Notes

- Status: inbox
- Follow-up reasons: none
- Content extraction: complete via pdf-ocr (10 characters)
- Extraction warnings: Low-quality PDF pages: 1-270
- Embedded local assets: 0
`;
  const pages = Array.from({ length: 150 }, (_, index) => index + 1);
  const updated = applyExtractionToRawNote(source, {
    status: "complete",
    method: "mineru",
    engine: "mineru",
    content: "### Page 1\n\nReadable text",
    characters: 100,
    quality: { level: "degraded", score: 80, formulaRiskPages: pages },
    warnings: ["Formula/layout review pages: 1-150"],
    assetCount: 2
  });
  assert.match(updated, /^extraction_formula_risk_pages: "1-150"$/m);
  assert.doesNotMatch(updated, /Low-quality PDF pages: 1-270/);
  assert.match(updated, /Extraction warnings: Formula\/layout review pages: 1-150/);
  assert.match(updated, /Embedded local assets: 2/);
  assert.match(updated, /^  - "images"$/m);
});
