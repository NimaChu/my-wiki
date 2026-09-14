import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVikiApiRunner } from "../scripts/core/viki-api-agent.mjs";
import { createVikiRetrieval } from "../scripts/core/viki-retrieval.mjs";
import { normalizeDashboardAgentPreferences } from "../scripts/core/dashboard-agent-preferences.mjs";
import { isPublicVikiAddress, validateVikiWebUrl } from "../scripts/core/viki-web-tools.mjs";

const env = { DEEPSEEK_API_KEY: "test-only-not-a-key", MY_WIKI_PROVIDERS_FILE: path.join(os.tmpdir(), "missing-mywiki-test-config.json") };
const final = { answerMarkdown: "Verified answer", sources: [{ path: "concepts/allowed.md", title: "Allowed" }], images: [] };
function stream(chunks, done = true) {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : ""), { headers: { "content-type": "text/event-stream" } });
}
const finalStream = () => stream([
  { choices: [{ delta: { reasoning_content: "private reasoning" } }] },
  { choices: [{ delta: { content: '{"answerMarkdown":"Verified ' } }] },
  { choices: [{ delta: { content: 'answer","sources":[{"path":"concepts/allowed.md","title":"Allowed"}],"images":[]' } }] },
  { choices: [{ delta: { content: "}" }, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } }
]);
function retrieval() {
  return { search: () => [{ path: "concepts/allowed.md", title: "Allowed" }],
    read: async (file) => { assert.equal(file, "concepts/allowed.md"); return { path: file, content: "Verified source", images: [] }; },
    inspectImage: async () => { throw new Error("outside scope"); } };
}
const args = () => ({ model: "deepseek-flash", prompt: "Read-only query", schema: {}, question: "Explain", retrieval: retrieval(), allowWeb: false });

test("API answer streams text, hides reasoning, records usage and keeps credentials server-side", async () => {
  const events = [];
  const runner = createVikiApiRunner({ env, fetcher: async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(init.headers.authorization, "Bearer test-only-not-a-key");
    const body = JSON.parse(init.body);
    assert.equal(body.stream, true);
    assert.equal(body.reasoning_effort, "high");
    assert.ok(!body.tools.some((tool) => tool.function.name.includes("web")));
    return finalStream();
  } });
  assert.deepEqual(await runner.run({ ...args(), onEvent: (event) => events.push(event) }), final);
  assert.ok(events.some((event) => event.text === "Verified "));
  assert.ok(!JSON.stringify(events).includes("private reasoning"));
  assert.ok(!JSON.stringify(await runner.info()).includes(env.DEEPSEEK_API_KEY));
  assert.equal(events.at(-1).metrics.usage.totalTokens, 50);
});

test("API treats greetings like other messages and preserves answers with no citations", async () => {
  const answer = { answerMarkdown: "你好！", sources: [], images: [] };
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.tools.some((tool) => tool.function.name === "read_documents"));
    assert.equal(body.tool_choice, "auto");
    return stream([{ choices: [{ delta: { content: JSON.stringify(answer) }, finish_reason: "stop" }] }]);
  } });
  const result = await runner.run({ ...args(), question: "你好", allowWeb: true });
  assert.deepEqual(result, answer);
});

test("native tool loop validates tools and paths, preserves reasoning only upstream, and gates web access", async () => {
  let calls = 0;
  let webCalls = 0;
  const runner = createVikiApiRunner({ env, searchWeb: async () => { webCalls++; }, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++calls === 1) return stream([{ choices: [{ delta: {
      reasoning_content: "internal trace", tool_calls: [
        { index: 0, id: "one", function: { name: "read_documents", arguments: '{"paths":["../secret.md"]}' } },
        { index: 1, id: "two", function: { name: "search_web", arguments: '{"query":"test"}' } }
      ] }, finish_reason: "tool_calls" }] }]);
    const assistant = body.messages.find((message) => message.tool_calls);
    assert.equal(assistant.reasoning_content, "internal trace");
    const toolMessages = body.messages.filter((message) => message.role === "tool");
    assert.equal(toolMessages.length, 2);
    assert.ok(toolMessages.every((message) => JSON.parse(message.content).error));
    return finalStream();
  } });
  await runner.run(args());
  assert.equal(calls, 2);
  assert.equal(webCalls, 0);
});

