import { fromMarkdown } from "mdast-util-from-markdown";

// Captured OKF source IDs are not usable footnotes without their definitions.
// Work only on Markdown text nodes, preserving code examples and defined notes.
export function stripDanglingSourceFootnotes(markdown) {
  if (!/\[\^source-/i.test(markdown)) return markdown;
  const definitions = new Set();
  const texts = [];
  const visit = (node) => {
    if (node.type === "definition" && /^\^source-/i.test(node.identifier)) definitions.add(node.identifier.slice(1).toLowerCase());
    if (["code", "inlineCode", "html", "link", "image"].includes(node.type)) return;
    if (node.type === "text") {
      const start = node.position.start.offset;
      const text = markdown.slice(start, node.position.end.offset);
      for (const match of text.matchAll(/^ {0,3}\[\^(source-[\w-]+)\]:/gim)) definitions.add(match[1].toLowerCase());
      texts.push({ start, text });
    }
    for (const child of node.children || []) visit(child);
  };
  visit(fromMarkdown(markdown));
  const removals = [];
  for (const { start, text } of texts) {
    for (const match of text.matchAll(/(?<!\\)\[\^(source-[\w-]+)\]/gi)) {
      if (!definitions.has(match[1].toLowerCase())) removals.push({ start: start + match.index, length: match[0].length });
    }
  }
  for (const item of removals.reverse()) markdown = markdown.slice(0, item.start) + markdown.slice(item.start + item.length);
  return markdown;
}
