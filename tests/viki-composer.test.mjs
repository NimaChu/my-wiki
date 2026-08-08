import assert from "node:assert/strict";
import test from "node:test";
import { shouldSubmitVikiComposer } from "../assets/dashboard/src/viki-composer.js";

test("Viki does not submit Enter while an input method is composing text", () => {
  assert.equal(shouldSubmitVikiComposer({ key: "Enter", isComposing: true }), false);
  assert.equal(shouldSubmitVikiComposer({ key: "Enter", keyCode: 229 }), false);
});

test("Viki submits plain Enter but preserves Shift+Enter for a newline", () => {
  assert.equal(shouldSubmitVikiComposer({ key: "Enter" }), true);
  assert.equal(shouldSubmitVikiComposer({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSubmitVikiComposer({ key: "a" }), false);
});
