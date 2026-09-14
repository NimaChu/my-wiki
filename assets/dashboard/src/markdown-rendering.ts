import { unified, type Processor } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root as MarkdownRoot, Nodes as MarkdownNodes } from "mdast";
import type { Root as HtmlRoot, Element, Nodes } from "hast";
import { markdownHeadingId } from "./markdown-workspace";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export type DocumentLink = { kind: "note"; path: string; anchor?: string } | { kind: "original"; path: string; name: string; anchor?: string };

export function markdownRenderChunks(content: string) {
  const tree = parser.parse(content);
  const legacyLabels = (node: MarkdownNodes) => {
    if (node.type === "text") node.value = node.value.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || target);
    if ("children" in node) node.children.forEach(legacyLabels);
  };
  legacyLabels(tree);
  const starts = [0];
  tree.children.forEach((node, index) => {
    if (index && node.type === "heading" && node.depth === 3 && /^Page \d+$/.test(node.children.map(child => "value" in child ? child.value : "").join(""))) starts.push(index);
  });
  return { tree, starts: starts.length >= 8 ? starts : [0] };
}

export function remarkDocumentPage(document: ReturnType<typeof markdownRenderChunks>, visible: number) {
  return function (this: Processor) {
    // Parse once for the whole document; pagination must not sever reference definitions.
    this.parser = () => {
      const end = document.starts[visible] ?? document.tree.children.length;
      const children = document.tree.children.slice(0, end);
      for (const node of document.tree.children.slice(end)) {
        if (node.type === "footnoteDefinition" || node.type === "definition") children.push(node);
      }
      return { ...document.tree, children } as MarkdownRoot;
    };
  };
}

function nodeText(node: Nodes): string {
  return "value" in node ? String(node.value) : "children" in node ? node.children.map(nodeText).join("") : "";
}

export function rehypeDocumentAnchors(prefix: string) {
  return () => (tree: HtmlRoot) => {
    const elements: Element[] = [];
    const walk = (node: Nodes) => {
      if (node.type === "element") elements.push(node);
      if ("children" in node) node.children.forEach(walk);
    };
    walk(tree);
    const headings = new Map<string, number>();
    for (const node of elements) {
      if (!/^h[1-6]$/.test(node.tagName) || node.properties.id) continue;
      const base = markdownHeadingId(nodeText(node));
      const count = headings.get(base) || 0;
      headings.set(base, count + 1);
      node.properties.id = count ? `${base}-${count + 1}` : base;
      node.properties.dataMarkdownHeading = node.properties.id;
    }
    const ids = new Set(elements.map(node => String(node.properties.id || "")).filter(Boolean));
    const targetId = (anchor: string) => ids.has(anchor) ? anchor : ids.has(`user-content-${anchor}`) ? `user-content-${anchor}` : anchor;
    for (const node of elements) {
      if (node.properties.id) node.properties.id = prefix + node.properties.id;
      for (const key of ["ariaDescribedBy", "ariaLabelledBy"]) {
        const value = node.properties[key];
        if (value) node.properties[key] = (Array.isArray(value) ? value : String(value).split(" ")).map(id => prefix + targetId(String(id)));
      }
      const href = node.properties.href;
      if (typeof href !== "string" || !href.startsWith("#")) continue;
      let anchor = href.slice(1);
      try { anchor = decodeURIComponent(anchor); } catch { /* Keep malformed fragments inert. */ }
      node.properties.href = `#${prefix}${targetId(anchor)}`;
    }
  };
}

export function resolveDocumentLink(href: string, documentPath: string): DocumentLink | null {
  if (!href || /[\\\u0000-\u001f]/.test(href) || href.startsWith("#") || href.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(href)) return null;
  try {
    const url = new URL(href, `https://my-wiki.invalid/${documentPath}`);
    const parts: string[] = [];
    for (const part of decodeURIComponent(url.pathname).split("/")) {
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    }
    const path = parts.join("/");
    if (/[\\\0]/.test(path)) return null;
    const anchor = decodeURIComponent(url.hash.slice(1));
    if (/^(concepts|references\/sources)\/.+\.md$/i.test(path)) return { kind: "note", path, anchor };
    if (/^references\/originals\/.+/i.test(path)) return { kind: "original", path, name: parts[parts.length - 1], anchor };
  } catch { /* Unsupported paths remain ordinary links. */ }
  return null;
}
