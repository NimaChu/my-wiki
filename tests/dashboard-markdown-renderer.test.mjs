import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Dashboard Markdown reader supports math and sanitized GFM or HTML tables", async () => {
  const component = await fs.readFile(path.join(root, "assets", "dashboard", "src", "RichMarkdown.tsx"), "utf8");
  const main = await fs.readFile(path.join(root, "assets", "dashboard", "src", "main.tsx"), "utf8");
  const styles = await fs.readFile(path.join(root, "assets", "dashboard", "src", "styles.css"), "utf8");
  const packageMetadata = JSON.parse(await fs.readFile(path.join(root, "assets", "dashboard", "package.json"), "utf8"));

  assert.match(component, /remarkPlugins=\{\[remarkGfm, remarkMath\]\}/);
  assert.match(component, /rehypePlugins=\{\[rehypeRaw, rehypeSanitize, rehypeKatex\]\}/);
  assert.match(component, /document-table-scroll/);
  assert.match(main, /lazy\(\(\) => import\("\.\/RichMarkdown"\)\)/);
  assert.match(styles, /\.document-markdown \.katex-display/);
  for (const dependency of ["katex", "rehype-katex", "rehype-raw", "rehype-sanitize", "remark-gfm", "remark-math"]) {
    assert.ok(packageMetadata.dependencies[dependency], `missing Markdown renderer dependency: ${dependency}`);
  }
});
