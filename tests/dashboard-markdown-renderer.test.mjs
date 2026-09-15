import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { before, after } from "node:test";
import { createRequire } from "node:module";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Dashboard Markdown reader supports math and sanitized GFM or HTML tables", async () => {
  const component = await fs.readFile(path.join(root, "assets", "dashboard", "src", "RichMarkdown.tsx"), "utf8");
  const main = await fs.readFile(path.join(root, "assets", "dashboard", "src", "main.tsx"), "utf8");
  const styles = await fs.readFile(path.join(root, "assets", "dashboard", "src", "styles.css"), "utf8");
  const packageMetadata = JSON.parse(await fs.readFile(path.join(root, "assets", "dashboard", "package.json"), "utf8"));

  const rendering = await fs.readFile(path.join(root, "assets/dashboard/src/markdown-rendering.ts"), "utf8");
  assert.match(rendering, /use\(remarkParse\)\.use\(remarkGfm\)\.use\(remarkMath\)/);
  assert.match(component, /rehypePlugins=\{\[rehypeRaw, rehypeSanitize, anchors, rehypeKatex\]\}/);
  assert.match(component, /document-table-scroll/);
  assert.match(main, /const RichMarkdown = lazy\(\(\) => import\("\.\/RichMarkdown"\)\)/);
  assert.doesNotMatch(main, /const \w+ = import\("\.\/RichMarkdown"\)/, "the homepage must not eagerly download the Markdown renderer");
  assert.match(component, /markdownRenderChunks/);
  assert.match(component, /startTransition/);
  assert.match(component, /IntersectionObserver/);
  assert.match(component, /document-render-progress/);
  assert.doesNotMatch(main, /function markdownBlocks|function renderInlineMarkdown/);
  assert.match(styles, /\.document-markdown \.katex-display/);
  for (const dependency of ["katex", "rehype-katex", "rehype-raw", "rehype-sanitize", "remark-gfm", "remark-math"]) {
    assert.ok(packageMetadata.dependencies[dependency], `missing Markdown renderer dependency: ${dependency}`);
  }
});

const require = createRequire(new URL("../assets/dashboard/package.json", import.meta.url));
const { build } = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
let temporary, RichMarkdown, resolveDocumentLink;
before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-markdown-render-"));
  RichMarkdown = (await loadTs("RichMarkdown.tsx")).default;
  resolveDocumentLink = (await loadTs("markdown-rendering.ts")).resolveDocumentLink;
});
after(() => temporary && fs.rm(temporary, { recursive: true, force: true }));
async function loadTs(name) {
  const result = await build({ entryPoints: [path.join(root, "assets/dashboard/src", name)], bundle: true, format: "esm", platform: "node", jsx: "automatic", write: false, plugins: [{ name: "test-runtime", setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: "empty", namespace: "style" }));
    builder.onLoad({ filter: /.*/, namespace: "style" }, () => ({ contents: "export default {};" }));
    builder.onResolve({ filter: /^[^./]/ }, args => {
      if (args.kind === "entry-point") return null;
      return { path: args.path.startsWith("node:") ? args.path : pathToFileURL(require.resolve(args.path)).href, external: true };
    });
  } }] });
  const file = path.join(temporary, name + ".mjs");
  await fs.writeFile(file, result.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}
const properties = { imageUrls: {}, imageFallback: "Unavailable", renderingLabel: "Rendering", renderMoreLabel: "More", documentPath: "concepts/example.md", onOpenDocument() {} };
function render(content, props = {}) { return React.createElement(RichMarkdown, { ...properties, content, ...props }); }
function elements(html) {
  const result = [];
  const walk = node => { if (node.tagName) result.push({ tag: node.tagName, attrs: Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value])) }); node.childNodes?.forEach(walk); };
  walk(parse(html));
  return result;
}

