import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkMarkdownFormat } from "../scripts/core/markdown-format.mjs";
import { auditOkfDirectory } from "../scripts/core/okf-lib.mjs";
import { readMarkdownDocument, saveMarkdownDocument } from "../scripts/core/dashboard-api.mjs";
import { importUniverse } from "../scripts/core/import-universe.mjs";
import { writeUniverseArchive } from "../scripts/core/universe-package-lib.mjs";

const header = '---\ntype: concept\nsources:\n  - id: source-a\n    resource: /references/sources/evidence.md\n---\n';
const cite = '[^source-a]: [Evidence](../references/sources/evidence.md#page-1)';
const valid = `${header}\n# Example\n\nA claim[^source-a]. Another claim[^source-a].\n\n| A | B |\n| --- | --- |\n| x\\|y | $a+b$ |\n\n${cite}\n`;

test("Markdown format checks accept GFM tables, math, repeated citations and relative evidence paths", () => {
  assert.deepEqual(checkMarkdownFormat(valid, { path: "concepts/example.md" }), []);
});

test("Markdown format diagnostics carry source file and exact line, ignoring code and escaped examples", () => {
  const body = `${header}\n# Example\n\n\\[^source-escaped] and \`[^source-code]\`.\n\n\`\`\`md\n[^source-fence]\n| A | B |\n| nope |\n\`\`\`\n\n$$\n[^source-math]\n$$\n\nMissing[^source-missing].\n`;
  const issues = checkMarkdownFormat(body, { path: "concepts/example.md" });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "markdown:missing-footnote-definition");
  assert.equal(issues[0].line, body.split("\n").findIndex(line => line.startsWith("Missing")) + 1);
  assert.equal(issues[0].column, 8);
  assert.equal(issues[0].path, "concepts/example.md");
});

test("Markdown source definitions must be unique, registered and point to their matching evidence", () => {
  assert.ok(checkMarkdownFormat(valid + cite, { path: "concepts/example.md" }).some(issue => issue.code === "markdown:duplicate-footnote-definition"));
  assert.ok(checkMarkdownFormat(valid.replace(cite, '[^source-a]: [Wrong](/references/sources/other.md)'), { path: "concepts/example.md" }).some(issue => issue.code === "markdown:source-resource-mismatch"));
  assert.ok(checkMarkdownFormat('Claim[^source-unknown].\n\n[^source-unknown]: [Evidence](/references/sources/evidence.md)').some(issue => issue.code === "markdown:unregistered-source"));
});

test("Suspected tables and ragged rows are review warnings, not automatic content repairs", () => {
  const body = '| A | B |\n| --- | --- |\n| x | y | z |\n\n| H | K |\n| x | y |';
  const issues = checkMarkdownFormat(body);
  assert.deepEqual(issues.map(issue => issue.code), ["markdown:table-column-count", "markdown:unparsed-table"]);
  assert.ok(issues.every(issue => issue.severity === "warning"));
});

test("Concept saves reject broken citations atomically and return table warnings; import audit uses the same checks", async t => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-format-"));
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  await fs.mkdir(path.join(vault, "concepts"));
  await fs.mkdir(path.join(vault, "references/sources"), { recursive: true });
  const file = path.join(vault, "concepts/example.md");
  await fs.writeFile(file, valid);
  await fs.writeFile(path.join(vault, "references/sources/evidence.md"), '---\ntype: reference\n---\n# Evidence');
  const before = await readMarkdownDocument(vault, "concepts/example.md");
  await assert.rejects(saveMarkdownDocument(vault, before.path, before.body.replace(cite, ""), before.version), /example\.md:\d+:\d+ markdown:missing-footnote-definition/);
  assert.equal(await fs.readFile(file, "utf8"), valid);
  const saved = await saveMarkdownDocument(vault, before.path, before.body + '\n| A | B |\n| 1 | 2 |\n', before.version);
  assert.equal(saved.formatIssues[0].severity, "warning");
  let audit = await auditOkfDirectory(vault);
  assert.equal(audit.valid, true);
  assert.equal(audit.markdownWarnings[0].code, "markdown:unparsed-table");
  await fs.writeFile(file, valid.replace(cite, ""));
  audit = await auditOkfDirectory(vault);
  assert.equal(audit.valid, false);
  assert.ok(audit.issues.some(issue => issue.code === "markdown:missing-footnote-definition"));
  const packageFile = path.join(vault, "broken.mywiki");
  await writeUniverseArchive(packageFile, [
    { path: "manifest.json", buffer: Buffer.from(JSON.stringify({ format: "okf", okf_version: "0.2", package: { type: "my-wiki-galaxy", version: 2 } })) },
    { path: "concepts/incoming.md", buffer: Buffer.from(valid.replace(cite, "")) }
  ]);
  await assert.rejects(importUniverse({ vault, packageFile, apply: true }), /markdown:missing-footnote-definition/);
  await assert.rejects(fs.access(path.join(vault, "concepts/incoming.md")));
});
