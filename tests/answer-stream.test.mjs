import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createAnswerDecoder, runOpenCodeStream } from "../scripts/core/opencode-stream.mjs";
import { readAnswerEvents } from "../assets/dashboard/src/answer-events.js";
import { createDashboardApi } from "../scripts/core/dashboard-api.mjs";
import { createLocalAgentRunner } from "../scripts/core/agent-service.mjs";

test("answer decoder streams only the root answer string with JSON escaping intact", () => {
  const values = [];
  const decode = createAnswerDecoder((text) => values.push(text));
  const answer = '中文\n| A | B |\nA "quote", backslash \\ and Unicode \u{1f680}';
  const json = JSON.stringify({ sources: [{ answerMarkdown: "do not render" }], answerMarkdown: answer, images: [{ caption: "secret metadata" }] });
  for (const character of '```json\n' + json + '\n```') decode(character);
  assert.equal(values.at(-1), answer);
  assert.ok(values.length > 10);
  assert.ok(values.every((text) => answer.startsWith(text)));
  assert.ok(!values.some((text) => /metadata|do not render/.test(text)));
  const invalid = [];
  createAnswerDecoder((text) => invalid.push(text))('log: {"answerMarkdown":"not an answer"}');
  assert.deepEqual(invalid, []);
});

test("SSE framing handles byte splits, CRLF, comments and multi-line data", async () => {
  const payload = ': heartbeat\r\nevent: delta\r\ndata: {"text":\r\ndata: "中文"}\r\n\r\n';
  const bytes = new TextEncoder().encode(payload);
  const events = [];
  await readAnswerEvents(new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } })), (type, data) => events.push({ type, data }));
  assert.deepEqual(events, [{ type: "delta", data: { text: "中文" } }]);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mywiki-stream-test-"));
  const vault = path.join(root, "vault");
  const dashboard = path.join(root, "dashboard");
  for (const folder of ["concepts", "references/sources", "references/assets", ".my-wiki"]) await mkdir(path.join(vault, folder), { recursive: true });
  await mkdir(dashboard);
  await writeFile(path.join(dashboard, ".my-wiki-runtime.json"), JSON.stringify({ vault }));
  await writeFile(path.join(vault, "concepts/example.md"), '---\ntitle: Example\ntype: Concept\nuniverses: [AI]\n---\n# Example\n');
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return { root, vault, dashboard };
}

