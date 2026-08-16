import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Download, FileArchive, FileUp, FolderUp, Inbox, Link2, LoaderCircle, Orbit, Plus, Upload, X } from "lucide-react";
import { InboxItem, Job, localApi, TaskProgress, UniverseSummary, waitForJob } from "./api";

type Language = "en" | "zh";
type ActionView = "add" | "universes" | null;
type AddTab = "link" | "file" | "folder" | "zip" | "inbox";

const labels = {
  en: {
    addKnowledge: "Add knowledge",
    manageUniverses: "Galaxies",
    addTitle: "Add knowledge to Inbox",
    addDescription: "Capture evidence now. Your agent can distill and connect it later.",
    link: "Web link",
    file: "File upload",
    folder: "Folder",
    zip: "ZIP bundle",
    inbox: "Inbox",
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
    emptyGalaxy: "Initial galaxy · no Wiki planets yet",
    capture: "Add to Inbox",
    chooseFile: "Choose a file",
    chooseFolder: "Choose a folder",
    chooseZip: "Choose a ZIP bundle",
    dropHint: "PDF, Markdown, HTML, text, images, and office documents",
    folderHint: "Upload all documents in one folder and its subfolders",
    zipHint: "Markdown with relative image files",
    selectedFile: "Selected file",
    failedFiles: "Failed files",
    noInbox: "Inbox is clear",
    refresh: "Refresh",
    close: "Close",
    success: "Source captured",
    status: "Status",
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
    uploading: "Uploading",
    queued: "Queued",
    extracting: "Extracting",
    failed: "Failed",
    pending: "Inbox items",
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
    manageUniverses: "知识星系",
    addTitle: "添加知识到 Inbox",
    addDescription: "先保存完整证据，之后再由 Agent 蒸馏并建立关系。",
    link: "网页链接",
    file: "上传文件",
    folder: "文件夹",
    zip: "ZIP 图文包",
    inbox: "Inbox",
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
    emptyGalaxy: "初始星系 · 暂无 Wiki 星球",
    capture: "添加到 Inbox",
    chooseFile: "选择文件",
    chooseFolder: "选择文件夹",
    chooseZip: "选择 ZIP 图文包",
    dropHint: "支持 PDF、Markdown、HTML、文本、图片和 Office 文档",
    folderHint: "批量上传文件夹及子文件夹中的文档",
    zipHint: "包含 Markdown 和相对路径引用的图片",
    selectedFile: "已选择",
    failedFiles: "失败文件",
    noInbox: "Inbox 当前为空",
    refresh: "刷新",
    close: "关闭",
    success: "原始资料已保存",
    status: "状态",
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
    uploading: "正在上传",
    queued: "排队中",
    extracting: "正在提取",
    failed: "处理失败",
    pending: "Inbox 条目",
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
  const l = labels[language];
  return (
    <>
      <div className="workspace-actions">
        <button
          type="button"
          className="workspace-action primary"
          aria-label={l.addKnowledge}
          title={l.addKnowledge}
          onClick={() => setView("add")}
        >
          <Plus size={16} aria-hidden="true" />
          <span>{l.addKnowledge}</span>
        </button>
        <button
          type="button"
          className="workspace-action"
          aria-label={l.manageUniverses}
          title={l.manageUniverses}
          onClick={() => setView("universes")}
        >
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
  const [suggestedUniverse, setSuggestedUniverse] = useState("");
  const [universes, setUniverses] = useState<UniverseSummary[]>([]);
  const [showUniverseDialog, setShowUniverseDialog] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

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
    if (tab !== "inbox" || !inbox.some((item) => item.jobStatus === "queued" || item.jobStatus === "running")) return;
    const timer = window.setInterval(() => void loadInbox(true), 1500);
    return () => window.clearInterval(timer);
  }, [tab, inbox]);

  const submit = async () => {
    setError("");
    if (tab === "link" && !url.trim()) return setError(l.requiredUrl);
    if (tab === "file" && !file) return setError(l.requiredFile);
    const uploadableFolderFiles = folderFiles.filter((item) => !isIgnoredFolderFile(item));
    if (tab === "folder" && uploadableFolderFiles.length === 0) return setError(l.requiredFolder);
    if (tab === "zip" && !zipFile) return setError(l.requiredZip);
    setBusy(true);
    setUploadProgress(null);
    try {
      let captured: Record<string, any>;
      if (tab === "link") {
        captured = await localApi.captureUrl({ url: url.trim(), title: title.trim(), collection: collection.trim(), suggestedUniverse });
      } else if (tab === "folder") {
        const items: Job[] = [];
        const failures = [];
        for (const item of uploadableFolderFiles) {
          try {
            items.push(await localApi.captureFile(item, { collection: collection.trim(), suggestedUniverse, sourcePath: item.webkitRelativePath || item.name }));
          } catch (nextError) {
            failures.push({ path: item.webkitRelativePath || item.name, error: errorMessage(nextError) });
          }
        }
        if (items.length === 0) throw new Error(failures[0]?.error || l.requiredFolder);
        setFolderFiles([]);
        setTab("inbox");
        await loadInbox();
        return;
      } else {
        const selected = tab === "zip" ? zipFile! : file!;
        await localApi.captureFile(
          selected,
          { title: title.trim(), collection: collection.trim(), suggestedUniverse },
          (uploaded, total) => setUploadProgress(Math.round(uploaded / total * 100))
        );
        setFile(null);
        setZipFile(null);
        setTitle("");
        setTab("inbox");
        await loadInbox();
        return;
      }
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
    setFile(null);
    setFolderFiles([]);
    setZipFile(null);
    setResult(null);
    setError("");
  };

  const capturedItems = result ? (Array.isArray(result.items) && result.items.length ? result.items : [result]) : [];
  const representative = capturedItems[0] || null;
  const followupCount = capturedItems.filter((item) => item.status === "needs-followup").length;

  return (
    <Dialog title={l.addTitle} description={l.addDescription} onClose={onClose}>
      <div className="dialog-tabs" role="tablist">
        <TabButton active={tab === "link"} onClick={() => setTab("link")} icon={<Link2 size={15} />} label={l.link} />
        <TabButton active={tab === "file"} onClick={() => setTab("file")} icon={<FileUp size={15} />} label={l.file} />
        <TabButton active={tab === "folder"} onClick={() => setTab("folder")} icon={<FolderUp size={15} />} label={l.folder} />
        <TabButton active={tab === "zip"} onClick={() => setTab("zip")} icon={<FileArchive size={15} />} label={l.zip} />
        <TabButton active={tab === "inbox"} onClick={() => setTab("inbox")} icon={<Inbox size={15} />} label={l.inbox} />
      </div>

      {result ? (
        <div className="operation-success">
          <BookOpen size={28} aria-hidden="true" />
          <h3>{l.success}</h3>
          <p>{result.count > 1 ? `${Number(result.count)} / ${Number(result.total || result.count)}` : String(representative?.vaultRelative || representative?.path || "")}</p>
          <dl>
            <div><dt>{l.status}</dt><dd>{followupCount ? `${followupCount} needs-followup` : "inbox"}</dd></div>
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
                      {item.jobStatus === "queued" ? l.queued : item.jobStatus === "running" ? l.extracting : item.jobStatus === "failed" ? l.failed : item.status}
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
          <div className="dialog-form">
            {tab === "link" ? (
              <label className="field full"><span>{l.url}</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" autoFocus /></label>
            ) : tab === "file" ? (
              <button type="button" className="file-drop" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFile(event.dataTransfer.files?.[0] || null); }}>
                <Upload size={24} aria-hidden="true" />
                <strong>{file ? file.name : l.chooseFile}</strong>
                <span>{file ? `${l.selectedFile}: ${formatBytes(file.size)}` : l.dropHint}</span>
                <input ref={fileInput} type="file" hidden onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </button>
            ) : tab === "folder" ? (
              <button type="button" className="file-drop" onClick={() => folderInput.current?.click()}>
                <FolderUp size={24} aria-hidden="true" />
                <strong>{folderFiles.length ? `${folderFiles.length} ${language === "zh" ? "个文件" : "files"}` : l.chooseFolder}</strong>
                <span>{folderFiles.length ? formatBytes(folderFiles.reduce((sum, item) => sum + item.size, 0)) : l.folderHint}</span>
                <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as any)} onChange={(event) => setFolderFiles(Array.from(event.target.files || []).filter((item) => !isIgnoredFolderFile(item)))} />
              </button>
            ) : (
              <button type="button" className="file-drop" onClick={() => zipInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dropped = event.dataTransfer.files?.[0] || null; setZipFile(dropped?.name.toLowerCase().endsWith(".zip") ? dropped : null); }}>
                <FileArchive size={24} aria-hidden="true" />
                <strong>{zipFile ? zipFile.name : l.chooseZip}</strong>
                <span>{zipFile ? `${l.selectedFile}: ${formatBytes(zipFile.size)}` : l.zipHint}</span>
                <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => setZipFile(event.target.files?.[0] || null)} />
              </button>
            )}
            {tab !== "folder" && tab !== "zip" ? <label className="field"><span>{l.title}</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={l.optionalTitle} /></label> : null}
            <label className={tab === "folder" || tab === "zip" ? "field full" : "field"}><span>{l.collection}</span><input list="my-wiki-collections" value={collection} onChange={(event) => setCollection(event.target.value)} placeholder={l.optionalCollection} /></label>
            <datalist id="my-wiki-collections">{collections.map((item) => <option key={item} value={item} />)}</datalist>
            <div className="field full"><span>{l.galaxy}</span><div className="field-with-action"><select aria-label={l.galaxy} value={suggestedUniverse} onChange={(event) => setSuggestedUniverse(event.target.value)}><option value="">{l.optionalGalaxy}</option>{universes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><button type="button" onClick={() => setShowUniverseDialog(true)}><Plus size={15} />{l.createGalaxy}</button></div></div>
          </div>
          {error ? <p className="dialog-error">{error}</p> : null}
          <div className="dialog-footer"><button type="button" onClick={onClose}>{l.close}</button><button className="primary-button" type="button" disabled={busy} onClick={submit}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{busy && uploadProgress !== null ? `${l.uploading} ${uploadProgress}%` : l.capture}</button></div>
        </>
      )}
      {tab === "inbox" && error ? <p className="dialog-error">{error}</p> : null}
      {showUniverseDialog ? <UniverseDialog language={language} onClose={() => setShowUniverseDialog(false)} onCreated={(universe) => { setUniverses((current) => [...current.filter((item) => item.name !== universe.name), universe].sort((a, b) => a.name.localeCompare(b.name))); setSuggestedUniverse(universe.name); setShowUniverseDialog(false); }} /> : null}
    </Dialog>
  );
}

