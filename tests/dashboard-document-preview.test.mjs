import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Viki evidence and Library originals share a read-only document preview", async () => {
  const read = name => readFile(new URL(`../assets/dashboard/src/${name}`, import.meta.url), "utf8");
  const main = await read("main.tsx");
  const library = await read("OriginalsDrive.tsx");
  const preview = await read("DocumentPreview.tsx");
  const viki = await read("Viki.tsx");
  assert.match(main, /readingFromViki\s*\?[^:]*<DocumentPreview source=\{\{ kind: "note"/);
  assert.match(library, /<DocumentPreview source=\{\{ kind: "original"/);
  assert.match(preview, /<RichMarkdown/);
  assert.match(preview, /localApi\.originalMarkdown/);
  assert.match(preview, /localApi\.markdown\(source.path, controller.signal\)/);
  assert.doesNotMatch(preview, /MarkdownLiveEditor|contentEditable|saveMarkdown|<textarea|method:\s*["'](?:PUT|POST)/);
  assert.match(preview, /createPortal/);
  assert.match(preview, /event\.stopPropagation\(\); onClose\(\)/);
  assert.match(viki, /!document.body.classList.contains\("has-document-preview"\)/);
});
