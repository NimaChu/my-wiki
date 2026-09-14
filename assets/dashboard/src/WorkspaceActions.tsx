import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArchiveRestore, BookOpen, FileArchive, FileUp, FolderUp, HardDrive, Inbox, Link2, LoaderCircle, NotebookPen, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { DriveGalaxy, GalaxyDialogMode, GalaxyTrashEntry, GithubAllowlist, InboxItem, Job, localApi, TaskProgress, UniverseSummary, waitForJob } from "./api";
import { maintenanceStageLabel } from "./maintenance-status";

const QuickNotes = lazy(() => import("./QuickNotes").then((module) => ({ default: module.QuickNotes })));
const GalaxyExport = lazy(() => import("./GalaxyExport").then((module) => ({ default: module.GalaxyExport })));
const OriginalsDrive = lazy(() => import("./OriginalsDrive").then((module) => ({ default: module.OriginalsDrive })));

type Language = "en" | "zh";
type ActionView = "notes" | "drive" | null;
type AddTab = "link" | "file" | "zip" | "inbox";
type UploadFile = { file: File; sourcePath: string };

const labels = {
  en: {
    addKnowledge: "Add knowledge",
    quickNotes: "Quick notes",
    addTitle: "Add knowledge",
    addDescription: "Capture evidence now. Your agent can distill and connect it later.",
    link: "Web link",
    file: "File upload",
    folder: "Folder",
    zip: "ZIP bundle",
    inbox: "Maintenance queue",
    url: "Webpage URL",
    title: "Title",
    optionalTitle: "Optional title",
    collection: "Collection",
    optionalCollection: "Optional provenance label",
    galaxy: "Knowledge galaxy",
    optionalGalaxy: "Optional; your agent can classify it during maintenance",
    createGalaxy: "New galaxy",
    createInitialGalaxy: "Create initial galaxy",
    galaxyNamePlaceholder: "Broad, durable knowledge domain",
    galaxyCreated: "Initial galaxy created",
    emptyGalaxy: "Initial galaxy · no concept planets yet",
    capture: "Add to maintenance queue",
    chooseFile: "Choose a file",
    chooseFolder: "Choose a folder",
    chooseZip: "Choose a ZIP bundle",
    dropHint: "PDF, Markdown, HTML, text, images, and office documents",
    folderHint: "Upload all documents in one folder and its subfolders",
    zipHint: "Markdown with relative image files",
    selectedFile: "Selected file",
    failedFiles: "Failed files",
    noInbox: "No pending maintenance tasks",
    refresh: "Refresh",
    close: "Close",
    success: "Source captured",
    status: "Status",
    addAnother: "Add another",
    wikiPages: "{count} concept planets",
    rawSources: "{count} references",
    recycleBin: "Recycle bin",
    recycleEmpty: "The recycle bin is empty",
    restoreGalaxy: "Restore galaxy",
    restoreGalaxyConfirm: "Re-import \"{name}\" from the recycle bin?",
    galaxyRestored: "Galaxy restored",
    permanentDelete: "Delete permanently",
    permanentDeletePrompt: "This permanently removes the archived package and cannot be undone. Type \"{name}\" to continue.",
    permanentlyDeleted: "Permanently deleted",
    deletedAt: "Deleted",
    deleteGalaxyMismatch: "The galaxy name did not match. Nothing was deleted.",
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
    uploading: "Uploading",
    queued: "Queued",
    extracting: "Extracting",
    failed: "Failed",
    pending: "maintenance tasks",
    source: "Source",
    snapshot: "Original",
    pdfText: "Readable content",
    pdfNeedsOcr: "No substantive readable content was extracted; follow-up is required.",
    noOriginal: "No local original",
    requiredUrl: "Enter a webpage URL.",
    requiredFile: "Choose a file first.",
    requiredFolder: "Choose a folder first.",
    requiredZip: "Choose a ZIP bundle first.",
    requiredPackage: "Choose a .mywiki package first.",
    preparingPreview: "Preparing import preview",
    writingImport: "Writing knowledge package",
    extractionProgress: "Extraction progress"
  },
  zh: {
    addKnowledge: "添加知识",
    quickNotes: "快速笔记",
    addTitle: "添加知识",
    addDescription: "先保存完整证据，之后再由 Agent 蒸馏并建立关系。",
    link: "网页链接",
    file: "上传文件",
    folder: "文件夹",
    zip: "ZIP 图文包",
    inbox: "维护队列",
    url: "网页链接",
    title: "标题",
    optionalTitle: "可选标题",
    collection: "来源集合",
    optionalCollection: "可选的来源标记",
    galaxy: "知识星系",
    optionalGalaxy: "可选；不选择时由 Agent 在维护时判断",
    createGalaxy: "新增星系",
    createInitialGalaxy: "新增初始星系",
    galaxyNamePlaceholder: "建议使用宽泛、长期稳定的知识分类",
    galaxyCreated: "初始星系已创建",
    emptyGalaxy: "初始星系 · 暂无概念星球",
    capture: "添加到维护队列",
    chooseFile: "选择文件",
    chooseFolder: "选择文件夹",
    chooseZip: "选择 ZIP 图文包",
    dropHint: "支持 PDF、Markdown、HTML、文本、图片和 Office 文档",
    folderHint: "批量上传文件夹及子文件夹中的文档",
    zipHint: "包含 Markdown 和相对路径引用的图片",
    selectedFile: "已选择",
    failedFiles: "失败文件",
    noInbox: "没有待处理的维护任务",
    refresh: "刷新",
    close: "关闭",
    success: "参考资料已保存",
    status: "状态",
    addAnother: "继续添加",
    wikiPages: "{count} 个概念星球",
    rawSources: "{count} 条参考资料",
    recycleBin: "回收站",
    recycleEmpty: "回收站为空",
    restoreGalaxy: "恢复星系",
    restoreGalaxyConfirm: "从回收站重新导入“{name}”？",
    galaxyRestored: "星系已恢复",
    permanentDelete: "永久删除",
    permanentDeletePrompt: "此操作会永久删除归档知识包且无法撤销。请输入“{name}”继续。",
    permanentlyDeleted: "已永久删除",
    deletedAt: "删除时间",
    deleteGalaxyMismatch: "输入的星系名称不匹配，未执行删除。",
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
    uploading: "正在上传",
    queued: "排队中",
    extracting: "正在提取",
    failed: "处理失败",
    pending: "项维护任务",
    source: "来源",
    snapshot: "原件",
    pdfText: "可读正文",
    pdfNeedsOcr: "未提取到有效正文，已锁定为待跟进。",
    noOriginal: "没有本地原件",
    requiredUrl: "请输入网页链接。",
    requiredFile: "请先选择一个文件。",
    requiredFolder: "请先选择一个文件夹。",
    requiredZip: "请先选择一个 ZIP 图文包。",
    requiredPackage: "请先选择一个 .mywiki 知识包。",
    preparingPreview: "正在解析导入预览",
    writingImport: "正在写入知识包",
    extractionProgress: "提取进度"
  }
} as const;