test("authenticated answer stream delivers before completion, reconnects and cancels without duplicate jobs", async (t) => {
  const { vault, dashboard } = await fixture(t);
  let options;
  let finish;
  const api = createDashboardApi({ dashboardRoot: dashboard, port: 0, agentRunner: {
    info: async () => ({ available: true, provider: "opencode", label: "OpenCode", providers: [{ provider: "opencode", label: "OpenCode", defaultModel: "test/model", models: [{ id: "test/model", label: "Test" }] }] }),
    run: async (input) => {
      options = input;
      return new Promise((resolve, reject) => {
        finish = resolve;
        input.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    }
  } });
  const server = http.createServer(api);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(base + "/api/v1/session")).json();
  const headers = { "x-my-wiki-token": token, "content-type": "application/json" };
  const ask = async () => {
    options = null;
    const response = await fetch(base + "/api/v1/agent/ask", { method: "POST", headers, body: JSON.stringify({ question: "Explain", provider: "opencode", model: "test/model", conversationId: "conversation_stream" }) });
    assert.equal(response.status, 202);
    const job = await response.json();
    for (let attempt = 0; attempt < 100 && !options; attempt++) await delay(10);
    assert.ok(options);
    return job;
  };
  const job = await ask();
  const eventsUrl = base + `/api/v1/jobs/${job.id}/events`;
  assert.equal((await fetch(eventsUrl)).status, 403);
  assert.equal((await fetch(base + "/api/v1/jobs/missing/events", { headers })).status, 404);
  const controller = new AbortController();
  const response = await fetch(eventsUrl, { headers, signal: controller.signal });
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const events = [];
  const reading = readAnswerEvents(response, (type, data) => events.push({ type, data })).catch(() => {});
  options.onEvent({ type: "text", text: "First paragraph" });
  options.onEvent({ type: "status", phase: "reading" });
  for (let attempt = 0; attempt < 100 && !events.some((e) => e.type === "delta"); attempt++) await delay(10);
  assert.equal(events.find((e) => e.type === "delta").data.delta, "First paragraph");
  assert.ok(!events.some((e) => e.type === "done"));
  assert.equal((await (await fetch(base + `/api/v1/jobs/${job.id}`, { headers })).json()).status, "running");
  controller.abort();
  await reading;
  assert.equal(options.signal.aborted, false);
  const resumed = [];
  const resumedReading = readAnswerEvents(await fetch(eventsUrl, { headers }), (type, data) => resumed.push({ type, data }));
  options.onEvent({ type: "text", text: "Replacement draft" });
  finish({ answerMarkdown: "Validated final answer", sources: [], images: [] });
  await resumedReading;
  assert.equal(resumed[0].data.text, "First paragraph");
  assert.equal(resumed.find((e) => e.type === "reset").data.text, "Replacement draft");
  assert.equal(resumed.filter((e) => e.type === "done").length, 1);
  assert.equal(resumed.at(-1).data.status, "complete");
  assert.equal(resumed.at(-1).data.result.answerMarkdown, "Validated final answer");
  const cancelled = await ask();
  options.onEvent({ type: "text", text: "Credentials sk-secret" });
  const redacted = await (await fetch(base + `/api/v1/jobs/${cancelled.id}`, { headers })).json();
  assert.equal(redacted.stream.text, "Credentials [redacted]");
  options.onEvent({ type: "text", text: "Keep this incomplete draft" });
  const cancelEvents = [];
  const cancelRead = readAnswerEvents(await fetch(base + `/api/v1/jobs/${cancelled.id}/events`, { headers }), (type, data) => cancelEvents.push({ type, data }));
  await fetch(base + `/api/v1/agent/query?job=${cancelled.id}`, { method: "DELETE", headers });
  options.onEvent({ type: "text", text: "Must not appear after cancellation" });
  await cancelRead;
  assert.equal(cancelEvents.at(-1).data.status, "cancelled");
  assert.equal(cancelEvents.at(-1).data.stream.text, "Keep this incomplete draft");
  assert.equal(options.signal.aborted, true);
  assert.ok(!JSON.stringify(cancelEvents).includes("Must not appear"));
  assert.ok(vault);
});

test("Viki preserves streamed answers without greeting exceptions or post-answer evidence checks", async (t) => {
  const { vault, dashboard } = await fixture(t);
  await writeFile(path.join(vault, "concepts/math.md"), '---\ntitle: Math\ntype: Concept\nuniverses: [Math]\n---\n# Math\n');
  await writeFile(path.join(vault, "concepts/hidden.md"), '---\ntitle: Hidden\ntype: Concept\nuniverses: [FlexSim]\n---\n# Hidden\n');
  let runOptions, finish;
  const runner = (provider) => ({
    info: async () => ({ available: true, provider, label: provider, providers: [{ provider, label: provider, models: [] }] }),
    run: async (options) => { runOptions = options; return new Promise((resolve) => { finish = resolve; }); }
  });
  const server = http.createServer(createDashboardApi({ dashboardRoot: dashboard, port: 0,
    agentRunner: runner("opencode"), vikiApiRunner: runner("deepseek-api") }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(base + "/api/v1/session")).json();
  const headers = { "x-my-wiki-token": token, "content-type": "application/json" };
  await fetch(base + "/api/v1/universes/visibility", { method: "POST", headers, body: JSON.stringify({ name: "FlexSim", hidden: true }) });
  for (const provider of ["opencode", "deepseek-api"]) {
    for (const scenario of [
      { question: "hi", answer: "你好！" },
      { question: "你好，Viki！", answer: "你好！今天想聊些什么？" },
      { question: "谢谢你", answer: "不客气！", webSearch: true },
      { question: "你好，请解释 FlexSim 的 Dashboard", answer: "General background is not vault evidence." },
      { question: "你好", answer: "The model's answer stays intact.", sources: [{ path: "concepts/hidden.md", title: "Hidden" }] },
      { question: "你好", answer: "Image claims do not replace text.", images: [{ path: "references/assets/hidden.png", caption: "Hidden" }] }
    ]) {
      runOptions = null;
      const response = await fetch(base + "/api/v1/agent/ask", { method: "POST", headers, body: JSON.stringify({
        question: scenario.question, provider, galaxies: ["AI", "Math"], language: "zh", webSearch: !!scenario.webSearch,
        history: [{ role: "assistant", content: "Earlier unsupported claim about a hidden galaxy." }]
      }) });
      assert.equal(response.status, 202);
      const job = await response.json();
      assert.equal(job.meta.allGalaxies, false, "All visible galaxies still exclude the hidden galaxy");
      for (let attempt = 0; attempt < 100 && !runOptions; attempt++) await delay(10);
      assert.ok(runOptions);
      const events = [];
      const reading = readAnswerEvents(await fetch(base + `/api/v1/jobs/${job.id}/events`, { headers, signal: AbortSignal.timeout(10000) }), (type, data) => events.push({ type, data }));
      runOptions.onEvent({ type: "text", text: scenario.answer });
      for (let attempt = 0; attempt < 100 && !events.some((event) => event.type === "delta"); attempt++) await delay(10);
      assert.equal(events.find((event) => event.type === "delta")?.data.delta, scenario.answer);
      finish({ answerMarkdown: scenario.answer, sources: scenario.sources || [], images: scenario.images || [] });
      await reading;
      const completed = events.at(-1).data;
      assert.equal(completed.status, "complete");
      assert.equal(completed.result.answerMarkdown, scenario.answer);
      assert.equal(completed.result.sources.length, scenario.sources?.length || 0);
      assert.equal(completed.result.images.length, scenario.images?.length || 0);
      assert.equal(runOptions.requiresEvidence, undefined);
      assert.equal(runOptions.scopedQuery, true);
      assert.doesNotMatch(runOptions.prompt, /social reply|Earlier unsupported claim/);
      assert.deepEqual(runOptions.history, []);
      assert.ok(completed.result.contextReceipt.signature);
      assert.ok(!events.some((event) => event.data.phase === "validating"));
    }
  }
});

const fakeServer = `
import http from 'node:http';
import fs from 'node:fs';
if(process.argv.includes('--version')){console.log('1.18');process.exit(0);}
if(process.argv.includes('debug')){console.log(JSON.stringify({model:'test/model'}));process.exit(0);}
if(process.env.FAKE_START_FAILURE)process.exit(1);
const clients=new Set(); let complete=false; let aborted=false;
const answer=JSON.stringify({answerMarkdown:'First paragraph\\n\\nFinal paragraph',sources:[],images:[]});
function emit(type,properties){for(const res of clients)res.write('data: '+JSON.stringify({type,properties})+'\\n\\n');}
const server=http.createServer(async(req,res)=>{
 if(req.headers.authorization!=='Basic '+Buffer.from('opencode:'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64')){res.writeHead(401);res.end();return;}
 const route=new URL(req.url,'http://localhost').pathname;
 const json=(data)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
 if(route==='/session'&&req.method==='POST')return json({id:'session_test'});
 if(route==='/session/status')return json(complete?{}:{session_test:{type:'busy'}});
 if(route==='/event'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': connected\\n\\n');clients.add(res);res.on('close',()=>clients.delete(res));return;}
 if(route.endsWith('/prompt_async')){
   let body='';for await(const chunk of req)body+=chunk;
   if(JSON.parse(body).model.modelID!=='model')throw Error('model lost');
   if(process.env.CAPTURE_CONFIG)fs.writeFileSync(process.env.CAPTURE_CONFIG,JSON.stringify({agent:JSON.parse(body).agent,config:JSON.parse(process.env.OPENCODE_CONFIG_CONTENT)}));
   res.writeHead(204);res.end();
   const messageID='assistant_one',sessionID='session_test';
   if(process.env.FAKE_SESSION_ERROR){emit('session.error',{sessionID,error:{name:'APIError',data:{message:'Quota fixture'}}});return;}
   emit('message.updated',{info:{id:messageID,sessionID,role:'assistant'}});
   emit('message.part.updated',{part:{id:'reason',messageID,sessionID,type:'reasoning',text:'private thought'}});
   emit('message.part.delta',{partID:'reason',messageID,sessionID,field:'text',delta:'hidden reasoning'});
   emit('message.part.updated',{part:{id:'tool',messageID,sessionID,type:'tool',tool:'read',state:{status:'running'}}});
   emit('message.part.updated',{part:{id:'text',messageID,sessionID,type:'text',text:''}});
   emit('message.part.delta',{partID:'text',messageID,sessionID:'other_session',field:'text',delta:'foreign'});
   const split=answer.indexOf('Final');
   emit('message.part.delta',{partID:'text',messageID,sessionID,field:'text',delta:answer.slice(0,split)});
   if(process.env.FAKE_DISCONNECT)for(const response of clients)response.end();
   if(process.env.FAKE_HANG)return;
   setTimeout(()=>{if(aborted)return;emit('message.part.delta',{partID:'text',messageID,sessionID,field:'text',delta:answer.slice(split)});emit('message.part.updated',{part:{id:'text',messageID,sessionID,type:'text',text:answer}});complete=true;},500);
   return;
 }
 if(route.endsWith('/message'))return json([{info:{id:'assistant_one',role:'assistant',time:complete?{completed:1}:{},finish:complete?'stop':undefined},parts:[{type:'text',text:answer}]}]);
 if(route.endsWith('/abort')){aborted=true;return json(true);}
 if(req.method==='DELETE')return json(true);
 res.writeHead(404);res.end();
});
server.listen(0,'127.0.0.1',()=>console.log('opencode server listening on http://127.0.0.1:'+server.address().port));
`;

test("OpenCode Viki uses agent-level read-only permissions after global config merge", async (t) => {
  const { root, vault } = await fixture(t);
  const command = path.join(root, "opencode.mjs");
  const captured = path.join(root, "captured.json");
  await writeFile(command, fakeServer);
  const runner = createLocalAgentRunner({ env: {
    ...process.env, MY_WIKI_AGENT_COMMAND: command, MY_WIKI_AGENT_PROVIDER: "opencode",
    MY_WIKI_OPENCODE_MODEL: "test/model", MY_WIKI_OPENCODE_PROVIDER: "test", CAPTURE_CONFIG: captured
  } });
  for (const allowWeb of [false, true]) {
    const result = await runner.run({ provider: "opencode", model: "test/model", vault, mode: "query", prompt: "Test", schema: {}, allowWeb, onEvent() {} });
    assert.match(result.answerMarkdown, /Final paragraph/);
    const { agent, config } = JSON.parse(await readFile(captured, "utf8"));
    assert.equal(agent, "my-wiki-viki");
    const permission = config.agent[agent].permission;
    assert.equal(Object.keys(permission)[0], "*");
    assert.equal(permission["*"], "deny");
    for (const tool of ["read", "glob", "grep", "list"]) assert.equal(permission[tool], "allow");
    for (const tool of ["edit", "bash", "task", "external_directory", "question"]) assert.equal(permission[tool], "deny");
    assert.equal(permission.websearch, allowWeb ? "allow" : "deny");
    assert.equal(permission.webfetch, allowWeb ? "allow" : "deny");
    assert.equal(config.share, "disabled");
  }
});

test("OpenCode transport recovers final output after an event disconnect and bounds failures", async (t) => {
  const { root, vault } = await fixture(t);
  const file = path.join(root, "server.mjs");
  await writeFile(file, fakeServer);
  const common = { command: process.execPath, args: [file], cwd: vault, prompt: "Test", model: "test/model", timeoutMs: 10000, onEvent() {}, terminate: (child, signal) => child.kill(signal) };
  const result = await runOpenCodeStream({ ...common, env: { ...process.env, FAKE_DISCONNECT: "1" } });
  assert.equal(JSON.parse(result).answerMarkdown, "First paragraph\n\nFinal paragraph");
  await assert.rejects(runOpenCodeStream({ ...common, env: { ...process.env, FAKE_SESSION_ERROR: "1" } }), /Quota fixture/);
  await assert.rejects(runOpenCodeStream({ ...common, env: { ...process.env, FAKE_START_FAILURE: "1" } }), /startup/);
  await assert.rejects(runOpenCodeStream({ ...common, timeoutMs: 300, env: { ...process.env, FAKE_HANG: "1" } }), /timed out/);
});
test("OpenCode Server adapter filters private events, streams JSON text, and kills its managed server", async (t) => {
  const { root, vault } = await fixture(t);
  const file = path.join(root, "server.mjs");
  await writeFile(file, fakeServer);
  const events = [];
  const killed = [];
  const result = await runOpenCodeStream({
    command: process.execPath, args: [file], cwd: vault, env: { ...process.env },
    prompt: "Test", model: "test/model", timeoutMs: 15000,
    onEvent: (event) => events.push(event),
    terminate: (child, signal) => { killed.push(child); child.kill(signal); }
  });
  assert.equal(JSON.parse(result).answerMarkdown, "First paragraph\n\nFinal paragraph");
  assert.ok(events.some((event) => event.type === "text" && event.text === "First paragraph\n\n"));
  assert.equal(events.filter((event) => event.text === "First paragraph\n\nFinal paragraph").length, 1);
  assert.ok(!/private thought|hidden reasoning|foreign/.test(JSON.stringify(events)));
  assert.ok(killed.length);
  assert.ok(killed[0].signalCode || killed[0].exitCode !== null);
  const controller = new AbortController();
  await assert.rejects(runOpenCodeStream({
    command: process.execPath, args: [file], cwd: vault, env: { ...process.env, FAKE_HANG: "1" },
    prompt: "Cancel", model: "test/model", timeoutMs: 15000, signal: controller.signal,
    onEvent: (event) => { if (event.type === "text" && event.text) controller.abort(); },
    terminate: (child, signal) => child.kill(signal)
  }), /cancelled/);
});
