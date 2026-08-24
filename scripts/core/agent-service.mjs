import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT = 15 * 60 * 1000;
const MAX_OUTPUT = 2 * 1024 * 1024;
const PROVIDER_ORDER = ["opencode", "qoder", "codex", "claude"];

export function createLocalAgentRunner({ env = process.env } = {}) {
  let detected;

  return {
    async info() {
      detected ??= detectProviders(env);
      return detected;
    },

    async run({ provider, model = "", vault, mode, prompt, schema, files = [], timeoutMs = DEFAULT_TIMEOUT, idleTimeoutMs = 0, signal }) {
      detected ??= detectProviders(env);
      if (!detected.available) throw new Error(detected.message);
      const selected = resolveProvider(detected, provider);

      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "my-wiki-agent-"));
      const outputFile = path.join(temporary, `${randomUUID()}.json`);
      const schemaFile = path.join(temporary, "response.schema.json");
      const providerConfigFile = path.join(temporary, "opencode.json");
      const requestedModel = String(model || "").trim();
      const primaryModel = requestedModel || selected.defaultModel || providerModel(selected.provider, env);
      const fallbackModels = selected.provider === "opencode" && !requestedModel
        ? openCodeFallbackModels(env, primaryModel)
        : [];
      await fs.writeFile(schemaFile, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
      await fs.writeFile(
        providerConfigFile,
        `${JSON.stringify(openCodeConfig(mode, env, selected.modelProvider), null, 2)}\n`,
        "utf8"
      );

      try {
        const runAttempt = async (model = "") => {
          const invocation = providerInvocation({
            provider: selected.provider,
            command: selected.command,
            vault,
            mode,
            prompt,
            schema,
            outputFile,
            schemaFile,
            providerConfigFile,
            model,
            files
          });
          let result;
          try {
            result = await runProcess(invocation.command, invocation.args, {
              cwd: vault,
              env: { ...env, ...(invocation.env || {}) },
              input: invocation.input,
              timeoutMs,
              idleTimeoutMs,
              signal,
              stopOnStderr: providerStderrError(selected.provider)
            });
          } catch (error) {
            const providerError = providerOutputError(selected.provider, error?.message);
            if (providerError) throw new Error(providerError);
            throw error;
          }
          const raw = selected.provider === "codex"
            ? await fs.readFile(outputFile, "utf8").catch(() => result.stdout)
            : result.stdout;
          const providerOutput = selected.provider === "qoder" ? `${result.stderr}\n${raw}` : result.stderr;
          const providerError = providerOutputError(selected.provider, providerOutput);
          if (providerError) throw new Error(providerError);
          return parseStructuredOutput(raw);
        };

        const models = selected.provider === "opencode"
          ? [primaryModel, ...fallbackModels]
          : [primaryModel];
        let lastError;
        for (let index = 0; index < models.length; index += 1) {
          try {
            return await runAttempt(models[index]);
          } catch (error) {
            lastError = error;
            const canFallback = selected.provider === "opencode"
              && index < models.length - 1
              && isOpenCodeFallbackEligible(error, signal);
            if (!canFallback) throw error;
          }
        }
        throw lastError;
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
      const resolvedCommand = provider === "codex" ? resolveExecutable(command, env) : command;
      if (commandAvailable(resolvedCommand) && providerAuthenticated(provider, resolvedCommand, env)) {
        const openCodeSettings = provider === "opencode" ? resolveOpenCodeSettings(resolvedCommand, env) : null;
        const defaultModel = openCodeSettings?.model || providerModel(provider, env);
        discovered.push({
          provider,
          command: resolvedCommand,
          label: providerLabel(provider, resolvedCommand),
          defaultModel,
          modelProvider: openCodeSettings?.provider || "",
          models: providerModels(provider, resolvedCommand, env, {
            discoverCatalog: !(customCommand && command === customCommand),
            configuredModel: defaultModel,
            modelProvider: openCodeSettings?.provider || ""
          })
        });
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
      : "No supported local agent was found. Install and sign in to Codex, OpenCode, Qoder, or Claude."
  };
}

function resolveExecutable(command, env) {
  const value = String(command || "").trim();
  if (!value) return value;
  const candidates = path.isAbsolute(value) || value.includes(path.sep)
    ? [value]
    : String(env.PATH || "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, value));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return realpathSync(candidate);
    } catch {
      return candidate;
    }
  }
  return value;
}

function resolveProvider(info, requestedProvider) {
  const requested = String(requestedProvider || info.defaultProvider || info.provider || "").trim().toLowerCase();
  const selected = info.providers.find((item) => item.provider === requested);
  if (!selected) throw new Error(`Selected local agent is unavailable: ${requested || "unknown"}`);
  return selected;
}

function providerLabel(provider, command = "") {
  if (provider === "codex") return "Codex";
  if (provider === "opencode") return "OpenCode";
  if (provider === "qoder") return path.basename(command).toLowerCase().includes("qoderclicn") ? "Qoder CN" : "Qoder";
  return "Claude";
}

function inferCommandProvider(command, preferred) {
  if (PROVIDER_ORDER.includes(preferred)) return preferred;
  const executable = path.basename(command).toLowerCase();
  return PROVIDER_ORDER.find((provider) => executable.includes(provider)) || "opencode";
}

function providerCandidates(provider, env) {
  const candidates = provider === "qoder" ? ["qoderclicn", "qodercli"] : [provider];
  if (process.platform !== "win32") return candidates;
  const local = env.LOCALAPPDATA || "";
  const appData = env.APPDATA || "";
  const profile = env.USERPROFILE || "";
  if (provider === "codex" && local) candidates.unshift(path.join(local, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
  if (provider === "opencode" && local) candidates.unshift(path.join(local, "Programs", "opencode", "node_modules", "opencode-ai", "bin", "opencode.exe"));
  if (provider === "qoder" && appData) {
    candidates.unshift(path.join(appData, "npm", "node_modules", "@qoder-ai", "qodercli", "bundle", "qodercli.js"));
  }
  if (provider === "qoder" && profile) {
    candidates.unshift(
      path.join(profile, ".local", "bin", "qoderclicn.exe"),
      path.join(profile, ".local", "bin", "qodercli.exe")
    );
  }
  return candidates;
}

function commandAvailable(command) {
  const invocation = executableInvocation(command, ["--version"]);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
    windowsHide: true,
    shell: false
  });
  return !result.error && result.status === 0;
}

function providerAuthenticated(provider, command, env) {
  if (provider !== "qoder") return true;
  const isChinaCli = path.basename(command).toLowerCase().includes("qoderclicn");
  const tokenName = isChinaCli ? "QODERCN_PERSONAL_ACCESS_TOKEN" : "QODER_PERSONAL_ACCESS_TOKEN";
  if (String(env[tokenName] || "").trim()) return true;
  const invocation = executableInvocation(command, ["status"]);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 8000,
    windowsHide: true,
    shell: false
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return !result.error
    && result.status === 0
    && (/(?:Username|Email):\s*\S+/i.test(output) || /["']?logged_in["']?\s*:\s*true/i.test(output));
}

function executableInvocation(command, args) {
  const extension = path.extname(command).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(extension)) {
    return { command: process.execPath, args: [command, ...args] };
  }
  return { command, args };
}

export function providerInvocation({ provider, command, vault, mode, prompt, schema, outputFile, schemaFile, providerConfigFile, model, files = [] }) {
  const writeMode = isWriteAgentMode(mode);
  if (provider === "codex") {
    return {
      command,
      args: [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--color", "never",
        "--sandbox", writeMode ? "workspace-write" : "read-only",
        "-C", vault,
        ...(model ? ["--model", model] : []),
        ...files.flatMap((file) => ["--image", file]),
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
      args: [
        "run",
        "--print-logs",
        "--log-level", "ERROR",
        "--format", "default",
        ...(model ? ["--model", model] : []),
        ...files.flatMap((file) => ["--file", file]),
        "--dir", vault,
        promptWithSchema(prompt, schema)
      ],
      input: "",
      env: { OPENCODE_CONFIG: providerConfigFile }
    };
  }

  if (provider === "qoder") {
    const tools = writeMode
      ? ["Read", "Grep", "Glob", "Edit", "Write"]
      : ["Read", "Grep", "Glob"];
    return {
      command,
      args: [
        "--print",
        "--output-format", "text",
        "--no-session-persistence",
        "--cwd", vault,
        "--permission-mode", writeMode ? "accept_edits" : "dont_ask",
        ...(model ? ["--model", model] : []),
        "--tools", ...tools,
        "--",
        promptWithSchema(prompt, schema)
      ],
      input: "",
      env: {}
    };
  }

  return {
    command,
    args: [
      "-p",
      "--output-format", "text",
      "--permission-mode", writeMode ? "acceptEdits" : "plan",
      ...(model ? ["--model", model] : []),
      promptWithSchema(prompt, schema)
    ],
    input: "",
    env: {}
  };
}

function providerModel(provider, env) {
  if (provider === "opencode") return String(env.MY_WIKI_OPENCODE_MODEL || "").trim();
  if (provider === "qoder") return String(env.MY_WIKI_QODER_MODEL || "").trim();
  if (provider === "codex") return String(env.MY_WIKI_CODEX_MODEL || "").trim();
  if (provider === "claude") return String(env.MY_WIKI_CLAUDE_MODEL || "").trim();
  return "";
}

function providerModels(provider, command, env, {
  discoverCatalog = true,
  configuredModel = providerModel(provider, env),
  modelProvider = provider === "opencode" ? openCodeProvider(env) : ""
} = {}) {
  const configured = configuredModel;
  let discovered = [];
  if (provider === "qoder") {
    discovered = [
      { id: "auto", label: "Auto" },
      { id: "efficient", label: "Efficient" },
      { id: "powerful", label: "Powerful" }
    ];
  } else if (provider === "claude") {
    discovered = [
      { id: "sonnet", label: "Sonnet" },
      { id: "opus", label: "Opus" },
      { id: "haiku", label: "Haiku" }
    ];
  } else if (discoverCatalog) {
    const args = provider === "opencode" ? ["models"] : provider === "codex" ? ["debug", "models"] : [];
    if (args.length > 0) {
      const invocation = executableInvocation(command, args);
      const result = spawnSync(invocation.command, invocation.args, {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        shell: false
      });
      if (!result.error && result.status === 0) {
        discovered = parseProviderModels(provider, result.stdout, { modelProvider });
      }
    }
  }

  return uniqueModelOptions([
    ...(configured ? [{ id: configured, label: configured }] : []),
    ...discovered
  ]);
}

export function parseProviderModels(provider, output, { modelProvider = "" } = {}) {
  const value = stripAnsi(String(output || "")).trim();
  if (provider === "opencode") {
    const providerPrefix = String(modelProvider || "").trim();
    return uniqueModelOptions(value.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[^\s/]+\/[^\s]+$/.test(line))
      .filter((id) => !providerPrefix || id.startsWith(`${providerPrefix}/`))
      .map((id) => ({ id, label: id })));
  }
  if (provider === "codex") {
    try {
      const parsed = JSON.parse(value);
      return uniqueModelOptions((Array.isArray(parsed?.models) ? parsed.models : [])
        .filter((item) => item?.visibility !== "hide")
        .flatMap((item) => {
          const id = String(item?.slug || "").trim();
          return id ? [{ id, label: String(item?.display_name || id).trim() || id }] : [];
        }));
    } catch {
      return [];
    }
  }
  return [];
}

function uniqueModelOptions(models) {
  const seen = new Set();
  return models.flatMap((item) => {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: String(item?.label || id).trim() || id }];
  });
}