export function WorkspaceActions({ language }: { language: Language }) {
  const [view, setView] = useState<ActionView>(null);
  const [initialNotePath, setInitialNotePath] = useState("");
  const [addGalaxy, setAddGalaxy] = useState<string | null>(null);
  const [exportGalaxy, setExportGalaxy] = useState<DriveGalaxy | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRunning, setExportRunning] = useState(false);
  const [galaxyPanel, setGalaxyPanel] = useState<GalaxyDialogMode | null>(null);
  const l = labels[language];
  useEffect(() => {
    const openQuickNote = (event: Event) => {
      setInitialNotePath(String((event as CustomEvent<{ path?: string }>).detail?.path || ""));
      setView("notes");
    };
    window.addEventListener("my-wiki:open-quick-note", openQuickNote);
    return () => window.removeEventListener("my-wiki:open-quick-note", openQuickNote);
  }, []);
  return (
    <>
      <div className="workspace-actions">
        <button
          type="button"
          className="workspace-action primary"
          aria-label={language === "zh" ? "文档库" : "Library"}
          title={language === "zh" ? "文档库" : "Library"}
          onClick={() => setView("drive")}
        >
          <HardDrive size={16} aria-hidden="true" />
          <span>{language === "zh" ? "文档库" : "Library"}</span>
        </button>
        <button
          type="button"
          className="workspace-action"
          aria-label={l.quickNotes}
          title={l.quickNotes}
          onClick={() => { setInitialNotePath(""); setView("notes"); }}
        >
          <NotebookPen size={16} aria-hidden="true" />
          <span>{l.quickNotes}</span>
        </button>
      </div>
      {view === "notes" ? <Suspense fallback={null}><QuickNotes language={language} initialPath={initialNotePath} onClose={() => setView(null)} /></Suspense> : null}
      {view === "drive" ? <Suspense fallback={null}><OriginalsDrive language={language} onClose={() => setView(null)} onAdd={setAddGalaxy} onGalaxies={setGalaxyPanel} onExport={(galaxy) => { if (!exportRunning) setExportGalaxy(galaxy); setExportOpen(true); }} /></Suspense> : null}
      {exportGalaxy ? <Suspense fallback={null}><GalaxyExport key={exportGalaxy.id} galaxy={exportGalaxy} language={language} open={exportOpen} onOpen={() => setExportOpen(true)} onMinimize={() => setExportOpen(false)} onClose={() => setExportGalaxy(null)} onRunning={setExportRunning} /></Suspense> : null}
      {galaxyPanel ? <GalaxyDialog language={language} mode={galaxyPanel} onClose={() => { setGalaxyPanel(null); window.dispatchEvent(new Event("my-wiki:drive-updated")); }} onCreated={() => { setGalaxyPanel(null); window.dispatchEvent(new Event("my-wiki:drive-updated")); }} /> : null}
      {addGalaxy !== null ? <AddKnowledgeDialog language={language} initialGalaxy={addGalaxy} onClose={() => { setAddGalaxy(null); window.dispatchEvent(new Event("my-wiki:drive-updated")); }} /> : null}
    </>
  );
}

