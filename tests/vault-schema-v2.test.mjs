import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { captureSource } from "../scripts/core/capture-service.mjs";
import { exportUniverse } from "../scripts/core/export-universe.mjs";
import { importUniverse } from "../scripts/core/import-universe.mjs";
import { auditOkfWiki } from "../scripts/core/okf-lib.mjs";
import { extractUniverseArchive } from "../scripts/core/universe-package-lib.mjs";
import { parseFrontmatter } from "../scripts/core/wiki-lib.mjs";

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("vault initialization creates only the native OKF v2 layout", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-schema-v2-"));
  const vault = path.join(root, "vault");
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  await run(process.execPath, [path.join(projectRoot, "scripts", "my-wiki.mjs"), "init", vault], {
    cwd: projectRoot,
    env: { ...process.env, MY_WIKI_CONFIG_PATH: path.join(root, "config.json") }
  });

  const marker = JSON.parse(await fs.readFile(path.join(vault, ".my-wiki.json"), "utf8"));
  assert.deepEqual(marker, { version: 2, format: "okf", okf_version: "0.2" });
  for (const relative of [
    "index.md",
    "log.md",
    "concepts",
    "references/sources",
    "references/assets",
    "references/originals",
    ".my-wiki"
  ]) await fs.access(path.join(vault, relative));
  await assert.rejects(fs.access(path.join(vault, "wiki")), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(vault, "raw")), { code: "ENOENT" });
});

test("captured evidence is an OKF Reference with independent workflow state", async (context) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-reference-v2-"));
  context.after(() => fs.rm(vault, { recursive: true, force: true }));
  await fs.mkdir(path.join(vault, "concepts"), { recursive: true });

  const captured = await captureSource({
    vault,
    title: "Schema v2 evidence",
    sourceType: "note",
    content: "A durable piece of evidence for the schema contract with [[legacy notation]].",
    shouldSnapshot: false,
    shouldMirrorImages: false
  });
  const content = await fs.readFile(captured.path, "utf8");
  const frontmatter = parseFrontmatter(content);
  assert.equal(frontmatter.type, "Reference");
  assert.equal(frontmatter.status, "stable");
  assert.equal(frontmatter.workflow_status, "inbox");
  assert.equal(frontmatter.generated.by, "process:my-wiki-capture");
  assert.doesNotMatch(content, /\[\[/);
  assert.equal((await auditOkfWiki(vault)).valid, true);
});

test("schema migration backs up v1 before moving and normalizing it", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-migrate-v2-"));
  const vault = path.join(root, "legacy-vault");
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(vault, "wiki"), { recursive: true });
  await fs.mkdir(path.join(vault, "raw", "sources"), { recursive: true });
  await fs.writeFile(path.join(vault, "wiki", "Legacy.md"), `---
title: Legacy
type: concept
status: active
universes:
  - Test
sources:
  - "[[raw/sources/evidence]]"
---

# Legacy

Legacy evidence link: [[raw/sources/evidence]].
`, "utf8");
  await fs.writeFile(path.join(vault, "raw", "sources", "evidence.md"), `---
title: Evidence
type: raw-source
status: processed
related:
  - "[[Legacy]]"
---

# Evidence

Substantive legacy evidence.
`, "utf8");

  const { stdout } = await run(process.execPath, [
    path.join(projectRoot, "scripts", "my-wiki.mjs"),
    "migrate-vault-v2",
    vault
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);
  assert.match(result.backupPath, /legacy-vault-schema-v1-backup-/);
  await fs.access(path.join(result.backupPath, "wiki", "Legacy.md"));
  await fs.access(path.join(result.backupPath, "raw", "sources", "evidence.md"));
  await fs.access(path.join(vault, "concepts", "Legacy.md"));
  const reference = parseFrontmatter(await fs.readFile(path.join(vault, "references", "sources", "evidence.md"), "utf8"));
  assert.equal(reference.type, "Reference");
  assert.equal(reference.status, "stable");
  assert.equal(reference.workflow_status, "processed");
  await assert.rejects(fs.access(path.join(vault, "wiki")), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(vault, "raw")), { code: "ENOENT" });
  assert.equal((await auditOkfWiki(vault)).valid, true);
});

