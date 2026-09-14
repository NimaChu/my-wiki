import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";
import { updateDocumentVersion, writeVersionReceipt } from "../scripts/core/document-versions.mjs";
import { parseFrontmatter, upsertFrontmatterValues } from "../scripts/core/wiki-lib.mjs";
import { reextractSources } from "../scripts/core/reextract-source.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-version-api-"));
  const vault = path.join(root, "vault");
  const dashboard = path.join(root, "dashboard");
  for (const directory of ["references/originals", "references/sources", "references/assets/book", "concepts", ".my-wiki/uploads"]) await fs.mkdir(path.join(vault, directory), { recursive: true });
  await fs.mkdir(dashboard);
  await fs.mkdir(path.join(dashboard, "scripts"));
  await fs.writeFile(path.join(dashboard, "scripts/generate-graph.mjs"), `import ${JSON.stringify(new URL("../assets/dashboard/scripts/generate-graph.mjs", import.meta.url).href)};`);
  await fs.writeFile(path.join(dashboard, ".my-wiki-runtime.json"), JSON.stringify({ vault }));
  const original = "references/originals/book.md";
  const source = "references/sources/book.md";
  const asset = "references/assets/book/figure.png";
  await fs.writeFile(path.join(vault, original), "# First edition\n\nOriginal evidence.");
  await fs.writeFile(path.join(vault, asset), "original image");
  await fs.writeFile(path.join(vault, source), `---\ntitle: Book\ntype: Reference\nstatus: stable\nworkflow_status: processed\nuniverse: AI\nsnapshot_path: ${original}\nextraction_status: complete\nneeds_followup: false\n---\n\n# Book\n\n## Capture\n\nFirst evidence. ![Figure](../assets/book/figure.png)\n\n## Processing Notes\n\n- Status: processed\n`);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, vault, dashboard, original, source, asset };
}