test("Actual reader renders tables, ordered lists, blockquotes and math instead of source text", () => {
  const html = renderToStaticMarkup(render('| Key | Value |\n| --- | --- |\n| a | **b** |\n\n1. First\n2. Second\n\n> Quote\n\n$x^2$\n\n<table><tr><td>HTML table</td></tr></table>'));
  const nodes = elements(html);
  assert.equal(nodes.filter(node => node.tag === "table").length, 2);
  assert.ok(nodes.some(node => node.tag === "ol"));
  assert.ok(nodes.some(node => node.tag === "blockquote"));
  assert.match(html, /class="katex"/);
  assert.match(html, /<strong>b<\/strong>/);
});

test("Footnotes and backlinks resolve within each reader with unique sanitized IDs and preserved accessibility", () => {
  const md = 'Claim[^source-a]. Again[^source-a].\n\n[^source-a]: [Evidence](/references/sources/evidence.md)\n\n[Web](https://example.com)';
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, render(md), render(md)));
  const nodes = elements(html), ids = nodes.map(node => node.attrs.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  const localLinks = nodes.filter(node => node.tag === "a" && node.attrs.href?.startsWith("#"));
  assert.ok(localLinks.length >= 8);
  for (const { attrs } of localLinks) { assert.ok(ids.includes(attrs.href.slice(1)), attrs.href); assert.equal(attrs.target, undefined); }
  for (const { attrs } of nodes.filter(node => node.attrs["aria-describedby"])) assert.ok(ids.includes(attrs["aria-describedby"]));
  assert.ok(nodes.some(node => node.attrs["data-footnote-ref"] !== undefined && node.attrs.id));
  assert.equal(nodes.find(node => node.attrs.href === '/references/sources/evidence.md').attrs.target, undefined);
  assert.equal(nodes.find(node => node.attrs.href === 'https://example.com').attrs.target, "_blank");
  assert.doesNotMatch(html, /\[\^source-a\]/);
});

test("Paged readers retain end-of-document footnotes and link definitions without splitting fenced page examples", () => {
  const md = Array.from({ length: 12 }, (_, i) => `### Page ${i + 1}\n\n${i === 0 ? 'Claim[^source-a]. [Evidence][e].\n\n```md\n### Page 999\n```' : 'Later text.'}`).join('\n\n') + '\n\n[^source-a]: [Source](/references/sources/evidence.md)\n\n[e]: /references/sources/evidence.md';
  const first = renderToStaticMarkup(render(md));
  assert.doesNotMatch(first, /\[\^source-a\]|\[Evidence\]\[e\]/);
  assert.match(first, /More 2\/12/);
  assert.doesNotMatch(first, /<h3[^>]*>Page 12/);
  assert.match(first, /<pre><code class="language-md">### Page 999/);
  const all = renderToStaticMarkup(render(md, { renderAll: true }));
  assert.match(all, /<h3[^>]*>Page 12/);
  assert.doesNotMatch(all, /document-render-progress/);
});

test("Reader keeps HTML sanitization and resolves only supported vault document links", () => {
  const html = renderToStaticMarkup(render('<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">bad</a><h2 id="location">Safe</h2>'));
  assert.doesNotMatch(html, /<script|onerror=|href="javascript:|id="location"/);
  assert.deepEqual(resolveDocumentLink('../references/sources/%E8%AF%81%E6%8D%AE.md#page-1', 'concepts/example.md'), { kind: 'note', path: 'references/sources/证据.md', anchor: 'page-1' });
  assert.equal(resolveDocumentLink('//evil.test/concepts/a.md', 'concepts/example.md'), null);
  assert.equal(resolveDocumentLink('javascript:alert(1)', 'concepts/example.md'), null);
  assert.equal(resolveDocumentLink('/.my-wiki/config.json', 'concepts/example.md'), null);
  assert.equal(resolveDocumentLink('\\\\evil.test/concepts/a.md', 'concepts/example.md'), null);
  const legacy = renderToStaticMarkup(render('[[Old concept|Label]]\n\n```md\n[[Code example]]\n```'));
  assert.match(legacy, /<p>Label<\/p>/);
  assert.match(legacy, /\[\[Code example\]\]/);
});
