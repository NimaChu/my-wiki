#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDashboardApi } from "../core/dashboard-api.mjs";
import { createLocalAgentRunner } from "../core/agent-service.mjs";
import { readVikiApiConfig } from "../core/viki-api-config.mjs";
import { readAnswerEvents } from "../../assets/dashboard/src/answer-events.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const arguments_ = process.argv.slice(2);
const option = (name, fallback) => arguments_.includes(name) ? arguments_[arguments_.indexOf(name) + 1] : fallback;
const output = path.resolve(option("--output", path.join(os.tmpdir(), `mywiki-benchmark-${Date.now()}`)));
const repeats = Math.max(1, Math.min(3, Number(option("--repeats", "2")) || 2));
const config = await readVikiApiConfig();
if (!config.apiKey) throw new Error("Configure a DeepSeek key outside the repository before benchmarking");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mywiki-benchmark-vault-"));
const vault = path.join(root, "vault"), dashboard = path.join(root, "dashboard");
await fs.mkdir(output, { recursive: true, mode: 0o700 });
for (const directory of ["concepts", "references/sources", "references/assets", ".my-wiki"]) await fs.mkdir(path.join(vault, directory), { recursive: true });
await fs.mkdir(dashboard);
await fs.writeFile(path.join(dashboard, ".my-wiki-runtime.json"), JSON.stringify({ vault }));
const documents = {
  "aurora": { title: "Aurora 试点", body: "Aurora 是一个合成测试项目，并非真实产品。2026-09-01 批准的当前方案：6 个团队参与，为期 8 周，验收要求错误率低于 2%。项目仍处于准备期，尚未启动。2026-08-01 草案中的 4 个团队、6 周已作废。\n\n适用场景：需要分阶段评估可靠性的受控上线。前提与停止条件见 [运行手册](./runbook.md)。" },
  "runbook": { title: "Aurora 运行手册", body: "准备条件：指定负责人；验证回滚脚本。上线步骤：先在 1 个团队试运行，再逐步扩到 6 个团队。停止条件：错误率连续 15 分钟超过 2%，立即停止扩展并执行回滚。这个停止阈值与试点验收目标是不同用途的条件。" },
  "vega": { title: "Vega 快速验证", body: "Vega 是合成测试策略。由 2 个团队进行为期 2 周的验证，适合低风险、可逆的界面文案调整。不可将其用于高风险基础设施发布。与 [Aurora](./aurora.md) 相比，它优先缩短反馈周期，而非分阶段验证可靠性。" },
  "panel": { title: "Aurora 监控面板", body: "这是 Aurora 试点使用的合成监控界面。两个分区的标题以及示例数字只能从下图读取；它们不是项目已运行的证据。\n\n![监控面板](../references/assets/aurora-panel.png)" },
  "hidden": { title: "Vela 排队定理", galaxy: "数学", body: "这是仅用于范围隔离测试的虚构定理。ALPHA_7429 的值为 637。此资料不属于 AI 星系。" }
};
for (const [id, document] of Object.entries(documents)) await fs.writeFile(path.join(vault, `concepts/${id}.md`), `---\ntitle: ${document.title}\ntype: Concept\nstatus: stable\nuniverses: [${document.galaxy || "AI"}]\n---\n# ${document.title}\n\n${document.body}\n`);
const require = createRequire(path.join(repo, "assets/dashboard/package.json"));
const { createCanvas } = require("@napi-rs/canvas");
const canvas = createCanvas(1000, 500), drawing = canvas.getContext("2d");
drawing.fillStyle = "#f3f5f8"; drawing.fillRect(0, 0, 1000, 500);
drawing.fillStyle = "#144f49"; drawing.fillRect(30, 70, 450, 360);
drawing.fillStyle = "#932f51"; drawing.fillRect(520, 70, 450, 360);
drawing.fillStyle = "white"; drawing.font = "bold 38px sans-serif";
drawing.fillText("Run Status", 60, 150); drawing.fillText("Risk Alerts", 550, 150);
drawing.font = "bold 74px sans-serif"; drawing.fillText("42", 60, 290); drawing.fillText("3", 550, 290);
await fs.writeFile(path.join(vault, "references/assets/aurora-panel.png"), canvas.toBuffer("image/png"));
await promisify(execFile)(process.execPath, [path.join(repo, "assets/dashboard/scripts/generate-graph.mjs")], { env: { ...process.env, MY_WIKI_VAULT: vault, MY_WIKI_GRAPH_OUTPUT: path.join(vault, ".my-wiki/dashboard-graph.json") } });
const cases = [
  { id: "facts", question: "Aurora 当前试点有几个团队、周期多长、验收目标是什么？请辨别旧草案，并说明项目已经开始了吗。控制在180字内，附参考证据。", expected: "6 teams; 8 weeks; error rate <2%; old 4-team/6-week draft obsolete; not started.", checks: [/6|六/, /8|八/, /2\s*%/, /未|尚|准备|没有/] },
  { id: "synthesis", question: "把 Aurora 的准备条件、分阶段上线步骤与停止条件整理成表格。区分验收目标和停止阈值，不要推断已上线。180字以内，附证据。", expected: "Owner and tested rollback; 1 then 6 teams; >2% for 15 minutes stops rollout and rolls back. <2% acceptance is separate.", checks: [/\|/, /回滚/, /15|十五/, /负责人/, /6|六/] },
  { id: "image", question: "Aurora 监控面板图中两个分区的标题分别是什么、各自显示什么数字？必须查看图片，不要凭文字猜，回答中附上这张图和参考证据。120字以内。", expected: "Run Status=42; Risk Alerts=3; include the local image and its source.", checks: [/42/, /3|三/, /Run Status|运行状态/i, /Risk Alerts|风险告警|风险警报/i], image: true },
  { id: "scope", question: "Vela 排队定理中 ALPHA_7429 的值是多少？只基于当前选中的 AI 星系，不要查其他星系。", expected: "Refuse/insufficient selected evidence; never disclose 637 from the Mathematics galaxy.", checks: [/不足|没有|未|无法|缺少|不包含/], forbidden: /637/ },
  { id: "history", question: "那它与 Vega 在周期和适用场景上有什么区别？用一个简短表格回答并附证据。", history: [{ role: "user", content: "我们正在讨论 Aurora 试点。" }, { role: "assistant", content: "Aurora 是用于分阶段评估可靠性的受控上线方案。" }], expected: "Aurora=8 weeks, controlled reliability rollout; Vega=2 weeks, low-risk reversible copy changes, not high-risk infrastructure.", checks: [/\|/, /8|八/, /2|两|二/, /低风险|文案/, /可靠|受控/] }
].filter((item) => !option("--case", "") || item.id === option("--case", ""));
const runner = createLocalAgentRunner({ env: { ...process.env, MY_WIKI_AGENT_PROVIDER: "opencode",
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { deepseek: { options: { apiKey: config.apiKey } } } }) } });
const server = http.createServer(createDashboardApi({ dashboardRoot: dashboard, port: 0, agentRunner: runner }));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  const { token } = await (await fetch(base + "/api/v1/session")).json();
  const headers = { "x-my-wiki-token": token, "content-type": "application/json" };
  for (let repeat = 0; repeat < repeats; repeat++) for (const scenario of cases) {
    const providers = (repeat + cases.indexOf(scenario)) % 2 ? ["deepseek-api", "opencode"] : ["opencode", "deepseek-api"];
    for (const provider of providers) {
      const started = Date.now();
      const response = await fetch(base + "/api/v1/agent/ask", { method: "POST", headers, body: JSON.stringify({
        provider, model: provider === "opencode" ? "deepseek/deepseek-flash" : "deepseek-flash", question: scenario.question,
        history: scenario.history || [], galaxies: ["AI"], language: "zh", webSearch: false,
        conversationId: `benchmark_${scenario.id}_${repeat}_${provider}`
      }) });
      const initial = await response.json();
      assert.equal(response.status, 202, JSON.stringify(initial));
      let terminal, firstTextMs, increments = 0;
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 120000);
      try {
        await readAnswerEvents(await fetch(base + `/api/v1/jobs/${initial.id}/events`, { headers, signal: controller.signal }), (type, data) => {
          if (type === "delta" && data.delta) { firstTextMs ??= Date.now() - started; increments++; }
          if (type === "done") terminal = data;
        });
      } catch {
        await fetch(base + `/api/v1/agent/query?job=${initial.id}`, { method: "DELETE", headers });
        terminal = await (await fetch(base + `/api/v1/jobs/${initial.id}`, { headers })).json();
      } finally { clearTimeout(deadline); }
      const answer = terminal?.result?.answerMarkdown || "";
      const result = { case: scenario.id, repeat: repeat + 1, provider, question: scenario.question, expected: scenario.expected,
        status: terminal?.status || "disconnected", error: terminal?.error || "", firstTextMs, totalMs: Date.now() - started,
        increments, characters: answer.length, checks: scenario.checks.map((pattern) => ({ pattern: pattern.source, pass: pattern.test(answer) })),
        forbiddenAbsent: !scenario.forbidden || !scenario.forbidden.test(answer), imagePresent: !scenario.image || !!terminal?.result?.images?.length,
        answer: terminal?.result, performance: terminal?.meta?.performance };
      results.push(result);
      await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ model: "deepseek-flash", date: new Date().toISOString(), repeats, cases: cases.map(({ checks, forbidden, ...item }) => item), results }, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ case: result.case, repeat: result.repeat, provider, status: result.status, firstTextMs, totalMs: result.totalMs,
        checks: `${result.checks.filter((item) => item.pass).length}/${result.checks.length}`, imagePresent: result.imagePresent }));
    }
  }
  await fs.cp(vault, path.join(output, "fixture"), { recursive: true });
  const median = (values) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : 0; };
  const lines = ["# Viki Transport Benchmark", "", "Controlled synthetic evidence; same DeepSeek Flash model and API credential; default high thinking; web disabled; provider order alternated. This is an end-to-end architecture comparison, not a pure transport benchmark. Automatic checks are keyword/format checks, not a complete quality score. Review each answer against the expected facts below.", "", "| Path | Completed | Median first text | Median total |", "| --- | --- | --- | --- |"];
  for (const provider of ["opencode", "deepseek-api"]) {
    const group = results.filter((item) => item.provider === provider), successful = group.filter((item) => item.status === "complete");
    lines.push(`| ${provider} | ${successful.length}/${group.length} | ${(median(successful.map((item) => item.firstTextMs)) / 1000).toFixed(2)} s | ${(median(successful.map((item) => item.totalMs)) / 1000).toFixed(2)} s |`);
  }
  for (const result of results) lines.push("", `## ${result.case} / ${result.provider} / ${result.repeat}`, "", result.question, "", `Expected: ${result.expected}`, "", `Status: ${result.status}; first text: ${result.firstTextMs} ms; total: ${result.totalMs} ms`, "", result.answer?.answerMarkdown || result.error, "", `Sources: ${(result.answer?.sources || []).map((item) => item.path).join(", ")}`, `Images: ${(result.answer?.images || []).map((item) => item.path).join(", ")}`);
  await fs.writeFile(path.join(output, "report.md"), lines.join("\n"), { mode: 0o600 });
  console.log(JSON.stringify({ output, calls: results.length }));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
}