async function serverFor(f, sourceReextractor, options = {}) {
  const handler = createDashboardApi({ dashboardRoot: f.dashboard, port: 0, agentRunner: { info: async () => ({ available: false }) }, sourceReextractor, ...options });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(origin + "/api/v1/session")).json();
  async function request(route, body, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(origin + route, { method, headers: { "x-my-wiki-token": session.token, ...(body && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data };
  }
  return { origin, request, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}
async function until(work, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await work();
    if (predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for document workflow");
}
async function upload(api, f, filename = "new.md") {
  const body = Buffer.from("# New edition\n\nUpdated evidence.");
  const started = await api.request("/api/v1/inbox/file/uploads", { filename, size: body.length, versionPath: f.original });
  assert.equal(started.status, 201);
  const route = `/api/v1/inbox/file/uploads/${started.data.id}`;
  await api.request(route + "?offset=0", body, "PATCH");
  return { route, id: started.data.id };
}
async function extracted(f) {
  const file = path.join(f.vault, f.source);
  await fs.writeFile(file, upsertFrontmatterValues((await fs.readFile(file, "utf8")).replace("Extraction pending for the updated original.", "New extracted evidence."), { workflow_status: "inbox", extraction_status: "complete", needs_followup: false, followup_reasons: [] }));
}

test("Distillation postflight reopens the current Reference when a Concept has a dangling source citation", async t => {
  const f = await fixture(t);
  const file = path.join(f.vault, f.source);
  await fs.writeFile(file, upsertFrontmatterValues((await fs.readFile(file, "utf8")).replace("First evidence.", "This reference contains substantive readable evidence about the topic, its mechanisms, practical applications and limitations for the Markdown citation postflight regression test."), { workflow_status: "inbox", extracted_characters: 180 }));
  const api = await serverFor(f, undefined, { agentRunner: {
    info: async () => ({ available: true, provider: "opencode", label: "OpenCode", providers: [{ provider: "opencode", label: "OpenCode" }] }),
    run: async () => {
      await fs.writeFile(path.join(f.vault, "concepts/topic.md"), '---\ntype: concept\ntitle: Topic\nstatus: stable\nuniverses: [AI]\nsources:\n  - id: source-book\n    resource: /references/sources/book.md\n---\n# Topic\n\nClaim[^source-book].\n');
      await fs.writeFile(file, upsertFrontmatterValues(await fs.readFile(file, "utf8"), { workflow_status: "processed" }) + '\n[Topic](/concepts/topic.md)\n');
      return { summary: "Distilled", processed: [f.source], createdWiki: ["concepts/topic.md"], updatedWiki: [], remainingNotes: "" };
    }
  } });
  t.after(api.close);
  const queued = await api.request("/api/v1/agent/maintenance", { paths: [f.source], batchSize: 1, provider: "opencode" });
  assert.ok(queued.data.id, JSON.stringify(queued));
  const finished = await until(async () => (await api.request(`/api/v1/jobs/${queued.data.id}`)).data, job => ["complete", "failed"].includes(job.status));
  assert.equal(finished.status, "complete", JSON.stringify(finished));
  assert.equal(finished.result.postflightPassed, false);
  assert.equal(finished.result.markdownFormatIssues[0].code, "markdown:missing-footnote-definition");
  assert.match(finished.result.remainingNotes, /concepts\/topic\.md:\d+:\d+/);
  assert.equal(parseFrontmatter(await fs.readFile(file, "utf8")).workflow_status, "inbox");
  assert.match(await fs.readFile(path.join(f.vault, "concepts/topic.md"), "utf8"), /Claim\[\^source-book\]/);
});

test("version API tracks upload/extraction, archives evidence and restores into distillation", async (t) => {
  const f = await fixture(t);
  let release;
  let entered = false;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = await serverFor(f, async ({ onProgress }) => { calls++; entered = true; onProgress({ phase: "extracting", current: 1, total: 2, percent: 50 }); await gate; await extracted(f); });
  try {
    const wrong = await api.request("/api/v1/inbox/file/uploads", { filename: "wrong.pdf", size: 4, versionPath: f.original });
    assert.equal(wrong.status, 400);
    const pending = await upload(api, f);
    const uploading = await api.request("/api/v1/maintenance-queue");
    assert.equal(uploading.data.items.find((item) => item.jobId === pending.id).stage, "upload");
    const job = await api.request(pending.route + "/complete", {});
    assert.equal(job.status, 202);
    await until(async () => entered, Boolean);
    const queue = await api.request("/api/v1/maintenance-queue");
    const item = queue.data.items.find((item) => item.path === f.source);
    assert.equal(item.stage, "extract");
    assert.equal(item.progress.percent, 50);
    assert.equal(queue.data.items.length, 1);
    const busy = await api.request("/api/v1/inbox/file/uploads", { filename: "next.md", size: 4, versionPath: f.original });
    assert.equal(busy.status, 409);
    release();
    await until(() => api.request(`/api/v1/jobs/${job.data.id}`), (value) => value.data.status === "complete");
    assert.equal((await api.request("/api/v1/maintenance-queue")).data.items[0].stage, "distill");
    const history = await api.request("/api/v1/drive/versions?" + new URLSearchParams({ path: f.original }));
    assert.equal(history.data.versions.length, 1);
    const id = history.data.versions[0].id;
    const query = new URLSearchParams({ path: f.original, id });
    const download = await api.request("/api/v1/drive/versions/download?" + query);
    assert.match(download.data.toString(), /First edition/);
    const archive = await api.request("/api/v1/drive/versions/archive?" + query);
    assert.equal(archive.status, 200);
    const zip = await JSZip.loadAsync(archive.data);
    assert.equal(await zip.file(f.asset).async("string"), "original image");
    assert.match(await zip.file(f.source).async("string"), /First evidence/);
    const restored = await api.request("/api/v1/drive/versions/restore", { path: f.original, id });
    assert.equal(restored.status, 202);
    await until(() => api.request(`/api/v1/jobs/${restored.data.id}`), (value) => value.data.status === "complete");
    assert.equal(calls, 1);
    const after = await api.request("/api/v1/maintenance-queue");
    assert.equal(after.data.items[0].stage, "distill");
    assert.equal(after.data.items[0].jobStatus, undefined);
    const current = await api.request("/api/v1/drive/versions?" + new URLSearchParams({ path: f.original }));
    assert.equal(current.data.current.number, 3);
    assert.equal(current.data.versions.length, 2);
  } finally { release(); await api.close(); }
});

test("version extraction failures remain visible and repairable", async (t) => {
  const f = await fixture(t);
  const api = await serverFor(f, async () => { throw new Error("Extractor unavailable"); });
  try {
    const pending = await upload(api, f);
    const job = await api.request(pending.route + "/complete", {});
    await until(() => api.request(`/api/v1/jobs/${job.data.id}`), (value) => value.data.status === "failed");
    const fm = parseFrontmatter(await fs.readFile(path.join(f.vault, f.source), "utf8"));
    assert.equal(fm.workflow_status, "needs-followup");
    assert.equal(fm.extraction_status, "failed");
    const queue = await api.request("/api/v1/maintenance-queue");
    assert.equal(queue.data.items[0].jobStatus, "failed");
    assert.match(queue.data.items[0].preview, /Extractor unavailable/);
    assert.equal((await api.request("/api/v1/drive/versions")).data.versions.length, 1);
  } finally { await api.close(); }
});

test("restart resumes a committed version without archiving or incrementing twice", async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  const relative = `.my-wiki/uploads/${id}-new.md`;
  const temporary = path.join(f.vault, relative);
  await fs.writeFile(temporary, "# New evidence");
  await updateDocumentVersion({ vault: f.vault, original: f.original, temporary, filename: "new.md", operationId: id });
  await writeVersionReceipt(f.vault, { id, original: f.original, temporary: relative, filename: "new.md" });
  const api = await serverFor(f, async () => extracted(f));
  try {
    await api.request("/api/v1/maintenance-queue");
    await until(() => api.request(`/api/v1/jobs/${id}`), (value) => value.data.status === "complete");
    const history = await api.request("/api/v1/drive/versions?" + new URLSearchParams({ path: f.original }));
    assert.equal(history.data.current.number, 2);
    assert.equal(history.data.versions.length, 1);
    await assert.rejects(fs.readFile(temporary), /ENOENT/);
    await assert.rejects(fs.readFile(path.join(f.vault, ".my-wiki/version-jobs", id + ".json")), /ENOENT/);
  } finally { await api.close(); }
});

async function htmlFixture(t) {
  const f = await fixture(t);
  const original = "references/originals/article.html";
  await fs.rename(path.join(f.vault, f.original), path.join(f.vault, original));
  await fs.writeFile(path.join(f.vault, original), "<html><body>Previous original article.</body></html>");
  const note = path.join(f.vault, f.source);
  await fs.writeFile(note, upsertFrontmatterValues(await fs.readFile(note, "utf8"), { snapshot_path: original, source_type: "webpage", source_url: "https://example.com/old", resource: "https://example.com/old" }));
  return { ...f, original };
}

test("HTML URL updates download before archiving, track progress, extract Markdown and preserve URL provenance", async (t) => {
  const f = await htmlFixture(t);
  const old = await fs.readFile(path.join(f.vault, f.original), "utf8");
  const body = '<html><script>secretScript()</script><body><h1>Updated article</h1><p>New readable evidence with enough substantive content for extraction.</p></body></html>';
  let release;
  let entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  const api = await serverFor(f, reextractSources, { htmlOriginalFetcher: async url => {
    assert.equal(url, "https://example.com/new"); entered = true; await gate;
    return { buffer: Buffer.from(body), url: "https://example.com/final" };
  } });
  try {
    const job = await api.request("/api/v1/drive/versions/url", { path: f.original, url: "https://example.com/new" });
    assert.equal(job.status, 202);
    await until(async () => entered, Boolean);
    assert.equal(await fs.readFile(path.join(f.vault, f.original), "utf8"), old);
    const queue = await api.request("/api/v1/maintenance-queue");
    assert.equal(queue.data.items.find(item => item.jobId === job.data.id).progress.phase, "fetching");
    assert.equal((await api.request("/api/v1/drive/versions/url", { path: f.original, url: "https://example.com/new" })).status, 409);
    release();
    const finished = await until(() => api.request(`/api/v1/jobs/${job.data.id}`), value => ["complete", "failed"].includes(value.data.status));
    assert.equal(finished.data.status, "complete", JSON.stringify(finished.data));
    const savedHtml = await fs.readFile(path.join(f.vault, f.original), "utf8");
    assert.match(savedHtml, /my-wiki-offline/);
    assert.match(savedHtml, /Updated article/);
    assert.doesNotMatch(savedHtml, /secretScript/);
    const document = await api.request("/api/v1/markdown?" + new URLSearchParams({ path: f.source }));
    assert.equal(document.status, 200);
    assert.match(document.data.body, /# Updated article/);
    assert.doesNotMatch(document.data.body, /<html>|secretScript/);
    const fm = parseFrontmatter(await fs.readFile(path.join(f.vault, f.source), "utf8"));
    assert.equal(fm.source_url, "https://example.com/final");
    assert.equal(fm.resource, fm.source_url);
    assert.equal(fm.extraction_method, "html-markdown");
    assert.equal((await api.request("/api/v1/maintenance-queue")).data.items[0].stage, "distill");
    const history = (await api.request("/api/v1/drive/versions")).data.versions;
    assert.equal(history.length, 1);
    const query = new URLSearchParams({ path: f.original, id: history[0].id });
    const zip = await JSZip.loadAsync((await api.request("/api/v1/drive/versions/archive?" + query)).data);
    assert.equal(await zip.file(f.original).async("string"), old);
    assert.equal(await zip.file(f.asset).async("string"), "original image");
    assert.equal(parseFrontmatter(await zip.file(f.source).async("string")).source_url, "https://example.com/old");
    const restored = await api.request("/api/v1/drive/versions/restore", { path: f.original, id: history[0].id });
    await until(() => api.request(`/api/v1/jobs/${restored.data.id}`), value => value.data.status === "complete");
    assert.equal(parseFrontmatter(await fs.readFile(path.join(f.vault, f.source), "utf8")).source_url, "https://example.com/old");
    assert.equal((await api.request("/api/v1/drive/versions?" + new URLSearchParams({path:f.original}))).data.current.number, 3);
  } finally { release(); await api.close(); }
});

test("failed HTML downloads preserve the current version and require authenticated public HTML URLs", async (t) => {
  const f = await htmlFixture(t);
  const original = await fs.readFile(path.join(f.vault, f.original), "utf8");
  const source = await fs.readFile(path.join(f.vault, f.source), "utf8");
  let calls = 0;
  const api = await serverFor(f, reextractSources, { htmlOriginalFetcher: async () => { calls++; throw new Error("Webpage HTTP 403"); } });
  try {
    assert.equal((await fetch(api.origin + "/api/v1/drive/versions/url", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({path:f.original,url:"https://example.com/new"}) })).status, 403);
    for (const url of ["", "http://127.0.0.1/private", "http://[::1]/", "https://user:pass@example.com", "file:///etc/passwd", "invalid"]) {
      assert.equal((await api.request("/api/v1/drive/versions/url", { path:f.original,url })).status, 400);
    }
    assert.equal((await api.request("/api/v1/drive/versions/url", {path:f.source,url:"https://example.com/new"})).status, 400);
    assert.equal(calls, 0);
    const job = await api.request("/api/v1/drive/versions/url", {path:f.original,url:"https://example.com/new"});
    const failed = await until(() => api.request(`/api/v1/jobs/${job.data.id}`), value => value.data.status === "failed");
    assert.match(failed.data.error, /403/);
    assert.equal(await fs.readFile(path.join(f.vault, f.original), "utf8"), original);
    assert.equal(await fs.readFile(path.join(f.vault, f.source), "utf8"), source);
    assert.equal((await api.request("/api/v1/drive/versions")).data.versions.length, 0);
    assert.equal((await api.request("/api/v1/maintenance-queue")).data.items[0].jobStatus, "failed");
  } finally { await api.close(); }
});

test("URL version receipts resume downloads and skip fetching an already committed replacement", async (t) => {
  const f = await htmlFixture(t);
  const id = randomUUID();
  const sourceUrl = "https://example.com/new";
  await writeVersionReceipt(f.vault, { id, original: f.original, filename: "article.html", sourceUrl });
  let fetched = 0;
  let api = await serverFor(f, reextractSources, { htmlOriginalFetcher: async () => {
    fetched++; return {url:sourceUrl,buffer:Buffer.from("<h1>Resumed article</h1><p>Fresh evidence after the restarted download, saved as a new version.</p>")};
  } });
  try {
    await api.request("/api/v1/maintenance-queue");
    await until(() => api.request(`/api/v1/jobs/${id}`), value => value.data.status === "complete");
    assert.equal(fetched, 1);
    assert.equal((await api.request("/api/v1/drive/versions?" + new URLSearchParams({path:f.original}))).data.current.number, 2);
  } finally { await api.close(); }
  await writeVersionReceipt(f.vault, {id,original:f.original,filename:"article.html",sourceUrl});
  api = await serverFor(f, reextractSources, {htmlOriginalFetcher:async () => {assert.fail("Committed versions must not be re-fetched");}});
  try {
    await api.request("/api/v1/maintenance-queue");
    await until(() => api.request(`/api/v1/jobs/${id}`), value => value.data.status === "complete");
    const history = (await api.request("/api/v1/drive/versions?" + new URLSearchParams({path:f.original}))).data;
    assert.equal(history.current.number, 2);
    assert.equal(history.versions.length, 1);
  } finally { await api.close(); }
});

test("verification-page URL updates never replace or archive the current evidence", async t => {
  const f = await htmlFixture(t);
  const original = await fs.readFile(path.join(f.vault,f.original));
  const source = await fs.readFile(path.join(f.vault,f.source));
  const api = await serverFor(f, async () => assert.fail("Verification pages must not enter extraction"), { htmlOriginalFetcher:async () => ({url:"https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha",buffer:Buffer.from("<p>环境异常</p><p>完成验证后即可继续访问</p><button>去验证</button>")}) });
  try {
    const job = await api.request("/api/v1/drive/versions/url",{path:f.original,url:"https://example.com/new"});
    assert.equal(job.status,202);
    const failed = await until(() => api.request(`/api/v1/jobs/${job.data.id}`), value => value.data.status === "failed");
    assert.match(failed.data.error,/验证码或安全验证页/);
    assert.deepEqual(await fs.readFile(path.join(f.vault,f.original)),original);
    assert.deepEqual(await fs.readFile(path.join(f.vault,f.source)),source);
    assert.equal((await api.request("/api/v1/drive/versions")).data.versions.length,0);
  } finally { await api.close(); }
});

test("maintenance queue follows current Reference versions even when both graph caches are stale", async t => {
  const f = await fixture(t);
  const file = path.join(f.vault,f.source);
  const graph = {vaultRoot:f.vault,nodes:[{id:f.source.slice(0,-3),path:f.source,title:"Old verification page",status:"needs-followup",preview:"Obsolete evidence"}],edges:[]};
  await fs.mkdir(path.join(f.dashboard,"public"));
  await fs.writeFile(path.join(f.dashboard,"public/wiki-graph.json"),JSON.stringify(graph));
  await fs.writeFile(path.join(f.vault,".my-wiki/dashboard-graph.json"),JSON.stringify(graph));
  const initial = await fs.readFile(file,"utf8");
  await fs.writeFile(file,upsertFrontmatterValues(initial,{document_version:"current-v3",workflow_status:"inbox",needs_followup:false}));
  const api = await serverFor(f,async () => assert.fail("Reading queue must not extract or maintain anything"));
  try {
    const queue = (await api.request("/api/v1/maintenance-queue")).data.items;
    assert.equal(queue.length,1);
    assert.equal(queue[0].documentVersion,"current-v3");
    assert.equal(queue[0].stage,"distill");
    assert.equal(queue[0].title,"Book");
    assert.match(queue[0].preview,/First evidence/);
    await fs.writeFile(file,upsertFrontmatterValues(initial,{document_version:"current-v3",workflow_status:"processed"}));
    assert.equal((await api.request("/api/v1/inbox")).data.items.length,0);
    const added = path.join(f.vault,"references/sources/new.md");
    await fs.writeFile(added,upsertFrontmatterValues(initial,{title:"New Reference",workflow_status:"needs-followup"}));
    const next = (await api.request("/api/v1/maintenance-queue")).data.items;
    assert.equal(next.length,1);
    assert.equal(next[0].title,"New Reference");
    assert.equal(next[0].stage,"repair");
    await fs.rm(added);
    assert.equal((await api.request("/api/v1/maintenance-queue")).data.items.length,0);
  } finally {await api.close();}
});

test("a new version supersedes old extraction failures without deleting current evidence", async t => {
  const f = await fixture(t);
  const api = await serverFor(f,async () => {throw new Error("Old version extraction failed");});
  try {
    const pending = await upload(api,f);
    const old = await api.request(pending.route+"/complete",{});
    await until(() => api.request(`/api/v1/jobs/${old.data.id}`),value => value.data.status === "failed");
    assert.equal((await api.request("/api/v1/maintenance-queue")).data.items[0].jobId,old.data.id);
    const temporary = path.join(f.root,"offline-new.md");
    await fs.writeFile(temporary,"# Valid new original\n\nRecovered readable evidence.");
    const version = await updateDocumentVersion({vault:f.vault,original:f.original,filename:"new.md",temporary});
    await extracted(f);
    const queue = (await api.request("/api/v1/maintenance-queue")).data.items;
    assert.equal(queue.length,1);
    assert.equal(queue[0].documentVersion,version.id);
    assert.equal(queue[0].stage,"distill");
    assert.equal(queue[0].jobId,undefined);
    assert.equal(queue[0].jobStatus,undefined);
    assert.match(await fs.readFile(path.join(f.vault,f.original),"utf8"),/Valid new original/);
    assert.equal((await api.request("/api/v1/drive/versions")).data.versions.length,2);
  } finally {await api.close();}
});

for (const action of ["distill","repair"]) test(`new document versions supersede failed ${action} tasks`, async t => {
  const f = await fixture(t);
  const file = path.join(f.vault,f.source);
  let body = (await fs.readFile(file,"utf8")).replace("First evidence.","Substantive readable content about an existing concept, preserved as document evidence.");
  if (action === "repair") body = body.replace("Substantive", "Substantive \uFFFD");
  await fs.writeFile(file,upsertFrontmatterValues(body,{document_version:"old-v1",extracted_characters:200,workflow_status:action === "repair" ? "needs-followup" : "inbox"}));
  const api = await serverFor(f,async () => {},{agentRunner:{info:async () => ({available:true,provider:"codex",label:"Codex",providers:[{provider:"codex",label:"Codex",models:[]}]}),run:async () => {throw new Error(`Old ${action} failure`);}}});
  try {
    const queued = await api.request(`/api/v1/agent/${action === "repair" ? "repair" : "maintenance"}`,{provider:"codex",...(action === "repair" ? {path:f.source} : {paths:[f.source]})});
    assert.equal(queued.status,202,JSON.stringify(queued.data));
    const failed = await until(() => api.request(`/api/v1/jobs/${queued.data.id}`),value => value.data.status === "failed");
    assert.match(failed.data.error,new RegExp(`Old ${action} failure`));
    assert.equal((await api.request("/api/v1/maintenance-queue")).data.items[0].jobId,queued.data.id);
    const temporary = path.join(f.root,"new.md");
    await fs.writeFile(temporary,"# Current version\n\nCurrent valid evidence for distillation.");
    const version = await updateDocumentVersion({vault:f.vault,original:f.original,filename:"new.md",temporary});
    await extracted(f);
    const queue = (await api.request("/api/v1/maintenance-queue")).data.items;
    assert.equal(queue.length,1);
    assert.equal(queue[0].stage,"distill");
    assert.equal(queue[0].documentVersion,version.id);
    assert.equal(queue[0].jobId,undefined);
    assert.equal(queue[0].jobStatus,undefined);
  } finally {await api.close();}
});

test("Dashboard prefers the newest valid graph for this vault across CLI and API outputs", async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.dashboard,"public"));
  const privateFile = path.join(f.vault,".my-wiki/dashboard-graph.json");
  const publicFile = path.join(f.dashboard,"public/wiki-graph.json");
  const graph = (name, vaultRoot=f.vault) => JSON.stringify({vaultRoot,generatedAt:name,nodes:[{id:`concepts/${name}`}],edges:[]});
  const stamp = async (file, seconds) => fs.utimes(file,seconds,seconds);
  await fs.writeFile(privateFile,graph("old-api"));await stamp(privateFile,100);
  await fs.writeFile(publicFile,graph("new-cli"));await stamp(publicFile,200);
  const api = await serverFor(f,async () => {});
  const current = async () => (await api.request("/api/v1/graph")).data.nodes[0].id;
  try {
    assert.equal(await current(),"concepts/new-cli");
    await fs.writeFile(privateFile,graph("new-api"));await stamp(privateFile,300);
    assert.equal(await current(),"concepts/new-api");
    await fs.writeFile(publicFile,graph("private-other-vault",path.join(f.root,"another-vault")));await stamp(publicFile,400);
    assert.equal(await current(),"concepts/new-api");
    await fs.writeFile(publicFile,"broken json");await stamp(publicFile,500);
    assert.equal(await current(),"concepts/new-api");
  } finally {await api.close();}
});
