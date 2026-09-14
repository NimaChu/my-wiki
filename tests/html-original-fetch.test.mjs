import assert from "node:assert/strict";
import test from "node:test";
import { fetchPublicHtmlOriginal } from "../scripts/core/viki-web-tools.mjs";

test("HTML original capture keeps the full snapshot, follows public redirects, and rejects private targets", async () => {
  const html = `<html><body>${"Evidence ".repeat(400000)}</body></html>`;
  const calls = [];
  const result = await fetchPublicHtmlOriginal("https://example.com/start", { fetcher: async (url, options) => {
    calls.push(url.href);
    assert.equal(options.redirect, "manual");
    assert.ok(options.dispatcher, "DNS-checked transport remains active");
    return url.pathname === "/start" ? new Response(null, {status:302,headers:{location:"/article"}}) : new Response(html, {headers:{"content-type":"text/html; charset=utf-8"}});
  } });
  assert.deepEqual(calls, ["https://example.com/start", "https://example.com/article"]);
  assert.equal(result.buffer.toString(), html);
  assert.equal(result.url, "https://example.com/article");
  let requests = 0;
  await assert.rejects(fetchPublicHtmlOriginal("https://example.com/start", {fetcher:async () => { requests++; return new Response(null,{status:302,headers:{location:"http://169.254.169.254/latest"}}); }}), /Local\/private/);
  assert.equal(requests, 1);
});

test("HTML capture rejects non-HTML, empty, oversized, and failed responses before replacement", async () => {
  const run = (response) => fetchPublicHtmlOriginal("https://example.com/article", {fetcher: async () => response});
  await assert.rejects(run(new Response("PDF",{headers:{"content-type":"application/pdf"}})), /HTML webpage/);
  await assert.rejects(run(new Response("text",{headers:{"content-type":"text/plain"}})), /HTML webpage/);
  await assert.rejects(run(new Response("",{headers:{"content-type":"text/html"}})), /empty/);
  await assert.rejects(run(new Response("denied",{status:403})), /403/);
  await assert.rejects(run(new Response("large",{headers:{"content-type":"text/html","content-length":String(21*1024*1024)}})), /size limit/);
  await assert.rejects(run(new Response(new Uint8Array(21*1024*1024),{headers:{"content-type":"text/html"}})), /size limit/);
});
