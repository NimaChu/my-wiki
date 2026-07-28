import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Download, FileUp, Inbox, Link2, LoaderCircle, Orbit, Plus, Upload, X } from "lucide-react";
import { InboxItem, Job, localApi, UniverseSummary, waitForJob } from "./api";

type Language = "en" | "zh";
type ActionView = "add" | "universes" | null;
type AddTab = "link" | "file" | "inbox";

const labels = {
  en: {
    addKnowledge: "Add knowledge",
    manageUniverses: "Galaxies",
    addTitle: "Add knowledge to Inbox",
    addDescription: "Capture evidence now. Your agent can distill and connect it later.",
    link: "Web link",
    file: "File upload",
    inbox: "Inbox",
    url: "Webpage URL",
    title: "Title",
    optionalTitle: "Optional title",
    collection: "Collection",
    optionalCollection: "Optional provenance label",
    capture: "Add to Inbox",
    chooseFile: "Choose a file",
    dropHint: "PDF, Markdown, HTML, text, images, and office documents",
    selectedFile: "Selected file",
    noInbox: "Inbox is clear",
    refresh: "Refresh",
    close: "Close",
    success: "Added to Inbox",
    addAnother: "Add another",
    universeTitle: "Knowledge galaxies",
    universeDescription: "Export one galaxy or preview a package before importing it.",
    wikiPages: "{count} Wiki planets",
    rawSources: "{count} raw",
    export: "Export",
    exporting: "Exporting",
    download: "Download package",
    importPackage: "Import a galaxy package",
    rename: "Galaxy name after import",
    optionalRename: "Keep the package name",
    previewImport: "Preview import",
    preview: "Import preview",
    write: "New",
    deduplicate: "Duplicates",
    conflicts: "Conflicts",
    applyImport: "Confirm import",
    importing: "Importing",
    imported: "Knowledge galaxy imported",
    loading: "Loading",
    pending: "Inbox items",
    source: "Source",
    snapshot: "Original",
    pdfText: "PDF text",
    pdfNeedsOcr: "No searchable text was extracted; OCR is required.",
    noOriginal: "No local original",
    requiredUrl: "Enter a webpage URL.",
    requiredFile: "Choose a file first.",
    requiredPackage: "Choose a .mywiki package first."
  },
  zh: {
    addKnowledge: "添加知识",
    manageUniverses: "知识星系",
    addTitle: "添加知识到 Inbox",
    addDescription: "先保存完整证据，之后再由 Agent 蒸馏并建立关系。",
    link: "网页链接",
    file: "上传文件",
    inbox: "Inbox",
    url: "网页链接",
    title: "标题",
    optionalTitle: "可选标题",
    collection: "来源集合",
    optionalCollection: "可选的来源标记",
    capture: "添加到 Inbox",
    chooseFile: "选择文件",
    dropHint: "支持 PDF、Markdown、HTML、文本、图片和 Office 文档",
    selectedFile: "已选择",
    noInbox: "Inbox 当前为空",
    refresh: "刷新",
    close: "关闭",
    success: "已添加到 Inbox",
    addAnother: "继续添加",
    universeTitle: "知识星系",
    universeDescription: "导出单个星系，或在确认前预览知识包导入内容。",
    wikiPages: "{count} 个 Wiki 星球",
    rawSources: "{count} 条 raw",
    export: "导出",
    exporting: "正在导出",
    download: "下载知识包",
    importPackage: "导入知识星系包",
    rename: "导入后的星系名",
    optionalRename: "默认沿用知识包名称",
    previewImport: "预览导入",
    preview: "导入预览",
    write: "新增",
    deduplicate: "重复",
    conflicts: "冲突",
    applyImport: "确认导入",
    importing: "正在导入",
    imported: "知识星系已导入",
    loading: "正在加载",
    pending: "Inbox 条目",
    source: "来源",
    snapshot: "原件",
    pdfText: "PDF 文本",
    pdfNeedsOcr: "未提取到可搜索文本，需要 OCR。",
    noOriginal: "没有本地原件",
    requiredUrl: "请输入网页链接。",
    requiredFile: "请先选择一个文件。",
    requiredPackage: "请先选择一个 .mywiki 知识包。"
  }
} as const;

