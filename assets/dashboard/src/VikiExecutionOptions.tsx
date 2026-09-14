import { useEffect, useRef, useState } from "react";
import type { AgentProvider } from "./api";

function modeOf(provider?: AgentProvider) {
  return provider?.executionMode || (provider?.provider.endsWith("-api") ? "api" : "cli");
}

export function VikiExecutionOptions({ providers, provider, language, onProviderChange }: {
  providers: AgentProvider[]; provider: string; language: "zh" | "en";
  onProviderChange: (value: string) => void;
}) {
  const selected = providers.find((item) => item.provider === provider);
  const [mode, setMode] = useState<"api" | "cli">(() => selected ? modeOf(selected) : provider.endsWith("-api") ? "api" : "cli");
  const remembered = useRef({ api: "", cli: "" });
  useEffect(() => {
    if (selected) { const next = modeOf(selected); setMode(next); remembered.current[next] = selected.provider; }
  }, [selected]);
  const choices = providers.filter((item) => modeOf(item) === mode);
  const zh = language === "zh";
  return <>
    <label><span>{zh ? "执行方式" : "Execution mode"}</span>
      <select aria-label={zh ? "执行方式" : "Execution mode"} value={mode} onChange={(event) => {
        const next = event.target.value as "api" | "cli";
        setMode(next);
        const available = providers.filter((item) => modeOf(item) === next);
        onProviderChange(available.find((item) => item.provider === remembered.current[next])?.provider || available[0]?.provider || "");
      }}><option value="api">API</option><option value="cli">CLI</option></select>
    </label>
    <label><span>{mode === "api" ? (zh ? "API 服务" : "API service") : "Agent CLI"}</span>
      <select aria-label={mode === "api" ? (zh ? "API 服务" : "API service") : "Agent CLI"} value={provider} disabled={!choices.length} onChange={(event) => onProviderChange(event.target.value)}>
        {!provider ? <option value="">{zh ? (mode === "api" ? "尚未配置 API" : "没有可用 CLI") : mode === "api" ? "No configured API" : "No available CLI"}</option> : null}
        {provider && !selected ? <option value={provider}>{provider} · {zh ? "已保存" : "Saved"}</option> : null}
        {choices.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}
      </select>
    </label>
  </>;
}

export function AgentModelOptions({ selected, model, language, defaultModelLabel, onModelChange }: {
  selected?: AgentProvider; model: string; language: "zh" | "en"; defaultModelLabel: string; onModelChange: (value: string) => void;
}) {
  const zh = language === "zh";
  return <label><span>{zh ? "模型" : "Model"}</span>
    <select aria-label={zh ? "模型" : "Model"} value={model} disabled={!selected} onChange={(event) => onModelChange(event.target.value)}>
      <option value="">{selected ? defaultModelLabel : (zh ? "未选择" : "Not selected")}</option>
      {model && !selected?.models.some((item) => item.id === model) ? <option value={model}>{model} · {zh ? "已保存" : "Saved"}</option> : null}
      {selected?.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </label>;
}
