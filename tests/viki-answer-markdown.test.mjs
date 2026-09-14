import assert from "node:assert/strict";
import test from "node:test";
import { stripDanglingSourceFootnotes } from "../assets/dashboard/src/answer-markdown.js";

test("answers remove dangling captured-source markers without inventing citations", () => {
  const text = "结论[^source-c9ef17603196] [^source-ee9cb8fa9e1e]\n\n| 内容 | 结果 |\n| --- | --- |\n| 证据 | 成功[^source-a] |";
  const cleaned = stripDanglingSourceFootnotes(text);
  assert.doesNotMatch(cleaned, /\[\^source-/);
  assert.match(cleaned, /结论/);
  assert.match(cleaned, /\| 证据 \| 成功 \|/);
});

test("footnote cleanup preserves defined notes, code, escaped syntax and unrelated footnotes", () => {
  for (const content of [
    "A[^source-kept].\n\n[^source-kept]: A valid definition",
    "A[^source-kept].\n\n[^source-kept]: https://example.com",
    "A[^custom-note].",
    "`[^source-code]`\n\n```markdown\n[^source-block]\n```\n\n    [^source-indented]",
    "\\[^source-literal]",
    "[Syntax [^source-example]](https://example.com)"
  ]) assert.equal(stripDanglingSourceFootnotes(content), content);
});