function promptWithSchema(prompt, schema) {
  return `${prompt}\n\nThe required JSON Schema is:\n${JSON.stringify(schema)}\nReturn one JSON object only, with every required property and no Markdown fence.`;
}

function modelProvider(model) {
  const value = String(model || "").trim();
  const separator = value.indexOf("/");
  return separator > 0 ? value.slice(0, separator) : "";
}

function openCodeProvider(env, fallbackModel = "") {
  const configured = String(env.MY_WIKI_OPENCODE_PROVIDER || "").trim();
  if (configured) return configured;
  return modelProvider(providerModel("opencode", env) || fallbackModel);
}

function resolveOpenCodeSettings(command, env) {
  let model = providerModel("opencode", env);
  let provider = openCodeProvider(env, model);
  if (model && provider) return { model, provider };

  const invocation = executableInvocation(command, ["debug", "config"]);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: false
  });
  if (!result.error && result.status === 0) {
    const resolved = parseOpenCodeConfig(result.stdout);
    model ||= resolved.model;
    provider ||= resolved.provider;
  }
  provider ||= modelProvider(model);
  return { model, provider };
}

export function parseOpenCodeConfig(output) {
  try {
    const config = JSON.parse(stripAnsi(String(output || "")).trim());
    const model = String(config?.model || "").trim();
    const enabledProviders = Array.isArray(config?.enabled_providers) ? config.enabled_providers : [];
    const provider = String(enabledProviders.find((item) => String(item || "").trim()) || "").trim()
      || modelProvider(model);
    return { model, provider };
  } catch {
    return { model: "", provider: "" };
  }
}

