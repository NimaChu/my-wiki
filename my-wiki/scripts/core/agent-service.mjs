import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT = 15 * 60 * 1000;
const MAX_OUTPUT = 2 * 1024 * 1024;
const PROVIDER_ORDER = ["opencode", "codex", "claude"];

export function createLocalAgentRunner({ env = process.env } = {}) {
  let detected;

  return {
    async info() {
      detected ??= detectProviders(env);
      return detected;
    },

    async run({ provider, vault, mode, prompt, schema, timeoutMs = DEFAULT_TIMEOUT }) {
      detected ??= detectProviders(env);
      if (!detected.available) throw new Error(detected.message);
      const selected = resolveProvider(detected, provider);

      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-agent-"));
      const outputFile = path.join(temporary, `${randomUUID()}.json`);
      const schemaFile = path.join(temporary, "response.schema.json");
      const providerConfigFile = path.join(temporary, "opencode.json");
      await fs.writeFile(schemaFile, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
      await fs.writeFile(providerConfigFile, `${JSON.stringify(openCodeConfig(mode), null, 2)}\n`, "utf8");

      try {
        const invocation = providerInvocation({
          provider: selected.provider,
          command: selected.command,
          vault,
          mode,
          prompt,
          schema,
          outputFile,
          schemaFile,
          providerConfigFile
        });
        const result = await runProcess(invocation.command, invocation.args, {
          cwd: vault,
          env: { ...env, ...(invocation.env || {}) },
          input: invocation.input,
          timeoutMs
        });
        const raw = selected.provider === "codex"
          ? await fs.readFile(outputFile, "utf8").catch(() => result.stdout)
          : result.stdout;
        return parseStructuredOutput(raw);
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
  };
}

function detectProviders(env) {
  const preferred = String(env.MY_WIKI_AGENT_PROVIDER || "").trim().toLowerCase();
  const customCommand = String(env.MY_WIKI_AGENT_COMMAND || "").trim();
  const customProvider = customCommand ? inferCommandProvider(customCommand, preferred) : "";
  const discovered = [];

  for (const provider of PROVIDER_ORDER) {
    const candidates = customCommand && customProvider === provider
      ? [customCommand]
      : providerCandidates(provider, env);
    for (const command of candidates) {
      if (commandAvailable(command)) {
        discovered.push({ provider, command, label: providerLabel(provider) });
        break;
      }
    }
  }

  const selected = discovered.find((item) => item.provider === (preferred || customProvider)) || discovered[0];
  if (selected) {
    return {
      available: true,
      provider: selected.provider,
      command: selected.command,
      label: selected.label,
      defaultProvider: selected.provider,
      providers: discovered,
      message: preferred && selected.provider !== preferred
        ? `Configured local agent is unavailable: ${preferred}. Using ${selected.label}.`
        : ""
    };
  }

  return {
    available: false,
    provider: "",
    command: "",
    label: "",
    defaultProvider: "",
    providers: [],
    message: preferred
      ? `Configured local agent is unavailable: ${preferred}`
      : "No supported local agent was found. Install and sign in to Codex, OpenCode, or Claude."
  };
}

function resolveProvider(info, requestedProvider) {
  const requested = String(requestedProvider || info.defaultProvider || info.provider || "").trim().toLowerCase();
  const selected = info.providers.find((item) => item.provider === requested);
  if (!selected) throw new Error(`Selected local agent is unavailable: ${requested || "unknown"}`);
  return selected;
}

function providerLabel(provider) {
  return provider === "codex" ? "Codex" : provider === "opencode" ? "OpenCode" : "Claude";
}

function inferCommandProvider(command, preferred) {
  if (PROVIDER_ORDER.includes(preferred)) return preferred;
  const executable = path.basename(command).toLowerCase();
  return PROVIDER_ORDER.find((provider) => executable.includes(provider)) || "opencode";
}

function providerCandidates(provider, env) {
  const candidates = [provider];
  if (process.platform !== "win32") return candidates;
  const local = env.LOCALAPPDATA || "";
  if (provider === "codex" && local) candidates.unshift(path.join(local, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
  if (provider === "opencode" && local) candidates.unshift(path.join(local, "Programs", "opencode", "node_modules", "opencode-ai", "bin", "opencode.exe"));
  return candidates;
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
    windowsHide: true,
    shell: false
  });
  return !result.error && result.status === 0;
}

function providerInvocation({ provider, command, vault, mode, prompt, schema, outputFile, schemaFile, providerConfigFile }) {
  if (provider === "codex") {
    return {
      command,
      args: [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--color", "never",
        "--sandbox", mode === "maintenance" ? "workspace-write" : "read-only",
        "-C", vault,
        "--output-schema", schemaFile,
        "--output-last-message", outputFile,
        "-"
      ],
      input: prompt,
      env: {}
    };
  }

  if (provider === "opencode") {
    return {
      command,
      args: ["run", "--format", "default", "--dir", vault, promptWithSchema(prompt, schema)],
      input: "",
      env: { OPENCODE_CONFIG: providerConfigFile }
    };
  }

  return {
    command,
    args: [
      "-p",
      "--output-format", "text",
      "--permission-mode", mode === "maintenance" ? "acceptEdits" : "plan",
      promptWithSchema(prompt, schema)
    ],
    input: "",
    env: {}
  };
}

function promptWithSchema(prompt, schema) {
  return `${prompt}\n\nThe required JSON Schema is:\n${JSON.stringify(schema)}\nReturn one JSON object only, with every required property and no Markdown fence.`;
}

function openCodeConfig(mode) {
  return {
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      lsp: "allow",
      edit: mode === "maintenance" ? "allow" : "deny",
      bash: "deny",
      task: "deny",
      external_directory: "deny",
      webfetch: "deny",
      websearch: "deny"
    }
  };
}

function runProcess(command, args, { cwd, env, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      reject(new Error(`Local agent timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);

    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_OUTPUT);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(cleanAgentError(stderr || stdout || `Local agent exited with code ${code}`)));
    });
    child.stdin.end(input || "");
  });
}

function parseStructuredOutput(value) {
  const cleaned = stripAnsi(String(value || "")).trim();
  const unfenced = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // Fall through to a useful error.
      }
    }
  }
  throw new Error("The local agent returned an invalid structured response");
}

function cleanAgentError(value) {
  return stripAnsi(String(value || ""))
    .replace(/(?:sk-[A-Za-z0-9_-]{12,}|gh[opsu]_[A-Za-z0-9_]{12,})/g, "[redacted]")
    .trim()
    .slice(-4000);
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}
