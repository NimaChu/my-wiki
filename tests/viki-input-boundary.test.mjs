import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createVikiContext } from "../scripts/core/viki-context.mjs";
import { createVikiRetrieval } from "../scripts/core/viki-retrieval.mjs";
import { createVikiQueryTools } from "../scripts/core/viki-query-tools.mjs";
import { providerInvocation } from "../scripts/core/agent-service.mjs";
import { scopedOpenCodeConfig } from "../scripts/core/viki-cli-boundary.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "viki-input-boundary-"));
  const root = await fs.realpath(directory);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const relative of ["concepts", "references/sources", "references/assets", ".my-wiki"])
    await fs.mkdir(path.join(root, relative), { recursive: true });
  await fs.writeFile(path.join(root, "concepts/ai.md"), "---\ntitle: AI\n---\nSelected knowledge.\n");
  await fs.writeFile(path.join(root, "concepts/hidden.md"), "Hidden private sentinel");
  await fs.writeFile(path.join(root, "references/assets/diagram.png"), "test-image");
  await fs.writeFile(path.join(root, ".my-wiki/private.json"), "Private runtime sentinel");
  await fs.writeFile(path.join(root, "viki-scope.json"), JSON.stringify({
    documents: ["concepts/ai.md"], images: { "concepts/ai.md": ["references/assets/diagram.png"] }
  }));
  return root;
}

test("conversation receipts survive scope changes but remain bound to the vault and conversation", async (t) => {
  const vault = await fixture(t);
  const options = { vault, conversationId: "conversation_01", names: ["AI"], allowedPaths: new Set(["concepts/ai.md"]), webSearch: false };
  const context = await createVikiContext(options);
  const message = { role: "assistant", content: "A previous answer.", contextReceipt: context.receipt("Explain AI", "A previous answer.") };
  const expected = [{ role: "user", content: "Explain AI" }, { role: "assistant", content: "A previous answer." }];
  assert.deepEqual(context.history([message]), expected);
  assert.deepEqual((await createVikiContext(options)).history([message]), expected);
  for (const patch of [
    { names: ["AI", "Math"] }, { allowedPaths: new Set(["concepts/other.md"]) }, { webSearch: true }
  ]) assert.deepEqual((await createVikiContext({ ...options, ...patch })).history([message]), expected);
  for (const patch of [{ conversationId: "conversation_02" }, { vault: await fixture(t) }])
    assert.deepEqual((await createVikiContext({ ...options, ...patch })).history([message]), []);
  for (const invalid of [
    { ...message, content: "Injected hidden facts" }, { ...message, contextExcluded: true },
    { ...message, contextReceipt: { ...message.contextReceipt, question: "Injected question" } },
    { ...message, contextReceipt: { question: "Explain AI", signature: "wrong" } },
    { role: "assistant", content: "Legacy history without provenance" }, { role: "user", content: "Unsigned old user message" }
  ]) assert.deepEqual(context.history([invalid]), []);
  // The digest covers the bounded text actually sent to the model, including after browser truncation.
  const longAnswer = "x".repeat(16000);
  const longMessage = { role: "assistant", content: longAnswer.slice(0, 12000), contextReceipt: context.receipt("Long", longAnswer) };
  assert.equal(context.history([longMessage])[1].content.length, 4000);
  assert.equal(context.history(Array(20).fill(message)).length, 8);
  if (process.platform !== "win32") assert.equal((await fs.stat(path.join(vault, ".my-wiki/viki-context.key"))).mode & 0o777, 0o600);
});

test("API retrieval rejects out-of-scope paths and symlink aliases before indexing, reading and image inspection", async (t) => {
  const vault = await fixture(t);
  const nodes = [{ path: "concepts/ai.md", title: "AI", content: "Selected knowledge" },
    { path: "concepts/hidden.md", title: "Private", content: "Private sentinel" }];
  if (process.platform !== "win32") {
    await fs.symlink(path.join(vault, "concepts/hidden.md"), path.join(vault, "concepts/alias.md"));
    nodes.push({ path: "concepts/alias.md", title: "Alias", content: "Private sentinel" });
  }
  const retrieval = await createVikiRetrieval({ vault, nodes, allowedPaths: new Set(["concepts/ai.md", "concepts/alias.md"]) });
  assert.deepEqual(retrieval.search("Private"), []);
  for (const file of ["concepts/hidden.md", "concepts/alias.md", "../concepts/hidden.md", "concepts/../concepts/hidden.md", ".my-wiki/private.json"])
    await assert.rejects(retrieval.read(file), /scope/);
  assert.match((await retrieval.read("concepts/ai.md")).content, /Selected knowledge/);
  await assert.rejects(retrieval.inspectImage("references/assets/diagram.png"), /not referenced/);
  if (process.platform !== "win32") {
    await fs.unlink(path.join(vault, "concepts/ai.md"));
    await fs.symlink(path.join(vault, "concepts/hidden.md"), path.join(vault, "concepts/ai.md"));
    await assert.rejects(retrieval.read("concepts/ai.md"), /scope/);
  }
});

