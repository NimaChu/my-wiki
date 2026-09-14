import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveReferencePathAlias } from "../scripts/core/reference-path-aliases.mjs";
import { resolveMarkdownVaultFile, resolveMarkdownImageFile } from "../scripts/core/dashboard-api.mjs";
import { resolveDriveOriginal } from "../scripts/core/originals-drive.mjs";
import { rawAttachmentIssues, scanVault } from "../scripts/core/wiki-lib.mjs";

async function fixture(t, paths = {}) {
  const vault = await mkdtemp(path.join(os.tmpdir(), "my-wiki-reference-alias-"));
  t.after(() => rm(vault, { recursive: true, force: true }));
  for (const file of ["references/sources/Reference name.md", "references/assets/Reference name/image.png", "references/originals/Reference name.pdf"]) {
    await mkdir(path.dirname(path.join(vault, file)), { recursive: true });
    await writeFile(path.join(vault, file), "evidence");
  }
  await mkdir(path.join(vault, ".my-wiki"));
  await writeFile(path.join(vault, ".my-wiki/reference-path-aliases.json"), JSON.stringify({ version: 1, paths }));
  return vault;
}

test("renamed References, relative images, and originals retain saved evidence URLs", async (t) => {
  const vault = await fixture(t, {
    "references/sources/2026-01-01--reference.md": "references/sources/Reference name.md",
    "references/assets/2026-01-01--reference": "references/assets/Reference name",
    "references/originals/2026-01-01--reference.pdf": "references/originals/Reference name.pdf"
  });
  const old = "references/sources/2026-01-01--reference.md";
  assert.equal(await resolveMarkdownVaultFile(vault, old), await realpath(path.join(vault, "references/sources/Reference name.md")));
  assert.equal(await resolveMarkdownImageFile(vault, old, "../assets/2026-01-01--reference/image.png"), await realpath(path.join(vault, "references/assets/Reference name/image.png")));
  assert.equal((await resolveDriveOriginal(vault, "references/originals/2026-01-01--reference.pdf")).file, await realpath(path.join(vault, "references/originals/Reference name.pdf")));
});

test("aliases respect existing files, path boundaries, directory ownership, and cycles", async (t) => {
  const paths = {
    "references/sources/Reference name.md": "references/sources/absent.md",
    "references/sources/cross.md": "references/originals/Reference name.pdf",
    "references/sources/traversal.md": "references/sources/../../.my-wiki/secret.md",
    "references/sources/a.md": "references/sources/b.md",
    "references/sources/b.md": "references/sources/a.md",
    "references/assets/old": "references/assets/Reference name",
    "references/sources/chain.md": "references/sources/older.md",
    "references/sources/older.md": "references/sources/Reference name.md"
  };
  const vault = await fixture(t, paths);
  for (const request of ["references/sources/Reference name.md", "references/sources/cross.md", "references/sources/traversal.md", "references/sources/a.md", "references/assets/older/image.png", "../secrets.md"]) assert.equal(await resolveReferencePathAlias(vault, request), request);
  assert.equal(await resolveReferencePathAlias(vault, "references/sources/chain.md"), "references/sources/Reference name.md");
  await assert.rejects(resolveMarkdownVaultFile(vault, "references/sources/cross.md"));
  await assert.rejects(resolveMarkdownVaultFile(vault, "references/sources/traversal.md"));
});

test("malformed or missing alias files do not change normal evidence access", async (t) => {
  const vault = await fixture(t);
  const requested = "references/sources/missing.md";
  await writeFile(path.join(vault, ".my-wiki/reference-path-aliases.json"), "{bad");
  assert.equal(await resolveReferencePathAlias(vault, requested), requested);
  await rm(path.join(vault, ".my-wiki/reference-path-aliases.json"));
  assert.equal(await resolveReferencePathAlias(vault, requested), requested);
  assert.equal(await resolveReferencePathAlias(vault, "references/sources/Reference name.md"), "references/sources/Reference name.md");
});

test("attachment validation preserves spaces in original filenames and parsed image destinations", async (t) => {
  const vault = await fixture(t);
  await writeFile(path.join(vault, "references/sources/Reference name.md"), [
    "---", "type: Reference", 'snapshot_path: "references/originals/Reference name.pdf"', "---",
    "![Image](<../assets/Reference name/image.png>)",
    '<img src="../assets/Reference name/image.png">'
  ].join("\n"));
  assert.deepEqual(await rawAttachmentIssues(await scanVault(vault)), []);
  await rm(path.join(vault, "references/originals/Reference name.pdf"));
  const issues = await rawAttachmentIssues(await scanVault(vault));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].target, "references/originals/Reference name.pdf");
});

test("a captured README remains a Reference in the graph after restoring its original filename", async (t) => {
  const vault = await fixture(t);
  await writeFile(path.join(vault, "references/sources/README.md"), "---\ntype: Reference\ntitle: Product documentation\nworkflow_status: processed\n---\n# Documentation\n");
  await mkdir(path.join(vault, "concepts"));
  await writeFile(path.join(vault, "concepts/README.md"), "# Concept directory instructions\n");
  const output = path.join(vault, ".my-wiki/test-graph.json");
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../assets/dashboard/scripts/generate-graph.mjs", import.meta.url))], {
    env: { ...process.env, MY_WIKI_VAULT: vault, MY_WIKI_GRAPH_OUTPUT: output }
  });
  const graph = JSON.parse(await readFile(output, "utf8"));
  assert(graph.nodes.some(node => node.id === "references/sources/README"));
  assert(!graph.nodes.some(node => node.id === "concepts/README"));
});
