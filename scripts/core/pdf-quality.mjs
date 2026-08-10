import { gzipSync } from "node:zlib";

const CJK = "\\u3400-\\u9fff\\uf900-\\ufaff";
const CJK_CHARACTER = new RegExp(`[${CJK}]`);
const CJK_SPACE = new RegExp(`([${CJK}])(?:[ \\t]+)(?=[${CJK}])`, "g");
const SPACE_BEFORE_CJK_PUNCTUATION = new RegExp(`([${CJK}])[ \\t]+([，。！？；：、）】》〉])`, "g");
const SPACE_AFTER_CJK_PUNCTUATION = new RegExp(`([（【《〈])[ \\t]+([${CJK}])`, "g");
const MEANINGFUL = /[\p{L}\p{N}\u3400-\u9fff]/gu;
const SYMBOL = /[^\p{L}\p{N}\u3400-\u9fff\s]/gu;
const MATH_SYMBOL = /[=+\-*/^_∑∫√∞≈≠≤≥∂∆∇∈∉⊂⊆∪∩→⇒⇔¬∧∨∀∃α-ωΑ-Ω]/gu;
const MOJIBAKE = /(?:�|\uFFFD|(?:Ã|Â|â€|ðŸ|B®|THEE))/gu;

export function cleanExtractedPageText(value) {
  let text = String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\r\n?/g, "\n");
  let previous;
  do {
    previous = text;
    text = text.replace(CJK_SPACE, "$1");
  } while (text !== previous);
  return text
    .replace(SPACE_BEFORE_CJK_PUNCTUATION, "$1$2")
    .replace(SPACE_AFTER_CJK_PUNCTUATION, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function assessPdfPage({ page = 0, text = "", confidence = null, method = "pdf-text" } = {}) {
  const original = String(text || "");
  const cleaned = cleanExtractedPageText(original);
  const repetition = repetitionMetrics(cleaned);
  const meaningful = countMatches(cleaned, MEANINGFUL);
  const symbols = countMatches(cleaned, SYMBOL);
  const mathSymbols = countMatches(cleaned, MATH_SYMBOL);
  const mojibake = countMatches(cleaned, MOJIBAKE);
  const cjkCharacters = [...original].filter((character) => CJK_CHARACTER.test(character)).length;
  const cjkSpaces = countCjkSpaces(original);
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const symbolHeavyLines = lines.filter((line) => {
    const lineMeaningful = countMatches(line, MEANINGFUL);
    const lineSymbols = countMatches(line, SYMBOL);
    return line.length >= 16 && lineSymbols > Math.max(6, lineMeaningful * 0.8);
  }).length;
  const isolatedLines = lines.filter((line) => line.length <= 3 && countMatches(line, MEANINGFUL) === 1).length;
  const normalizedConfidence = confidence !== null && confidence !== undefined && confidence !== "" && Number.isFinite(Number(confidence))
    ? Number(confidence)
    : null;
  const reasons = [];
  let score = 100;

  if (meaningful < 24) {
    score -= 70;
    reasons.push("insufficient-text");
  } else if (meaningful < 80) {
    score -= 30;
    reasons.push("sparse-text");
  }
  if (mojibake > 0) {
    score -= Math.min(35, mojibake * 8);
    reasons.push("mojibake");
  }
  if (symbolHeavyLines >= 2) {
    score -= Math.min(35, symbolHeavyLines * 4);
    reasons.push("symbol-noise");
  }
  if (lines.length >= 8 && isolatedLines / lines.length >= 0.22) {
    score -= 20;
    reasons.push("fragmented-layout");
  }
  if (normalizedConfidence !== null && normalizedConfidence < 60) {
    score -= Math.min(45, (60 - normalizedConfidence) * 1.5);
    reasons.push("low-ocr-confidence");
  }
  if (repetition.hallucination) {
    score -= 100;
    reasons.push("repetitive-ocr-hallucination");
  }

  const formulaRisk = !repetition.hallucination && (mathSymbols >= 4 || (symbols >= 12 && symbols / Math.max(1, meaningful) >= 0.08));
  if (formulaRisk && method !== "mineru") reasons.push("formula-layout-risk");
  const cjkSpacingRate = cjkCharacters ? cjkSpaces / cjkCharacters : 0;

  return {
    page,
    text: repetition.hallucination ? "_OCR output suppressed because extreme repetition indicates a page-level recognition hallucination._" : cleaned,
    score: round(Math.max(0, score)),
    level: score < 45 ? "poor" : score < 70 ? "degraded" : "good",
    reasons: [...new Set(reasons)],
    meaningfulCharacters: meaningful,
    cjkSpacingRate: round(cjkSpacingRate * 100),
    repetitionCompressionRatio: repetition.compressionRatio,
    repetitionUniqueChunkRatio: repetition.uniqueChunkRatio,
    repetitiveHallucination: repetition.hallucination,
    formulaRisk,
    confidence: normalizedConfidence
  };
}

export function summarizePdfQuality(pageResults = [], { method = "pdf-text" } = {}) {
  const results = pageResults.filter(Boolean);
  const lowQualityPages = results.filter((result) => result.level === "poor").map((result) => result.page);
  const degradedPages = results.filter((result) => result.level === "degraded").map((result) => result.page);
  const formulaRiskPages = results.filter((result) => result.formulaRisk).map((result) => result.page);
  const repetitiveHallucinationPages = results.filter((result) => result.repetitiveHallucination).map((result) => result.page);
  const score = results.length ? average(results.map((result) => result.score)) : 0;
  const lowRatio = lowQualityPages.length / Math.max(1, results.length);
  const degradedRatio = (lowQualityPages.length + degradedPages.length) / Math.max(1, results.length);
  const formulaRatio = formulaRiskPages.length / Math.max(1, results.length);
  const reasons = [...new Set(results.flatMap((result) => result.reasons))];
  let level = "good";
  if (method === "mineru") {
    if (!results.length || lowRatio > 0.1 || score < 55) level = "poor";
    else if (lowQualityPages.length || degradedRatio > 0.3 || score < 72) level = "degraded";
  } else if (!results.length || lowRatio > 0.05 || degradedRatio > 0.2 || score < 62) level = "poor";
  else if (lowQualityPages.length || degradedRatio > 0.05 || score < 78) level = "degraded";
  if (method !== "mineru" && formulaRatio > 0.18) {
    level = level === "poor" ? "poor" : "degraded";
    reasons.push("formula-layout-risk");
  }
  return {
    level,
    score: round(score),
    totalPages: results.length,
    lowQualityPages,
    degradedPages,
    formulaRiskPages,
    repetitiveHallucinationPages,
    reasons: [...new Set(reasons)]
  };
}

export function qualityWarnings(quality) {
  if (!quality) return [];
  const warnings = [];
  if (quality.lowQualityPages?.length) warnings.push(`Low-quality PDF pages: ${compactPageRanges(quality.lowQualityPages)}`);
  if (quality.degradedPages?.length) warnings.push(`Degraded PDF pages: ${compactPageRanges(quality.degradedPages)}`);
  if (quality.formulaRiskPages?.length) warnings.push(`Formula/layout review pages: ${compactPageRanges(quality.formulaRiskPages)}`);
  if (quality.repetitiveHallucinationPages?.length) warnings.push(`Suppressed repetitive OCR hallucinations: ${compactPageRanges(quality.repetitiveHallucinationPages)}`);
  return warnings;
}

function repetitionMetrics(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 1000) return { compressionRatio: 1, uniqueChunkRatio: 1, hallucination: false };
  const bytes = Buffer.from(normalized, "utf8");
  const compressionRatio = gzipSync(bytes).length / Math.max(1, bytes.length);
  const chunks = [];
  for (let index = 0; index + 23 < normalized.length; index += 24) chunks.push(normalized.slice(index, index + 24));
  const uniqueChunkRatio = new Set(chunks).size / Math.max(1, chunks.length);
  return {
    compressionRatio: roundRatio(compressionRatio),
    uniqueChunkRatio: roundRatio(uniqueChunkRatio),
    hallucination: compressionRatio < 0.08 && uniqueChunkRatio < 0.35
  };
}

export function compactPageRanges(pages = [], limit = 80) {
  const values = [...new Set(pages.map(Number).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  const ranges = [];
  for (let index = 0; index < values.length;) {
    const start = values[index];
    let end = start;
    while (index + 1 < values.length && values[index + 1] === end + 1) end = values[++index];
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }
  const output = ranges.join(",");
  return output.length <= limit ? output : `${output.slice(0, limit).replace(/,[^,]*$/, "")}…`;
}

function countCjkSpaces(value) {
  let count = 0;
  const characters = [...String(value || "")];
  for (let index = 0; index < characters.length - 2; index += 1) {
    if (CJK_CHARACTER.test(characters[index]) && /[ \t]/.test(characters[index + 1]) && CJK_CHARACTER.test(characters[index + 2])) count += 1;
  }
  return count;
}

function countMatches(value, expression) {
  expression.lastIndex = 0;
  return (String(value || "").match(expression) || []).length;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function roundRatio(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