test("API handles truncated streams, quota errors, cancellation, and bounded tool loops", async () => {
  await assert.rejects(createVikiApiRunner({ env, fetcher: async () => stream([{ choices: [{ delta: { content: '{"answerMarkdown":"Partial' } }] }], false) }).run(args()), /disconnected/);
  await assert.rejects(createVikiApiRunner({ env, fetcher: async () => new Response("private detail", { status: 402 }) }).run(args()), /insufficient balance/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createVikiApiRunner({ env, fetcher: async () => { throw new Error("must not call"); } }).run({ ...args(), signal: controller.signal }), /cancelled/);
  let calls = 0;
  await assert.rejects(createVikiApiRunner({ env, fetcher: async (_url, init) => {
    calls++;
    if (calls >= 4) {
      const body = JSON.parse(init.body);
      assert.equal(body.tools, undefined);
      assert.equal(body.tool_choice, undefined);
      assert.deepEqual(body.response_format, { type: "json_object" });
    }
    return stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: `call${calls}`, function: { name: "search_knowledge", arguments: '{"query":"repeat"}' } }] }, finish_reason: "tool_calls" }] }]);
  } }).run(args()), /DeepSeek API.*answer JSON/);
  assert.equal(calls, 5);
});

const toolStream = (id, name = "read_documents", argumentsText = '{"paths":["concepts/allowed.md"]}') => stream([
  { choices: [{ delta: { reasoning_content: "private tool reasoning", tool_calls: [
    { index: 0, id, function: { name, arguments: argumentsText } }
  ] }, finish_reason: "tool_calls" }] }
]);
// The provider emitted this control syntax as ordinary content in the failing live turn.
const leakedDsml = '<\uff5c\uff5cDSML\uff5c\uff5c calls>\n<\uff5c\uff5cDSML\uff5c\uff5c invoke name="read_knowledge">\n<\uff5c\uff5cDSML\uff5c\uff5c parameter name="path" string="true">concepts/private.md</\uff5c\uff5cDSML\uff5c\uff5c parameter>\n</\uff5c\uff5cDSML\uff5c\uff5c invoke>\n</\uff5c\uff5cDSML\uff5c\uff5c calls>';
const contentStream = (content) => stream([{ choices: [{ delta: { content }, finish_reason: "stop" }] }]);

test("API finalizes from scoped evidence and images without replaying tools or reasoning", async () => {
  let calls = 0;
  let reads = 0;
  const events = [];
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    calls++;
    if (calls <= 3) {
      assert.equal(body.tool_choice, "auto");
      assert.equal(body.response_format, undefined);
      return calls === 2 ? toolStream("image", "inspect_image", '{"path":"references/assets/panel.png"}') : toolStream(`read-${calls}`);
    }
    assert.equal(calls, 4);
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.ok(body.messages.every((message) => ["system", "user"].includes(message.role)));
    const context = JSON.stringify(body.messages);
    assert.ok(!context.includes("private tool reasoning"));
    assert.ok(!context.includes("tool_call_id"));
    assert.match(body.messages[0].content, /Verified prior conversation/);
    assert.match(body.messages[0].content, /No tools are available/);
    assert.match(body.messages[1].content, /Current question: Explain/);
    assert.match(context, /concepts\/allowed.md/);
    assert.match(context, /Evidence page 3/);
    assert.match(context, /data:image\/png;base64,dGVzdA==/);
    return finalStream();
  } });
  const result = await runner.run({ ...args(), prompt: "Verified prior conversation", onEvent: (event) => events.push(event),
    retrieval: { ...retrieval(), read: async (file) => ({ path: file, content: `Evidence page ${++reads}` }),
      inspectImage: async (file) => ({ path: file, dataUrl: "data:image/png;base64,dGVzdA==" }) } });
  assert.deepEqual(result, final);
  assert.equal(reads, 3);
  assert.equal(events.at(-1).metrics.rounds, 4);
  assert.equal(events.at(-1).metrics.toolCalls, 3);
  assert.equal(events.at(-1).metrics.finalizationAttempts, 1);
});

test("API recovers fourth-round DSML text once, without executing or replaying it", async () => {
  let calls = 0;
  let searches = 0;
  const events = [];
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    calls++;
    if (calls <= 3) return toolStream(`search-${calls}`, "search_knowledge", '{"query":"MCP CLI"}');
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.ok(!JSON.stringify(body.messages).includes("DSML"));
    assert.ok(!JSON.stringify(body.messages).includes("concepts/private.md"));
    if (calls === 4) return contentStream(leakedDsml);
    assert.equal(calls, 5);
    assert.match(body.messages.at(-1).content, /previous completion/);
    return finalStream();
  } });
  const result = await runner.run({ ...args(), onEvent: (event) => events.push(event),
    retrieval: { ...retrieval(), search: () => { searches++; return [{ path: "concepts/allowed.md" }]; } } });
  assert.deepEqual(result, final);
  assert.equal(searches, 4);
  assert.equal(events.at(-1).metrics.toolCalls, 3);
  assert.equal(events.at(-1).metrics.finalizationAttempts, 2);
  assert.ok(!JSON.stringify(events).includes("DSML"));
});