test("active runtime source contains no legacy vault directory dependency", async () => {
  const roots = ["scripts/core", "assets/dashboard/scripts", "assets/dashboard/src"];
  const legacy = /raw\/(?:sources|assets|snapshots)|(?:^|[^.\w-])wiki\//m;
  const failures = [];
  for (const relative of roots) {
    const files = await walk(path.join(projectRoot, relative));
    for (const file of files) {
      if (file.includes(`${path.sep}scripts${path.sep}migrations${path.sep}`)) continue;
      const content = await fs.readFile(file, "utf8");
      if (legacy.test(content)) failures.push(path.relative(projectRoot, file));
    }
  }
  assert.deepEqual(failures, []);
});

test(".mywiki is an audited OKF v0.2 package and imports into the native layout", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-package-v2-"));
  const sourceVault = path.join(root, "source");
  const targetVault = path.join(root, "target");
  const unpacked = path.join(root, "unpacked");
  const packageFile = path.join(root, "schema-v2.mywiki");
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const vault of [sourceVault, targetVault]) {
    await fs.mkdir(path.join(vault, "concepts"), { recursive: true });
    await fs.mkdir(path.join(vault, "references", "sources"), { recursive: true });
    await fs.writeFile(path.join(vault, "index.md"), "---\nokf_version: \"0.2\"\n---\n\n# Knowledge Index\n", "utf8");
    await fs.writeFile(path.join(vault, "log.md"), "# Knowledge Update Log\n", "utf8");
  }
  const captured = await captureSource({
    vault: sourceVault,
    title: "Portable evidence",
    sourceType: "note",
    content: "Evidence supporting the portable schema concept.",
    shouldSnapshot: false,
    shouldMirrorImages: false
  });
  const sourcePath = path.relative(sourceVault, captured.path).replace(/\\/g, "/");
  await fs.writeFile(path.join(sourceVault, "concepts", "Portable Schema.md"), `---
type: Concept
title: Portable Schema
description: A concept used to verify native OKF galaxy packages.
status: stable
tags:
  - schema
universes:
  - Test
sources:
  - id: portable-evidence
    resource: /${sourcePath}
    title: Portable evidence
---

# Portable Schema

The package keeps evidence next to its Concept.[^portable-evidence]

[^portable-evidence]: [Portable evidence](/${sourcePath})
`, "utf8");

  const exported = await exportUniverse({ vault: sourceVault, universeName: "Test", output: packageFile });
  assert.equal(exported.okf.valid, true);
  await extractUniverseArchive(packageFile, unpacked);
  const manifest = JSON.parse(await fs.readFile(path.join(unpacked, "manifest.json"), "utf8"));
  assert.deepEqual(
    { format: manifest.format, okf: manifest.okf_version, type: manifest.package.type, version: manifest.package.version },
    { format: "okf", okf: "0.2", type: "my-wiki-galaxy", version: 2 }
  );
  await fs.access(path.join(unpacked, "concepts", "Portable Schema.md"));
  await fs.access(path.join(unpacked, sourcePath));
  const preview = await importUniverse({ vault: targetVault, packageFile, apply: false });
  assert.equal(preview.mode, "dry-run");
  const imported = await importUniverse({ vault: targetVault, packageFile, apply: true });
  assert.equal(imported.applied, true);
  await fs.access(path.join(targetVault, "concepts", "Portable Schema.md"));
  await fs.access(path.join(targetVault, sourcePath));
  await assert.rejects(fs.access(path.join(targetVault, "wiki")), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(targetVault, "raw")), { code: "ENOENT" });
});

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return entry.isFile() && /\.(?:mjs|js|ts|tsx)$/.test(entry.name) ? [target] : [];
  }))).flat();
}
