import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "parse5";
import { createOfflineHtml, inspectHtmlCapture, inlineHtmlImageAssets } from "../scripts/core/html-original.mjs";
import { extractLocalDocument } from "../scripts/core/document-extractor.mjs";
import { captureSource, capturedHtmlToMarkdown, materializeEmbeddedAssets } from "../scripts/core/capture-service.mjs";
import { parseFrontmatter } from "../scripts/core/wiki-lib.mjs";
import { fetchPublicHtmlOriginal } from "../scripts/core/viki-web-tools.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVuoAAAAASUVORK5CYII=", "base64");
const captcha = "<title>WeChat</title><p>环境异常</p><p>当前环境异常，完成验证后即可继续访问。</p><button>去验证</button>";
const sourceUrl = "https://example.com/article";

test("HTML capture rejects successful HTTP verification pages before extracting evidence", async t => {
  assert.throws(() => inspectHtmlCapture(captcha), { code: "webpage:verification-required" });
  assert.throws(() => inspectHtmlCapture("<p>Continue</p>", "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha"), { code: "webpage:verification-required" });
  assert.throws(() => inspectHtmlCapture("<title>Just a moment</title><p>Enable JavaScript and cookies to continue</p>"), { code: "webpage:verification-required" });
  assert.doesNotThrow(() => inspectHtmlCapture('<div id="js_content"><h1>浏览器问题排查</h1><p>出现环境异常和去验证按钮时的解决方法。</p></div>'));
  await assert.rejects(fetchPublicHtmlOriginal(sourceUrl, { fetcher: async () => new Response(captcha, {headers:{"content-type":"text/html"}}) }), {code:"webpage:verification-required"});
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-html-gate-"));
  t.after(() => fs.rm(root, {recursive:true,force:true}));
  const file = path.join(root, "captcha.html");
  await fs.writeFile(file, captcha);
  const extraction = await extractLocalDocument({ file });
  assert.equal(extraction.status, "failed");
  assert.doesNotMatch(extraction.content, /当前环境异常|去验证/);
  assert.match(extraction.message, /验证码或安全验证页/);
});

test("offline HTML keeps article structure, embeds lazy images and removes active or network-dependent presentation", async () => {
  const html = `<title>Offline &amp; readable</title><link rel="stylesheet" href="https://example.com/style.css"><body><nav>Page controls</nav><div id="js_content" style="visibility:hidden;opacity:0" hidden><h2>Evidence</h2><p style="background:url(https://example.com/track)">Substantive article text for offline reading.</p><img data-src="/figure.png" src="about:blank" onerror="leak()" srcset="https://example.com/alternate 2x"><img src="/figure.png"><table><tr><td colspan="2">Table evidence</td></tr></table><a href="/related">Related</a><a href="javascript:alert(1)">Unsafe link</a><script>leak()</script><iframe src="https://example.com/frame"></iframe></div><footer>Website footer</footer></body>`;
  const calls = [];
  const result = await createOfflineHtml(html, {sourceUrl,loadImage:async url => {calls.push(url);return png;}});
  assert.deepEqual(calls, ["https://example.com/figure.png"]);
  assert.equal(result.imageCount, 1);
  assert.equal(result.imageBytes, png.length);
  const output = result.buffer.toString();
  assert.match(output, /<h2>Evidence<\/h2>/);
  assert.match(output, /colspan="2"/);
  assert.match(output, /href="https:\/\/example.com\/related"/);
  assert.match(output, /my-wiki-offline/);
  assert.match(output, /default-src 'none'/);
  assert.doesNotMatch(output, /visibility|opacity| hidden|onerror|srcset|javascript:|leak|<iframe|<script|Page controls|Website footer/);
  const resources = [];
  function visit(node) {
    for (const attr of node.attrs || []) if (["src", "srcset", "poster"].includes(attr.name)) resources.push(attr.value);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(output));
  assert.equal(resources.length, 2);
  assert.ok(resources.every(value => value.startsWith("data:image/png;base64,")));
  assert.equal(inlineHtmlImageAssets(output).length, 1);
});