test("early malformed API completions use tool-free JSON finalization, not content replacement", async (t) => {
  for (const content of [leakedDsml, "", "Plain Markdown answer", "{}", '{"answerMarkdown":""}', '{"answerMarkdown":"bad\\escape"}']) {
    await t.test(`format ${JSON.stringify(content).slice(0, 45)}`, async () => {
      let calls = 0;
      const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
        const body = JSON.parse(init.body);
        if (++calls === 1) return contentStream(content);
        assert.equal(calls, 2);
        assert.equal(body.tools, undefined);
        assert.deepEqual(body.response_format, { type: "json_object" });
        return finalStream();
      } });
      assert.deepEqual(await runner.run(args()), final);
    });
  }
});

test("failed API finalization is bounded, reports the provider, and never exposes raw output", async () => {
  let calls = 0;
  const runner = createVikiApiRunner({ env, fetcher: async () => {
    calls++;
    return contentStream(leakedDsml);
  } });
  await assert.rejects(runner.run(args()), (error) => {
    assert.match(error.message, /DeepSeek API.*answer JSON/);
    assert.doesNotMatch(error.message, /local agent|private.md|DSML/);
    return true;
  });
  assert.equal(calls, 3);
});

test("finalization can return no citations and resets provisional text on format recovery", async () => {
  let calls = 0;
  const events = [];
  const answer = { answerMarkdown: "General background, not a claim from the vault", sources: [], images: [] };
  const runner = createVikiApiRunner({ env, fetcher: async () => {
    if (++calls <= 3) return toolStream(`read-${calls}`);
    if (calls === 4) return contentStream('{"answerMarkdown":"Unfinished draft",');
    return contentStream(JSON.stringify(answer));
  } });
  assert.deepEqual(await runner.run({ ...args(), onEvent: (event) => events.push(event) }), answer);
  const textEvents = events.filter((event) => event.type === "text");
  const draftIndex = textEvents.findIndex((event) => event.text === "Unfinished draft");
  assert.ok(draftIndex >= 0);
  assert.equal(textEvents[draftIndex + 1].text, "");
  assert.equal(textEvents.at(-1).text, answer.answerMarkdown);
});

test("finalization does not retry HTTP errors, disconnections, length limits, or cancellation", async (t) => {
  const cases = [
    ["HTTP", () => new Response("Private server error", { status: 429 }), /rate limited/],
    ["disconnect", () => stream([{ choices: [{ delta: { content: '{"answerMarkdown":"Partial' } }] }], false), /disconnected/],
    ["length", () => stream([{ choices: [{ delta: { content: "{}" }, finish_reason: "length" }] }]), /output limit/],
    ["empty", () => contentStream(""), /answer JSON/]
  ];
  for (const [name, response, pattern] of cases) await t.test(name, async () => {
    let calls = 0;
    const runner = createVikiApiRunner({ env, fetcher: async () => ++calls === 1 ? contentStream(leakedDsml) : response() });
    await assert.rejects(runner.run(args()), pattern);
    assert.equal(calls, name === "empty" ? 3 : 2);
  });
  await t.test("cancel during finalization", async () => {
    let calls = 0;
    const controller = new AbortController();
    const runner = createVikiApiRunner({ env, fetcher: async () => {
      if (++calls === 1) return contentStream(leakedDsml);
      controller.abort();
      return contentStream(leakedDsml);
    } });
    await assert.rejects(runner.run({ ...args(), signal: controller.signal }), /cancelled/);
    assert.equal(calls, 2);
  });
});

