import assert from "node:assert/strict";
import test from "node:test";

import { promoteVaultMarkdownImages } from "../assets/dashboard/src/viki-markdown.js";

test("Viki renders historical local Markdown images through authenticated image blocks", () => {
  const result = promoteVaultMarkdownImages([
    "First claim.",
    "![Agent workflow](references/assets/my-wiki/workflow.png)",
    "Second claim.",
    "![Unsafe](concepts/private.png)"
  ].join("\n\n"));

  assert.equal(result.content, [
    "First claim.",
    "Second claim.",
    "![Unsafe](concepts/private.png)"
  ].join("\n\n"));
  assert.deepEqual(result.images, [{
    path: "references/assets/my-wiki/workflow.png",
    caption: "Agent workflow",
    afterBlock: 0
  }]);
});

test("Viki de-duplicates embedded and structured images", () => {
  const result = promoteVaultMarkdownImages(
    "Claim.\n\n![Diagram](references/assets/capture/diagram.png)",
    [{ path: "references/assets/capture/diagram.png", caption: "Duplicate", afterBlock: 1 }]
  );
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].caption, "Diagram");
});
