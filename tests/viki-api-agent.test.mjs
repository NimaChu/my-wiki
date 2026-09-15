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
const final = { answerMarkdown: "Verified answer", sources: [{ path: "concepts/allowed.md", title: "Allowed", type: "vault" }], images: [] };
function stream(chunks, done = true) {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : ""), { headers: { "content-type": "text/event-stream" } });
}
const contentStream = (content, { reasoning = "", usage } = {}) => stream([
  ...(reasoning ? [{ choices: [{ delta: { reasoning_content: reasoning } }] }] : []),
  { choices: [{ delta: { content: content.slice(0, Math.ceil(content.length / 2)) } }] },
  { choices: [{ delta: { content: content.slice(Math.ceil(content.length / 2)) }, finish_reason: "stop" }], ...(usage ? { usage } : {}) }
]);
const metadataStream = (metadata) => contentStream(JSON.stringify(metadata));
const lengthStream = (content) => stream([{ choices: [{ delta: { content }, finish_reason: "length" }] }]);
function retrieval() {
  return { search: () => [{ path: "concepts/allowed.md", title: "Allowed" }],
    read: async (file) => { assert.equal(file, "concepts/allowed.md"); return { path: file, title: "Allowed", content: "Verified source", images: [] }; },
    inspectImage: async () => { throw new Error("outside scope"); } };
}
const emptyRetrieval = () => ({ search: () => [], read: async () => { throw new Error("must not read"); }, inspectImage: async () => { throw new Error("must not inspect"); } });
const args = () => ({ model: "deepseek-flash", prompt: "Read-only query", schema: {}, question: "Explain", retrieval: retrieval(), allowWeb: false });

test("API streams Markdown while keeping answer metadata and reasoning out of the body", async () => {
  let calls = 0;
  const events = [];
  const runner = createVikiApiRunner({ env, fetcher: async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(init.headers.authorization, "Bearer test-only-not-a-key");
    const body = JSON.parse(init.body);
    assert.equal(body.stream, true);
    assert.equal(body.reasoning_effort, "high");
    if (++calls === 1) {
      assert.equal(body.max_tokens, 65536);
      assert.ok(!body.tools.some((tool) => tool.function.name.includes("web")));
      assert.equal(body.response_format, undefined);
      return contentStream("Verified answer", { reasoning: "private reasoning", usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } });
    }
    assert.equal(calls, 2);
    assert.equal(body.max_tokens, 2000);
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.messages.at(-2).content, "Verified answer");
    return metadataStream({ sources: [{ path: "concepts/allowed.md" }], images: [] });
  } });
  assert.deepEqual(await runner.run({ ...args(), onEvent: (event) => events.push(event) }), final);
  assert.ok(events.some((event) => event.text === "Verified answer"));
  assert.ok(events.some((event) => event.type === "metadata" && event.sources.length === 1));
  assert.ok(!JSON.stringify(events).includes("private reasoning"));
  assert.ok(!JSON.stringify(await runner.info()).includes(env.DEEPSEEK_API_KEY));
  assert.equal(events.at(-1).metrics.usage.totalTokens, 50);
  assert.equal(events.at(-1).metrics.metadataAttempts, 1);
});

test("API treats greetings like other messages and preserves answers with no citations", async () => {
  const answer = { answerMarkdown: "你好！", sources: [], images: [] };
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.tools.some((tool) => tool.function.name === "read_documents"));
    assert.equal(body.tool_choice, "auto");
    return contentStream(answer.answerMarkdown);
  } });
  const result = await runner.run({ ...args(), question: "你好", allowWeb: true, retrieval: emptyRetrieval() });
  assert.deepEqual(result, answer);
});

test("tool results and final Markdown stay in one model trajectory", async () => {
  let calls = 0;
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++calls === 1) return toolStream("read-one");
    if (calls === 2) {
      assert.equal(body.response_format, undefined);
      const assistant = body.messages.find((message) => message.tool_calls);
      assert.equal(assistant.reasoning_content, "private tool reasoning");
      assert.match(body.messages.find((message) => message.role === "tool").content, /Verified source/);
      return contentStream("Verified answer");
    }
    assert.equal(calls, 3);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.ok(body.messages.some((message) => message.tool_calls));
    assert.ok(body.messages.some((message) => message.role === "tool"));
    assert.equal(body.messages.at(-2).content, "Verified answer");
    return metadataStream({ sources: [{ path: "concepts/allowed.md" }], images: [] });
  } });
  assert.deepEqual(await runner.run(args()), final);
  assert.equal(calls, 3);
});