test("API attaches vision after tool results and only exposes web tools when enabled", async () => {
  let calls = 0;
  const webCalls = [];
  const runner = createVikiApiRunner({ env,
    searchWeb: async (query) => { webCalls.push(query); return { content: "Public evidence" }; },
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.ok(body.tools.some((tool) => tool.function.name === "search_web"));
      if (++calls === 1) return stream([{ choices: [{ delta: { tool_calls: [
        { index: 0, id: "image", function: { name: "inspect_image", arguments: '{"path":"references/assets/panel.png"}' } },
        { index: 1, id: "web", function: { name: "search_web", arguments: '{"query":"public test"}' } }
      ] }, finish_reason: "tool_calls" }] }]);
      const tail = body.messages.slice(-3);
      assert.deepEqual(tail.map((message) => message.role), ["tool", "tool", "user"]);
      assert.equal(tail[2].content[1].image_url.url, "data:image/png;base64,dGVzdA==");
      return finalStream();
    }
  });
  const events = [];
  await runner.run({ ...args(), allowWeb: true, retrieval: { ...retrieval(),
    inspectImage: async (file) => ({ path: file, dataUrl: "data:image/png;base64,dGVzdA==" }) }, onEvent: (event) => events.push(event) });
  assert.deepEqual(webCalls, ["public test"]);
  assert.ok(!JSON.stringify(events).includes("data:image"));
  await createVikiApiRunner({ env, fetcher: async (_url, init) => {
    assert.ok(!JSON.parse(init.body).tools.some((tool) => tool.function.name === "inspect_image"));
    return finalStream();
  } }).run({ ...args(), model: "deepseek-v4-pro" });
});

test("pausing an active API request aborts the upstream request without retrying", async () => {
  const controller = new AbortController();
  let calls = 0;
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    calls++;
    queueMicrotask(() => controller.abort());
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  await assert.rejects(runner.run({ ...args(), signal: controller.signal }), /cancelled/);
  assert.equal(calls, 1);
});

test("retrieval enforces path/symlink scope, paginates references and only exposes referenced images", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "viki-retrieval-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const vault = path.join(root, "vault");
  await mkdir(path.join(vault, "concepts"), { recursive: true });
  await mkdir(path.join(vault, "references/assets"), { recursive: true });
  await writeFile(path.join(vault, "concepts/allowed.md"), "# 星环试点 Aurora\n" + "Evidence\n".repeat(300));
  await writeFile(path.join(vault, "concepts/hidden.md"), "Private token NEVER_RETURN_923");
  await writeFile(path.join(vault, "references/assets/panel.png"), Buffer.from([137, 80, 78, 71]));
  const nodes = [
    { path: "concepts/allowed.md", title: "星环试点 Aurora", content: "Six teams, eight weeks", aliases: ["星环"] },
    { path: "concepts/hidden.md", title: "Private hidden galaxy", content: "NEVER_RETURN_923" }
  ];
  const scoped = await createVikiRetrieval({ vault, nodes, allowedPaths: new Set(["concepts/allowed.md"]), imagePaths: () => ["references/assets/panel.png"] });
  assert.equal(scoped.search("星环试点有哪些阶段")[0].path, "concepts/allowed.md");
  assert.equal(scoped.search("NEVER_RETURN_923").length, 0);
  await assert.rejects(scoped.read("concepts/hidden.md"), /scope/);
  await assert.rejects(scoped.read("../secret"), /scope/);
  await assert.rejects(scoped.inspectImage("references/assets/panel.png"), /not referenced/);
  const page = await scoped.read("concepts/allowed.md", 250, 10);
  assert.equal(page.startLine, 250);
  assert.equal(page.truncated, true);
  assert.match((await scoped.inspectImage("references/assets/panel.png")).dataUrl, /^data:image\/png;base64,/);
  if (process.platform !== "win32") {
    await writeFile(path.join(root, "outside.md"), "Outside");
    await rm(path.join(vault, "concepts/allowed.md"));
    await symlink(path.join(root, "outside.md"), path.join(vault, "concepts/allowed.md"));
    await assert.rejects(scoped.read("concepts/allowed.md"), /scope/);
  }
});

test("API selections persist only for Viki; local-network web targets remain blocked", () => {
  const value = normalizeDashboardAgentPreferences({ viki: { provider: "deepseek-api", models: { "deepseek-api": "deepseek-flash" } }, queue: { repair: { provider: "deepseek-api" }, distill: { provider: "opencode", model: "test/model" } } });
  assert.equal(value.viki.provider, "deepseek-api");
  assert.equal(value.queue.repair.provider, "");
  assert.equal(value.queue.distill.provider, "opencode");
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:10.1.1.1", "fc00::1"]) assert.equal(isPublicVikiAddress(address), false);
  for (const url of ["file:///etc/passwd", "http://localhost/x", "http://127.0.0.1", "https://user:pass@example.com", "http://[::ffff:127.0.0.1]/"]) assert.throws(() => validateVikiWebUrl(url));
  assert.equal(validateVikiWebUrl("https://example.com/page").hostname, "example.com");
});
