#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const MINERU_VERSION = "3.4.4";

const current = run("mineru", ["--version"], { quiet: true });
if (current.status === 0 && current.output.includes(MINERU_VERSION)) {
  console.log(`MinerU ${MINERU_VERSION} is already available.`);
  process.exit(0);
}

const uv = run("uv", ["--version"], { quiet: true });
if (uv.status !== 0) {
  console.error("The optional high-fidelity PDF engine requires uv. Install it from https://docs.astral.sh/uv/getting-started/installation/ and rerun npm run pdf:setup.");
  process.exit(1);
}

console.log(`Installing MinerU ${MINERU_VERSION}. Model files are downloaded by MinerU when first needed.`);
const installed = run("uv", [
  "tool",
  "install",
  "--force",
  "--python",
  "3.11",
  ...(process.platform === "linux" ? ["--index", "https://download.pytorch.org/whl/cpu", "--index-strategy", "unsafe-best-match"] : []),
  `mineru[core]==${MINERU_VERSION}`
]);
if (installed.status !== 0) process.exit(installed.status || 1);

const verified = run("mineru", ["--version"]);
if (verified.status !== 0 || !verified.output.includes(MINERU_VERSION)) {
  console.error("MinerU was installed, but its executable is not visible on PATH. Restart the terminal or add the uv tool bin directory to PATH.");
  process.exit(1);
}

function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: quiet ? "pipe" : ["inherit", "pipe", "pipe"]
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (!quiet && output) console.log(output);
  return { status: result.status ?? 1, output };
}
