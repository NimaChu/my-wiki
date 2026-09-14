import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";

test("Library readers are authenticated, full length, range capable and read-only", async (t) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-reader-test-"));
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  await fs.mkdir(path.join(vault, "references/originals"), { recursive: true });
  await fs.mkdir(path.join(vault, "references/assets"), { recursive: true });
  const markdown = "---\ntitle: Original reader\n---\n# Full document\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![figure](../assets/figure.svg)\n\nLast paragraph.\n";
  const originals = { "测试.pdf": "%PDF-1.4\n0123456789\n%%EOF", "note.md": markdown, "book.markdown": "# Long book\n" + "Evidence\n".repeat(10000), "long.txt": "Start\n" + "Line\n".repeat(10000) + "End", "page.html": "<script>parent.hacked=true</script><p>Evidence</p>", "unsupported.docx": "Office binary", "empty.txt": "" };
  for (const [name, body] of Object.entries(originals)) await fs.writeFile(path.join(vault, "references/originals", name), body);
  await fs.writeFile(path.join(vault, "references/assets/figure.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const api = createDashboardApi({ dashboardRoot: vault, port: 0, requestContext: async () => ({ vault }) });
  const server = http.createServer(async (req, res) => { if (!await api(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const route = (name, endpoint = "read") => `${base}/api/v1/drive/${endpoint}?${new URLSearchParams({ path: `references/originals/${name}` })}`;
  for (const endpoint of ["read", "markdown", "markdown-image"]) assert.equal((await fetch(route("note.md", endpoint))).status, 403);
  const { token } = await fetch(`${base}/api/v1/session`).then((response) => response.json());
  const headers = { "x-my-wiki-token": token };
  const read = (name, extraHeaders = {}) => fetch(route(name), { headers: { ...headers, ...extraHeaders } });
  const pdf = await read("测试.pdf");
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /^inline; filename\*=UTF-8''/);
  assert.equal(await pdf.text(), originals["测试.pdf"]);
  const full = originals["测试.pdf"];
  for (const [range, start, end] of [["bytes=0-4", 0, 4], ["bytes=9-", 9, full.length - 1], ["bytes=-5", full.length - 5, full.length - 1], ["bytes=0-999999", 0, full.length - 1]]) {
    const response = await read("测试.pdf", { range });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${full.length}`);
    assert.equal(await response.text(), full.slice(start, end + 1));
  }
  for (const range of ["bytes=99999-", "bytes=5-1", "bytes=0-1,4-5", "bytes=-0", "bytes=-", "bogus", "bytes=99999999999999999999-"]) {
    assert.equal((await read("测试.pdf", { range })).status, 416, range);
  }
  const head = await fetch(route("测试.pdf"), { method: "HEAD", headers });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), full.length);
  assert.equal(await head.text(), "");
  assert.equal(await (await read("empty.txt")).text(), "");
  assert.equal((await read("empty.txt", { range: "bytes=0-" })).status, 416);
  assert.equal(await (await read("long.txt")).text(), originals["long.txt"]);
  assert.equal((await read("unsupported.docx")).status, 415);
  const html = await read("page.html");
  assert.match(html.headers.get("content-security-policy"), /^sandbox;/);
  assert.match(html.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(html.headers.get("x-content-type-options"), "nosniff");
  const md = await fetch(route("note.md", "markdown"), { headers }).then((response) => response.json());
  assert.equal(md.title, "Original reader");
  assert.ok(md.body.endsWith("Last paragraph.\n"));
  const long = await fetch(route("book.markdown", "markdown"), { headers }).then((response) => response.json());
  assert.equal(long.body, originals["book.markdown"]);
  const textOriginal = "---\ntitle: This is text, not document metadata\n---\n# TXT heading\n\n中文正文。\n\n![figure](../assets/figure.svg)\n";
  await fs.writeFile(path.join(vault, "references/originals/note.TXT"), textOriginal);
  for (const [name, expected] of [["long.txt", originals["long.txt"]], ["empty.txt", ""], ["note.TXT", textOriginal]]) {
    const response = await fetch(route(name, "markdown"), { headers });
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(document.body, expected, "TXT content is complete and does not lose frontmatter-like text");
    const editText = await fetch(`${base}/api/v1/markdown`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: document.path, body: "changed", expectedVersion: document.version }) });
    assert.equal(editText.status, 400);
    assert.equal(await fs.readFile(path.join(vault, document.path), "utf8"), expected);
  }
  assert.equal((await fetch(route("unsupported.docx", "markdown"), { headers })).status, 415);
  const textImageUrl = `${base}/api/v1/drive/markdown-image?${new URLSearchParams({ note: "references/originals/note.TXT", src: "../assets/figure.svg" })}`;
  assert.equal((await fetch(textImageUrl, { headers })).status, 200);
  const imageUrl = `${base}/api/v1/drive/markdown-image?${new URLSearchParams({ note: md.path, src: "../assets/figure.svg" })}`;
  assert.equal((await fetch(imageUrl, { headers })).status, 200);
  await fs.mkdir(path.join(vault, "references/sources"), { recursive: true });
  await fs.mkdir(path.join(vault, "references/assets/legacy/other"), { recursive: true });
  await fs.copyFile(path.join(vault, "references/assets/figure.svg"), path.join(vault, "references/assets/legacy/figure.svg"));
  await fs.writeFile(path.join(vault, "references/sources/note.md"), "---\ntitle: Legacy\nsnapshot_markdown_path: references/originals/note.md\nimage_index_path: references/assets/legacy/image-index.json\n---\nEvidence");
  const legacyImage = "references/assets/legacy/figure.svg";
  const indexFile = path.join(vault, "references/assets/legacy/image-index.json");
  await fs.writeFile(indexFile, JSON.stringify({ images: [{ local_path: legacyImage }] }));
  const legacyUrl = `${base}/api/v1/drive/markdown-image?${new URLSearchParams({ note: md.path, src: "attachment/figure.svg" })}`;
  assert.equal((await fetch(legacyUrl, { headers })).status, 200);
  await fs.copyFile(path.join(vault, legacyImage), path.join(vault, "references/assets/legacy/other/figure.svg"));
  await fs.writeFile(indexFile, JSON.stringify({ images: [{ local_path: legacyImage }, { local_path: "references/assets/legacy/other/figure.svg" }] }));
  assert.equal((await fetch(legacyUrl, { headers })).status, 400, "ambiguous mirrored basenames are not guessed");
  await fs.writeFile(indexFile, JSON.stringify({ images: [{ local_path: "references/assets/figure.svg" }] }));
  assert.equal((await fetch(legacyUrl, { headers })).status, 400, "another Reference's asset is not used");
  const edit = await fetch(`${base}/api/v1/markdown`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ path: md.path, body: "changed", expectedVersion: md.version }) });
  assert.equal(edit.status, 400);
  assert.equal(await fs.readFile(path.join(vault, md.path), "utf8"), markdown);
  const escaped = route("../../private.txt");
  assert.equal((await fetch(escaped, { headers })).status, 400);
  if (process.platform !== "win32") {
    await fs.writeFile(path.join(vault, "private.txt"), "private");
    await fs.symlink(path.join(vault, "private.txt"), path.join(vault, "references/originals/escape.txt"));
    assert.equal((await read("escape.txt")).status, 404);
  }
});
