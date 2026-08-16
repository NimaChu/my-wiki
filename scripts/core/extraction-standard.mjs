import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { documentIrDigest, documentIrFromMarkdown } from "./document-ir.mjs";

export const EXTRACTION_REPORT_SCHEMA = "my-wiki.extraction-report/v1";

export async function standardizeExtractionResult(result, { file = "", filename = "", attempts = [] } = {}) {
  const source = file ? await sourceIdentity(file, filename) : { filename, sha256: "", bytes: 0 };
  const document = result.document || documentIrFromMarkdown({
    content: result.content,
    filename: source.filename,
    sourceHash: source.sha256,
    engine: result.engine,
    engineVersion: result.engineVersion,
    method: result.method,
    pages: result.pages,
    assets: result.assets,
    quality: result.quality
  });
  document.source = { ...document.source, filename: source.filename, sha256: source.sha256 };
  const report = buildExtractionReport({ result, document, source, attempts });
  const status = result.status === "complete" && !report.acceptance.accepted ? "low-quality" : result.status;
  const warnings = [...new Set([...(result.warnings || []), ...report.acceptance.warnings])];
  return {
    ...result,
    status,
    document,
    extractionReport: report,
    warnings,
    message: status === result.status ? result.message : report.acceptance.summary
  };
}

export function buildExtractionReport({ result, document, source = {}, attempts = [] }) {
  const expectedPages = Number(result.pages || document.pages?.length || 0);
  const representedPages = [...new Set((document.blocks || []).map((block) => Number(block.page)).filter((page) => page > 0))].sort((a, b) => a - b);
  const missingPages = expectedPages > 0
    ? Array.from({ length: expectedPages }, (_, index) => index + 1).filter((page) => !representedPages.includes(page))
    : [];
  const hardFailures = [];
  const warnings = [];
  if (result.status !== "complete") hardFailures.push(`extractor-status:${result.status || "unknown"}`);
  if (!String(result.content || "").trim()) hardFailures.push("empty-output");
  if (expectedPages > 0 && representedPages.length === 0) hardFailures.push("missing-page-provenance");
  if (missingPages.length) warnings.push(`IR has no content blocks for pages: ${compactNumbers(missingPages)}`);
  if (result.quality?.level === "poor") hardFailures.push("quality:poor");
  if (result.quality?.level === "degraded") warnings.push("Extraction quality is degraded and should be sampled before distillation.");
  if (result.quality?.missingVisualEvidencePages?.length) {
    hardFailures.push(`missing-visual-evidence:pages=${compactNumbers(result.quality.missingVisualEvidencePages)}`);
  }
  if (result.quality?.preservedVisualEvidencePages?.length) {
    warnings.push(`Rendered omitted visual evidence on pages: ${compactNumbers(result.quality.preservedVisualEvidencePages)}`);
  }
  if (result.quality?.visualReviewPages?.length) warnings.push(`Visual review pages remain: ${compactNumbers(result.quality.visualReviewPages)}`);
  const accepted = hardFailures.length === 0;
  return {
    schema: EXTRACTION_REPORT_SCHEMA,
    report_id: createHash("sha256").update(`${source.sha256 || ""}\0${documentIrDigest(document)}`).digest("hex"),
    generated_at: new Date().toISOString(),
    source,
    selected_engine: String(result.engine || result.method || "unknown"),
    selected_method: String(result.method || ""),
    attempts: attempts.map(sanitizeAttempt),
    coverage: {
      expected_pages: expectedPages,
      represented_pages: representedPages,
      missing_pages: missingPages,
      blocks: document.blocks?.length || 0,
      assets: document.assets?.length || 0
    },
    quality: result.quality || null,
    acceptance: {
      accepted,
      hard_failures: hardFailures,
      warnings,
      summary: accepted ? "Extraction passed the My Wiki evidence standard." : `Extraction failed the My Wiki evidence standard: ${hardFailures.join(", ")}.`
    }
  };
}

export function finalizeExtractionReport(report, { formulaGate = null, unicodeGate = null, attachmentFailures = [] } = {}) {
  if (!report) return null;
  const hardFailures = [...(report.acceptance?.hard_failures || [])];
  const warnings = [...(report.acceptance?.warnings || [])];
  if (formulaGate?.errors?.length) hardFailures.push(`formula-syntax:${formulaGate.errors.length}`);
  if (formulaGate?.strictWarnings?.length) hardFailures.push(`formula-strict:${formulaGate.strictWarnings.length}`);
  if (unicodeGate?.blocked) hardFailures.push(`unicode-replacement:${Number(unicodeGate.count || 0)}`);
  for (const failure of attachmentFailures) hardFailures.push(`missing-attachment:${failure}`);
  const accepted = hardFailures.length === 0;
  return {
    ...report,
    gates: {
      formula: formulaGate ? { checked: Number(formulaGate.checked || 0), syntax_errors: Number(formulaGate.errors?.length || 0), strict_warnings: Number(formulaGate.strictWarnings?.length || 0) } : null,
      encoding: unicodeGate ? { blocked: Boolean(unicodeGate.blocked), replacements: Number(unicodeGate.count || 0), pages: unicodeGate.pages || [] } : null,
      attachments: { failures: [...attachmentFailures] }
    },
    acceptance: {
      accepted,
      hard_failures: [...new Set(hardFailures)],
      warnings: [...new Set(warnings)],
      summary: accepted ? "Extraction passed the My Wiki evidence standard." : `Extraction failed the My Wiki evidence standard: ${[...new Set(hardFailures)].join(", ")}.`
    }
  };
}

export async function persistExtractionArtifacts({ vault, rawBase, report, document }) {
  if (!report || !document) return { reportPath: "", documentPath: "" };
  const root = path.join(vault, ".my-wiki", "extractions");
  await fs.mkdir(root, { recursive: true });
  const safeBase = String(rawBase || "document").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 160);
  const reportFile = path.join(root, `${safeBase}.report.json`);
  const documentFile = path.join(root, `${safeBase}.document.json.gz`);
  const reportRelative = portable(path.relative(vault, reportFile));
  const documentRelative = portable(path.relative(vault, documentFile));
  await fs.writeFile(documentFile, gzipSync(Buffer.from(`${JSON.stringify(document)}\n`)));
  await fs.writeFile(reportFile, `${JSON.stringify({ ...report, document_ir: documentRelative }, null, 2)}\n`, "utf8");
  return { reportPath: reportRelative, documentPath: documentRelative };
}

async function sourceIdentity(file, filename) {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      bytes += result.bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { filename: String(filename || path.basename(file)), sha256: hash.digest("hex"), bytes };
}

function sanitizeAttempt(attempt) {
  return {
    engine: String(attempt?.engine || "unknown"),
    status: String(attempt?.status || "unknown"),
    method: String(attempt?.method || ""),
    pages: Number(attempt?.pages || 0),
    provider: String(attempt?.provider || ""),
    model: String(attempt?.model || ""),
    repaired_pages: compactPageValues(attempt?.repairedPages),
    rejected_pages: compactPageValues(attempt?.rejectedPages),
    message: String(attempt?.message || "").slice(0, 500)
  };
}

function compactPageValues(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number).filter((page) => Number.isInteger(page) && page > 0))].sort((a, b) => a - b);
}

function compactNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isInteger))].sort((a, b) => a - b).join(",");
}

function portable(value) {
  return String(value || "").replace(/\\/g, "/");
}