test("API handles truncated streams, quota errors, cancellation, and bounded tool loops", async () => {
  await assert.rejects(createVikiApiRunner({ env, fetcher: async () => stream([{ choices: [{ delta: { content: "Partial" } }] }], false) }).run(args()), /disconnected/);
  await assert.rejects(createVikiApiRunner({ env, fetcher: async () => new Response("private detail", { status: 402 }) }).run(args()), /insufficient balance/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createVikiApiRunner({ env, fetcher: async () => { throw new Error("must not call"); } }).run({ ...args(), signal: controller.signal }), /cancelled/);
  let calls = 0;
  const bounded = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++calls <= 3) return toolStream(`call${calls}`, "search_knowledge", '{"query":"repeat"}');
    if (calls === 4) {
      assert.equal(body.tools, undefined);
      assert.equal(body.response_format, undefined);
      assert.equal(body.messages.filter((message) => message.tool_calls).length, 3);
      return contentStream("Bounded answer");
    }
    if (calls === 5) {
      const body = JSON.parse(init.body);
      assert.equal(body.tools, undefined);
      assert.deepEqual(body.response_format, { type: "json_object" });
      return metadataStream({ sources: [], images: [] });
    }
    throw new Error("unexpected call");
  } });
  assert.equal((await bounded.run(args())).answerMarkdown, "Bounded answer");
  assert.equal(calls, 5);
});

const toolStream = (id, name = "read_documents", argumentsText = '{"paths":["concepts/allowed.md"]}') => stream([
  { choices: [{ delta: { reasoning_content: "private tool reasoning", tool_calls: [
    { index: 0, id, function: { name, arguments: argumentsText } }
  ] }, finish_reason: "tool_calls" }] }
]);
// The provider emitted this control syntax as ordinary content in the failing live turn.
const leakedDsml = '<\uff5c\uff5cDSML\uff5c\uff5c calls>\n<\uff5c\uff5cDSML\uff5c\uff5c invoke name="read_knowledge">\n<\uff5c\uff5cDSML\uff5c\uff5c parameter name="path" string="true">concepts/private.md</\uff5c\uff5cDSML\uff5c\uff5c parameter>\n</\uff5c\uff5cDSML\uff5c\uff5c invoke>\n</\uff5c\uff5cDSML\uff5c\uff5c calls>';
test("API recovers leaked control syntax in the same trajectory without exposing it", async () => {
  let calls = 0;
  const events = [];
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++calls === 1) return contentStream(leakedDsml);
    if (calls === 2) {
      assert.equal(body.tools, undefined);
      assert.equal(body.response_format, undefined);
      assert.ok(JSON.stringify(body.messages).includes("DSML"));
      assert.match(body.messages.at(-1).content, /research phase is complete/);
      return contentStream("Recovered answer");
    }
    assert.deepEqual(body.response_format, { type: "json_object" });
    return metadataStream({ sources: [], images: [] });
  } });
  const result = await runner.run({ ...args(), onEvent: (event) => events.push(event) });
  assert.equal(result.answerMarkdown, "Recovered answer");
  assert.equal(events.at(-1).metrics.finalizationAttempts, 1);
  assert.ok(!JSON.stringify(events).includes("DSML"));
});

test("failed Markdown recovery is bounded and never exposes provider control output", async () => {
  let calls = 0;
  const runner = createVikiApiRunner({ env, fetcher: async () => {
    calls++;
    return contentStream(leakedDsml);
  } });
  await assert.rejects(runner.run(args()), (error) => {
    assert.match(error.message, /usable Markdown answer/);
    assert.doesNotMatch(error.message, /local agent|private.md|DSML/);
    return true;
  });
  assert.equal(calls, 3);
});

test("metadata failure keeps the completed Markdown and falls back to observed evidence", async () => {
  let calls = 0;
  const events = [];
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    if (++calls === 1) return contentStream("Stable body");
    assert.deepEqual(JSON.parse(init.body).response_format, { type: "json_object" });
    return new Response("private detail", { status: 429 });
  } });
  assert.deepEqual(await runner.run({ ...args(), onEvent: (event) => events.push(event) }), {
    answerMarkdown: "Stable body", sources: final.sources, images: []
  });
  assert.equal(events.filter((event) => event.type === "text").at(-1).text, "Stable body");
});

