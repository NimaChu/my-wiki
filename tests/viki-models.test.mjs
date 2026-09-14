import assert from "node:assert/strict";
import test from "node:test";
import { vikiModelSelection } from "../assets/dashboard/src/viki-models.js";

test("Viki resolves legacy defaults to actual models without a default option", () => {
  const provider = { defaultModel: "model-a", models: [{ id: "model-a", label: "Model A" }, { id: "model-b", label: "Model B" }] };
  assert.deepEqual(vikiModelSelection(provider), { selected: "model-a", label: "Model A", models: provider.models });
  assert.equal(vikiModelSelection(provider, "model-b").selected, "model-b");
  assert.equal(vikiModelSelection(provider, "model-b").label, "Model B");
  assert.equal(vikiModelSelection(provider).models.filter((item) => item.id === "model-a").length, 1);
  assert.ok(vikiModelSelection(provider).models.every((item) => item.id));
});

test("Viki retains saved or default IDs missing from discovery without guessing another model", () => {
  const provider = { defaultModel: "provider-default", models: [{ id: "other", label: "Other" }, { id: "other", label: "Other" }] };
  assert.equal(vikiModelSelection(provider).models.length, 2);
  assert.equal(vikiModelSelection(provider).selected, "provider-default");
  assert.equal(vikiModelSelection(provider, "saved-model").models[0].id, "saved-model");
  assert.equal(vikiModelSelection({ models: provider.models }).selected, "");
  assert.deepEqual(vikiModelSelection(undefined), { selected: "", label: "", models: [] });
});