export function WorkspaceActions({ language }: { language: Language }) {
  const [view, setView] = useState<ActionView>(null);
  const l = labels[language];
  return (
    <>
      <div className="workspace-actions">
        <button type="button" className="workspace-action primary" onClick={() => setView("add")}>
          <Plus size={16} aria-hidden="true" />
          <span>{l.addKnowledge}</span>
        </button>
        <button type="button" className="workspace-action" onClick={() => setView("universes")}>
          <Orbit size={16} aria-hidden="true" />
          <span>{l.manageUniverses}</span>
        </button>
      </div>
      {view === "add" ? <AddKnowledgeDialog language={language} onClose={() => setView(null)} /> : null}
      {view === "universes" ? <UniverseDialog language={language} onClose={() => setView(null)} /> : null}
    </>
  );
}

function AddKnowledgeDialog({ language, onClose }: { language: Language; onClose: () => void }) {
  const l = labels[language];
  const [tab, setTab] = useState<AddTab>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [collection, setCollection] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadInbox = async () => {
    setLoadingInbox(true);
    setError("");
    try {
      setInbox((await localApi.inbox()).items);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoadingInbox(false);
    }
  };

  useEffect(() => {
    localApi.collections().then(({ collections: values }) => setCollections(values.map((item) => item.name))).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "inbox") void loadInbox();
  }, [tab]);

  const submit = async () => {
    setError("");
    if (tab === "link" && !url.trim()) return setError(l.requiredUrl);
    if (tab === "file" && !file) return setError(l.requiredFile);
    setBusy(true);
    try {
      const captured = tab === "link"
        ? await localApi.captureUrl({ url: url.trim(), title: title.trim(), collection: collection.trim() })
        : await localApi.captureFile(file!, { title: title.trim(), collection: collection.trim() });
      setResult(captured);
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setUrl("");
    setTitle("");
    setCollection("");
    setFile(null);
    setResult(null);
    setError("");
  };

  return (
    <Dialog title={l.addTitle} description={l.addDescription} onClose={onClose}>
      <div className="dialog-tabs" role="tablist">
        <TabButton active={tab === "link"} onClick={() => setTab("link")} icon={<Link2 size={15} />} label={l.link} />
        <TabButton active={tab === "file"} onClick={() => setTab("file")} icon={<FileUp size={15} />} label={l.file} />
        <TabButton active={tab === "inbox"} onClick={() => setTab("inbox")} icon={<Inbox size={15} />} label={l.inbox} />
      </div>

      {result ? (
        <div className="operation-success">
          <BookOpen size={28} aria-hidden="true" />
          <h3>{l.success}</h3>
          <p>{String(result.vaultRelative || result.path || "")}</p>
          <dl>
            <div><dt>{l.snapshot}</dt><dd>{String(result.snapshot || l.noOriginal)}</dd></div>
            {result.textExtraction ? (
              <div><dt>{l.pdfText}</dt><dd>{result.textExtraction === "complete" ? `${Number(result.extractedPages || 0)} ${language === "zh" ? "页" : "pages"} / ${Number(result.extractedCharacters || 0).toLocaleString()} ${language === "zh" ? "字符" : "characters"}` : l.pdfNeedsOcr}</dd></div>
            ) : null}
            <div><dt>{l.collection}</dt><dd>{String(result.collection || "-")}</dd></div>
          </dl>
          <div className="dialog-footer"><button type="button" onClick={reset}>{l.addAnother}</button><button className="primary-button" type="button" onClick={onClose}>{l.close}</button></div>
        </div>
      ) : tab === "inbox" ? (
        <div className="inbox-view">
          <div className="section-command-row">
            <span>{inbox.length} {l.pending}</span>
            <button type="button" onClick={loadInbox} disabled={loadingInbox}>{loadingInbox ? <LoaderCircle className="spin" size={15} /> : null}{l.refresh}</button>
          </div>
          {loadingInbox && inbox.length === 0 ? <p className="dialog-empty">{l.loading}</p> : null}
          {!loadingInbox && inbox.length === 0 ? <p className="dialog-empty">{l.noInbox}</p> : null}
          <div className="inbox-list">
            {inbox.map((item) => (
              <article key={item.id} className="inbox-row">
                <div><strong>{item.title}</strong><p>{item.preview}</p></div>
                <dl>
                  <div><dt>{l.source}</dt><dd>{item.sourceType || "-"}</dd></div>
                  <div><dt>{l.collection}</dt><dd>{item.collection || "-"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="dialog-form">
            {tab === "link" ? (
              <label className="field full"><span>{l.url}</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" autoFocus /></label>
            ) : (
              <button type="button" className="file-drop" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFile(event.dataTransfer.files?.[0] || null); }}>
                <Upload size={24} aria-hidden="true" />
                <strong>{file ? file.name : l.chooseFile}</strong>
                <span>{file ? `${l.selectedFile}: ${formatBytes(file.size)}` : l.dropHint}</span>
                <input ref={fileInput} type="file" hidden onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </button>
            )}
            <label className="field"><span>{l.title}</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={l.optionalTitle} /></label>
            <label className="field"><span>{l.collection}</span><input list="my-wiki-collections" value={collection} onChange={(event) => setCollection(event.target.value)} placeholder={l.optionalCollection} /></label>
            <datalist id="my-wiki-collections">{collections.map((item) => <option key={item} value={item} />)}</datalist>
          </div>
          {error ? <p className="dialog-error">{error}</p> : null}
          <div className="dialog-footer"><button type="button" onClick={onClose}>{l.close}</button><button className="primary-button" type="button" disabled={busy} onClick={submit}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{l.capture}</button></div>
        </>
      )}
      {tab === "inbox" && error ? <p className="dialog-error">{error}</p> : null}
    </Dialog>
  );
}

function UniverseDialog({ language, onClose }: { language: Language; onClose: () => void }) {
  const l = labels[language];
  const [universes, setUniverses] = useState<UniverseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeExport, setActiveExport] = useState("");
  const [download, setDownload] = useState<{ name: string; url: string } | null>(null);
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [rename, setRename] = useState("");
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  const [importState, setImportState] = useState<"idle" | "uploading" | "preview" | "applying" | "complete">("idle");
  const packageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localApi.universes().then(({ universes: values }) => setUniverses(values)).catch((nextError) => setError(errorMessage(nextError))).finally(() => setLoading(false));
  }, []);

  const exportOne = async (universe: string) => {
    setError("");
    setDownload(null);
    setActiveExport(universe);
    try {
      const complete = await waitForJob(await localApi.exportUniverse(universe));
      setDownload({ name: universe, url: await localApi.downloadUrl(complete.downloadUrl) });
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setActiveExport("");
    }
  };

  const previewImport = async () => {
    if (!packageFile) return setError(l.requiredPackage);
    setError("");
    setImportState("uploading");
    try {
      const complete = await waitForJob(await localApi.previewImport(packageFile, rename), setPreviewJob);
      setPreviewJob(complete);
      setImportState("preview");
    } catch (nextError) {
      setError(errorMessage(nextError));
      setImportState("idle");
    }
  };

  const applyImport = async () => {
    if (!previewJob) return;
    setError("");
    setImportState("applying");
    try {
      await waitForJob(await localApi.applyImport(previewJob.id, rename));
      setImportState("complete");
      setUniverses((await localApi.universes()).universes);
    } catch (nextError) {
      setError(errorMessage(nextError));
      setImportState("preview");
    }
  };

  const summary = previewJob?.result as any;
  return (
    <Dialog title={l.universeTitle} description={l.universeDescription} onClose={onClose} wide>
      <div className="universe-manager">
        <section className="universe-list-section">
          {loading ? <p className="dialog-empty">{l.loading}</p> : null}
          <div className="universe-list">
            {universes.map((universe) => (
              <article className="universe-row" key={universe.name}>
                <div><strong>{universe.name}</strong><span>{template(l.wikiPages, universe.wiki)} · {template(l.rawSources, universe.raw)}</span></div>
                <button type="button" disabled={Boolean(activeExport)} onClick={() => exportOne(universe.name)}>
                  {activeExport === universe.name ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
                  {activeExport === universe.name ? l.exporting : l.export}
                </button>
              </article>
            ))}
          </div>
          {download ? <a className="download-ready" href={download.url}><Download size={16} />{l.download}: {download.name}</a> : null}
        </section>

        <section className="import-section">
          <h3>{l.importPackage}</h3>
          <button type="button" className="file-drop compact" onClick={() => packageInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dropped = event.dataTransfer.files?.[0] || null; setPackageFile(dropped); setPreviewJob(null); setImportState("idle"); }}>
            <FileUp size={21} aria-hidden="true" />
            <strong>{packageFile?.name || l.chooseFile}</strong>
            <span>{packageFile ? formatBytes(packageFile.size) : ".mywiki"}</span>
            <input ref={packageInput} type="file" accept=".mywiki" hidden onChange={(event) => { setPackageFile(event.target.files?.[0] || null); setPreviewJob(null); setImportState("idle"); }} />
          </button>
          <label className="field full"><span>{l.rename}</span><input value={rename} onChange={(event) => setRename(event.target.value)} placeholder={l.optionalRename} /></label>
          {summary ? <ImportSummary language={language} summary={summary} /> : null}
          {importState === "complete" ? <p className="import-complete">{l.imported}</p> : null}
          <div className="section-command-row">
            {importState === "preview" ? <button className="primary-button" type="button" onClick={applyImport}><Upload size={15} />{l.applyImport}</button> : importState !== "complete" ? <button className="primary-button" type="button" disabled={importState === "uploading" || importState === "applying"} onClick={previewImport}>{importState === "uploading" || importState === "applying" ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{importState === "applying" ? l.importing : l.previewImport}</button> : null}
          </div>
        </section>
      </div>
      {error ? <p className="dialog-error">{error}</p> : null}
      <div className="dialog-footer"><button type="button" onClick={onClose}>{l.close}</button></div>
    </Dialog>
  );
}

