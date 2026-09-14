import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parseFrontmatter, stripFrontmatter } from "./wiki-lib.mjs";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const identifier = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

function resourceKey(value, documentPath) {
  try {
    const url = new URL(value, `https://my-wiki.invalid/${documentPath}`);
    url.hash = "";
    return decodeURIComponent(url.href);
  } catch { return String(value); }
}

export function checkMarkdownFormat(content, { path = "", sources = parseFrontmatter(content).sources } = {}) {
  const body = stripFrontmatter(content);
  const offset = content.length - body.length;
  const linesBefore = content.slice(0, offset).split("\n").length - 1;
  const tree = parser.parse(body);
  const definitions = new Map();
  const references = [];
  const issues = [];
  const sourceMap = new Map((Array.isArray(sources) ? sources : []).filter(source => source && typeof source === "object").map(source => [identifier(source.id), source]));
  const report = (node, code, message, severity = "error", details = {}) => issues.push({ path, line: (node.position?.start.line || 1) + linesBefore, column: node.position?.start.column || 1, code: `markdown:${code}`, severity, message, ...details });
  const visit = node => {
    if (node.type === "footnoteDefinition") {
      if (definitions.has(node.identifier)) report(node, "duplicate-footnote-definition", `Duplicate footnote definition: ${node.identifier}`, "error", { id: node.identifier });
      else definitions.set(node.identifier, node);
    }
    if (node.type === "footnoteReference") references.push(node);
    if (node.type === "text") {
      const source = body.slice(node.position.start.offset, node.position.end.offset);
      for (const match of source.matchAll(/\[\^(source-[^\]\s]+)\]/gi)) {
        const slashes = source.slice(0, match.index).match(/\\+$/)?.[0].length || 0;
        if (slashes % 2) continue;
        const preceding = source.slice(0, match.index).split("\n");
        const position = { start: { line: node.position.start.line + preceding.length - 1, column: preceding.length > 1 ? preceding[preceding.length - 1].length + 1 : node.position.start.column + match.index } };
        report({ position }, "missing-footnote-definition", `Missing footnote definition: ${match[1]}`, "error", { id: identifier(match[1]) });
      }
    }
    if (node.type === "table") {
      const expected = node.children[0].children.length;
      for (const row of node.children.slice(1)) {
        if (row.children.length !== expected) report(row, "table-column-count", `Table has ${row.children.length} cells; its header has ${expected}. Check cell separators and escaped pipes.`, "warning", { expected, actual: row.children.length });
      }
    }
    if (node.type === "paragraph") {
      const source = body.slice(node.position.start.offset, node.position.end.offset);
      const lines = source.split("\n");
      if (lines.filter(line => /^\s*\|.*\|\s*$/.test(line)).length >= 2 || lines.some(line => /\|\s*:?-{3,}:?\s*\|/.test(line))) {
        report(node, "unparsed-table", "Possible table rendered as text. Check the header separator, line breaks and cell counts.", "warning", { excerpt: source.slice(0, 240) });
      }
    }
    for (const child of node.children || []) visit(child);
  };
  visit(tree);
  const checked = new Set();
  for (const reference of references) {
    const id = reference.identifier;
    if (!id.startsWith("source-") || checked.has(id)) continue;
    checked.add(id);
    const source = sourceMap.get(id);
    if (!source?.resource) {
      report(reference, "unregistered-source", `Footnote ${id} has no matching sources entry with a resource.`, "error", { id });
      continue;
    }
    const links = [];
    const collect = node => { if (node.type === "link") links.push(node.url); for (const child of node.children || []) collect(child); };
    collect(definitions.get(id));
    if (!links.some(link => resourceKey(link, path) === resourceKey(source.resource, path))) report(definitions.get(id), "source-resource-mismatch", `Footnote ${id} does not link to its registered source: ${source.resource}`, "error", { id, resource: source.resource });
  }
  return issues;
}

export function markdownFormatSummary(issues) {
  return issues.slice(0, 10).map(issue => `${issue.path}:${issue.line}:${issue.column} ${issue.code}: ${issue.message}`).join("\n");
}
