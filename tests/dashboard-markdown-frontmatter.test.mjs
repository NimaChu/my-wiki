import assert from "node:assert/strict";
import test from "node:test";
import { joinMarkdownFrontmatter, splitMarkdownFrontmatter } from "../assets/dashboard/src/markdown-frontmatter.js";

test("live Markdown editing keeps YAML frontmatter byte-for-byte", () => {
  const source = "---\r\ntitle: Example\r\nstatus: processed\r\n---\r\n# Original\n\nBody";
  const { prefix, body } = splitMarkdownFrontmatter(source);

  assert.equal(prefix, "---\r\ntitle: Example\r\nstatus: processed\r\n---\r\n");
  assert.equal(body, "# Original\n\nBody");
  assert.equal(joinMarkdownFrontmatter(prefix, "# Updated\n"), "---\r\ntitle: Example\r\nstatus: processed\r\n---\r\n# Updated\n");
});

test("plain Markdown is edited without a synthetic frontmatter prefix", () => {
  assert.deepEqual(splitMarkdownFrontmatter("# Note\n"), { prefix: "", body: "# Note\n" });
});
