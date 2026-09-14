import type { InboxItem } from "./api";

export function maintenanceStageLabel(item: InboxItem, language: "zh" | "en") {
  const zh = language === "zh";
  const stage = item.stage || (item.status === "needs-followup" ? "repair" : "distill");
  const names = { upload: ["上传", "upload"], extract: ["提取", "extraction"], repair: ["修复", "repair"], distill: ["蒸馏", "distillation"] };
  const name = names[stage][zh ? 0 : 1];
  if (item.jobStatus === "failed") return zh ? `${name}失败` : `${name} failed`;
  if (item.jobStatus === "queued") return zh ? `等待${name}` : `Queued for ${name}`;
  if (item.jobStatus === "running") return zh ? `正在${name}` : `${name[0].toUpperCase() + name.slice(1)} in progress`;
  return zh ? `待${name}` : `Awaiting ${name}`;
}
