import assert from "node:assert/strict";
import test from "node:test";
import { capturedHtmlToMarkdown } from "../scripts/core/capture-service.mjs";

test("WeChat capture keeps article content while excluding page chrome and trailing promotion", () => {
  const article = `${"正文内容。".repeat(80)}<img data-src="https://mmbiz.qpic.cn/article.png"><p>文章结论。</p><p>推荐阅读</p><p>另一篇文章</p>`;
  const html = `<!doctype html><html><body>
    <nav>在小说阅读器读本章</nav>
    <div class="rich_media_content" id="js_content"><div>${article}</div></div>
    <div id="js_article_bottom_bar">赞 在看 分享 留言 收藏</div>
    <div>微信扫一扫 使用小程序 取消 允许</div>
  </body></html>`;

  const markdown = capturedHtmlToMarkdown(html, { sourceUrl: "https://mp.weixin.qq.com/s/token" });

  assert.match(markdown, /正文内容/);
  assert.match(markdown, /!\[\]\(https:\/\/mmbiz\.qpic\.cn\/article\.png\)/);
  assert.match(markdown, /文章结论/);
  assert.doesNotMatch(markdown, /在小说阅读器|推荐阅读|另一篇文章|赞 在看|微信扫一扫|取消 允许/);
});

test("ordinary webpages continue to use the complete HTML body", () => {
  const markdown = capturedHtmlToMarkdown("<main><h1>Article</h1><p>Body</p></main><footer>Source footer</footer>", {
    sourceUrl: "https://example.com/article"
  });
  assert.match(markdown, /# Article/);
  assert.match(markdown, /Source footer/);
});
