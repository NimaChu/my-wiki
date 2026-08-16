import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import { gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { acceptVisualRepairPage, repairPdfWithAgentVision, visualRepairRiskPages } from "../scripts/core/agent-vision-repair.mjs";
import { doclingDocumentToIr } from "../scripts/core/docling-extractor.mjs";
import { createDocumentIr, documentIrFromMarkdown, replaceMarkdownPages } from "../scripts/core/document-ir.mjs";
import { buildExtractionReport, finalizeExtractionReport, persistExtractionArtifacts } from "../scripts/core/extraction-standard.mjs";
import { extractPdfWithOcrFallback } from "../scripts/core/document-extractor.mjs";

test("My Wiki document IR preserves page blocks and supports targeted page replacement", () => {
  const content = "### Page 1\n\nFirst page.\n\n### Page 2\n\nBroken OCR.";
  const document = documentIrFromMarkdown({ content, filename: "book.pdf", engine: "mineru", method: "mineru", pages: 2 });
  assert.equal(document.schema, "my-wiki.document-ir/v1");
  assert.deepEqual(document.pages.map((page) => page.number), [1, 2]);
  assert.deepEqual(document.blocks.map((block) => block.page), [1, 2]);
  assert.equal(replaceMarkdownPages(content, new Map([[2, "Repaired visually."]])), "### Page 1\n\nFirst page.\n\n### Page 2\n\nRepaired visually.");
});

test("central extraction report combines structural, formula, encoding, and attachment gates", () => {
  const document = createDocumentIr({
    filename: "book.pdf",
    engine: "mineru",
    pages: [{ number: 1 }, { number: 2 }],
    blocks: [{ page: 1, markdown: "Only page one", text: "Only page one" }]
  });
  const report = buildExtractionReport({
    result: { status: "complete", method: "mineru", engine: "mineru", content: "Only page one", pages: 2, quality: { level: "good", score: 92 } },
    document,
    source: { filename: "book.pdf", sha256: "abc", bytes: 10 },
    attempts: [{ engine: "mineru", status: "complete" }]
  });
  assert.equal(report.acceptance.accepted, true);
  assert.deepEqual(report.coverage.missing_pages, [2]);
  const final = finalizeExtractionReport(report, {
    formulaGate: { checked: 3, errors: [{}], strictWarnings: [] },
    unicodeGate: { blocked: true, count: 1, pages: [1] },
    attachmentFailures: ["missing.png"]
  });
  assert.equal(final.acceptance.accepted, false);
  assert.deepEqual(final.acceptance.hard_failures, ["formula-syntax:1", "unicode-replacement:1", "missing-attachment:missing.png"]);
});

test("central extraction report blocks unresolved visual evidence with exact page context", () => {
  const document = createDocumentIr({
    filename: "paper.pdf",
    engine: "mineru",
    pages: [{ number: 13 }, { number: 15 }],
    blocks: [
      { page: 13, markdown: "13", text: "13" },
      { page: 15, markdown: "15", text: "15" }
    ]
  });
  const report = buildExtractionReport({
    result: {
      status: "complete",
      method: "mineru",
      engine: "mineru",
      content: "### Page 13\n\n13\n\n### Page 15\n\n15",
      pages: 15,
      quality: { level: "degraded", score: 90.7, missingVisualEvidencePages: [13, 15] }
    },
    document
  });
  assert.equal(report.acceptance.accepted, false);
  assert.deepEqual(report.acceptance.hard_failures, ["missing-visual-evidence:pages=13,15"]);
});

test("extraction report and compressed IR stay in vault runtime state", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-extraction-report-"));
  try {
    const document = createDocumentIr({ blocks: [{ page: 1, text: "Evidence", markdown: "Evidence" }], pages: [{ number: 1 }] });
    const report = buildExtractionReport({ result: { status: "complete", content: "Evidence", pages: 1 }, document });
    const artifacts = await persistExtractionArtifacts({ vault, rawBase: "source", report, document });
    assert.equal(artifacts.reportPath, ".my-wiki/extractions/source.report.json");
    const persistedReport = JSON.parse(await fs.readFile(path.join(vault, artifacts.reportPath), "utf8"));
    assert.equal(persistedReport.document_ir, ".my-wiki/extractions/source.document.json.gz");
    const persistedDocument = JSON.parse(gunzipSync(await fs.readFile(path.join(vault, artifacts.documentPath))).toString("utf8"));
    assert.equal(persistedDocument.blocks[0].text, "Evidence");
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
});

test("Docling JSON maps structural labels and provenance into My Wiki IR", () => {
  const document = doclingDocumentToIr({
    name: "sample",
    pages: { "1": { size: { width: 600, height: 800 } } },
    texts: [
      { self_ref: "#/texts/0", label: "section_header", text: "Heading", prov: [{ page_no: 1, bbox: { l: 10, t: 50, r: 300, b: 20, coord_origin: "BOTTOMLEFT" }, charspan: [0, 7] }] },
      { self_ref: "#/texts/1", label: "formula", text: "x^2", prov: [{ page_no: 1, bbox: { l: 10, t: 100, r: 100, b: 80 } }] }
    ]
  }, { filename: "sample.pdf" });
  assert.deepEqual(document.blocks.map((block) => block.type), ["heading", "formula"]);
  assert.equal(document.blocks[0].bbox.left, 10);
  assert.equal(document.blocks[1].markdown, "$$\nx^2\n$$");
});

test("Agent vision is limited to risk pages and must improve the deterministic page score", () => {
  assert.deepEqual(visualRepairRiskPages({ quality: { lowQualityPages: [8], degradedPages: [3], visualReviewPages: [8, 9] } }, { MY_WIKI_VISUAL_REPAIR_MAX_PAGES: "2" }), [3, 8]);
  assert.equal(acceptVisualRepairPage({ level: "poor", score: 20 }, { level: "good", score: 90, meaningfulCharacters: 100 }), true);
  assert.equal(acceptVisualRepairPage({ level: "good", score: 90, meaningfulCharacters: 100 }, { level: "good", score: 92, meaningfulCharacters: 100 }), false);
});

test("Agent vision attaches rendered pages through the existing CLI runner", async () => {
  const calls = [];
  const primary = {
    status: "low-quality",
    method: "mineru",
    engine: "mineru",
    content: "### Page 1\n\nx",
    quality: { level: "poor", lowQualityPages: [1] },
    warnings: []
  };
  const repaired = await repairPdfWithAgentVision({
    file: "book.pdf",
    primary,
    dependencyRoot: "/dashboard",
    environment: { MY_WIKI_VISUAL_REPAIR_PROVIDER: "opencode", MY_WIKI_VISUAL_REPAIR_MODEL: "provider/vision" },
    renderPages: async ({ pages, outputDir }) => pages.map((page) => ({ page, file: path.join(outputDir, `page-${page}.png`) })),
    agentRunner: {
      info: async () => ({ available: true, providers: [{ provider: "opencode", label: "OpenCode", defaultModel: "provider/default" }] }),
      run: async (options) => {
        calls.push(options);
        return { pages: [{ page: 1, markdown: "# Linear Algebra\n\nA vector space is closed under vector addition and scalar multiplication.", notes: "Recovered from page image." }] };
      }
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "opencode");
  assert.equal(calls[0].model, "provider/vision");
  assert.match(calls[0].files[0], /page-1\.png$/);
  assert.match(repaired.result.content, /A vector space is closed/);
  assert.equal(repaired.result.method, "mineru+agent-vision-repair");
  assert.equal(repaired.attempt.provider, "opencode");
});

test("automatic PDF routing uses Docling only when MinerU is unavailable", async () => {
  const calls = [];
  const result = await extractPdfWithOcrFallback({
    file: "report.pdf",
    environment: { MY_WIKI_VISUAL_REPAIR_MODE: "off" },
    extractPdf: async () => ({ status: "complete", content: "Flat text", pages: 2 }),
    extractMineru: async () => { calls.push("mineru"); return { status: "unavailable", method: "mineru" }; },
    extractDocling: async () => { calls.push("docling"); return { status: "complete", method: "docling", engine: "docling", content: "Structured report", pages: 2, quality: { level: "good", score: 90 } }; }
  });
  assert.deepEqual(calls, ["mineru", "docling"]);
  assert.equal(result.engine, "docling");
  assert.equal(result.status, "complete");
});