function UniverseDialog({ language, onClose, onCreated }: { language: Language; onClose: () => void; onCreated?: (universe: UniverseSummary) => void }) {
  const l = labels[language];
  const [universes, setUniverses] = useState<UniverseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newUniverse, setNewUniverse] = useState("");
  const [creatingUniverse, setCreatingUniverse] = useState(false);
  const [createdMessage, setCreatedMessage] = useState("");
  const [activeExport, setActiveExport] = useState("");
  const [download, setDownload] = useState<{ name: string; url: string } | null>(null);
  const [packageFile, setPackageFile] = useState<File | null>(null);
  const [rename, setRename] = useState("");
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  const [importState, setImportState] = useState<"idle" | "uploading" | "previewing" | "preview" | "applying" | "complete">("idle");
  const [importProgress, setImportProgress] = useState<number | null>(null);
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

  const createInitialUniverse = async () => {
    setError("");
    setCreatedMessage("");
    setCreatingUniverse(true);
    try {
      const created = await localApi.createUniverse(newUniverse.trim());
      const summary: UniverseSummary = { name: created.name, wiki: created.wiki, raw: created.raw, declared: true };
      setUniverses((current) => [...current.filter((item) => item.name !== summary.name), summary].sort((a, b) => b.wiki - a.wiki || a.name.localeCompare(b.name)));
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

  const previewImport = async () => {
    if (!packageFile) return setError(l.requiredPackage);
    setError("");
    setImportState("uploading");
    setImportProgress(0);
    try {
      const initial = await localApi.previewImport(packageFile, rename, (uploaded, total) => {
        setImportProgress(total > 0 ? Math.round((uploaded / total) * 100) : null);
      });
      setImportProgress(null);
      setImportState("previewing");
      const complete = await waitForJob(initial, setPreviewJob);
      setPreviewJob(complete);
      setImportState("preview");
    } catch (nextError) {
      setError(errorMessage(nextError));
      setImportState("idle");
    } finally {
      setImportProgress(null);
    }
  };

  const applyImport = async () => {
    if (!previewJob) return;
    setError("");
      setImportState("applying");
      setImportProgress(null);
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
          <div className="universe-create">
            <h3>{l.createInitialGalaxy}</h3>
            <div className="field-with-action"><input aria-label={l.createInitialGalaxy} value={newUniverse} onChange={(event) => setNewUniverse(event.target.value)} placeholder={l.galaxyNamePlaceholder} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void createInitialUniverse(); }} /><button className="primary-button" type="button" disabled={creatingUniverse || !newUniverse.trim()} onClick={createInitialUniverse}>{creatingUniverse ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{l.createGalaxy}</button></div>
            {createdMessage ? <p className="inline-success">{createdMessage}</p> : null}
          </div>
          {loading ? <p className="dialog-empty">{l.loading}</p> : null}
          <div className="universe-list">
            {universes.map((universe) => (
              <article className="universe-row" key={universe.name}>
                <div><strong>{universe.name}</strong><span>{universe.wiki === 0 ? l.emptyGalaxy : `${template(l.wikiPages, universe.wiki)} · ${template(l.rawSources, universe.raw)}`}</span></div>
                <button type="button" disabled={Boolean(activeExport) || universe.wiki === 0} onClick={() => exportOne(universe.name)}>
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
        </section>
      </div>
      {error ? <p className="dialog-error">{error}</p> : null}
      <div className="dialog-footer"><button type="button" onClick={onClose}>{l.close}</button></div>
    </Dialog>
  );
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
    </div>
  );
}

function Dialog({ title, description, onClose, wide = false, children }: { title: string; description: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
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

function isIgnoredFolderFile(file: File) {
  const sourcePath = (file.webkitRelativePath || file.name).replace(/\\/g, "/").replace(/^\.\//, "");
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

function template(value: string, count: number) {
  return value.replace("{count}", String(count));
}
