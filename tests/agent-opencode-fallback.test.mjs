import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLocalAgentRunner,
  parseStructuredOutput,
  parseOpenCodeConfig,
  parseProviderModels,
  providerInvocation
} from "../scripts/core/agent-service.mjs";

test("structured responses survive web-tool logs and literal newlines", () => {
  const answer = {
    answerMarkdown: "A silver spacecraft.",
    sources: [{ path: "https://example.com/starship", title: "Starship", type: "web" }],
    images: [{ path: "https://example.com/starship.jpg", caption: "Starship", afterBlock: 0, type: "web" }]
  };
  const noisy = [
    JSON.stringify({ tool: "websearch", query: "starship appearance" }),
    "Search completed.",
    JSON.stringify(answer)
  ].join("\n");
  assert.deepEqual(parseStructuredOutput(noisy), answer);

  const literalNewline = '{"answerMarkdown":"Line one\nLine two","sources":[],"images":[]}';
  assert.deepEqual(parseStructuredOutput(literalNewline), {
    answerMarkdown: "Line one\nLine two",
    sources: [],
    images: []
  });
});

test("Codex and OpenCode receive page images through native CLI attachment flags", () => {
  const common = { command: "agent", vault: "/vault", mode: "query", prompt: "Repair", schema: {}, outputFile: "/out", schemaFile: "/schema", providerConfigFile: "/config", model: "vision", files: ["/pages/1.png", "/pages/2.png"] };
  const codex = providerInvocation({ ...common, provider: "codex" });
  const webCodex = providerInvocation({ ...common, provider: "codex", allowWeb: true });
  const opencode = providerInvocation({ ...common, provider: "opencode" });
  assert.deepEqual(codex.args.filter((value) => value === "--image").length, 2);
  assert.deepEqual(opencode.args.filter((value) => value === "--file").length, 2);
  assert.ok(codex.args.includes("/pages/1.png"));
  assert.ok(opencode.args.includes("/pages/2.png"));
  assert.deepEqual(webCodex.args.slice(webCodex.args.indexOf("--enable"), webCodex.args.indexOf("--enable") + 2), ["--enable", "browser_use"]);
});

test("Codex discovery resolves symlinks so bundled companion executables remain adjacent", {
  skip: process.platform === "win32" ? "Windows uses native executable discovery instead of Unix launcher symlinks" : false
}, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-codex-symlink-test-"));
  const bundle = path.join(temporary, "bundle");
  const bin = path.join(temporary, "bin");
  const command = path.join(bundle, "codex");
  const symlink = path.join(bin, "codex");
  await fs.mkdir(bundle);
  await fs.mkdir(bin);
  await fs.writeFile(command, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.symlink(command, symlink);

  try {
    const info = await createLocalAgentRunner({
      env: { ...process.env, PATH: bin, MY_WIKI_AGENT_PROVIDER: "codex" }
    }).info();
    assert.equal(info.available, true);
    assert.equal(info.providers.find((item) => item.provider === "codex")?.command, await fs.realpath(command));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("provider model catalogs normalize OpenCode lines and visible Codex models", () => {
  assert.deepEqual(parseProviderModels("opencode", `
internal-litellm/gpt-5.6-sol
not a model id
internal-litellm/gpt-5.6-sol
openai/gpt-5
`), [
    { id: "internal-litellm/gpt-5.6-sol", label: "internal-litellm/gpt-5.6-sol" },
    { id: "openai/gpt-5", label: "openai/gpt-5" }
  ]);

  assert.deepEqual(parseProviderModels("opencode", `
opencode-go/glm-5.2
openai/gpt-5
opencode-go/kimi-k3
`, { modelProvider: "opencode-go" }), [
    { id: "opencode-go/glm-5.2", label: "opencode-go/glm-5.2" },
    { id: "opencode-go/kimi-k3", label: "opencode-go/kimi-k3" }
  ]);

  assert.deepEqual(parseProviderModels("codex", JSON.stringify({ models: [
    { slug: "gpt-5.6-sol", display_name: "GPT-5.6 Sol", visibility: "list" },
    { slug: "internal-only", display_name: "Internal", visibility: "hide" }
  ] })), [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }
  ]);
});

test("OpenCode resolved config supplies the CLI default model and provider", () => {
  assert.deepEqual(parseOpenCodeConfig(JSON.stringify({
    model: "opencode-go/glm-5.2",
    enabled_providers: ["opencode-go"]
  })), {
    model: "opencode-go/glm-5.2",
    provider: "opencode-go"
  });

  assert.deepEqual(parseOpenCodeConfig(JSON.stringify({ model: "opencode-go/kimi-k3" })), {
    model: "opencode-go/kimi-k3",
    provider: "opencode-go"
  });
});

test("OpenCode discovery refreshes when its config file changes", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-opencode-refresh-test-"));
  const command = path.join(temporary, "opencode-refresh-test.cjs");
  const config = path.join(temporary, "opencode.json");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) process.exit(0);
const current = JSON.parse(fs.readFileSync(process.env.OPENCODE_CONFIG, "utf8"));
if (process.argv.includes("models")) process.stdout.write(current.model + "\\n");
else process.stdout.write(JSON.stringify(current));
`;
  await fs.writeFile(command, script, { mode: 0o755 });
  await fs.writeFile(config, JSON.stringify({ model: "first/model", enabled_providers: ["first"] }));

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "opencode",
        MY_WIKI_AGENT_COMMAND: command,
        OPENCODE_CONFIG: config
      }
    });
    assert.equal((await runner.info()).providers[0].defaultModel, "first/model");
    await fs.writeFile(config, JSON.stringify({ model: "second/model", enabled_providers: ["second"] }));
    assert.equal((await runner.info()).providers[0].defaultModel, "second/model");
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("OpenCode constrains its runtime config to the configured provider", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-opencode-provider-test-"));
  const command = path.join(temporary, "opencode-provider-test.cjs");
  const capturedConfig = path.join(temporary, "opencode-config.json");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) process.exit(0);
fs.copyFileSync(process.env.OPENCODE_CONFIG, process.env.CAPTURED_CONFIG);
process.stdout.write(JSON.stringify({ answer: "ok" }));
`;
  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "opencode",
        MY_WIKI_AGENT_COMMAND: command,
        MY_WIKI_OPENCODE_PROVIDER: "opencode-go",
        MY_WIKI_OPENCODE_MODEL: "opencode-go/glm-5.2",
        CAPTURED_CONFIG: capturedConfig
      }
    });
    await runner.run({
      provider: "opencode",
      vault: temporary,
      mode: "query",
      prompt: "Answer",
      schema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } } },
      allowWeb: true
    });

    const config = JSON.parse(await fs.readFile(capturedConfig, "utf8"));
    assert.deepEqual(config.enabled_providers, ["opencode-go"]);
    assert.equal(config.permission.websearch, "allow");
    assert.equal(config.permission.webfetch, "allow");
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("an explicitly selected OpenCode model is passed through without fallback", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-opencode-explicit-model-test-"));
  const command = path.join(temporary, "opencode-explicit-model-test.cjs");
  const attempts = path.join(temporary, "attempts.log");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) process.exit(0);