function ImportSummary({ language, summary }: { language: Language; summary: any }) {
  const l = labels[language];
  const rows = [
    ["Wiki", summary.wiki],
    ["Raw", summary.raw],
    ["Assets", summary.assets],
    ["Snapshots", summary.snapshots]
  ];
  return (
    <div className="import-summary">
      <strong>{l.preview}: {summary.universe}</strong>
      <div className="import-summary-grid">
        {rows.map(([name, values]) => <div key={name as string}><span>{name as string}</span><b>{values?.write || 0}</b><small>{l.write}</small><b>{values?.deduplicate || 0}</b><small>{l.deduplicate}</small><b className={(values?.conflicts || 0) > 0 ? "has-conflict" : ""}>{values?.conflicts || 0}</b><small>{l.conflicts}</small></div>)}
      </div>
    </div>
  );
}

function Dialog({ title, description, onClose, wide = false, children }: { title: string; description: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`workspace-dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <header><div><h2 id="workspace-dialog-title">{title}</h2><p>{description}</p></div><button type="button" className="icon-button" aria-label={labels.en.close} onClick={onClose}><X size={18} /></button></header>
        {children}
      </section>
    </div>,
    document.body
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? "is-active" : ""} onClick={onClick}>{icon}{label}</button>;
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function template(value: string, count: number) {
  return value.replace("{count}", String(count));
}
