import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";
import { originalPreview, prepareLibraryPreviews, previewPreparationStatus } from "../scripts/core/original-preview.mjs";

const dependencyRoot = fileURLToPath(new URL("../assets/dashboard", import.meta.url));
async function fixture(t) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-preview-"));
  await fs.mkdir(path.join(vault, "references/originals"), { recursive: true });
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  return vault;
}
function hasRenderingDependencies() {
  try { const require = createRequire(path.join(dependencyRoot, "package.json")); require.resolve("@napi-rs/canvas"); require.resolve("pdfjs-dist/legacy/build/pdf.mjs"); return true; }
  catch { return false; }
}
function pdfFixture() {
  const stream = "BT /F1 20 Tf 40 180 Td (Preview test) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 240] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const start = Buffer.byteLength(body);
  return `${body}xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
}

test("background preparation creates cached previews before any browser request", async (t) => {
  const vault = await fixture(t);
  await fs.writeFile(path.join(vault, "references/originals/background.md"), "# Background evidence");
  const prepared = prepareLibraryPreviews(vault, dependencyRoot);
  assert.equal(prepareLibraryPreviews(vault, dependencyRoot), prepared);
  await prepared;
  assert.deepEqual(previewPreparationStatus(vault), { running: false, completed: 1, total: 1, failed: 0 });
  const directories = await fs.readdir(path.join(vault, ".my-wiki/library-previews"));
  assert.equal(directories.length, 1);
  const file = path.join(vault, ".my-wiki/library-previews", directories[0], "preview.json");
  const before = (await fs.stat(file)).mtimeMs;
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).text, "# Background evidence");
  assert.equal((await originalPreview(vault, "references/originals/background.md", dependencyRoot)).file, file);
  assert.equal((await fs.stat(file)).mtimeMs, before);
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e",
    `import { originalPreview } from ${JSON.stringify(new URL("../scripts/core/original-preview.mjs", import.meta.url).href)}; console.log(JSON.stringify(await originalPreview(process.argv[1], "references/originals/background.md", process.argv[2])));`, vault, dependencyRoot]);
  assert.equal(JSON.parse(stdout).file, file, "a new server process reuses the disk snapshot");
  assert.equal((await fs.stat(file)).mtimeMs, before);
});

test("preview revalidation requires authentication and invalidates when the original changes", async (t) => {
  const vault = await fixture(t);
  await fs.mkdir(path.join(vault, "references/sources"), { recursive: true });
  await fs.mkdir(path.join(vault, "concepts"), { recursive: true });
  const relative = "references/originals/preview.md";
  await fs.writeFile(path.join(vault, relative), "# Cached document");
  const dashboard = path.join(vault, ".my-wiki/dashboard");
  await fs.mkdir(dashboard, { recursive: true });
  await fs.writeFile(path.join(dashboard, ".my-wiki-runtime.json"), JSON.stringify({ vault }));
  const allowedOrigins = new Set();
  const server = http.createServer(createDashboardApi({ dashboardRoot: dashboard, previewDependencyRoot: dependencyRoot, port: 0, allowedOrigins }));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  allowedOrigins.add(base);
  const sessionResponse = await fetch(base + "/api/v1/session");
  assert.equal(sessionResponse.status, 200, await sessionResponse.clone().text());
  const { token } = await sessionResponse.json();
  const url = base + "/api/v1/drive/preview?" + new URLSearchParams({ path: relative });
  const first = await fetch(url, { headers: { "x-my-wiki-token": token } });
  assert.equal(first.status, 200, await first.clone().text());
  const etag = first.headers.get("etag");
  assert.ok(etag);
  assert.equal(first.headers.get("cache-control"), "private, no-cache");
  assert.match((await first.json()).text, /Cached document/);
  const unchanged = await fetch(url, { headers: { "x-my-wiki-token": token, "if-none-match": etag } });
  assert.equal(unchanged.status, 304);
  assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
  const unauthorized = await fetch(url, { headers: { "if-none-match": etag } });
  assert.equal(unauthorized.status, 403);
  await fs.writeFile(path.join(vault, relative), "# Changed document");
  const changed = await fetch(url, { headers: { "x-my-wiki-token": token, "if-none-match": etag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
  assert.match((await changed.json()).text, /Changed document/);
});

test("text previews are bounded, cached and invalidate when originals change", async (t) => {
  const vault = await fixture(t);
  const relative = "references/originals/test.md";
  const original = "---\ntitle: Metadata\n---\n# Real document\n" + "evidence ".repeat(1000);
  await fs.writeFile(path.join(vault, relative), original);
  const first = await originalPreview(vault, relative, dependencyRoot);
  const result = JSON.parse(await fs.readFile(first.file, "utf8"));
  assert.equal(result.kind, "text"); assert.equal(result.text.length, 2400);
  assert.ok(result.text.startsWith("# Real document"));
  assert.equal((await originalPreview(vault, relative, dependencyRoot)).file, first.file);
  assert.equal(await fs.readFile(path.join(vault, relative), "utf8"), original);
  await fs.writeFile(path.join(vault, relative), "New content");
  const next = await originalPreview(vault, relative, dependencyRoot);
  assert.notEqual(next.file, first.file);
  assert.equal(JSON.parse(await fs.readFile(next.file, "utf8")).text, "New content");
  await assert.rejects(originalPreview(vault, "references/originals/../../index.md", dependencyRoot), { status: 400 });
});

test("image and PDF previews render locally without editing or extracting the original", { skip: !hasRenderingDependencies() }, async (t) => {
  const vault = await fixture(t);
  const require = createRequire(path.join(dependencyRoot, "package.json"));
  const { createCanvas, loadImage } = require("@napi-rs/canvas");
  const canvas = createCanvas(1000, 500); const context = canvas.getContext("2d"); context.fillStyle = "#f00"; context.fillRect(0, 0, 1000, 500);
  for (const [name, body] of [["image.png", canvas.toBuffer("image/png")], ["paper.pdf", Buffer.from(pdfFixture())]]) {
    const relative = `references/originals/${name}`;
    await fs.writeFile(path.join(vault, relative), body);
    const [first, same] = await Promise.all([originalPreview(vault, relative, dependencyRoot), originalPreview(vault, relative, dependencyRoot)]);
    assert.equal(first.type, "image/png"); assert.equal(first.file, same.file);
    const image = await loadImage(first.file); assert.ok(image.width > 0 && image.width <= 720);
    assert.deepEqual(await fs.readFile(path.join(vault, relative)), body);
  }
});

test("Office slide previews contain only extracted text", { skip: !hasRenderingDependencies() }, async (t) => {
  const vault = await fixture(t);
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", '<p:sld><p:cSld><a:p><a:r><a:t>Actual slide title</a:t></a:r></a:p></p:cSld></p:sld>');
  await fs.writeFile(path.join(vault, "references/originals/slides.pptx"), await zip.generateAsync({ type: "nodebuffer" }));
  const result = await originalPreview(vault, "references/originals/slides.pptx", dependencyRoot);
  assert.equal(JSON.parse(await fs.readFile(result.file, "utf8")).text, "Actual slide title");
});