function openCodeConfig(mode, env, configuredProvider = "") {
  const activeProvider = String(configuredProvider || "").trim() || openCodeProvider(env);
  return {
    ...(activeProvider ? { enabled_providers: [activeProvider] } : {}),
    permission: {
      read: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      lsp: "allow",
      edit: isWriteAgentMode(mode) ? "allow" : "deny",
      bash: "deny",
      task: "deny",
      external_directory: "deny",
      webfetch: "deny",
      websearch: "deny"
    }
  };
}

function isWriteAgentMode(mode) {
  return mode === "maintenance" || mode === "repair";
}

function openCodeFallbackModels(env, primaryModel) {
  const configured = [
    ...String(env.MY_WIKI_OPENCODE_FALLBACK_MODELS || "").split(","),
    String(env.MY_WIKI_OPENCODE_FALLBACK_MODEL || "")
  ]
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(configured)].filter((model) => model !== primaryModel);
}

function isOpenCodeFallbackEligible(error, signal) {
  if (signal?.aborted) return false;
  const message = String(error?.message || error || "");
  return !message.includes("Local agent request was cancelled")
    && !message.includes("Local agent timed out")
    && !message.includes("Local agent stopped after")
    && !/invalid api key|authentication|unauthorized|forbidden|\b401\b/i.test(message);
}

