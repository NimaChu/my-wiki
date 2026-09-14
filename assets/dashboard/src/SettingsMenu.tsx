import { useEffect, useRef, useState } from "react";
import { Bot, KeyRound, LoaderCircle, Save, Settings, ShieldCheck, Sparkles, Trash2, Wrench } from "lucide-react";
import { AgentInfo, DashboardSession, localApi, VikiApiSettings } from "./api";
import { AgentModelOptions, VikiExecutionOptions } from "./VikiExecutionOptions";
import { ThemeControl } from "./ThemeControl";
import { Dialog, GithubAccessDialog } from "./WorkspaceActions";
import "./settings.css";

type SettingsView = "api" | "access" | "repair" | "distill" | "viki";
const agentSettingTitle = (kind: "repair" | "distill" | "viki", zh: boolean) => kind === "repair" ? (zh ? "修复 Agent 设置" : "Repair agent settings") : kind === "distill" ? (zh ? "蒸馏 Agent 设置" : "Distillation agent settings") : (zh ? "Viki 设置" : "Viki settings");

export function SettingsMenu({ language }: { language: "zh" | "en" }) {
  const zh = language === "zh";
  const menu = useRef<HTMLDetailsElement>(null);
  const [session, setSession] = useState<DashboardSession | null>(null);
  const [view, setView] = useState<SettingsView | null>(null);
  useEffect(() => {
    let cancelled = false;
    void localApi.session().then((value) => { if (!cancelled) setSession(value); }).catch(() => {});
    const close = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => { cancelled = true; document.removeEventListener("pointerdown", close); };
  }, []);
  const open = (next: SettingsView) => { if (menu.current) menu.current.open = false; setView(next); };
  const close = () => { setView(null); menu.current?.querySelector("summary")?.focus(); };
  return <>
    <details ref={menu} className="settings-control" onKeyDown={(event) => { if (event.key === "Escape" && menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }}>
      <summary aria-label={zh ? "设置" : "Settings"} title={zh ? "设置" : "Settings"}><Settings size={17} /></summary>
      <div className="settings-menu" role="group" aria-label={zh ? "设置" : "Settings"}>
        <ThemeControl language={language} />
        {(["repair", "distill", "viki"] as const).map((kind) => {
          const Icon = kind === "repair" ? Wrench : kind === "distill" ? Sparkles : Bot;
          return <button key={kind} type="button" className="settings-menu-command" onClick={() => open(kind)}><Icon size={16} /><span>{agentSettingTitle(kind, zh)}</span></button>;
        })}
        {session?.canManageProviders ? <button type="button" className="settings-menu-command" onClick={() => open("api")}><KeyRound size={16} /><span>{zh ? "API 配置" : "API configuration"}</span></button> : null}
        {session?.canManageAccess ? <button type="button" className="settings-menu-command" onClick={() => open("access")}><ShieldCheck size={16} /><span>{zh ? "GitHub 访问白名单" : "GitHub access allowlist"}</span></button> : null}
      </div>
    </details>
    {view === "api" ? <ApiConfiguration language={language} onClose={close} /> : null}
    {view === "access" ? <GithubAccessDialog language={language} onClose={close} /> : null}
    {view === "repair" || view === "distill" || view === "viki" ? <AgentConfiguration kind={view} language={language} onClose={close} /> : null}
  </>;
}

function AgentConfiguration({ kind, language, onClose }: { kind: "repair" | "distill" | "viki"; language: "zh" | "en"; onClose: () => void }) {
  const zh = language === "zh";
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = info?.providers.find((item) => item.provider === provider);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([kind === "viki" ? localApi.vikiAgent() : localApi.agent(), localApi.agentPreferences()]).then(([agent, preferences]) => {
      if (cancelled) return;
      const saved = kind === "viki" ? { provider: preferences.viki.provider, model: "" } : preferences.queue[kind];
      setInfo(agent); setProvider(saved.provider || agent.defaultProvider || agent.providers[0]?.provider || ""); setModel(saved.model);
    }).catch((error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [kind]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  const save = async () => {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      const preferences = await localApi.saveAgentPreferences(kind === "viki" ? { viki: { provider } } : { queue: { [kind]: { provider, model } } });
      window.dispatchEvent(new CustomEvent("my-wiki:agent-preferences-updated", { detail: preferences }));
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog title={agentSettingTitle(kind, zh)} description="" onClose={() => { if (!busy) onClose(); }}>
    <form className="api-settings-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {info ? <fieldset className="agent-settings-fields" disabled={busy}>
        {kind === "viki" ? <VikiExecutionOptions providers={info.providers} provider={provider} language={language}
          onProviderChange={setProvider} /> : <>
          <label><span>Agent CLI</span><select aria-label="Agent CLI" value={provider} onChange={(event) => { setProvider(event.target.value); setModel(""); }}>
            {!provider ? <option value="">{zh ? "没有可用 CLI" : "No available CLI"}</option> : null}
            {provider && !selected ? <option value={provider}>{provider} · {zh ? "已保存" : "Saved"}</option> : null}
            {info.providers.map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}
          </select></label>
          <AgentModelOptions selected={selected} model={model} language={language} defaultModelLabel={`${zh ? "CLI 默认" : "CLI default"}${selected?.defaultModel ? ` · ${selected.defaultModel}` : ""}`} onModelChange={setModel} />
        </>}
      </fieldset> : !error ? <span role="status">{zh ? "正在加载" : "Loading"}</span> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
      <div className="api-settings-actions"><button type="submit" className="primary-button" disabled={!selected || busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}{zh ? "保存" : "Save"}</button></div>
    </form>
  </Dialog>;
}

function ApiConfiguration({ language, onClose }: { language: "zh" | "en"; onClose: () => void }) {
  const zh = language === "zh";
  const [data, setData] = useState<VikiApiSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    void localApi.apiSettings().then((value) => { if (!cancelled) { setData(value); input.current?.focus(); } }).catch((error) => { if (!cancelled) setError(String(error.message)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  const save = async (removeKey = false) => {
    if (!data || busy) return;
    if (removeKey && !window.confirm(zh ? "删除 DeepSeek API 密钥？后续对话将无法使用此 API。" : "Remove the DeepSeek API key? Future turns cannot use this API.")) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      setData(await localApi.saveApiSettings({ model: data.model, reasoningEffort: data.reasoningEffort,
        ...(removeKey ? { removeKey: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }));
      setApiKey(""); setSaved(true);
      window.dispatchEvent(new Event("my-wiki:providers-updated"));
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog title={zh ? "API 配置" : "API configuration"} description="" onClose={() => { if (!busy) onClose(); }}>
    <form className="api-settings-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="api-settings-provider"><strong>DeepSeek</strong><span>{data ? (data.configured ? (zh ? "已配置" : "Configured") : (zh ? "未配置" : "Not configured")) : (zh ? "正在加载" : "Loading")}</span></div>
      {data ? <>
        <label><span>API Key</span><input ref={input} type="password" autoComplete="new-password" spellCheck={false} disabled={busy || data.keySource === "environment"} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setSaved(false); }} placeholder={data.keySource === "environment" ? (zh ? "由服务环境变量管理" : "Managed by service environment") : data.configured ? (zh ? "已保存，留空保持不变" : "Saved; leave blank to keep") : (zh ? "输入 API 密钥" : "Enter API key")} /></label>
        <label><span>{zh ? "默认模型" : "Default model"}</span><select aria-label={zh ? "默认模型" : "Default model"} disabled={busy} value={data.model} onChange={(event) => { setData({ ...data, model: event.target.value }); setSaved(false); }}>{data.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
        <label><span>{zh ? "思考强度" : "Reasoning effort"}</span><select aria-label={zh ? "思考强度" : "Reasoning effort"} disabled={busy} value={data.reasoningEffort} onChange={(event) => { setData({ ...data, reasoningEffort: event.target.value as VikiApiSettings["reasoningEffort"] }); setSaved(false); }}><option value="low">{zh ? "低" : "Low"}</option><option value="high">{zh ? "高" : "High"}</option><option value="max">{zh ? "最高" : "Max"}</option></select></label>
      </> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
      {saved ? <p role="status">{zh ? "已保存" : "Saved"}</p> : null}
      <div className="api-settings-actions">
        {data?.keySource === "file" ? <button type="button" className="danger-button" disabled={busy} onClick={() => void save(true)}><Trash2 size={15} />{zh ? "删除密钥" : "Remove key"}</button> : null}
        <button type="submit" className="primary-button" disabled={!data || busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}{zh ? "保存" : "Save"}</button>
      </div>
    </form>
  </Dialog>;
}
