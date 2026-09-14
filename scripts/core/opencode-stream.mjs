import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { JSONParser } from "@streamparser/json";
import { readAnswerEvents } from "../../assets/dashboard/src/answer-events.js";

const MAX_TEXT = 2 * 1024 * 1024;

export function createAnswerDecoder(onText) {
  let prefix = "";
  let started = false;
  let failed = false;
  let length = 0;
  const parser = new JSONParser({ paths: ["$.answerMarkdown"], emitPartialTokens: true, emitPartialValues: true });
  parser.onValue = ({ value, stack }) => {
    if (stack.length === 1 && typeof value === "string") onText(value);
  };
  return (chunk) => {
    if (failed) return;
    length += chunk.length;
    if (length > MAX_TEXT) { failed = true; return; }
    if (!started) {
      prefix += chunk;
      const opening = prefix.indexOf("{");
      if (opening < 0) return;
      // Only unwrap a JSON fence, never stream log lines or arbitrary prose.
      if (!/^\s*(?:```(?:json)?\s*)?$/i.test(prefix.slice(0, opening))) { failed = true; return; }
      chunk = prefix.slice(opening);
      prefix = "";
      started = true;
    }
    try { if (!parser.isEnded) parser.write(chunk); } catch { failed = true; }
  };
}

// One short-lived, password-protected loopback server per question. It uses the
// same scoped working directory, provider configuration and authentication as CLI.
export async function runOpenCodeStream({ command, args = [], cwd, env, prompt, model, agent, signal, timeoutMs, onEvent, terminate }) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Local agent request was cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error(`Local agent timed out after ${Math.round(timeoutMs / 60000)} minutes`)), timeoutMs);
  timer.unref?.();
  let child;
  let sessionId;
  let base;
  let reading;
  const streamController = new AbortController();
  const abortStream = () => streamController.abort();
  controller.signal.addEventListener("abort", abortStream, { once: true });
  const password = randomBytes(24).toString("hex");
  const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "content-type": "application/json" };
  const url = (route) => `${base}${route}?${new URLSearchParams({ directory: cwd })}`;
  const request = async (route, method = "GET", body, requestSignal = controller.signal) => {
    const response = await fetch(url(route), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: requestSignal });
    if (!response.ok) throw new Error(`OpenCode Server HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  let exited = false;
  let exitPromise;
  const toolIds = new Set();
  let metrics = { transport: "server", rounds: 0, toolCalls: 0 };
  try {
    controller.signal.throwIfAborted();
    onEvent({ type: "status", phase: "starting" });
    child = spawn(command, [...args, "serve", "--hostname", "127.0.0.1", "--port", "0"], {
      cwd, env: { ...env, OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password },
      detached: process.platform !== "win32", windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"]
    });
    exitPromise = new Promise((resolve) => child.once("close", () => { exited = true; resolve(); }));
    base = await new Promise((resolve, reject) => {
      let output = "";
      const startup = setTimeout(() => finish(new Error("OpenCode Server did not start within 15 seconds")), 15000);
      const onAbort = () => finish(controller.signal.reason);
      const onError = (error) => finish(error);
      const onClose = () => finish(new Error("OpenCode Server exited during startup"));
      const finish = (error, address) => {
        clearTimeout(startup);
        controller.signal.removeEventListener("abort", onAbort);
        child.stdout.off("data", onData);
        child.off("error", onError);
        child.off("close", onClose);
        if (error) reject(error); else resolve(address);
      };
      const onData = (chunk) => {
        output = (output + chunk).slice(-8192);
        const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(null, match[1]);
      };
      child.stdout.on("data", onData);
      child.stderr.resume();
      child.once("error", onError);
      child.once("close", onClose);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    child.stdout.resume();
    child.on("error", () => controller.abort(new Error("OpenCode Server process failed")));
    child.once("close", () => controller.abort(new Error("OpenCode Server stopped before the answer completed")));
    sessionId = (await request("/session", "POST", { title: "Viki" })).id;
    if (!sessionId) throw new Error("OpenCode Server did not create a session");
    const assistants = new Set();
    const parts = new Map();
    let currentMessage = "";
    let streamError;
    const streamResponse = await fetch(url("/event"), { headers, signal: streamController.signal });
    reading = readAnswerEvents(streamResponse, (_type, event) => {
      const p = event.properties || {};
      if ((p.sessionID || p.part?.sessionID || p.info?.sessionID) !== sessionId) return;
      if (event.type === "session.error") { streamError = new Error(p.error?.data?.message || p.error?.name || "OpenCode request failed"); return; }
      if (event.type === "message.updated" && p.info.role === "assistant") {
        assistants.add(p.info.id);
        if (p.info.error) streamError = new Error(p.info.error.data?.message || p.info.error.name || "OpenCode request failed");
      }
      if (event.type === "message.part.updated" && assistants.has(p.part.messageID)) {
        const part = p.part;
        if (part.type === "tool") {
          toolIds.add(part.id);
          onEvent({ type: "status", phase: /web|search/.test(part.tool) ? "searching" : "reading" });
        } else if (part.type === "reasoning") {
          onEvent({ type: "status", phase: "thinking" });
        } else if (part.type === "text") {
          if (currentMessage !== part.messageID) {
            currentMessage = part.messageID;
            onEvent({ type: "text", text: "" });
          }
          let tracked = parts.get(part.id);
          if (!tracked) {
            tracked = { text: "", decode: createAnswerDecoder((text) => {
              onEvent({ type: "status", phase: "generating" });
              onEvent({ type: "text", text });
            }) };
            parts.set(part.id, tracked);
          }
          if (typeof part.text === "string" && part.text.startsWith(tracked.text)) {
            tracked.decode(part.text.slice(tracked.text.length));
            tracked.text = part.text;
          }
        }
      }
      if (event.type === "message.part.delta" && p.field === "text" && assistants.has(p.messageID)) {
        const tracked = parts.get(p.partID);
        if (tracked && typeof p.delta === "string") {
          if (tracked.text.length + p.delta.length > MAX_TEXT) throw new Error("OpenCode answer exceeded the size limit");
          tracked.text += p.delta;
          tracked.decode(p.delta);
        }
      }
    }).catch(() => {}); // The session is authoritative; a lost event connection cannot rerun the prompt.
    const separator = String(model || "").indexOf("/");
    await request(`/session/${sessionId}/prompt_async`, "POST", {
      ...(agent ? { agent } : {}),
      ...(separator > 0 ? { model: { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) } } : {}),
      parts: [{ type: "text", text: prompt }]
    });
    onEvent({ type: "status", phase: "thinking" });
    while (true) {
      await delay(1000, undefined, { signal: controller.signal });
      if (streamError) throw streamError;
      const messages = await request(`/session/${sessionId}/message`);
      const assistantMessages = messages.filter((message) => message.info.role === "assistant");
      metrics = { transport: "server", rounds: assistantMessages.length, toolCalls: toolIds.size,
        usage: assistantMessages.reduce((total, message) => ({
          promptTokens: total.promptTokens + (message.info.tokens?.input || 0),
          completionTokens: total.completionTokens + (message.info.tokens?.output || 0),
          reasoningTokens: total.reasoningTokens + (message.info.tokens?.reasoning || 0)
        }), { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 }) };
      const last = messages.filter((message) => message.info.role === "assistant").at(-1);
      if (last?.info.error) throw new Error(last.info.error.data?.message || last.info.error.name || "OpenCode request failed");
      if (last?.info.time?.completed && last.info.finish && !["tool-calls", "unknown"].includes(last.info.finish)) {
        const statuses = await request("/session/status");
        if (statuses[sessionId] && statuses[sessionId].type !== "idle") continue;
        if (last.info.finish === "length") throw new Error("OpenCode answer reached the model output limit; please narrow the question");
        const text = last.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
        if (!text.trim()) throw new Error("OpenCode finished without an answer. Please retry the question.");
        if (text.length > MAX_TEXT) throw new Error("OpenCode answer exceeded the size limit");
        return text;
      }
    }
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", abortStream);
    streamController.abort();
    await reading;
    if (sessionId && !exited) {
      if (controller.signal.aborted) await request(`/session/${sessionId}/abort`, "POST", undefined, AbortSignal.timeout(1500)).catch(() => {});
      await request(`/session/${sessionId}`, "DELETE", undefined, AbortSignal.timeout(1500)).catch(() => {});
    }
    if (child && !exited) {
      terminate(child, "SIGTERM");
      await Promise.race([exitPromise, delay(1500)]);
      if (!exited) { terminate(child, "SIGKILL"); await Promise.race([exitPromise, delay(1500)]); }
    }
    onEvent({ type: "metrics", metrics });
  }
}