function openCodeProviderError(stderr) {
  const value = stripAnsi(String(stderr || ""));
  const known = [
    /Invalid API key\.?/i,
    /authentication (?:failed|required)\.?/i,
    /unauthorized\.?/i,
    /forbidden\.?/i,
    /rate limit(?:ed| exceeded)?\.?/i,
    /insufficient (?:credits|quota)\.?/i,
    /model [^\n"]+ (?:not found|unavailable)\.?/i,
    /ProviderModelNotFoundError/i
  ].map((pattern) => value.match(pattern)?.[0]).find(Boolean);
  return known ? `OpenCode provider request failed: ${known}` : "";
}

function qoderProviderError(output) {
  const value = stripAnsi(String(output || ""));
  if (/insufficient_quota|exceeded your current quota|quota (?:is )?(?:exhausted|exceeded)|too_many_requests/i.test(value)) {
    return "Qoder quota is exhausted. Switch Agent CLI to OpenCode or add Qoder credits, then retry.";
  }
  if (/invalid (?:personal access )?token|authentication (?:failed|required)|unauthorized|\b401\b/i.test(value)) {
    return "Qoder authentication failed. Check the Qoder personal access token, then retry.";
  }
  if (/rate.?limit(?:ed| exceeded)?|\b429\b/i.test(value)) {
    return "Qoder rate limit was reached. Wait briefly or switch Agent CLI to OpenCode, then retry.";
  }
  return "";
}

function providerOutputError(provider, output) {
  if (provider === "opencode") return openCodeProviderError(output);
  if (provider === "qoder") return qoderProviderError(output);
  return "";
}

function providerStderrError(provider) {
  if (provider === "opencode") return openCodeProviderError;
  if (provider === "qoder") return qoderProviderError;
  return undefined;
}

function runProcess(command, args, { cwd, env, input, timeoutMs, idleTimeoutMs, signal, stopOnStderr }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Local agent request was cancelled"));
      return;
    }
    const invocation = executableInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stopError = null;
    let idleTimer = null;
    let forceTimer = null;

    const cleanup = () => {
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      clearTimeout(forceTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const stop = (error) => {
      if (settled || stopError) return;
      stopError = error;
      terminateProcessTree(child, "SIGTERM");
      forceTimer = setTimeout(() => {
        terminateProcessTree(child, "SIGKILL");
        fail(error);
      }, 2000);
      forceTimer.unref?.();
    };
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      if (!(idleTimeoutMs > 0)) return;
      idleTimer = setTimeout(() => {
        stop(new Error(`Local agent stopped after ${Math.round(idleTimeoutMs / 1000)} seconds without output`));
      }, idleTimeoutMs);
      idleTimer.unref?.();
    };
    const onAbort = () => stop(new Error("Local agent request was cancelled"));
    const totalTimer = setTimeout(() => {
      stop(new Error(`Local agent timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);
    totalTimer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    resetIdleTimer();

    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_OUTPUT);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
      resetIdleTimer();
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
      const providerError = stopOnStderr?.(stderr);
      if (providerError) stop(new Error(providerError));
    });
    child.on("error", (error) => {
      fail(stopError || error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (stopError) reject(stopError);
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(cleanAgentError(stderr || stdout || `Local agent exited with code ${code}`)));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input || "");
  });
}

function terminateProcessTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      shell: false,
      stdio: "ignore"
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process has already exited.
    }
  }
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