test("offline HTML fails closed on missing, unsafe or invalid images", async () => {
  for (const src of ["http://127.0.0.1/private", "http://localhost./secret", "file:///etc/passwd", "data:image/svg+xml;base64,AAAA"]) {
    await assert.rejects(createOfflineHtml(`<p>Evidence</p><img src="${src}">`, {sourceUrl,loadImage:async () => assert.fail("Private or unsupported images cannot be fetched")}), /离线网页/);
  }
  await assert.rejects(createOfflineHtml('<p>Evidence</p><img src="/missing.png">', {sourceUrl,loadImage:async () => {throw new Error("HTTP 404");}}), /第 1 张图片保存失败.*404/);
  await assert.rejects(createOfflineHtml('<p>Evidence</p><img src="/fake.png">', {sourceUrl,loadImage:async () => Buffer.from("<html>not an image</html>")}), /valid PNG/);
});

test("offline embedded images re-extract into portable Reference asset paths", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-html-images-"));
  t.after(() => fs.rm(root, {recursive:true,force:true}));
  const file = path.join(root, "article.html");
  const html = await createOfflineHtml('<article><p>Long enough substantive evidence for the extraction pipeline.</p><img src="/figure.png" alt="Figure"></article>', {sourceUrl,loadImage:async () => png});
  await fs.writeFile(file, html.buffer);
  const extraction = await extractLocalDocument({file});
  assert.equal(extraction.status, "complete");
  assert.equal(extraction.assets.length, 1);
  assert.doesNotMatch(extraction.content, /data:image/);
  assert.ok(extraction.characters < 200, "Embedded image bytes must not count as extracted text");
  const materialized = await materializeEmbeddedAssets({vault:root,notePath:path.join(root,"references/sources/article.md"),rawBase:"article",markdown:extraction.content,assets:extraction.assets});
  assert.match(materialized.markdown, /!\[\]\(\.\.\/assets\/article\/embedded-1.png\)/);
  assert.doesNotMatch(materialized.markdown, /data:image/);
  assert.deepEqual(await fs.readFile(path.join(root,"references/assets/article/embedded-1.png")), png);
});

test("offline WeChat captures retain article scoping and footer cleanup", async () => {
  const html = `<title>WeChat article</title><div id="js_content" class="rich_media_content"><p>${"Evidence ".repeat(80)}</p><p>推荐阅读</p><p>Unrelated recommendation</p></div><footer>Page controls</footer>`;
  const offline = await createOfflineHtml(html, {sourceUrl:"https://mp.weixin.qq.com/s/article"});
  const markdown = capturedHtmlToMarkdown(offline.buffer.toString());
  assert.match(markdown, /Evidence/);
  assert.doesNotMatch(markdown, /推荐阅读|Unrelated recommendation|Page controls/);
});

test("new URL capture writes portable HTML and retains unresolved-title quality warnings", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-url-offline-"));
  t.after(() => fs.rm(root, {recursive:true,force:true}));
  await fs.mkdir(path.join(root,"concepts"));
  let response = `<meta property="og:title" content="Actual article title"><div id="js_content" style="visibility:hidden"><p>Readable source content for a newly captured page.</p><img src="data:image/png;base64,${png.toString("base64")}"></div>`;
  t.mock.method(globalThis, "fetch", async () => new Response(response, {headers:{"content-type":"text/html"}}));
  const result = await captureSource({vault:root,url:sourceUrl,inferTitleFromSource:true,requireSnapshot:true});
  assert.equal(result.title, "Actual article title");
  const content = await fs.readFile(result.path,"utf8");
  const fm = parseFrontmatter(content);
  assert.match(await fs.readFile(path.join(root,fm.snapshot_path),"utf8"), /my-wiki-offline/);
  assert.doesNotMatch(content, /data:image/);
  assert.match(content, /embedded-1.png/);
  response = "<p>Readable source content without any title at all.</p>";
  const untitled = await captureSource({vault:root,url:"https://example.com/opaque",inferTitleFromSource:true,requireSnapshot:true});
  assert.deepEqual(parseFrontmatter(await fs.readFile(untitled.path,"utf8")).followup_reasons,["metadata:title-unresolved"]);
  response = captcha;
  await assert.rejects(captureSource({vault:root,url:sourceUrl,requireSnapshot:true}), /验证码或安全验证页/);
});
