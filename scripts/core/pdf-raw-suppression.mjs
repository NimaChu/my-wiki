import { compactPageRanges } from "./pdf-quality.mjs";
import { upsertFrontmatterValues } from "./wiki-lib.mjs";

export function suppressRawPdfPages(content, { blankPages = [], showthroughPages = [] } = {}) {
  const blanks = normalizePages(blankPages);
  const showthrough = normalizePages(showthroughPages).filter((page) => !blanks.includes(page));
  const requested = [...new Set([...blanks, ...showthrough])].sort((left, right) => left - right);
  let updated = String(content || "");

  for (const page of requested) {
    const reason = blanks.includes(page)
      ? "_Page omitted after manual review confirmed that it contains only blank-page noise._"
      : "_Page omitted after manual review confirmed that it contains only reverse-side show-through._";
    updated = replacePdfPage(updated, page, reason);
  }

  const repetitive = mergePages(frontmatterPages(updated, "extraction_repetitive_hallucination_pages"), blanks);
  const suppressed = mergePages(frontmatterPages(updated, "extraction_suppressed_hallucination_pages"), requested);
  const recordedBlanks = mergePages(frontmatterPages(updated, "extraction_blank_pages"), blanks);
  const recordedShowthrough = mergePages(frontmatterPages(updated, "extraction_showthrough_pages"), showthrough);
  updated = upsertFrontmatterValues(updated, {
    extracted_characters: captureMeaningfulCharacters(updated),
    extraction_repetitive_hallucination_pages: compactPageRanges(repetitive, 400),
    extraction_suppressed_hallucination_pages: compactPageRanges(suppressed, 400),
    extraction_blank_pages: compactPageRanges(recordedBlanks, 400),
    extraction_showthrough_pages: compactPageRanges(recordedShowthrough, 400)
  });

  const note = `- Manual PDF page suppression: blank pages ${compactPageRanges(blanks) || "none"}; reverse-side show-through pages ${compactPageRanges(showthrough) || "none"}.`;
  if (!updated.includes(note)) updated = appendProcessingNote(updated, note);
  return updated;
}

function replacePdfPage(content, page, body) {
  const expression = new RegExp(`(^### Page ${page}[ \\t]*$)[\\s\\S]*?(?=^### Page \\d+[ \\t]*$|^## Images[ \\t]*$)`, "m");
  if (!expression.test(content)) throw new Error(`PDF page section not found: ${page}`);
  return content.replace(expression, `$1\n\n${body}\n\n`);
}

function appendProcessingNote(content, note) {
  const marker = content.match(/^## Processing Notes\s*$/m);
  if (!marker || marker.index === undefined) return `${content.trimEnd()}\n\n## Processing Notes\n\n${note}\n`;
  const start = marker.index + marker[0].length;
  const tail = content.slice(start);
  const nextHeading = tail.search(/^##\s+/m);
  const end = nextHeading < 0 ? content.length : start + nextHeading;
  return `${content.slice(0, end).trimEnd()}\n${note}\n\n${content.slice(end).replace(/^\s+/, "")}`.trimEnd() + "\n";
}

function captureMeaningfulCharacters(content) {
  const capture = String(content || "").match(/^## Capture\s*$([\s\S]*?)(?=^##\s+)/m)?.[1] || "";
  return capture.replace(/^### Page \d+\s*$/gm, "").replace(/[\s`*_#>|\-:[\](){}.!?,;"'\\]/g, "").length;
}

function frontmatterPages(content, key) {
  const match = String(content || "").match(new RegExp(`^${key}:\\s*["']?([^"'\\r\\n]*)`, "m"));
  return normalizePages(match?.[1] || "");
}

function normalizePages(values) {
  const output = new Set();
  for (const value of Array.isArray(values) ? values : String(values || "").split(",")) {
    const token = String(value || "").trim();
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      for (let page = Number(range[1]); page <= Number(range[2]); page += 1) output.add(page);
      continue;
    }
    const page = Number(token);
    if (Number.isInteger(page) && page > 0) output.add(page);
  }
  return [...output].sort((left, right) => left - right);
}

function mergePages(...groups) {
  return normalizePages(groups.flat());
}
