import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Minimize2, X } from "lucide-react";
import { DriveGalaxy, Job, localApi, TaskProgress, waitForJob } from "./api";
import { LibraryIconButton } from "./LibraryIconButton";
import "./galaxy-export.css";

type Props = { galaxy: DriveGalaxy; language: "zh" | "en"; open: boolean; onOpen: () => void; onClose: () => void; onMinimize: () => void; onRunning: (running: boolean) => void };
const phases: Record<string, [string, string]> = {
  scanning: ["扫描知识与依赖", "Scanning knowledge and dependencies"],
  collecting: ["整理参考资料", "Collecting references"],
  hashing: ["计算文件校验和", "Hashing files"],
  packing: ["压缩知识包", "Compressing package"],
  verifying: ["验证归档文件", "Verifying archive files"],
  auditing: ["检查 OKF 格式", "Auditing OKF format"],
  complete: ["打包完成", "Package ready"]
};
const size = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

export function GalaxyExport({ galaxy, language, open, onOpen, onClose, onMinimize, onRunning }: Props) {
  const zh = language === "zh";
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const progress: TaskProgress = job?.meta.progress || { phase: "scanning", current: 0, total: 0, percent: null, message: "" };
  const complete = job?.status === "complete";
  const percent = complete ? 100 : progress.percent;
  const phaseLabel = phases[complete ? "complete" : progress.phase]?.[zh ? 0 : 1] || (zh ? "准备导出" : "Preparing export");
  const dismiss = () => running ? onMinimize() : onClose();
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, running, onClose, onMinimize]);

  const start = async () => {
    if (busy.current) return;
    busy.current = true; setRunning(true); onRunning(true); setError(""); setJob(null);
    try { await waitForJob(await localApi.exportUniverse(galaxy.name), setJob); }
    catch (next) { setError(next instanceof Error ? next.message : String(next)); }
    finally { busy.current = false; setRunning(false); onRunning(false); }
  };
  const download = async () => {
    if (!job?.downloadUrl) return;
    try {
      const link = document.createElement("a");
      link.href = await localApi.downloadUrl(job.downloadUrl); link.download = `${galaxy.name}.mywiki`; link.click();
    } catch (next) { setError(next instanceof Error ? next.message : String(next)); }
  };
  if (!open) return createPortal(<button className="galaxy-export-tray" onClick={onOpen} aria-label={zh ? "查看星系导出进度" : "View galaxy export progress"}><Download size={17} /><span><strong>{galaxy.name}</strong><small>{error ? (zh ? "导出需要处理" : "Export needs attention") : phaseLabel}{running && percent !== null ? ` · ${percent}%` : ""}</small></span></button>, document.body);
  return createPortal(<div className="galaxy-export-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    <section className="galaxy-export-dialog" role="dialog" aria-modal="true" aria-label={zh ? "导出知识星系" : "Export knowledge galaxy"}>
      <header><h3>{zh ? "导出知识星系" : "Export knowledge galaxy"}</h3><LibraryIconButton className="icon-button" title={running ? (zh ? "收起，后台继续" : "Minimize and continue") : (zh ? "关闭" : "Close")} onClick={dismiss}>{running ? <Minimize2 size={18} /> : <X size={18} />}</LibraryIconButton></header>
      <div className="galaxy-export-body">
        <strong>{galaxy.name}</strong>
        {!job && !running && !error ? <p>{zh ? `导出 ${galaxy.wiki} 个概念及其关联的参考资料、原件和附件为 .mywiki 知识包？` : `Export ${galaxy.wiki} concepts and their linked references, originals and assets as a .mywiki package?`}</p> : <>
          <div className="galaxy-export-phase" aria-live="polite"><span>{phaseLabel}</span>{percent !== null ? <b>{percent}%</b> : null}</div>
          <div className={`galaxy-export-progress${percent === null ? " indeterminate" : ""}`} role="progressbar" aria-label={phaseLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><span style={percent === null ? undefined : { width: `${percent}%` }} /></div>
          {progress.total > 0 && !complete ? <small>{zh ? "当前阶段" : "Current stage"} · {progress.phase === "packing" ? `${size(progress.current)} / ${size(progress.total)}` : `${progress.current} / ${progress.total}`}</small> : null}
          {complete ? <p>{galaxy.name}.mywiki · {size(Number(job.result?.archiveBytes || 0))}</p> : null}
        </>}
        {error ? <p className="galaxy-export-error" role="alert">{error}</p> : null}
      </div>
      <footer><button onClick={dismiss}>{running ? (zh ? "后台继续" : "Continue in background") : complete ? (zh ? "关闭" : "Close") : (zh ? "取消" : "Cancel")}</button>{!running ? <button className="primary-button" onClick={() => void (complete ? download() : start())}><Download size={16} />{complete ? (zh ? "下载知识包" : "Download package") : error ? (zh ? "重试导出" : "Retry export") : (zh ? "确认导出" : "Confirm export")}</button> : null}</footer>
    </section>
  </div>, document.body);
}