test("answer generation does not retry transport or cancellation failures", async (t) => {
  const cases = [
    ["HTTP", () => new Response("Private server error", { status: 429 }), /rate limited/],
    ["disconnect", () => stream([{ choices: [{ delta: { content: "Partial" } }] }], false), /disconnected/],
  ];
  for (const [name, response, pattern] of cases) await t.test(name, async () => {
    let calls = 0;
    const runner = createVikiApiRunner({ env, fetcher: async () => { calls++; return response(); } });
    await assert.rejects(runner.run(args()), pattern);
    assert.equal(calls, 1);
  });
  await t.test("cancel during recovery", async () => {
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

test("API automatically continues a length-truncated Markdown answer in the same trajectory", async () => {
  let calls = 0;
  const events = [];
  const runner = createVikiApiRunner({ env, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++calls === 1) return lengthStream("```svg\n<svg><text>first");
    if (calls === 2) {
      assert.equal(body.tools, undefined);
      assert.equal(body.messages.at(-2).content, "```svg\n<svg><text>first");
      assert.match(body.messages.at(-1).content, /exact point/);
      return contentStream(" part</text></svg>\n```");
    }
    assert.equal(body.max_tokens, 2000);
    return metadataStream({ sources: [], images: [] });
  } });
  const result = await runner.run({ ...args(), onEvent: (event) => events.push(event) });
  assert.equal(result.answerMarkdown, "```svg\n<svg><text>first part</text></svg>\n```");
  assert.equal(events.filter((event) => event.type === "text").at(-1).text, result.answerMarkdown);
  assert.equal(calls, 3);
});

test("automatic answer continuation remains bounded", async () => {
  let calls = 0;
  const runner = createVikiApiRunner({ env, fetcher: async () => { calls++; return lengthStream(`segment-${calls}`); } });
  await assert.rejects(runner.run(args()), /after automatic continuation/);
  assert.equal(calls, 3);
});

test("API attaches vision after tool results and only exposes web tools when enabled", async () => {
  let calls = 0;
  const webCalls = [];
  const runner = createVikiApiRunner({ env,
    searchWeb: async (query) => { webCalls.push(query); return { content: "[Public evidence](https://example.com/page)\n![Panel](https://example.com/panel.png)" }; },
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (++calls === 1) {
        assert.ok(body.tools.some((tool) => tool.function.name === "search_web"));
        return stream([{ choices: [{ delta: { tool_calls: [
        { index: 0, id: "image", function: { name: "inspect_image", arguments: '{"path":"references/assets/panel.png"}' } },
        { index: 1, id: "web", function: { name: "search_web", arguments: '{"query":"public test"}' } }
      ] }, finish_reason: "tool_calls" }] }]);
      }
      if (calls === 2) {
        const tail = body.messages.slice(-3);
        assert.deepEqual(tail.map((message) => message.role), ["tool", "tool", "user"]);
        assert.equal(tail[2].content[1].image_url.url, "data:image/png;base64,dGVzdA==");
        return contentStream("Answer with an image");
      }
      return metadataStream({ sources: [{ path: "https://example.com/page" }], images: [{ path: "references/assets/panel.png", caption: "Panel", afterBlock: 0 }] });
    }
  });
  const events = [];
  const result = await runner.run({ ...args(), allowWeb: true, retrieval: { ...retrieval(),
    inspectImage: async (file) => ({ path: file, dataUrl: "data:image/png;base64,dGVzdA==" }) }, onEvent: (event) => events.push(event) });
  assert.deepEqual(webCalls, ["public test"]);
  assert.ok(!JSON.stringify(events).includes("data:image"));
  assert.equal(result.sources[0].path, "https://example.com/page");
  assert.equal(result.images[0].path, "references/assets/panel.png");
  await createVikiApiRunner({ env, fetcher: async (_url, init) => {
    assert.ok(!JSON.parse(init.body).tools.some((tool) => tool.function.name === "inspect_image"));
    return contentStream("No vision");
  } }).run({ ...args(), model: "deepseek-v4-pro", retrieval: emptyRetrieval() });
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
