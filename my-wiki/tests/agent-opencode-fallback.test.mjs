import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalAgentRunner } from "../scripts/core/agent-service.mjs";

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
