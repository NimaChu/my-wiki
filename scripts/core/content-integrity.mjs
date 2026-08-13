import { compactPageRanges } from "./pdf-quality.mjs";

const REPLACEMENT_CHARACTER = "\uFFFD";

export function markdownCaptureSection(content) {
  const value = String(content || "");
  const marker = value.match(/^## Capture\s*$/m);
  if (!marker || marker.index === undefined) return "";
  const bodyStart = marker.index + marker[0].length;
  const tail = value.slice(bodyStart).replace(/^\s+/, "");
  const nextHeading = tail.search(/^##\s+/m);
  return (nextHeading >= 0 ? tail.slice(0, nextHeading) : tail).trim();
}

export function unicodeReplacementReport(content, { captureOnly = false } = {}) {
  const value = captureOnly ? markdownCaptureSection(content) : String(content || "");
  const pages = new Set();
  let page = 0;
  let count = 0;
  let unpagedCount = 0;
  for (const line of value.split(/\r?\n/)) {
    const heading = line.match(/^### Page (\d+)\s*$/);
    if (heading) page = Number(heading[1]);
    const lineCount = [...line].filter((character) => character === REPLACEMENT_CHARACTER).length;
    if (!lineCount) continue;
    count += lineCount;
    if (page > 0) pages.add(page);
    else unpagedCount += lineCount;
  }
  const pageNumbers = [...pages].sort((left, right) => left - right);
  return {
    blocked: count > 0,
    count,
    pages: pageNumbers,
    affectedPages: pageNumbers.length,
    unpagedCount
  };
}

export function unicodeReplacementFollowupReasons(report) {
  if (!report?.blocked) return [];
  const pageDetail = report.pages?.length ? `:pages=${compactPageRanges(report.pages)}` : "";
  return [`encoding:unicode-replacement-character:count=${Number(report.count || 0)}${pageDetail}`];
}

export function unicodeReplacementNote(report) {
  if (!report?.blocked) return "passed (0 U+FFFD characters)";
  const pages = report.pages?.length ? ` across ${report.affectedPages} pages (${compactPageRanges(report.pages)})` : "";
  return `blocked (${Number(report.count || 0)} U+FFFD characters${pages})`;
}