export function GithubAccessDialog({ language, onClose }: { language: Language; onClose: () => void }) {
  const zh = language === "zh";
  const [data, setData] = useState<GithubAllowlist | null>(null);
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    localApi.githubAllowlist().then((result) => { if (!cancelled) setData(result); }).catch((error) => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  const update = async (name: string, remove = false) => {
    if (busy) return;
    if (remove && !window.confirm(zh ? `移除 ${name} 的访问权限？该账号现有网页登录和 CLI 授权将无法继续访问。` : `Remove access for ${name}? Existing browser and CLI authorization will stop working.`)) return;
    setBusy(true);
    setError("");
    try {
      setData(await localApi.updateGithubAccess(name, remove));
      if (!remove) setLogin("");
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <Dialog title={zh ? "GitHub 访问白名单" : "GitHub access allowlist"} description={zh ? "白名单成员可访问和编辑同一份知识库。仅管理员可更改白名单。" : "Members can access and edit the same knowledge base. Only the owner can change this list."} onClose={() => { if (!busy) onClose(); }}>
    <div className="github-access-content">
      <form className="github-access-form" onSubmit={(event) => { event.preventDefault(); void update(login.trim()); }}>
        <label htmlFor="github-access-login">{zh ? "GitHub 用户名" : "GitHub username"}</label>
        <div><input id="github-access-login" autoFocus autoComplete="off" maxLength={39} value={login} onChange={(event) => setLogin(event.target.value)} placeholder="octocat" disabled={busy || !data} required /><button type="submit" disabled={busy || !data || !login.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{zh ? "添加" : "Add"}</button></div>
      </form>
      {error ? <p role="alert" className="github-access-error">{error}</p> : null}
      {!data && !error ? <p role="status">{zh ? "加载中…" : "Loading…"}</p> : null}
      <ul className="github-access-list">{data?.accounts.map((account) => <li key={account.login.toLowerCase()}><span>{account.login}</span>{account.owner ? <span className="github-access-owner">{zh ? "管理员" : "Owner"}</span> : <button type="button" className="icon-button" disabled={busy} title={zh ? "移除账号" : "Remove account"} aria-label={`${zh ? "移除账号" : "Remove account"}: ${account.login}`} onClick={() => void update(account.login, true)}><Trash2 size={16} /></button>}</li>)}</ul>
    </div>
  </Dialog>;
}

function AddKnowledgeDialog({ language, initialGalaxy = "", onClose }: { language: Language; initialGalaxy?: string; onClose: () => void }) {
  const l = labels[language];
  const [tab, setTab] = useState<AddTab>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [collection, setCollection] = useState("");
  const [suggestedUniverse, setSuggestedUniverse] = useState(initialGalaxy);
  const [universes, setUniverses] = useState<UniverseSummary[]>([]);
  const [showCreateGalaxy, setShowCreateGalaxy] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [readingFiles, setReadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const chooseFiles = (values: UploadFile[], hasFolder: boolean) => {
    const usable = values.filter((item) => !isIgnoredUploadPath(item.sourcePath));
    setError("");
    if (!usable.length) { setError(language === "zh" ? "没有可上传的文件，系统隐藏文件会被忽略。" : "No uploadable files. System files are ignored."); return; }
    if (hasFolder && !window.confirm(language === "zh" ? `将上传文件夹及子文件夹中的 ${usable.length} 个文件（${formatBytes(usable.reduce((sum, item) => sum + item.file.size, 0))}）。是否继续？` : `Upload all ${usable.length} files (${formatBytes(usable.reduce((sum, item) => sum + item.file.size, 0))}) in the selected folder and its subfolders?`)) return;
    setFiles(usable);
  };
  const dropFiles = async (transfer: DataTransfer) => {
    if (busy || readingFiles) return;
    setReadingFiles(true);
    try { const result = await droppedUploadFiles(transfer); chooseFiles(result.files, result.hasFolder); }
    catch (e) { setError(errorMessage(e)); }
    finally { setReadingFiles(false); }
  };

  const loadInbox = async (quiet = false) => {
    if (!quiet) setLoadingInbox(true);
    setError("");
    try {
      setInbox((await localApi.inbox()).items);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      if (!quiet) setLoadingInbox(false);
    }
  };

  useEffect(() => {
    localApi.collections().then(({ collections: values }) => setCollections(values.map((item) => item.name))).catch(() => {});
    localApi.universes().then(({ universes: values }) => setUniverses(values)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "inbox") void loadInbox();
  }, [tab]);

  useEffect(() => {
    if (tab !== "inbox") return;
    const timer = window.setInterval(() => void loadInbox(true), 1500);
    return () => window.clearInterval(timer);
  }, [tab]);

  const submit = async () => {
    setError("");
    if (tab === "link" && !url.trim()) return setError(l.requiredUrl);
    if (tab === "file" && !files.length) return setError(l.requiredFile);
    if (tab === "zip" && !zipFile) return setError(l.requiredZip);
    setBusy(true);
    setUploadProgress(null);
    try {
      let captured: Record<string, any>;
      if (tab === "link") {
        captured = await localApi.captureUrl({ url: url.trim(), title: title.trim(), collection: collection.trim(), suggestedUniverse });
      } else if (tab === "file" || tab === "zip") {
        const selected = tab === "zip" ? [{ file: zipFile!, sourcePath: zipFile!.name }] : files;
        setTab("inbox");
        const items: Job[] = [];
        const failures = [];
        const failedSelection: UploadFile[] = [];
        const totalBytes = selected.reduce((sum, item) => sum + item.file.size, 0);
        let completedBytes = 0;
        for (const item of selected) {
          try {
            items.push(await localApi.captureFile(item.file, { title: selected.length === 1 ? title.trim() : "", collection: collection.trim(), suggestedUniverse, sourcePath: item.sourcePath }, (uploaded) => setUploadProgress(Math.round((completedBytes + uploaded) / Math.max(1, totalBytes) * 100))));
          } catch (nextError) {
            failures.push(`${item.sourcePath}: ${errorMessage(nextError)}`);
            failedSelection.push(item);
          }
          completedBytes += item.file.size;
          setUploadProgress(Math.round(completedBytes / Math.max(1, totalBytes) * 100));
        }
        setFiles(failedSelection);
        window.dispatchEvent(new Event("my-wiki:drive-updated"));
        window.dispatchEvent(new Event("my-wiki:graph-updated"));
        if (failures.length) { setError(`${items.length} ${l.success}; ${l.failedFiles}: ${failures.join("; ")}`); return; }
        setZipFile(null);
        setTitle("");
        setTab("inbox");
        await loadInbox();
        return;
      } else return;
      setResult(captured);
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  };

  const reset = () => {
    setUrl("");
    setTitle("");
    setCollection("");
    setSuggestedUniverse("");
    setFiles([]);
    setZipFile(null);
    setResult(null);
    setError("");
  };

  const capturedItems = result ? (Array.isArray(result.items) && result.items.length ? result.items : [result]) : [];
  const representative = capturedItems[0] || null;
  const followupCount = capturedItems.filter((item) => item.status === "needs-followup").length;

  return (
    <Dialog title={l.addTitle} description={l.addDescription} onClose={() => { if (!busy && !readingFiles) onClose(); }}>
      <div className="dialog-tabs" role="tablist">
        <TabButton active={tab === "link"} onClick={() => { if (!busy && !readingFiles) setTab("link"); }} icon={<Link2 size={15} />} label={l.link} />
        <TabButton active={tab === "file"} onClick={() => { if (!busy && !readingFiles) setTab("file"); }} icon={<FileUp size={15} />} label={l.file} />
        <TabButton active={tab === "zip"} onClick={() => { if (!busy && !readingFiles) setTab("zip"); }} icon={<FileArchive size={15} />} label={l.zip} />
        <TabButton active={tab === "inbox"} onClick={() => setTab("inbox")} icon={<Inbox size={15} />} label={l.inbox} />
      </div>

      {result ? (
        <div className="operation-success">
          <BookOpen size={28} aria-hidden="true" />
          <h3>{l.success}</h3>
          <p>{result.count > 1 ? `${Number(result.count)} / ${Number(result.total || result.count)}` : String(representative?.vaultRelative || representative?.path || "")}</p>
          <dl>
            <div><dt>{l.status}</dt><dd>{followupCount ? (language === "zh" ? "待修复" : "Awaiting repair") : (language === "zh" ? "待蒸馏" : "Awaiting distillation")}</dd></div>
            <div><dt>{l.snapshot}</dt><dd>{String(representative?.snapshot || l.noOriginal)}</dd></div>
            {(representative?.extractionStatus || representative?.textExtraction) ? (
              <div><dt>{l.pdfText}</dt><dd>{(representative.extractionStatus || representative.textExtraction) === "complete" ? `${Number(representative.extractedPages || 0)} ${language === "zh" ? "页" : "pages"} / ${Number(representative.extractedCharacters || 0).toLocaleString()} ${language === "zh" ? "字符" : "characters"}` : String(representative.extractionMessage || l.pdfNeedsOcr)}</dd></div>
            ) : null}
            <div><dt>{l.collection}</dt><dd>{String(representative?.collection || "-")}</dd></div>
            <div><dt>{l.galaxy}</dt><dd>{String(representative?.suggestedUniverse || suggestedUniverse || "-")}</dd></div>
            {result.failures?.length ? <div><dt>{l.failedFiles}</dt><dd>{Number(result.failures.length)}</dd></div> : null}
          </dl>
          <div className="dialog-footer"><button type="button" onClick={reset}>{l.addAnother}</button><button className="primary-button" type="button" onClick={onClose}>{l.close}</button></div>
        </div>
      ) : tab === "inbox" ? (
        <div className="inbox-view">
          <div className="section-command-row">
            <span>{inbox.length} {l.pending}</span>
            <button type="button" onClick={() => void loadInbox()} disabled={loadingInbox}>{loadingInbox ? <LoaderCircle className="spin" size={15} /> : null}{l.refresh}</button>
          </div>
          {loadingInbox && inbox.length === 0 ? <p className="dialog-empty">{l.loading}</p> : null}
          {!loadingInbox && inbox.length === 0 ? <p className="dialog-empty">{l.noInbox}</p> : null}
          <div className="inbox-list">
            {inbox.map((item) => (
              <article key={item.id} className="inbox-row">
                <div><strong>{item.title}</strong><p>{item.preview}</p></div>
                {item.progress ? <ProgressBar progress={item.progress} language={language} /> : null}
                <dl>
                  <div>
                    <dt>{l.status}</dt>
                    <dd className={`inbox-status ${item.jobStatus || item.status}`}>
                      {item.jobStatus === "queued" || item.jobStatus === "running" ? <LoaderCircle className="spin" size={12} /> : null}
                      {maintenanceStageLabel(item, language)}
                    </dd>
                  </div>
                  <div><dt>{l.source}</dt><dd>{item.sourceType || "-"}</dd></div>
                  <div><dt>{l.collection}</dt><dd>{item.collection || "-"}</dd></div>
                  <div><dt>{l.galaxy}</dt><dd>{item.suggestedUniverse || "-"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="dialog-form" inert={busy || readingFiles ? true : undefined}>
            {tab === "link" ? (
              <label className="field full"><span>{l.url}</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" autoFocus /></label>
            ) : tab === "file" ? (
              <div className="unified-upload full" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void dropFiles(event.dataTransfer); }}>
                <button type="button" className="file-drop" onClick={() => fileInput.current?.click()}><Upload size={24} aria-hidden="true" /><strong>{files.length === 1 ? files[0].file.name : files.length ? `${files.length} ${language === "zh" ? "个文件" : "files"}` : l.chooseFile}</strong><span>{readingFiles ? l.loading : files.length ? formatBytes(files.reduce((sum, item) => sum + item.file.size, 0)) : l.dropHint}</span></button>
                <div className="upload-selection-actions"><button type="button" onClick={() => fileInput.current?.click()}><FileUp size={15} />{language === "zh" ? "选择文件（可多选）" : "Choose files"}</button><button type="button" onClick={() => folderInput.current?.click()}><FolderUp size={15} />{l.chooseFolder}</button></div>
                <input ref={fileInput} type="file" multiple hidden onChange={(event) => { const values = Array.from(event.target.files || []); if (values.length) chooseFiles(values.map((file) => ({ file, sourcePath: file.name })), false); event.target.value = ""; }} />
                <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as any)} onChange={(event) => { const values = Array.from(event.target.files || []); if (values.length) chooseFiles(values.map((file) => ({ file, sourcePath: file.webkitRelativePath || file.name })), true); event.target.value = ""; }} />
                {files.length ? <ul className="upload-file-list">{files.map((item, index) => <li key={`${item.sourcePath}-${index}`}><span title={item.sourcePath}>{item.sourcePath}</span><small>{formatBytes(item.file.size)}</small><button className="icon-button" title={language === "zh" ? "移除选择" : "Remove selection"} aria-label={`${language === "zh" ? "移除选择" : "Remove selection"} ${item.sourcePath}`} onClick={() => setFiles((values) => values.filter((_, i) => i !== index))}><X size={14} /></button></li>)}</ul> : null}
              </div>
            ) : (
              <button type="button" className="file-drop" onClick={() => zipInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dropped = event.dataTransfer.files?.[0] || null; setZipFile(dropped?.name.toLowerCase().endsWith(".zip") ? dropped : null); }}>
                <FileArchive size={24} aria-hidden="true" />
                <strong>{zipFile ? zipFile.name : l.chooseZip}</strong>
                <span>{zipFile ? `${l.selectedFile}: ${formatBytes(zipFile.size)}` : l.zipHint}</span>
                <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => setZipFile(event.target.files?.[0] || null)} />
              </button>
            )}
            {tab === "link" || (tab === "file" && files.length <= 1) ? <label className="field"><span>{l.title}</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={l.optionalTitle} /></label> : null}
            <label className={(tab === "file" && files.length > 1) || tab === "zip" ? "field full" : "field"}><span>{l.collection}</span><input list="my-wiki-collections" value={collection} onChange={(event) => setCollection(event.target.value)} placeholder={l.optionalCollection} /></label>
            <datalist id="my-wiki-collections">{collections.map((item) => <option key={item} value={item} />)}</datalist>
            <div className="field full"><span>{l.galaxy}</span><div className="field-with-action"><select aria-label={l.galaxy} value={suggestedUniverse} onChange={(event) => setSuggestedUniverse(event.target.value)}><option value="">{l.optionalGalaxy}</option>{universes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><button type="button" onClick={() => setShowCreateGalaxy(true)}><Plus size={15} />{l.createGalaxy}</button></div></div>
          </div>
          {error ? <p className="dialog-error">{error}</p> : null}
          <div className="dialog-footer"><button type="button" disabled={busy || readingFiles} onClick={onClose}>{l.close}</button><button className="primary-button" type="button" disabled={busy || readingFiles} onClick={submit}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{busy && uploadProgress !== null ? `${l.uploading} ${uploadProgress}%` : l.capture}</button></div>
        </>
      )}
      {tab === "inbox" && error ? <p className="dialog-error">{error}</p> : null}
      {showCreateGalaxy ? <GalaxyDialog mode="create" language={language} onClose={() => setShowCreateGalaxy(false)} onCreated={(universe) => { setUniverses((current) => [...current.filter((item) => item.name !== universe.name), universe].sort((a, b) => a.name.localeCompare(b.name))); setSuggestedUniverse(universe.name); setShowCreateGalaxy(false); }} /> : null}
    </Dialog>
  );
}

function GalaxyDialog({ language, onClose, onCreated, mode }: { language: Language; onClose: () => void; onCreated?: (universe: UniverseSummary) => void; mode: GalaxyDialogMode }) {
  const l = labels[language];
  const [trashEntries, setTrashEntries] = useState<GalaxyTrashEntry[]>([]);
  const [loading, setLoading] = useState(mode === "trash");
  const [error, setError] = useState("");
  const [newUniverse, setNewUniverse] = useState("");
  const [creatingUniverse, setCreatingUniverse] = useState(false);
  const [createdMessage, setCreatedMessage] = useState("");
  const [activeTrashAction, setActiveTrashAction] = useState("");
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [rename, setRename] = useState("");
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  const [importState, setImportState] = useState<"idle" | "uploading" | "previewing" | "preview" | "applying" | "complete">("idle");
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const packageInput = useRef<HTMLInputElement>(null);
  const working = creatingUniverse || Boolean(activeTrashAction) || ["uploading", "previewing", "applying"].includes(importState);
  useEffect(() => {
    if (mode !== "trash") return;
    localApi.galaxyTrash().then((trash) => setTrashEntries(trash.entries)).catch((next) => setError(errorMessage(next))).finally(() => setLoading(false));
  }, [mode]);
  const createInitialUniverse = async () => {
    setError("");
    setCreatedMessage("");
    setCreatingUniverse(true);
    try {
      const created = await localApi.createUniverse(newUniverse.trim());
      const summary: UniverseSummary = { name: created.name, wiki: created.wiki, raw: created.raw, declared: true, hidden: false };
      setNewUniverse("");
      setCreatedMessage(`${l.galaxyCreated}: ${created.name}`);
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
      onCreated?.(summary);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setCreatingUniverse(false);
    }
  };


  const refreshTrash = async () => setTrashEntries((await localApi.galaxyTrash()).entries);
  const restoreTrashEntry = async (entry: GalaxyTrashEntry) => {
    if (!window.confirm(l.restoreGalaxyConfirm.replace("{name}", entry.galaxy))) return;
    setError("");
    setActiveTrashAction(entry.id);
    try {
      await localApi.restoreGalaxyTrash(entry.id);
      await refreshTrash();
      setCreatedMessage(`${l.galaxyRestored}: ${entry.galaxy}`);
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setActiveTrashAction("");
    }
  };

  const purgeTrashEntry = async (entry: GalaxyTrashEntry) => {
    const confirmation = window.prompt(l.permanentDeletePrompt.replace("{name}", entry.galaxy));
    if (confirmation === null) return;
    if (confirmation !== entry.galaxy) {
      setError(l.deleteGalaxyMismatch);
      return;
    }
    setError("");
    setActiveTrashAction(entry.id);
    try {
      await localApi.purgeGalaxyTrash(entry.id, confirmation);
      await refreshTrash();
      setCreatedMessage(`${l.permanentlyDeleted}: ${entry.galaxy}`);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setActiveTrashAction("");
    }
  };



  const previewImport = async () => {
    if (!packageFile) return setError(l.requiredPackage);
    setError(""); setImportState("uploading"); setImportProgress(0);
    try {
      const initial = await localApi.previewImport(packageFile, rename, (uploaded, total) => setImportProgress(total > 0 ? Math.round(uploaded / total * 100) : null));
      setImportProgress(null); setImportState("previewing");
      const complete = await waitForJob(initial, setPreviewJob);
      setPreviewJob(complete); setImportState("preview");
    } catch (next) { setError(errorMessage(next)); setImportState("idle"); }
    finally { setImportProgress(null); }
  };
  const applyImport = async () => {
    if (!previewJob) return;
    setError(""); setImportState("applying"); setImportProgress(null);
    try {
      await waitForJob(await localApi.applyImport(previewJob.id, rename));
      setImportState("complete");
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
      window.dispatchEvent(new Event("my-wiki:drive-updated"));
    } catch (next) { setError(errorMessage(next)); setImportState("preview"); }
  };
  const summary = previewJob?.result as any;
  return <Dialog title={mode === "create" ? l.createInitialGalaxy : mode === "import" ? l.importPackage : l.recycleBin} description="" onClose={() => { if (!working) onClose(); }}>
    <div className="universe-manager universe-manager-single">
      {mode === "create" ? <section className="universe-list-section"><div className="universe-create">
        <div className="field-with-action"><input aria-label={l.createInitialGalaxy} value={newUniverse} disabled={creatingUniverse} onChange={(event) => setNewUniverse(event.target.value)} placeholder={l.galaxyNamePlaceholder} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && !creatingUniverse && newUniverse.trim()) void createInitialUniverse(); }} /><button className="primary-button" type="button" disabled={creatingUniverse || !newUniverse.trim()} onClick={createInitialUniverse}>{creatingUniverse ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{l.createGalaxy}</button></div>
      </div></section> : null}
      {mode === "trash" ? <section className="universe-list-section">
        {loading ? <p className="dialog-empty">{l.loading}</p> : null}
        <div className="universe-list">
          {trashEntries.map((entry) => (
              <article className="universe-row recycle-row" key={entry.id}>
                <div>
                  <strong>{entry.galaxy}</strong>
                  <span>{template(l.wikiPages, entry.archivedConcepts)} · {template(l.rawSources, entry.archivedReferences)}</span>
                  <span>{l.deletedAt}: {new Date(entry.trashedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")} · {formatBytes(entry.packageBytes)}</span>
                </div>
                <div className="universe-row-actions">
                  <button type="button" disabled={Boolean(activeTrashAction) || !entry.recoverable} onClick={() => void restoreTrashEntry(entry)}>
                    {activeTrashAction === entry.id ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}{l.restoreGalaxy}
                  </button>
                  <button type="button" className="destructive-text-action" disabled={Boolean(activeTrashAction)} onClick={() => void purgeTrashEntry(entry)}>
                    <Trash2 size={15} />{l.permanentDelete}
                  </button>
                </div>
              </article>
          ))}

          {!loading && trashEntries.length === 0 ? <p className="recycle-empty">{l.recycleEmpty}</p> : null}
        </div>
      </section> : null}
        {mode === "import" ? <section className="import-section">
          <h3>{l.importPackage}</h3>
          <button type="button" className="file-drop compact" onClick={() => packageInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dropped = event.dataTransfer.files?.[0] || null; setPackageFile(dropped); setPreviewJob(null); setImportState("idle"); setImportProgress(null); }}>
            <FileUp size={21} aria-hidden="true" />
            <strong>{packageFile?.name || l.chooseFile}</strong>
            <span>{packageFile ? formatBytes(packageFile.size) : ".mywiki"}</span>
            <input ref={packageInput} type="file" accept=".mywiki" hidden onChange={(event) => { setPackageFile(event.target.files?.[0] || null); setPreviewJob(null); setImportState("idle"); setImportProgress(null); }} />
          </button>
          <label className="field full"><span>{l.rename}</span><input value={rename} onChange={(event) => setRename(event.target.value)} placeholder={l.optionalRename} /></label>
          {importState === "uploading" ? <ProgressBar progress={{ phase: "uploading", current: importProgress || 0, total: 100, percent: importProgress, message: `${l.uploading}${importProgress === null ? "" : ` ${importProgress}%`}` }} language={language} /> : null}
          {importState === "previewing" ? <ProgressBar progress={{ phase: "previewing", current: 0, total: 0, percent: null, message: l.preparingPreview }} language={language} /> : null}
          {importState === "applying" ? <ProgressBar progress={{ phase: "applying", current: 0, total: 0, percent: null, message: l.writingImport }} language={language} /> : null}
          {summary ? <ImportSummary language={language} summary={summary} /> : null}
          {importState === "complete" ? <p className="import-complete">{l.imported}</p> : null}
          <div className="section-command-row">
            {importState === "preview" ? <button className="primary-button" type="button" onClick={applyImport}><Upload size={15} />{l.applyImport}</button> : importState !== "complete" ? <button className="primary-button" type="button" disabled={["uploading", "previewing", "applying"].includes(importState)} onClick={previewImport}>{["uploading", "previewing", "applying"].includes(importState) ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{importState === "applying" ? l.importing : importState === "previewing" ? l.preparingPreview : l.previewImport}</button> : null}
          </div>
        </section> : null}
    </div>
    {createdMessage ? <p className="inline-success">{createdMessage}</p> : null}
    {error ? <p className="dialog-error">{error}</p> : null}
    <div className="dialog-footer"><button type="button" disabled={working} onClick={onClose}>{l.close}</button></div>
  </Dialog>;
}

function ProgressBar({ progress, language }: { progress: TaskProgress; language: Language }) {
  const percent = progress.percent;
  const detail = progressLabel(progress, language);
  return (
    <div className="task-progress" role="progressbar" aria-label={detail} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      <div className="task-progress-label"><span>{detail}</span>{percent !== null ? <strong>{percent}%</strong> : null}</div>
      <div className={`task-progress-track${percent === null ? " is-indeterminate" : ""}`}>
        <span style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  );
}

function progressLabel(progress: TaskProgress, language: Language) {
  if (progress.phase === "uploading") return progress.message || (language === "zh" ? "正在上传" : "Uploading");
  if (progress.phase === "previewing") return progress.message || (language === "zh" ? "正在解析导入预览" : "Preparing import preview");
  if (progress.phase === "applying") return progress.message || (language === "zh" ? "正在写入知识包" : "Writing knowledge package");
  const labels: Record<string, [string, string]> = {
    "preserving-snapshot": ["保存原始快照", "Preserving original snapshot"],
    extracting: ["准备提取", "Preparing extraction"],
    analyzing: ["分析文档结构", "Analyzing document structure"],
    "pdf-analysis": ["读取 PDF 结构", "Reading PDF structure"],
    "visual-analysis": ["检查空白页与透印", "Checking page artifacts"],
    mineru: ["MinerU 提取", "MinerU extraction"],
    ocr: ["OCR 文字识别", "OCR text recognition"],
    "quality-check": ["检查页面与公式", "Checking pages and formulas"],
    assembling: ["整理 Markdown 与图片", "Assembling Markdown and images"],
    "writing-raw": ["写入 Raw 证据", "Writing Raw evidence"],
    complete: ["提取完成", "Extraction complete"]
  };
  const label = labels[progress.phase]?.[language === "zh" ? 0 : 1] || (language === "zh" ? "正在提取" : "Extracting");
  return progress.total > 0 && progress.current > 0
    ? `${label} · ${progress.current}/${progress.total}`
    : label;
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
      {summary.okf?.markdownWarnings?.length ? <div className="warning-box" role="status">
        <strong>{language === "zh" ? "Markdown 格式待复核" : "Markdown format review"}</strong>
        {summary.okf.markdownWarnings.map((issue: { path: string; line: number; column: number; code: string; message: string }, index: number) => <p key={index}>{issue.path}:{issue.line}:{issue.column} {issue.code}: {issue.message}</p>)}
      </div> : null}
    </div>
  );
}

export function Dialog({ title, description, onClose, wide = false, children }: { title: string; description: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const titleId = useId();
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`workspace-dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header><div><h2 id={titleId}>{title}</h2><p>{description}</p></div><button type="button" className="icon-button" aria-label={labels.en.close} onClick={onClose}><X size={18} /></button></header>
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

function isIgnoredUploadPath(value: string) {
  const sourcePath = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = sourcePath.split("/").filter(Boolean);
  const basename = (parts[parts.length - 1] || "").toLowerCase();
  return parts.some((part) => part.startsWith(".") || ["__macosx", "node_modules"].includes(part.toLowerCase()))
    || ["thumbs.db", "ehthumbs.db", "desktop.ini", "icon\r"].includes(basename)
    || basename.startsWith("~$");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function droppedUploadFiles(transfer: DataTransfer): Promise<{ files: UploadFile[]; hasFolder: boolean }> {
  const entries = Array.from(transfer.items).filter((item) => item.kind === "file").map((item) => item.webkitGetAsEntry?.()).filter((item): item is FileSystemEntry => Boolean(item));
  if (!entries.length) return { files: Array.from(transfer.files).map((file) => ({ file, sourcePath: file.name })), hasFolder: false };
  const files: UploadFile[] = [];
  async function read(entry: FileSystemEntry, parent = "") {
    const sourcePath = `${parent}${entry.name}`;
    if (isIgnoredUploadPath(sourcePath)) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      files.push({ file, sourcePath });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await read(child, `${sourcePath}/`);
      }
    }
  }
  for (const entry of entries) await read(entry);
  return { files, hasFolder: entries.some((entry) => entry.isDirectory) };
}

function template(value: string, count: number) {
  return value.replace("{count}", String(count));
}
