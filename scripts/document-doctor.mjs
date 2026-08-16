#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createLocalAgentRunner } from "./core/agent-service.mjs";

const checks = [
  check("MinerU", process.env.MY_WIKI_MINERU_COMMAND || "mineru", ["--version"], "Chinese technical PDF primary extractor"),
  checkPythonDocling()
];
const agentInfo = await createLocalAgentRunner({ env: process.env }).info();
const visionProviders = (agentInfo.providers || []).filter((item) => ["opencode", "codex"].includes(item.provider));
checks.push({
  name: "Agent vision",
  available: visionProviders.length > 0,
  detail: visionProviders.length
    ? `${visionProviders.map((item) => item.label).join(", ")} - bounded risk-page visual repair`
    : "not available - install and sign in to OpenCode or Codex"
});

for (const item of checks) {
  console.log(`${item.available ? "OK" : "--"}  ${item.name}: ${item.detail}`);
}
console.log("\nRouting: MinerU -> Docling when MinerU is unavailable -> PDF.js/Tesseract degraded fallback; OpenCode/Codex may repair only gated risk pages.");
if (!checks[0].available || !checks[1].available) console.log("Run npm run document:setup to install the recommended local engines.");
if (!checks[2].available) console.log("Install and sign in to OpenCode or Codex, then choose a vision-capable model for page repair.");

function check(name, command, args, role) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32", timeout: 15_000 });
  const output = `${result.stdout || ""}${result.stderr || ""}`.replace(/\s+/g, " ").trim();
  return { name, available: result.status === 0, detail: result.status === 0 ? `${output || "available"} - ${role}` : `not available - ${role}` };
}

function checkPythonDocling() {
  const configured = String(process.env.MY_WIKI_DOCLING_PYTHON || "").trim();
  const candidates = configured ? [configured] : process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const command of candidates) {
    const result = spawnSync(command, ["-c", "import importlib.metadata; print(importlib.metadata.version('docling'))"], { encoding: "utf8", shell: process.platform === "win32", timeout: 15_000 });
    if (result.status === 0) return { name: "Docling", available: true, detail: `${String(result.stdout || "").trim()} via ${command} - structured document adapter` };
  }
  const uv = spawnSync("uv", ["tool", "dir"], { encoding: "utf8", shell: process.platform === "win32", timeout: 15_000 });
  if (uv.status === 0) {
    const command = path.join(String(uv.stdout || "").trim(), "docling", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
    const result = spawnSync(command, ["-c", "import importlib.metadata; print(importlib.metadata.version('docling'))"], { encoding: "utf8", shell: process.platform === "win32", timeout: 15_000 });
    if (result.status === 0) return { name: "Docling", available: true, detail: `${String(result.stdout || "").trim()} via uv tool - structured document adapter` };
  }
  return { name: "Docling", available: false, detail: "not available - structured document adapter" };
}
