import { spawn } from "node:child_process";

export async function commandAvailable(command, args = ["--version"], { environment = process.env, timeout = 15_000 } = {}) {
  const result = await runExternalCommand(command, args, { environment, timeout }).catch(() => ({ code: -1 }));
  return result.code === 0;
}

export function runExternalCommand(command, args, { environment = process.env, timeout = 30 * 60 * 1000, cwd = undefined, onStdout = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, Math.max(1_000, Number(timeout || 0)));
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: Number.isInteger(code) ? code : -1, signal: signal || "", stdout, stderr });
    });
  });
}

export function cleanExternalError(value) {
  return String(value || "External document tool failed").replace(/\s+/g, " ").trim().slice(0, 1200);
}
