import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureSource, inferCapturedTitle, isWeakSourceTitle } from "../scripts/core/capture-service.mjs";
import { parseFrontmatter } from "../scripts/core/wiki-lib.mjs";

test("web capture infers a real title from Open Graph metadata", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-wiki-title-"));
  const vault = path.join(root, "vault");
  const snapshot = path.join(root, "wechat.html");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(vault, "concepts"), { recursive: true });
  await writeFile(snapshot, `<!doctype html><html><head><meta content="为什么超级个体不需要超级团队？" property="og:title"><title></title></head><body><h1>为什么超级个体不需要超级团队？</h1><p>Substantive evidence.</p></body></html>`, "utf8");

  const result = await captureSource({
    vault,
    url: "https://mp.weixin.qq.com/s/uOLP0XMkFSsCW_bhMb1DDw",
    sourceType: "webpage",
    snapshotFile: snapshot,
    inferTitleFromSource: true,
    shouldMirrorImages: false
  });

  const content = await readFile(result.path, "utf8");
  const frontmatter = parseFrontmatter(content);
  assert.equal(result.title, "为什么超级个体不需要超级团队？");
  assert.equal(frontmatter.title, "为什么超级个体不需要超级团队？");
  assert.match(path.basename(result.path), /为什么超级个体不需要超级团队/);
  assert.equal(frontmatter.workflow_status, "inbox");
});

test("explicit titles are not overwritten and unresolved generated titles require repair", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "my-wiki-title-fallback-"));
  const vault = path.join(root, "vault");
  const snapshot = path.join(root, "page.html");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(vault, "concepts"), { recursive: true });
  await writeFile(snapshot, "<!doctype html><html><body><p>Evidence without a title.</p></body></html>", "utf8");

  const result = await captureSource({
    vault,
    url: "https://example.com/s/opaque-token",
    sourceType: "webpage",
    snapshotFile: snapshot,
    inferTitleFromSource: true,
    shouldMirrorImages: false
  });
  const frontmatter = parseFrontmatter(await readFile(result.path, "utf8"));
  assert.equal(frontmatter.workflow_status, "needs-followup");
  assert.deepEqual(frontmatter.followup_reasons, ["metadata:title-unresolved"]);

  assert.equal(inferCapturedTitle({ html: '<meta name="twitter:title" content="Trusted title">' }), "Trusted title");
  assert.equal(isWeakSourceTitle("opaque token", "https://example.com/s/opaque-token"), true);
});
