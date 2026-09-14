import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, Download, Eye, EyeOff, File, FileImage, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Grid2X2, Grid3X3, HardDrive, History, LayoutGrid, List, LoaderCircle, Orbit, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { cachedLibrary, DriveGalaxy, DriveOriginal, GalaxyDialogMode, localApi, OriginalsDriveData, waitForJob } from "./api";
import { DocumentVersions } from "./DocumentVersions";
import { LibraryIconButton, LibraryTooltip } from "./LibraryIconButton";
import DocumentPreview from "./DocumentPreview";
import "./originals-drive.css";

type Props = { language: "zh" | "en"; onClose: () => void; onAdd: (galaxy: string) => void; onGalaxies: (mode: GalaxyDialogMode) => void; onExport: (galaxy: DriveGalaxy) => void };
type Entry = { id: string; name: string; folder: boolean; original?: DriveOriginal };
type Form = { kind: "create" | "rename" | "delete" | "move"; id?: string; name?: string };
type ViewMode = "list" | "small" | "medium" | "large";
const empty: OriginalsDriveData = { galaxies: [], folders: [], files: [], placements: [] };
const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`;

export function OriginalsDrive({ language, onClose, onAdd, onGalaxies, onExport }: Props) {
  const zh = language === "zh";
  const title = zh ? "文档库" : "Library";
  const [data, setData] = useState(() => cachedLibrary() || empty);
  const [galaxy, setGalaxy] = useState("");
  const [selectedGalaxy, setSelectedGalaxy] = useState("");
  const [galaxyAction, setGalaxyAction] = useState("");
  const [galaxyForm, setGalaxyForm] = useState<{ kind: "rename" | "delete"; item: DriveGalaxy } | null>(null);
  const [galaxyInput, setGalaxyInput] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [fileType, setFileType] = useState("");
  const [versions, setVersions] = useState<{ mode: "update" | "history"; original?: DriveOriginal } | null>(null);
  const [preparation, setPreparation] = useState<{ running: boolean; completed: number; total: number } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { const value = localStorage.getItem("my-wiki-drive-view"); if (["list", "small", "medium", "large"].includes(value || "")) return value as ViewMode; } catch {}
    return "medium";
  });
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [preview, setPreview] = useState<DriveOriginal | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const id = useId();
  useEffect(() => { try { localStorage.setItem("my-wiki-drive-view", viewMode); } catch {} }, [viewMode]);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await localApi.originalsDrive()); setError(""); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); window.addEventListener("my-wiki:drive-updated", load); return () => window.removeEventListener("my-wiki:drive-updated", load); }, [load]);
  useEffect(() => {
    const refresh = () => void localApi.previewPreparation().then(setPreparation).catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { setSelected([]); setQuery(""); }, [galaxy, folder]);
  useEffect(() => { setFileType(""); setSelectedGalaxy(""); }, [galaxy]);
  useEffect(() => {
    if (loading) return;
    if (galaxy && !data.galaxies.some((item) => item.id === galaxy)) { setGalaxy(""); setFolder(null); }
    if (folder && !data.folders.some((item) => item.id === folder)) setFolder(null);
    if (selectedGalaxy && !data.galaxies.some((item) => item.id === selectedGalaxy)) setSelectedGalaxy("");
  }, [data, loading, galaxy, folder, selectedGalaxy]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy || galaxyAction || document.querySelectorAll('[role="dialog"]').length > 1) return;
      if (form) setForm(null); else onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, galaxyAction, form, onClose]);

  const galaxyName = (item: { id: string; name: string }) => item.id === "unassigned" ? (zh ? "未分类资料" : "Unclassified originals") : item.name;
  const current = data.galaxies.find((item) => item.id === galaxy);
  const selectedGroup = data.galaxies.find((item) => item.id === selectedGalaxy);
  const manageableGroup = selectedGroup?.id !== "unassigned" ? selectedGroup : undefined;
  const folders = data.folders.filter((item) => item.galaxy === galaxy);
  const parents = useMemo(() => {
    const result = [];
    let node = data.folders.find((item) => item.id === folder);
    const seen = new Set();
    while (node && !seen.has(node.id)) { seen.add(node.id); result.unshift(node); node = data.folders.find((item) => item.id === node!.parentId); }
    return result;
  }, [data.folders, folder]);
  const placements = new Map(data.placements.filter((item) => item.galaxy === galaxy).map((item) => [item.path, item.folderId]));
  const allEntries: Entry[] = [
    ...folders.filter((item) => query || item.parentId === folder).map((item) => ({ id: item.id, name: item.name, folder: true })),
    ...data.files.filter((item) => item.galaxies.includes(galaxy) && (query || (placements.get(item.path) || null) === folder)).map((item) => ({ id: item.path, name: item.name, folder: false, original: item }))
  ];
  const extension = (name: string) => name.includes(".") ? name.split(".").pop()!.toLowerCase() : "other";
  const fileTypes = [...new Set(data.files.filter((item) => item.galaxies.includes(galaxy)).map((item) => extension(item.name)))].sort();
  const entries = allEntries.filter((item) => (!fileType || item.folder || extension(item.name) === fileType) && (!query || `${item.name} ${item.original?.references.map((ref) => ref.title).join(" ") || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => Number(b.folder) - Number(a.folder) || (direction === "asc" ? 1 : -1) * (sort === "size" ? (a.original?.size || 0) - (b.original?.size || 0) : sort === "modified" ? (a.original?.modified || "").localeCompare(b.original?.modified || "") : a.name.localeCompare(b.name, language, { numeric: true })));
  const selection = entries.filter((item) => selected.includes(item.id));
  const openFolder = (value: string | null) => { setFolder(value); setSelected([]); setQuery(""); };
  const select = (entry: Entry) => setSelected((values) => values.includes(entry.id) ? values.filter((value) => value !== entry.id) : [...values, entry.id]);
  const openForm = (value: Form) => { setForm(value); setName(value.name || ""); setTarget(folder || ""); setError(""); };
  const folderPath = (value: string) => {
    const names = [];
    let item = folders.find((f) => f.id === value);
    const seen = new Set();
    while (item && !seen.has(item.id)) { seen.add(item.id); names.unshift(item.name); item = folders.find((f) => f.id === item!.parentId); }
    return names.join(" / ");
  };
  const invalidTargets = new Set(selection.filter((item) => item.folder).map((item) => item.id));
  for (let i = 0; i < folders.length; i++) for (const item of folders) if (item.parentId && invalidTargets.has(item.parentId)) invalidTargets.add(item.id);
  const execute = async () => {
    if (!form || !current) return;
    setBusy(true); setError("");
    try {
      await localApi.updateOriginalsDrive({ action: form.kind, galaxy, name: name.trim(), id: form.id, parentId: form.kind === "move" ? target || null : folder, files: selection.filter((item) => !item.folder).map((item) => item.id), folders: selection.filter((item) => item.folder).map((item) => item.id) });
      setForm(null); setSelected([]); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const download = async (item: DriveOriginal) => {
    try {
      const url = await localApi.downloadUrl(`/api/v1/drive/download?${new URLSearchParams({ path: item.path })}`);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.name; anchor.click();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const selectedFiles = selection.flatMap((item) => item.original ? [item.original] : []);
  const downloadSelected = async () => {
    if (!selectedFiles.length || downloading) return;
    if (selectedFiles.length === 1) return download(selectedFiles[0]);
    setDownloading(true); setDownloadProgress(0); setError("");
    try {
      const initial = await localApi.downloadOriginals(galaxy, selectedFiles.map((item) => item.path));
      const result = await waitForJob(initial, (job) => setDownloadProgress(job.meta.progress?.percent || 0));
      const anchor = document.createElement("a"); anchor.href = await localApi.downloadUrl(result.downloadUrl); anchor.download = "originals.zip"; anchor.click();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setDownloading(false); }
  };
  const views = [
    { value: "list" as const, label: zh ? "列表" : "List", Icon: List },
    { value: "large" as const, label: zh ? "大图标" : "Large icons", Icon: LayoutGrid },
    { value: "medium" as const, label: zh ? "中图标" : "Medium icons", Icon: Grid2X2 },
    { value: "small" as const, label: zh ? "小图标" : "Small icons", Icon: Grid3X3 }
  ];
  const view = views.find((item) => item.value === viewMode)!;
  const openGalaxyForm = (kind: "rename" | "delete") => {
    if (!manageableGroup) return;
    setError(""); setGalaxyInput(kind === "rename" ? manageableGroup.name : ""); setGalaxyForm({ kind, item: manageableGroup });
  };
  const runGalaxyAction = async (action: "visibility" | "rename" | "delete") => {
    const item = galaxyForm?.item || manageableGroup;
    if (!item || galaxyAction) return;
    setError(""); setGalaxyAction(action);
    try {
      if (action === "visibility") await localApi.setUniverseHidden(item.name, !item.hidden);
      if (action === "rename") {
        const renamed = await localApi.renameUniverse(item.name, galaxyInput.trim());
        setSelectedGalaxy(`galaxy:${renamed.name.toLocaleLowerCase()}`);
      }
      if (action === "delete") { await localApi.deleteUniverse(item.name, galaxyInput); setSelectedGalaxy(""); }
      setGalaxyForm(null);
      window.dispatchEvent(new Event("my-wiki:graph-updated"));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setGalaxyAction(""); }
  };
  const shownGalaxies = data.galaxies.filter((item) => galaxyName(item).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selectionBox = (item: Entry) => <input type="checkbox" aria-label={`${zh ? "选择" : "Select"} ${item.name}`} checked={selected.includes(item.id)} onChange={() => select(item)} />;
  const itemActions = (item: Entry) => item.folder ? <>
    <LibraryIconButton className="icon-button" aria-label={`${zh ? "重命名" : "Rename"} ${item.name}`} title={zh ? "重命名文件夹" : "Rename folder"} onClick={() => openForm({ kind: "rename", id: item.id, name: item.name })}><Pencil size={15} /></LibraryIconButton>
    <LibraryIconButton className="icon-button" aria-label={`${zh ? "删除" : "Delete"} ${item.name}`} title={zh ? "删除文件夹" : "Delete folder"} onClick={() => openForm({ kind: "delete", id: item.id, name: item.name })}><Trash2 size={15} /></LibraryIconButton>
  </> : <><LibraryIconButton className="icon-button" aria-label={`${zh ? "预览" : "Preview"} ${item.name}`} title={zh ? "预览" : "Preview"} onClick={() => setPreview(item.original!)}><Eye size={16} /></LibraryIconButton><LibraryIconButton className="icon-button" aria-label={`${zh ? "下载" : "Download"} ${item.name}`} title={zh ? "下载原件" : "Download original"} onClick={() => void download(item.original!)}><Download size={16} /></LibraryIconButton></>;
  const formTitle = form?.kind === "create" ? (zh ? "新建文件夹" : "New folder") : form?.kind === "move" ? (zh ? "移动到文件夹" : "Move to folder") : form?.kind === "delete" ? (zh ? "删除文件夹" : "Delete folder") : (zh ? "重命名" : "Rename");

  return createPortal(
    <section className="originals-drive" role="dialog" aria-modal="true" aria-labelledby={id} data-view={viewMode}>
      <header className="drive-header">
        <HardDrive size={20} /><h2 id={id}>{title}</h2><span>{data.files.length} {zh ? "个原件" : "originals"}</span>
        <LibraryIconButton className="icon-button" disabled={Boolean(galaxyAction)} aria-label={zh ? "关闭文档库" : "Close library"} title={zh ? "关闭文档库" : "Close library"} onClick={onClose}><X size={20} /></LibraryIconButton>
      </header>
      <div className="drive-body">
        <nav className="drive-sidebar" aria-label={zh ? "文档库星系" : "Library galaxies"}>
          <button aria-current={!galaxy ? "page" : undefined} onClick={() => { setGalaxy(""); openFolder(null); }}><HardDrive size={17} /><span>{zh ? "全部星系" : "All galaxies"}</span></button>
          {data.galaxies.map((item) => <button key={item.id} aria-current={galaxy === item.id ? "page" : undefined} onClick={() => { setGalaxy(item.id); openFolder(null); }}><Orbit size={17} /><span>{galaxyName(item)}</span><small>{item.count}</small></button>)}
          <button className="drive-history-entry" onClick={() => setVersions({ mode: "history" })}><History size={17} /><span>{zh ? "历史文档库" : "Document history"}</span></button>
          <button onClick={() => onGalaxies("trash")}><ArchiveRestore size={17} /><span>{zh ? "星系回收站" : "Galaxy recycle bin"}</span></button>
        </nav>
        <main className="drive-main">
          <div className="drive-toolbar">
            <LibraryIconButton className="icon-button" disabled={!galaxy} title={zh ? "上一级" : "Up"} aria-label={zh ? "上一级" : "Up"} onClick={() => { if (folder) openFolder(parents[parents.length - 1]?.parentId || null); else setGalaxy(""); }}><ArrowLeft size={17} /></LibraryIconButton>
            <LibraryIconButton className="icon-button" title={zh ? "刷新" : "Refresh"} aria-label={zh ? "刷新文档库" : "Refresh library"} disabled={loading} onClick={() => void load()}>{loading ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}</LibraryIconButton>
            <nav className="drive-breadcrumbs" aria-label={zh ? "文件路径" : "Folder path"}>
              <button onClick={() => { setGalaxy(""); openFolder(null); }}>{title}</button>
              {current ? <><ChevronRight size={14} /><button onClick={() => openFolder(null)}>{galaxyName(current)}</button></> : null}
              {parents.map((item) => <span key={item.id}><ChevronRight size={14} /><button onClick={() => openFolder(item.id)}>{item.name}</button></span>)}
            </nav>
            <label className="drive-search"><Search size={15} /><input aria-label={zh ? "搜索文档库" : "Search library"} placeholder={zh ? "搜索" : "Search"} value={query} onChange={(e) => { setQuery(e.target.value); setSelected([]); }} /></label>
          </div>
          <div className="drive-commands">
            <LibraryIconButton className="icon-button" onClick={() => onGalaxies("create")} title={zh ? "新增星系" : "New galaxy"} aria-label={zh ? "新增星系" : "New galaxy"}><Orbit size={17} /></LibraryIconButton>
            <LibraryIconButton className="icon-button" onClick={() => onGalaxies("import")} title={zh ? "导入星系" : "Import galaxy"} aria-label={zh ? "导入星系" : "Import galaxy"}><Upload size={17} /></LibraryIconButton>
            <LibraryIconButton className="icon-button" onClick={() => onAdd(current?.id === "unassigned" ? "" : current?.name || "")} title={zh ? "添加知识" : "Add knowledge"} aria-label={zh ? "添加知识" : "Add knowledge"}><Plus size={17} /></LibraryIconButton>
            <span className="drive-command-separator" aria-hidden="true" />
            {!galaxy ? <>
              <LibraryIconButton className="icon-button" disabled={!selectedGroup || Boolean(galaxyAction)} aria-label={zh ? "打开星系" : "Open galaxy"} title={zh ? "打开星系" : "Open galaxy"} onClick={() => { if (selectedGroup) setGalaxy(selectedGroup.id); }}><FolderOpen size={17} /></LibraryIconButton>
              <LibraryIconButton className="icon-button" disabled={!manageableGroup || !manageableGroup.wiki || Boolean(galaxyAction)} aria-label={zh ? "导出星系" : "Export galaxy"} title={zh ? "导出星系" : "Export galaxy"} onClick={() => { if (manageableGroup) onExport(manageableGroup); }}><Download size={17} /></LibraryIconButton>
              <LibraryIconButton className="icon-button" disabled={!manageableGroup || Boolean(galaxyAction)} aria-label={zh ? (manageableGroup?.hidden ? "显示星系" : "隐藏星系") : manageableGroup?.hidden ? "Show galaxy" : "Hide galaxy"} title={zh ? (manageableGroup?.hidden ? "显示星系" : "隐藏星系") : manageableGroup?.hidden ? "Show galaxy" : "Hide galaxy"} onClick={() => void runGalaxyAction("visibility")}>{manageableGroup?.hidden ? <EyeOff size={17} /> : <Eye size={17} />}</LibraryIconButton>
              <LibraryIconButton className="icon-button" disabled={!manageableGroup || Boolean(galaxyAction)} aria-label={zh ? "重命名星系" : "Rename galaxy"} title={zh ? "重命名星系" : "Rename galaxy"} onClick={() => openGalaxyForm("rename")}><Pencil size={17} /></LibraryIconButton>
              <LibraryIconButton className="icon-button destructive-text-action" disabled={!manageableGroup || Boolean(galaxyAction)} aria-label={zh ? "删除星系" : "Delete galaxy"} title={zh ? "删除星系" : "Delete galaxy"} onClick={() => openGalaxyForm("delete")}><Trash2 size={17} /></LibraryIconButton>
              {galaxyAction ? <span className="drive-galaxy-progress" role="status"><LoaderCircle className="spin" size={15} />{zh ? "正在更新星系" : "Updating galaxy"}</span> : selectedGroup ? <span className="drive-galaxy-selection">{galaxyName(selectedGroup)}</span> : null}
            </> : <>
            <LibraryIconButton className="icon-button" disabled={!galaxy} aria-label={zh ? "新建文件夹" : "New folder"} title={zh ? "新建文件夹" : "New folder"} onClick={() => openForm({ kind: "create" })}><FolderPlus size={17} /></LibraryIconButton>
            <LibraryIconButton className="icon-button" disabled={!selection.length} aria-label={zh ? "移动选中项" : "Move selected items"} title={zh ? "移动选中项" : "Move selected items"} onClick={() => openForm({ kind: "move" })}><FolderInput size={17} /></LibraryIconButton>
            <LibraryIconButton className="icon-button" disabled={!selectedFiles.length || downloading} aria-label={zh ? "下载选中文件" : "Download selected files"} title={zh ? "下载选中文件" : "Download selected files"} onClick={() => void downloadSelected()}>{downloading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}</LibraryIconButton>
            <LibraryIconButton className="icon-button" disabled={selection.length !== 1 || selectedFiles.length !== 1} aria-label={zh ? "更新文件版本" : "Update document version"} title={zh ? "更新文件版本" : "Update document version"} onClick={() => setVersions({ mode: "update", original: selectedFiles[0] })}><Upload size={17} /></LibraryIconButton>
            <LibraryIconButton className="icon-button" disabled={selection.length !== 1 || selectedFiles.length !== 1} aria-label={zh ? "历史版本与恢复" : "Version history and restore"} title={zh ? "历史版本与恢复" : "Version history and restore"} onClick={() => setVersions({ mode: "history", original: selectedFiles[0] })}><History size={17} /></LibraryIconButton>
            {downloading ? <span role="status" className="drive-download-progress">{zh ? "正在打包" : "Preparing ZIP"} {downloadProgress}%</span> : null}
            {galaxy ? <label className="drive-select-all"><input type="checkbox" aria-label={zh ? "全选当前列表" : "Select all visible items"} checked={entries.length > 0 && selection.length === entries.length} onChange={(e) => setSelected(e.target.checked ? entries.map((item) => item.id) : [])} /><span>{selection.length ? `${selection.length} ${zh ? "项已选" : "selected"}` : zh ? "全选" : "Select all"}</span></label> : null}
            </>}
            <div className="drive-view-controls">
              {galaxy ? <select aria-label={zh ? "文件类型" : "File type"} value={fileType} onChange={(e) => { setFileType(e.target.value); setSelected([]); }}><option value="">{zh ? "全部类型" : "All types"}</option>{fileTypes.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select> : null}
              {galaxy ? <select aria-label={zh ? "排序" : "Sort"} value={sort} onChange={(e) => setSort(e.target.value)}><option value="name">{zh ? "名称" : "Name"}</option><option value="modified">{zh ? "更新时间" : "Modified"}</option><option value="size">{zh ? "大小" : "Size"}</option></select> : null}
              {galaxy ? <LibraryIconButton className="icon-button" aria-label={zh ? (direction === "asc" ? "升序排列，点击切换为降序" : "降序排列，点击切换为升序") : (direction === "asc" ? "Ascending, switch to descending" : "Descending, switch to ascending")} title={zh ? (direction === "asc" ? "升序" : "降序") : direction === "asc" ? "Ascending" : "Descending"} onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")}>{direction === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}</LibraryIconButton> : null}
              <LibraryTooltip label={zh ? "切换视图" : "Change view"}><details className="drive-view-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); event.stopPropagation(); } }}>
                <summary aria-label={zh ? "切换视图" : "Change view"}><view.Icon size={17} /><ChevronDown size={12} /></summary>
                <div role="menu" aria-label={zh ? "文档库视图" : "Library view"}>{views.map(({ value, label, Icon }) => <button key={value} role="menuitemradio" aria-checked={viewMode === value} onClick={(event) => { setViewMode(value); const details = event.currentTarget.closest("details"); if (details) details.open = false; }}><Icon size={16} /><span>{label}</span>{viewMode === value ? <Check size={14} /> : null}</button>)}</div>
              </details></LibraryTooltip>
            </div>
          </div>
          {error && !form && !galaxyForm ? <p role="alert" className="drive-error">{error}</p> : null}
          <div className="drive-scroll" aria-busy={loading}>
            {!galaxy ? (
              <div className={viewMode === "list" ? "drive-galaxy-list" : "drive-grid"}>
                {shownGalaxies.map((item) => <article key={item.id} className={`drive-galaxy${selectedGalaxy === item.id ? " selected" : ""}`}>
                  <input className="drive-galaxy-check" type="checkbox" aria-label={`${zh ? "选择星系" : "Select galaxy"} ${galaxyName(item)}`} checked={selectedGalaxy === item.id} disabled={Boolean(galaxyAction)} onChange={(event) => setSelectedGalaxy(event.target.checked ? item.id : "")} />
                  <button className="drive-galaxy-open" disabled={Boolean(galaxyAction)} aria-pressed={selectedGalaxy === item.id} onClick={() => setSelectedGalaxy(item.id)} onDoubleClick={() => { setGalaxy(item.id); openFolder(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setGalaxy(item.id); openFolder(null); } }}>
                  <span className="drive-galaxy-art"><Folder className="drive-folder-art" /><Orbit className="drive-galaxy-badge" size={18} /></span>
                  <strong>{galaxyName(item)}</strong><span>{item.count} {zh ? "个原件" : "originals"}</span>
                  </button>
                  {item.hidden ? <span className="drive-galaxy-hidden"><EyeOff size={13} />{zh ? "已隐藏" : "Hidden"}</span> : null}
                </article>)}
              </div>
            ) : viewMode === "list" ? (
              <table className="drive-table">
                <thead><tr><th className="drive-check" /><th>{zh ? "名称" : "Name"}</th><th className="drive-size">{zh ? "大小" : "Size"}</th><th className="drive-date">{zh ? "更新时间" : "Modified"}</th><th className="drive-actions" aria-label={zh ? "操作" : "Actions"} /></tr></thead>
                <tbody>{entries.map((item) => <tr key={item.id} className={selected.includes(item.id) ? "selected" : ""} onDoubleClick={() => item.folder ? openFolder(item.id) : setPreview(item.original!)}>
                  <td>{selectionBox(item)}</td>
                  <td><button className="drive-filename" title={item.original?.path || item.name} onClick={() => item.folder ? openFolder(item.id) : select(item)}><DriveFileIcon entry={item} /><span>{item.name}{item.original?.references[0]?.title && item.original.references[0].title !== item.name ? <small>{item.original.references[0].title}</small> : null}</span></button></td>
                  <td className="drive-size">{item.original ? bytes(item.original.size) : "-"}</td><td className="drive-date">{item.original ? new Date(item.original.modified).toLocaleDateString(language) : "-"}</td><td className="drive-actions">{itemActions(item)}</td>
                </tr>)}</tbody>
              </table>
            ) : (
              <div className="drive-grid">{entries.map((item) => <article key={item.id} className={`drive-tile ${selected.includes(item.id) ? "selected" : ""}`}>
                <div className="drive-tile-check">{selectionBox(item)}</div>
                <button className="drive-tile-open" title={item.name} onClick={() => item.folder ? openFolder(item.id) : select(item)} onDoubleClick={() => { if (!item.folder) setPreview(item.original!); }}>
                  <DriveFileIcon entry={item} preview /><span>{item.name}</span>
                </button>
                <small>{item.original ? bytes(item.original.size) : zh ? "文件夹" : "Folder"}</small>
                <div className="drive-tile-actions">{itemActions(item)}</div>
              </article>)}</div>
            )}
            {!loading && (!galaxy ? !shownGalaxies.length : !entries.length) ? <p className="drive-empty">{zh ? "暂无文件" : "No files"}</p> : null}
            {loading && !data.files.length ? <p className="drive-empty" role="status"><LoaderCircle className="spin" size={18} />{zh ? "正在读取文档" : "Loading documents"}</p> : null}
          </div>
          <footer className="drive-footer"><span>{galaxy ? `${entries.length} ${zh ? "项" : "items"}${selection.length ? ` · ${selection.length} ${zh ? "项已选择" : "selected"}` : ""}` : `${data.galaxies.length} ${zh ? "个分类" : "groups"}`}</span>{preparation?.running ? <span role="status">{zh ? "后台预制快照" : "Preparing previews"} {preparation.completed}/{preparation.total}</span> : null}<LibraryIconButton className="icon-button drive-history-mobile" aria-label={zh ? "历史文档库" : "Document history"} title={zh ? "历史文档库" : "Document history"} onClick={() => setVersions({ mode: "history" })}><History size={16} /></LibraryIconButton><LibraryIconButton className="icon-button drive-history-mobile" aria-label={zh ? "星系回收站" : "Galaxy recycle bin"} title={zh ? "星系回收站" : "Galaxy recycle bin"} onClick={() => onGalaxies("trash")}><ArchiveRestore size={16} /></LibraryIconButton></footer>
        </main>
      </div>
      {form ? <div className="drive-form-backdrop">
        <form className="drive-form" aria-label={formTitle} onSubmit={(e) => { e.preventDefault(); void execute(); }}>
          <h3>{formTitle}</h3>
          {form.kind === "move" ? <label>{zh ? "目标文件夹" : "Destination"}<select aria-label={zh ? "目标文件夹" : "Destination"} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">{current && galaxyName(current)}</option>{folders.filter((item) => !invalidTargets.has(item.id)).sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id))).map((item) => <option key={item.id} value={item.id}>{folderPath(item.id)}</option>)}</select></label> :
            form.kind === "delete" ? <p>{zh ? `删除“${form.name}”？其内容将移到上一级，不会删除实际原件。` : `Delete “${form.name}”? Contents move up one level. Original files are not deleted.`}</p> :
              <label>{zh ? "名称" : "Name"}<input autoFocus required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} /></label>}
          {error ? <p className="drive-error" role="alert">{error}</p> : null}
          <div><button type="button" disabled={busy} onClick={() => setForm(null)}>{zh ? "取消" : "Cancel"}</button><button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : null}{zh ? "确认" : "Confirm"}</button></div>
        </form>
      </div> : null}
      {preview ? <OriginalPreview original={preview} zh={zh} onClose={() => setPreview(null)} onDownload={() => void download(preview)} /> : null}
      {versions ? <DocumentVersions {...versions} language={language} onClose={() => setVersions(null)} onUpdated={() => { void load(); window.dispatchEvent(new Event("my-wiki:graph-updated")); }} /> : null}
      {galaxyForm ? <div className="drive-form-backdrop">
        <form className="drive-form" role="dialog" aria-modal="true" aria-label={zh ? (galaxyForm.kind === "rename" ? "重命名星系" : "删除星系") : galaxyForm.kind === "rename" ? "Rename galaxy" : "Delete galaxy"} onSubmit={(event) => { event.preventDefault(); void runGalaxyAction(galaxyForm.kind); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); if (!galaxyAction) setGalaxyForm(null); } }}>
          <h3>{zh ? (galaxyForm.kind === "rename" ? "重命名星系" : "删除星系") : galaxyForm.kind === "rename" ? "Rename galaxy" : "Delete galaxy"}</h3>
          {galaxyForm.kind === "delete" ? <p>{zh ? `“${galaxyForm.item.name}”将导出到回收站，相关概念、参考资料和原件将从当前知识库移除，可在回收站恢复。` : `“${galaxyForm.item.name}” will be archived in the recycle bin and its knowledge removed from the active vault. It can be restored later.`}</p> : null}
          <label>{zh ? (galaxyForm.kind === "rename" ? "新星系名称" : "输入星系名称以确认") : galaxyForm.kind === "rename" ? "New galaxy name" : "Type the galaxy name to confirm"}<input autoFocus required maxLength={120} value={galaxyInput} disabled={Boolean(galaxyAction)} onChange={(event) => setGalaxyInput(event.target.value)} /></label>
          {error ? <p className="drive-error" role="alert">{error}</p> : null}
          <div><button type="button" disabled={Boolean(galaxyAction)} onClick={() => setGalaxyForm(null)}>{zh ? "取消" : "Cancel"}</button><button className="primary-button" type="submit" disabled={Boolean(galaxyAction) || (galaxyForm.kind === "delete" ? galaxyInput !== galaxyForm.item.name : !galaxyInput.trim())}>{galaxyAction ? <LoaderCircle className="spin" size={15} /> : null}{zh ? (galaxyForm.kind === "delete" ? "移入回收站" : "确认重命名") : galaxyForm.kind === "delete" ? "Move to recycle bin" : "Confirm rename"}</button></div>
        </form>
      </div> : null}
    </section>, document.body
  );
}

function DriveFileIcon({ entry, preview = false }: { entry: Entry; preview?: boolean }) {
  const target = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const isImage = !entry.folder && /\.(png|jpe?g|gif|webp)$/i.test(entry.name);
  useEffect(() => {
    if (!preview || !target.current || entry.folder) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "900px" });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [preview, entry.folder]);
  const result = useOriginalPreview(entry.original, preview && visible);
  if (entry.folder) return <Folder className="drive-folder-art" aria-hidden="true" />;
  const Icon = isImage ? FileImage : /\.(pdf|md|txt|html|docx?)$/i.test(entry.name) ? FileText : File;
  return <span className="drive-preview-slot" ref={target}>{result?.kind === "image" ? <img className="drive-file-preview" src={result.src} alt="" /> : result?.kind === "text" && result.text ? <span className="drive-text-preview" aria-hidden="true">{result.text}</span> : <span className="drive-file-art"><Icon aria-hidden="true" />{preview ? <b>{entry.name.split(".").pop()?.slice(0, 5).toUpperCase()}</b> : null}</span>}</span>;
}

function useOriginalPreview(original: DriveOriginal | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ kind: "image" | "text" | "unavailable"; src?: string; text?: string } | null>(null);
  useEffect(() => {
    setResult(null);
    if (!original || !enabled) return;
    const controller = new AbortController();
    let imageUrl = "";
    const timeout = window.setTimeout(() => { setResult({ kind: "unavailable" }); controller.abort(); }, 45000);
    localApi.originalPreview(original.path, controller.signal, original.modified).then((value) => {
      window.clearTimeout(timeout);
      if (controller.signal.aborted) return;
      if (value.kind === "image") { imageUrl = URL.createObjectURL(value.blob); setResult({ kind: "image", src: imageUrl }); }
      else setResult(value);
    }).catch(() => { window.clearTimeout(timeout); if (!controller.signal.aborted) setResult({ kind: "unavailable" }); });
    return () => { window.clearTimeout(timeout); controller.abort(); if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [original?.path, original?.modified, enabled]);
  return result;
}

function OriginalPreview({ original, zh, onClose, onDownload }: { original: DriveOriginal; zh: boolean; onClose: () => void; onDownload: () => void }) {
  return <DocumentPreview source={{ kind: "original", ...original }} zh={zh} onClose={onClose} onDownload={onDownload} />;
}
