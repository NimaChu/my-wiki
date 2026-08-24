import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditOkfDirectory,
  auditOkfWiki,
  exportOkfBundle,
  migrateWikiToOkf
} from "../scripts/core/okf-lib.mjs";
import { parseFrontmatter, scanVault, stripFrontmatter } from "../scripts/core/wiki-lib.mjs";

async function fixture() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-okf-"));
  await fs.mkdir(path.join(vault, "concepts"), { recursive: true });
  await fs.mkdir(path.join(vault, "references", "sources"), { recursive: true });
  await fs.mkdir(path.join(vault, "references", "originals"), { recursive: true });
  await fs.mkdir(path.join(vault, "references", "assets", "source-one"), { recursive: true });
  await fs.writeFile(path.join(vault, "references", "originals", "source-one.txt"), "original", "utf8");
  await fs.writeFile(path.join(vault, "references", "assets", "source-one", "figure.png"), "png", "utf8");
  await fs.writeFile(path.join(vault, "references", "sources", "source-one.md"), `---
title: "Source One"
type: raw-source
status: processed
source_url: "https://example.com/source"
snapshot_path: "references/originals/source-one.txt"
related:
  - "[[Concept One]]"
---

# Source One

## Capture

Evidence text with an image.

![Figure](../assets/source-one/figure.png)
`, "utf8");
  await fs.writeFile(path.join(vault, "concepts", "Concept One.md"), `\uFEFF---
title: "Concept One"
type: concept
status: active
universes:
  - "AI"
tags: [concept, test]
sources:
  - "[[references/sources/source-one]]"
---

# Concept One

## Summary

An evidence-backed concept. [[references/sources/source-one]]

## Related

- [[Concept Two]]
`, "utf8");
  await fs.writeFile(path.join(vault, "concepts", "Concept Two.md"), `---
title: "Concept Two"
type: concept
status: active
universes: [AI]
tags: [concept]
sources: []
---

# Concept Two

Related to [[Concept One]].
`, "utf8");
  await fs.writeFile(path.join(vault, "index.md"), "---\ntitle: Old Index\ntype: index\nstatus: active\n---\n\n# Old Index\n", "utf8");
  await fs.writeFile(path.join(vault, "log.md"), "---\ntitle: Old Log\ntype: log\nstatus: active\n---\n\n# Old Log\n\n- [2026-08-20T10:00:00Z] CREATE concept\n", "utf8");
  return vault;
}

test("OKF migration converts legacy frontmatter, Wikilinks, citations, and reserved files", async (context) => {
  const vault = await fixture();
  context.after(() => fs.rm(vault, { recursive: true, force: true }));
  const result = await migrateWikiToOkf(vault, { apply: true, backup: false });
  assert.equal(result.concepts, 2);
  const report = await auditOkfWiki(vault);
  assert.equal(report.valid, true, JSON.stringify(report.issues));

  const concept = await fs.readFile(path.join(vault, "concepts", "Concept One.md"), "utf8");
  const frontmatter = parseFrontmatter(concept);
  assert.equal(frontmatter.status, "stable");
  assert.equal(frontmatter.sources[0].resource, "/references/sources/source-one.md");
  assert.match(frontmatter.sources[0].id, /^source-[a-f0-9]{12}$/);
  assert.match(stripFrontmatter(concept), /\[\^source-[a-f0-9]{12}\]/);
  assert.match(stripFrontmatter(concept), /\[Concept Two\]\(\/concepts\/Concept%20Two\.md\)/);
  assert.doesNotMatch(stripFrontmatter(concept), /\[\[/);

  const scan = await scanVault(vault);
  assert(scan.edges.some((edge) => edge.source === "concepts/Concept One" && edge.target === "concepts/Concept Two"));
  assert(scan.edges.some((edge) => edge.source === "concepts/Concept One" && edge.target === "references/sources/source-one"));

  await migrateWikiToOkf(vault, { apply: true, backup: false });
  const log = await fs.readFile(path.join(vault, "log.md"), "utf8");
  assert.match(log, /^## 2026-08-20$/m);
  assert.equal((log.match(/\*\*Migration\*\*/g) || []).length, 1);
});

test("OKF export creates a self-contained audited bundle", async (context) => {
  const vault = await fixture();
  context.after(() => fs.rm(vault, { recursive: true, force: true }));
  await migrateWikiToOkf(vault, { apply: true, backup: false });
  const output = path.join(vault, "exported-okf");
  const result = await exportOkfBundle(vault, { galaxy: "AI", output });
  assert.equal(result.audit.valid, true);
  assert.equal((await auditOkfDirectory(output)).valid, true);
  await fs.access(path.join(output, "concepts", "Concept One.md"));
  await fs.access(path.join(output, "references", "sources", "source-one.md"));
  await fs.access(path.join(output, "references", "originals", "source-one.txt"));
  await fs.access(path.join(output, "references", "assets", "source-one", "figure.png"));
  const exported = await fs.readFile(path.join(output, "concepts", "Concept One.md"), "utf8");
  assert.equal(parseFrontmatter(exported).sources[0].resource, "/references/sources/source-one.md");
});