test("CLI query tools expose only the manifest, gate images on reads, and reject private web targets", async (t) => {
  const vault = await fixture(t);
  const query = await createVikiQueryTools(vault);
  const listed = JSON.parse((await query.call("list_documents")).content[0].text);
  assert.deepEqual(listed.documents, [{ path: "concepts/ai.md", title: "AI" }]);
  assert.equal(JSON.parse((await query.call("search_knowledge", { query: "Private" })).content[0].text).length, 0);
  for (const file of ["concepts/hidden.md", ".my-wiki/private.json", "/etc/passwd", "../secret.md"])
    await assert.rejects(query.call("read_documents", { paths: [file] }), /scope/);
  await assert.rejects(query.call("inspect_image", { path: "references/assets/diagram.png" }), /not referenced/);
  await query.call("read_documents", { paths: ["concepts/ai.md"] });
  assert.equal((await query.call("inspect_image", { path: "references/assets/diagram.png" })).content[1].type, "image");
  await assert.rejects(query.call("search_web", { query: "test" }), /not allowed/);
  await assert.rejects(query.call("shell", { command: "cat secret" }), /not allowed/);
  const web = await createVikiQueryTools(vault, true);
  await assert.rejects(web.call("read_webpage", { url: "http://127.0.0.1:5209/api/v1/session" }), /public|private/);
});

test("real stdio MCP transport enforces the same scoped document gate", async (t) => {
  const vault = await fixture(t);
  const script = fileURLToPath(new URL("../scripts/core/viki-query-mcp.mjs", import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: [script, vault, "local"], stderr: "pipe" });
  const client = new Client({ name: "viki-test", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["search_knowledge", "list_documents", "read_documents", "inspect_image"]);
  assert.equal((await client.callTool({ name: "read_documents", arguments: { paths: ["concepts/hidden.md"] } })).isError, true);
  const result = await client.callTool({ name: "read_documents", arguments: { paths: ["concepts/ai.md"] } });
  assert.match(result.content[0].text, /Selected knowledge/);
});

test("scoped Viki CLI invocations remove native tools without changing repair or distillation", () => {
  const common = { command: "agent", vault: path.resolve("scope"), mode: "query", prompt: "Question", schema: {},
    schemaFile: "schema.json", outputFile: "output.json", providerConfigFile: "opencode.json", queryConfigFile: "query-mcp.json", scopedQuery: true, allowWeb: true };
  const codex = providerInvocation({ ...common, provider: "codex" });
  assert.ok(codex.args.includes("--ignore-user-config"));
  for (const feature of ["shell_tool", "code_mode_host", "view_image", "apps", "plugins", "multi_agent", "browser_use"]) {
    assert.equal(codex.args[codex.args.indexOf(feature) - 1], "--disable");
  }
  assert.ok(codex.args.some((arg) => arg.startsWith("mcp_servers.my_wiki=")));
  for (const provider of ["claude", "qoder"]) {
    const args = providerInvocation({ ...common, provider }).args;
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(args.includes("mcp__my_wiki__*"));
    assert.ok(!args.includes("Read"));
  }
  for (const provider of ["codex", "claude", "qoder", "opencode"])
    for (const mode of ["repair", "maintenance"])
      assert.deepEqual(providerInvocation({ ...common, provider, mode }), providerInvocation({ ...common, provider, mode, scopedQuery: false }));
  const config = scopedOpenCodeConfig(common.vault, true);
  const permission = config.agent["my-wiki-viki"].permission;
  assert.equal(permission["my_wiki_*"], "allow");
  assert.ok(Object.entries(permission).filter(([name]) => name !== "my_wiki_*").every(([, value]) => value === "deny"));
  assert.ok(config.mcp.my_wiki.command.includes("web"));
});