const model = process.argv[process.argv.indexOf("--model") + 1];
fs.appendFileSync(process.env.ATTEMPTS_FILE, model + "\\n");
process.stdout.write(JSON.stringify({ answer: model }));
`;
  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "opencode",
        MY_WIKI_AGENT_COMMAND: command,
        MY_WIKI_OPENCODE_MODEL: "configured/default",
        MY_WIKI_OPENCODE_FALLBACK_MODELS: "fallback/one,fallback/two",
        ATTEMPTS_FILE: attempts
      }
    });
    const result = await runner.run({
      provider: "opencode",
      model: "chosen/model",
      vault: temporary,
      mode: "query",
      prompt: "Answer",
      schema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } } }
    });

    assert.deepEqual(result, { answer: "chosen/model" });
    assert.equal((await fs.readFile(attempts, "utf8")).trim(), "chosen/model");
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("OpenCode retries a failed primary model with the configured fallback", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-opencode-test-"));
  const command = path.join(temporary, "opencode-test.cjs");
  const attempts = path.join(temporary, "attempts.log");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) process.exit(0);
const model = process.argv[process.argv.indexOf("--model") + 1];
fs.appendFileSync(process.env.ATTEMPTS_FILE, model + "\\n");
if (model === "opencode-go/kimi-k3") {
  process.stderr.write("primary unavailable");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ answer: "fallback worked" }));
`;

  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "opencode",
        MY_WIKI_AGENT_COMMAND: command,
        MY_WIKI_OPENCODE_MODEL: "opencode-go/kimi-k3",
        MY_WIKI_OPENCODE_FALLBACK_MODEL: "opencode-go/glm-5.2",
        ATTEMPTS_FILE: attempts
      }
    });
    const result = await runner.run({
      provider: "opencode",
      vault: temporary,
      mode: "query",
      prompt: "Answer",
      schema: {
        type: "object",
        required: ["answer"],
        properties: { answer: { type: "string" } }
      }
    });

    assert.deepEqual(result, { answer: "fallback worked" });
    assert.deepEqual(
      (await fs.readFile(attempts, "utf8")).trim().split("\n"),
      ["opencode-go/kimi-k3", "opencode-go/glm-5.2"]
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("OpenCode abandons a rate-limited primary model and uses the fallback", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-opencode-rate-test-"));
  const command = path.join(temporary, "opencode-rate-test.cjs");
  const attempts = path.join(temporary, "attempts.log");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) process.exit(0);
const model = process.argv[process.argv.indexOf("--model") + 1];
fs.appendFileSync(process.env.ATTEMPTS_FILE, model + "\\n");
if (model === "opencode-go/kimi-k3") {
  process.stderr.write("Provider rate limit exceeded");
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(JSON.stringify({ answer: "fallback worked after rate limit" }));
}
`;

  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "opencode",
        MY_WIKI_AGENT_COMMAND: command,
        MY_WIKI_OPENCODE_MODEL: "opencode-go/kimi-k3",
        MY_WIKI_OPENCODE_FALLBACK_MODEL: "opencode-go/glm-5.2",
        ATTEMPTS_FILE: attempts
      }
    });
    const result = await runner.run({
      provider: "opencode",
      vault: temporary,
      mode: "query",
      prompt: "Answer",
      schema: {
        type: "object",
        required: ["answer"],
        properties: { answer: { type: "string" } }
      },
      timeoutMs: 5000
    });

    assert.deepEqual(result, { answer: "fallback worked after rate limit" });
    assert.deepEqual(
      (await fs.readFile(attempts, "utf8")).trim().split("\n"),
      ["opencode-go/kimi-k3", "opencode-go/glm-5.2"]
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("OpenCode tries each configured fallback model in order", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-opencode-fallback-chain-test-"));
  const command = path.join(temporary, "opencode-fallback-chain-test.cjs");
  const attempts = path.join(temporary, "attempts.log");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) process.exit(0);
const model = process.argv[process.argv.indexOf("--model") + 1];
fs.appendFileSync(process.env.ATTEMPTS_FILE, model + "\\n");
if (model !== "opencode-go/grok-4.5") {
  process.stderr.write("Provider rate limit exceeded");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ answer: "final fallback worked" }));
`;

  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "opencode",
        MY_WIKI_AGENT_COMMAND: command,
        MY_WIKI_OPENCODE_MODEL: "opencode-go/kimi-k3",
        MY_WIKI_OPENCODE_FALLBACK_MODELS: "opencode-go/glm-5.2, opencode-go/deepseek-v4-pro, opencode-go/grok-4.5",
        ATTEMPTS_FILE: attempts
      }
    });
    const result = await runner.run({
      provider: "opencode",
      vault: temporary,
      mode: "query",
      prompt: "Answer",
      schema: {
        type: "object",
        required: ["answer"],
        properties: { answer: { type: "string" } }
      }
    });

    assert.deepEqual(result, { answer: "final fallback worked" });
    assert.deepEqual(
      (await fs.readFile(attempts, "utf8")).trim().split("\n"),
      [
        "opencode-go/kimi-k3",
        "opencode-go/glm-5.2",
        "opencode-go/deepseek-v4-pro",
        "opencode-go/grok-4.5"
      ]
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("OpenCode does not retry the fallback model after authentication failure", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-opencode-auth-test-"));
  const command = path.join(temporary, "opencode-auth-test.cjs");
  const attempts = path.join(temporary, "attempts.log");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) process.exit(0);
const model = process.argv[process.argv.indexOf("--model") + 1];
fs.appendFileSync(process.env.ATTEMPTS_FILE, model + "\\n");
process.stderr.write("Invalid API key.");
process.exit(1);
`;

  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "opencode",
        MY_WIKI_AGENT_COMMAND: command,
        MY_WIKI_OPENCODE_MODEL: "opencode-go/kimi-k3",
        MY_WIKI_OPENCODE_FALLBACK_MODEL: "opencode-go/glm-5.2",
        ATTEMPTS_FILE: attempts
      }
    });

    await assert.rejects(
      runner.run({
        provider: "opencode",
        vault: temporary,
        mode: "query",
        prompt: "Answer",
        schema: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string" } }
        }
      }),
      /Invalid API key/
    );
    assert.equal((await fs.readFile(attempts, "utf8")).trim(), "opencode-go/kimi-k3");
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("Qoder uses bounded read-only tools for Viki and workspace edits for maintenance or repair", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-qoder-test-"));
  const command = path.join(temporary, "qoderclicn-test.cjs");
  const attempts = path.join(temporary, "attempts.log");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("1.1.9");
  process.exit(0);
}
if (process.argv.includes("status")) {
  process.stdout.write("Username: Test\\nEmail: test@example.com\\n");
  process.exit(0);
}
fs.appendFileSync(process.env.ATTEMPTS_FILE, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(JSON.stringify({ answer: "qoder worked" }));
`;
  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "qoder",
        MY_WIKI_AGENT_COMMAND: command,
        MY_WIKI_QODER_MODEL: "efficient",
        ATTEMPTS_FILE: attempts
      }
    });
    const info = await runner.info();
    assert.equal(info.defaultProvider, "qoder");
    assert.ok(info.providers.some((item) => item.provider === "qoder" && item.label === "Qoder CN"));

    const options = {
      provider: "qoder",
      vault: temporary,
      prompt: "Answer",
      schema: {
        type: "object",
        required: ["answer"],
        properties: { answer: { type: "string" } }
      }
    };
    assert.deepEqual(await runner.run({ ...options, mode: "query" }), { answer: "qoder worked" });
    assert.deepEqual(await runner.run({ ...options, mode: "query", allowWeb: true }), { answer: "qoder worked" });
    assert.deepEqual(await runner.run({ ...options, mode: "maintenance" }), { answer: "qoder worked" });
    assert.deepEqual(await runner.run({ ...options, mode: "repair" }), { answer: "qoder worked" });

    const [queryArgs, webQueryArgs, maintenanceArgs, repairArgs] = (await fs.readFile(attempts, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(queryArgs.slice(0, 10), [
      "--print",
      "--output-format", "text",
      "--no-session-persistence",
      "--cwd", temporary,
      "--permission-mode", "dont_ask",
      "--model", "efficient"
    ]);
    assert.deepEqual(queryArgs.slice(10, queryArgs.indexOf("--")), ["--tools", "Read", "Grep", "Glob"]);
    assert.deepEqual(webQueryArgs.slice(10, webQueryArgs.indexOf("--allowed-tools")), ["--tools", "Read", "Grep", "Glob", "WebSearch", "WebFetch"]);
    assert.equal(webQueryArgs[webQueryArgs.indexOf("--allowed-tools") + 1], "WebSearch,WebFetch");
    assert.deepEqual(
      maintenanceArgs.slice(10, maintenanceArgs.indexOf("--")),
      ["--tools", "Read", "Grep", "Glob", "Edit", "Write"]
    );
    assert.equal(maintenanceArgs[maintenanceArgs.indexOf("--permission-mode") + 1], "accept_edits");
    assert.deepEqual(
      repairArgs.slice(10, repairArgs.indexOf("--")),
      ["--tools", "Read", "Grep", "Glob", "Edit", "Write"]
    );
    assert.equal(repairArgs[repairArgs.indexOf("--permission-mode") + 1], "accept_edits");
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("Qoder quota failures are reported instead of misclassified as invalid structured output", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-qoder-quota-test-"));
  const command = path.join(temporary, "qoder-quota-test.cjs");
  const script = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("1.1.9");
  process.exit(0);
}
process.stdout.write("Qoder API error: TOO_MANY_REQUESTS - {\\"error\\":{\\"code\\":\\"insufficient_quota\\",\\"message\\":\\"You exceeded your current quota\\"}}");
`;
  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "qoder",
        MY_WIKI_AGENT_COMMAND: command,
        QODER_PERSONAL_ACCESS_TOKEN: "test-token"
      }
    });
    await assert.rejects(
      runner.run({
        provider: "qoder",
        vault: temporary,
        mode: "maintenance",
        prompt: "Maintain",
        schema: {
          type: "object",
          required: ["summary"],
          properties: { summary: { type: "string" } }
        }
      }),
      /Qoder quota is exhausted.*OpenCode/
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("Qoder CN uses its region-specific PAT environment variable", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-qodercn-auth-test-"));
  const command = path.join(temporary, "qoderclicn-test.cjs");
  const script = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("1.1.9");
  process.exit(0);
}
process.exit(2);
`;
  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "qoder",
        MY_WIKI_AGENT_COMMAND: command,
        QODER_PERSONAL_ACCESS_TOKEN: "",
        QODERCN_PERSONAL_ACCESS_TOKEN: "test-token"
      }
    });
    const info = await runner.info();
    assert.equal(info.providers.find((item) => item.provider === "qoder")?.label, "Qoder CN");
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("Qoder stays hidden when the CLI is not signed in", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-qoder-auth-test-"));
  const command = path.join(temporary, "qoder-auth-test.cjs");
  const script = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("1.1.9");
  process.exit(0);
}
if (process.argv.includes("status")) {
  process.stderr.write("Not signed in");
  process.exit(1);
}
process.exit(2);
`;
  await fs.writeFile(command, script, { mode: 0o755 });

  try {
    const runner = createLocalAgentRunner({
      env: {
        ...process.env,
        MY_WIKI_AGENT_PROVIDER: "qoder",
        MY_WIKI_AGENT_COMMAND: command,
        QODER_PERSONAL_ACCESS_TOKEN: "",
        QODERCN_PERSONAL_ACCESS_TOKEN: ""
      }
    });
    const info = await runner.info();
    assert.equal(info.providers.some((item) => item.provider === "qoder"), false);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
