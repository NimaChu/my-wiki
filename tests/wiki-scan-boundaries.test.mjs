import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { rawLayoutIssues, scanVault } from "../scripts/core/wiki-lib.mjs";

async function writeMarkdown(file, title, type = "raw-source") {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\ntitle: ${title}\ntype: ${type}\nstatus: active\n---\n# ${title}\n`, "utf8");
}

test("vault scans knowledge notes but excludes Markdown snapshots and assets", async (context) => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "my-wiki-scan-boundaries-"));
  context.after(() => rm(vault, { recursive: true, force: true }));

  await writeMarkdown(path.join(vault, "raw", "sources", "source.md"), "Source");
  await writeMarkdown(path.join(vault, "raw", "snapshots", "original.md"), "Original snapshot");
  await writeMarkdown(path.join(vault, "raw", "assets", "source", "caption.md"), "Asset metadata");
  await writeMarkdown(path.join(vault, "raw", "legacy.md"), "Misplaced source");
  await writeMarkdown(path.join(vault, "wiki", "topic.md"), "Topic", "concept");

  const scan = await scanVault(vault);
  assert.deepEqual(scan.nodes.map((node) => node.id).sort(), [
    "raw/legacy",
    "raw/sources/source",
    "wiki/topic"
  ]);
  assert.deepEqual(rawLayoutIssues(scan), [{ source: "raw/legacy", reason: "misplaced-source" }]);
});
