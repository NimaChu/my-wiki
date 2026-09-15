import { unpackDashboardGraph } from "./graph-transport.js";
import { readAnswerEvents } from "./answer-events.js";

export type DriveFolder = { id: string; galaxy: string; name: string; parentId: string | null };
export type DriveOriginal = { path: string; name: string; size: number; modified: string; galaxies: string[]; references: { path: string; title: string }[] };
export type DriveGalaxy = { id: string; name: string; count: number; wiki: number; raw: number; hidden: boolean };
export type GalaxyDialogMode = "create" | "import" | "trash";
export type OriginalsDriveData = {
  galaxies: DriveGalaxy[];
  files: DriveOriginal[];
  folders: DriveFolder[];
  placements: { galaxy: string; path: string; folderId: string }[];
};

export type InboxItem = {
  id: string;
  jobId?: string;
  jobStatus?: "queued" | "running" | "failed";
  path: string;
  title: string;
  status: string;
  referenceStatus?: string;
  documentVersion?: string;
  followupReasons?: string[];
  visualGapPages?: number[];
  sourceType: string;
  sourceUrl: string;
  snapshotPath: string;
  collection: string;
  suggestedUniverse: string;
  captured: string;
  preview: string;
  progress?: TaskProgress;
  stage?: "upload" | "extract" | "repair" | "distill";
};

export type DocumentVersion = { id: string; original: string; filename: string; number: number; createdAt: string; archivedAt: string; restoredFrom: string; reusable: boolean; bytes: number; referenceCount: number };

export type TaskProgress = {
  phase: string;
  current: number;
  total: number;
  percent: number | null;
  message: string;
};

export type UniverseSummary = {
  name: string;
  wiki: number;
  raw: number;
  declared?: boolean;
  hidden?: boolean;
};

export type GalaxyTrashEntry = {
  id: string;
  galaxy: string;
  trashedAt: string;
  archivedConcepts: number;
  archivedReferences: number;
  packageBytes: number;
  recoverable: boolean;
  retainedBackups: number;
};

export type AnswerStream = {
  text: string;
  phase: string;
  revision: number;
  sources?: AgentAnswer["sources"];
  images?: AgentAnswer["images"];
};

export type Job = {
  id: string;
  type: "capture-file" | "document-version" | "export" | "export-originals" | "import-preview" | "import-apply" | "agent-maintenance" | "agent-repair" | "agent-answer";
  meta: Record<string, any>;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  createdAt: string;
  completedAt: string;
  result: Record<string, any> | null;
  error: string;
  downloadUrl: string;
  stream?: AnswerStream;
};

export type AgentProvider = {
  executionMode?: "api" | "cli";
  provider: string;
  label: string;
  defaultModel: string;
  models: AgentModel[];
};

export type AgentModel = {
  id: string;
  label: string;
};

export type VikiApiSettings = { provider: string; label: string; configured: boolean; keySource: "environment" | "file" | "none"; model: string; models: AgentModel[]; reasoningEffort: "low" | "high" | "max" };

export type AgentInfo = {
  available: boolean;
  provider: string;
  label: string;
  defaultProvider: string;
  providers: AgentProvider[];
  answerProviders?: AgentProvider[];
  answerAvailable?: boolean;
  message: string;
  busy: boolean;
  maintenanceBusy: boolean;
  activeJob: Job | null;
  activeMaintenanceJob: Job | null;
  rawTaskLimit?: number;
  agentTaskLimit?: number;
  extractionTaskLimit?: number;
  activeRawJobs?: Job[];
  activeAgentJobs?: Job[];
  activeExtractionJobs?: Job[];
};

export type AgentTaskSelection = {
  provider: string;
  model: string;
};

export type AgentPreferences = {
  version: 1;
  viki: { provider: string; models: Record<string, string> };
  queue: { distill: AgentTaskSelection; repair: AgentTaskSelection };
};

export type AgentPreferencesPatch = { viki?: { provider?: string; models?: Record<string, string> }; queue?: Partial<AgentPreferences["queue"]> };

export type PetAppearance = {
  id: string;
  displayName: string;
  spriteVersionNumber: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  imageRendering: "smooth" | "pixelated";
  displayScale: number;
  spritesheetUrl: string;
};

export type AgentAnswer = {
  answerMarkdown: string;
  contextReceipt?: { question: string; signature: string };
  sources: Array<{ path: string; title: string; type?: "vault" | "web" }>;
  images: Array<{ path: string; caption: string; afterBlock: number; type?: "vault" | "web" }>;
};

export type MaintenanceResult = {
  summary: string;
  processed: string[];
  createdWiki: string[];
  updatedWiki: string[];
  remainingNotes: string;
  lintIssues: number;
};

export type RepairResult = {
  summary: string;
  path: string;
  unlocked: boolean;
  status: "inbox" | "needs-followup";
  repairedIssues: string[];
  remainingIssues: string[];
  remainingReasons: string[];
  lintIssues: number;
};

export type MarkdownDocument = {
  path: string;
  title: string;
  body: string;
  version: string;
  formatIssues?: Array<{ path: string; line: number; column: number; code: string; severity: "error" | "warning"; message: string }>;
};

export type LocalNoteSummary = {
  path: string;
  title: string;
  updatedAt: string;
  bytes: number;
};

export type DashboardSession = { token: string; vault: string; canManageAccess?: boolean; canManageProviders?: boolean };
export type GithubAllowlist = { owner: string; accounts: Array<{ login: string; owner: boolean }> };

let session: Promise<DashboardSession> | null = null;
let graphRequest: Promise<any> | null = null;
let graphCache: { etag: string; value: any } | null = null;
let libraryCache: { etag: string; value: OriginalsDriveData } | null = null;
let libraryRequest: Promise<OriginalsDriveData> | null = null;
export const cachedLibrary = () => libraryCache?.value;
const CHUNKED_UPLOAD_THRESHOLD = 1024 * 1024;
type PreviewResult = { kind: "image"; blob: Blob } | { kind: "text" | "unavailable"; text?: string };
const previewCache = new Map<string, PreviewResult>();
const previewBytes = (value: PreviewResult) => value.kind === "image" ? value.blob.size : (value.text?.length || 0) * 2;
let cachedPreviewBytes = 0;
let maintenanceRequest: Promise<{ items: InboxItem[] }> | null = null;
let activePreviews = 0;
const previewQueue: Array<() => void> = [];
async function previewSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (activePreviews >= 3) await new Promise<void>((resolve) => previewQueue.push(resolve));
  activePreviews++;
  try {
    if (signal.aborted) throw new DOMException("Preview cancelled", "AbortError");
    return await work();
  } finally { activePreviews--; previewQueue.shift()?.(); }
}

async function getSession() {
  if (!session) {
    session = fetch("/api/v1/session", { cache: "no-store", signal: AbortSignal.timeout(20000) }).then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response));
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Dashboard write service is unavailable / 本地写入服务未启动，请重启 Dashboard 后刷新页面。");
      }
      try {
        return await response.json();
      } catch {
        throw new Error("Dashboard write service returned an invalid response / 本地写入服务返回异常，请重启 Dashboard。");
      }
    }).catch((error) => {
      session = null;
      throw error;
    });
  }
  return session;
}

async function apiFetch(path: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await getSession();
    const headers = new Headers(init.headers);
    headers.set("x-my-wiki-token", current.token);
    const response = await fetch(path, { ...init, headers, cache: init.cache || "no-store" });
    if (response.ok || response.status === 304) return response;
    if (attempt === 0 && await hasInvalidSessionToken(response)) {
      session = null;
      continue;
    }
    throw new Error(await responseError(response));
  }
  throw new Error("Dashboard session could not be refreshed");
}

async function hasInvalidSessionToken(response: Response) {
  if (response.status !== 403) return false;
  try {
    const body = await response.clone().json() as { error?: unknown };
    return body.error === "Dashboard session token is missing or invalid";
  } catch {
    return false;
  }
}

async function responseError(response: Response) {
  try {
    const value = await response.json();
    return value.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export const localApi = {
  async originalPreview(path: string, signal: AbortSignal, revision = ""): Promise<PreviewResult> {
    const key = `${path}:${revision}`;
    const cached = previewCache.get(key);
    if (cached) { previewCache.delete(key); previewCache.set(key, cached); return cached; }
    return previewSlot(signal, async () => {
      if (previewCache.has(key)) return previewCache.get(key)!;
      const response = await apiFetch(`/api/v1/drive/preview?${new URLSearchParams({ path })}`, { signal, cache: "no-cache" });
      const result: PreviewResult = response.headers.get("content-type")?.startsWith("image/") ? { kind: "image", blob: await response.blob() } : await response.json();
      cachedPreviewBytes -= previewCache.has(key) ? previewBytes(previewCache.get(key)!) : 0;
      previewCache.set(key, result);
      cachedPreviewBytes += previewBytes(result);
      while (previewCache.size > 160 || cachedPreviewBytes > 24 * 1024 * 1024) {
        const oldest = previewCache.keys().next().value!;
        cachedPreviewBytes -= previewBytes(previewCache.get(oldest)!);
        previewCache.delete(oldest);
      }
      return result;
    });
  },
  async previewPreparation() {
    return (await apiFetch("/api/v1/drive/previews")).json() as Promise<{ running: boolean; completed: number; total: number; failed: number }>;
  },
  async documentVersions(path = "") {
    return (await apiFetch(`/api/v1/drive/versions?${new URLSearchParams({ path })}`)).json() as Promise<{ current: DocumentVersion | null; versions: DocumentVersion[] }>;
  },
  async restoreDocumentVersion(path: string, id: string) {
    return (await apiFetch("/api/v1/drive/versions/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, id }) })).json() as Promise<Job>;
  },
  async updateDocumentFromUrl(path: string, url: string) {
    return (await apiFetch("/api/v1/drive/versions/url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, url }) })).json() as Promise<Job>;
  },
  async githubAllowlist() {
    const response = await apiFetch("/api/v1/access/allowlist");
    return response.json() as Promise<GithubAllowlist>;
  },
  async apiSettings() {
    return (await apiFetch("/api/v1/settings/api")).json() as Promise<VikiApiSettings>;
  },
  async saveApiSettings(patch: { apiKey?: string; removeKey?: boolean; model?: string; reasoningEffort?: string }) {
    return (await apiFetch("/api/v1/settings/api", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) })).json() as Promise<VikiApiSettings>;
  },
  async updateGithubAccess(login: string, remove = false) {
    const response = await apiFetch("/api/v1/access/allowlist", {
      method: remove ? "DELETE" : "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ login })
    });
    return response.json() as Promise<GithubAllowlist>;
  },
  async session() {
    return getSession();
  },

  async graph() {
    if (!graphRequest) graphRequest = (async () => {
      const response = await apiFetch("/api/v1/graph?view=compact", { headers: graphCache?.etag ? { "if-none-match": graphCache.etag } : {}, signal: AbortSignal.timeout(30000) });
      if (response.status === 304 && graphCache) return graphCache.value;
      const value = unpackDashboardGraph(await response.json());
      graphCache = { etag: response.headers.get("etag") || "", value };
      return value;
    })().finally(() => { graphRequest = null; });
    return graphRequest;
  },

  async vault() {
    const response = await apiFetch("/api/v1/vault");
    return response.json() as Promise<{ vault: string; stats: Record<string, number> }>;
  },

  async inbox() {
    if (!maintenanceRequest) maintenanceRequest = apiFetch("/api/v1/maintenance-queue").then((response) => response.json() as Promise<{ items: InboxItem[] }>).finally(() => { maintenanceRequest = null; });
    return maintenanceRequest;
  },

  async captureJobs() {
    const response = await apiFetch("/api/v1/capture-jobs");
    return response.json() as Promise<{ items: InboxItem[] }>;
  },

  async deleteQueueItem(path: string) {
    const params = new URLSearchParams({ path });
    const response = await apiFetch(`/api/v1/inbox/item?${params}`, { method: "DELETE" });
    return response.json() as Promise<{ deleted: boolean; path: string; removedArtifacts: string[]; graphRefreshed: boolean }>;
  },

  async deleteQueueItems(paths: string[]) {
    const response = await apiFetch("/api/v1/inbox/items", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths })
    });
    return response.json() as Promise<{
      deleted: Array<{ deleted: boolean; path: string; removedArtifacts: string[] }>;
      failed: Array<{ path: string; error: string }>;
      count: number;
      graphRefreshed: boolean;
    }>;
  },

  async collections() {
    const response = await apiFetch("/api/v1/collections");
    return response.json() as Promise<{ collections: Array<{ name: string; count: number }> }>;
  },

  async originalsDrive() {
    if (!libraryRequest) libraryRequest = (async () => {
      const response = await apiFetch("/api/v1/drive", { headers: libraryCache?.etag ? { "if-none-match": libraryCache.etag } : {}, signal: AbortSignal.timeout(30000) });
      if (response.status === 304 && libraryCache) return libraryCache.value;
      const value = await response.json() as OriginalsDriveData;
      libraryCache = { etag: response.headers.get("etag") || "", value };
      return value;
    })().finally(() => { libraryRequest = null; });
    return libraryRequest;
  },

  async downloadOriginals(galaxy: string, files: string[]) {
    return (await apiFetch("/api/v1/drive/downloads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ galaxy, files }) })).json() as Promise<Job>;
  },

  async updateOriginalsDrive(input: { action: "create" | "rename" | "delete" | "move"; galaxy: string; name?: string; id?: string; parentId?: string | null; files?: string[]; folders?: string[] }) {
    return (await apiFetch("/api/v1/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).json();
  },

  async universes() {
    const response = await apiFetch("/api/v1/universes");
    return response.json() as Promise<{ universes: UniverseSummary[] }>;
  },

  async createUniverse(name: string) {
    const response = await apiFetch("/api/v1/universes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });
    return response.json() as Promise<UniverseSummary & { created: boolean; graphRefreshed: boolean }>;
  },

  async setUniverseHidden(name: string, hidden: boolean) {
    const response = await apiFetch("/api/v1/universes/visibility", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, hidden })
    });
    return response.json() as Promise<{ name: string; hidden: boolean; graphRefreshed: boolean }>;
  },

  async renameUniverse(name: string, newName: string) {
    const response = await apiFetch("/api/v1/universes/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, newName })
    });
    return response.json() as Promise<{ name: string; previousName: string; hidden: boolean; updatedConcepts: number; updatedReferences: number; graphRefreshed: boolean }>;
  },

  async deleteUniverse(name: string, confirmation: string) {
    const response = await apiFetch("/api/v1/universes/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, confirmation })
    });
    return response.json() as Promise<{ name: string; trashPackage: string; trashReceipt: string; removedConcepts: number; updatedConcepts: number; removedReferences: number; updatedReferences: number; graphRefreshed: boolean }>;
  },

  async galaxyTrash() {
    const response = await apiFetch("/api/v1/universes/trash");
    return response.json() as Promise<{ entries: GalaxyTrashEntry[] }>;
  },

  async restoreGalaxyTrash(id: string) {
    const response = await apiFetch("/api/v1/universes/trash/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    return response.json() as Promise<{ id: string; galaxy: string; graphRefreshed: boolean }>;
  },

  async purgeGalaxyTrash(id: string, confirmation: string) {
    const response = await apiFetch("/api/v1/universes/trash/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, confirmation })
    });
    return response.json() as Promise<{ id: string; galaxy: string; purged: boolean }>;
  },

  async agent() {
    const response = await apiFetch("/api/v1/agent");
    return response.json() as Promise<AgentInfo>;
  },

  async vikiAgent() {
    const response = await apiFetch("/api/v1/agent");
    const info = await response.json() as AgentInfo;
    const providers = info.answerProviders || info.providers;
    return { ...info, providers, available: info.answerAvailable ?? info.available,
      defaultProvider: providers.some((item) => item.provider === info.defaultProvider) ? info.defaultProvider : providers[0]?.provider || "" };
  },

  async agentPreferences() {
    const response = await apiFetch("/api/v1/agent/preferences");
    return response.json() as Promise<AgentPreferences>;
  },

  async saveAgentPreferences(preferences: AgentPreferencesPatch) {
    const response = await apiFetch("/api/v1/agent/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(preferences)
    });
    return response.json() as Promise<AgentPreferences>;
  },

  async pets() {
    const response = await apiFetch("/api/v1/pets");
    const payload = await response.json() as { pets: PetAppearance[] };
    const current = await getSession();
    return {
      pets: payload.pets.map((pet) => {
        const url = new URL(pet.spritesheetUrl, window.location.href);
        url.searchParams.set("token", current.token);
        return { ...pet, spritesheetUrl: url.href };
      })
    };
  },

  async maintain(paths: string[], batchSize = 8, selection: AgentTaskSelection) {
    const response = await apiFetch("/api/v1/agent/maintenance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths, batchSize, ...selection })
    });
    return response.json() as Promise<Job>;
  },

  async maintainBatch(paths: string[], batchSize: number, selections: { distill: AgentTaskSelection; repair: AgentTaskSelection }) {
    const response = await apiFetch("/api/v1/agent/maintenance-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paths,
        batchSize,
        distillProvider: selections.distill.provider,
        distillModel: selections.distill.model,
        repairProvider: selections.repair.provider,
        repairModel: selections.repair.model
      })
    });
    return response.json() as Promise<{ jobs: Job[]; count: number }>;
  },

  async repair(path: string, selection: AgentTaskSelection) {
    const response = await apiFetch("/api/v1/agent/repair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, ...selection })
    });
    return response.json() as Promise<Job>;
  },

  async ask(
    question: string,
    history: Array<{ role: "user" | "assistant"; content: string; contextReceipt?: AgentAnswer["contextReceipt"] }>,
    language: "en" | "zh",
    provider: string,
    model: string,
    conversationId: string,
    webSearch: boolean,
    galaxies: string[]
  ) {
    const response = await apiFetch("/api/v1/agent/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, history, language, provider, model, conversationId, webSearch, galaxies })
    });
    return response.json() as Promise<Job>;
  },

  async cancelQuery(jobId: string) {
    const params = new URLSearchParams({ job: jobId });
    const response = await apiFetch(`/api/v1/agent/query?${params}`, { method: "DELETE" });
    return response.json() as Promise<{ cancelled: boolean; job: Job | null }>;
  },

  async exportConversationBundle(input: {
    markdown: string;
    markdownFilename: string;
    archiveFilename: string;
    images: Array<{ path: string; archivePath: string }>;
  }) {
    const response = await apiFetch("/api/v1/viki/conversation-export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    return response.blob();
  },

  async notes() {
    const response = await apiFetch("/api/v1/notes");
    return response.json() as Promise<{ notes: LocalNoteSummary[] }>;
  },

  async deleteNote(path: string) {
    const params = new URLSearchParams({ path });
    const response = await apiFetch(`/api/v1/notes?${params}`, { method: "DELETE" });
    return response.json() as Promise<{ deleted: boolean; path: string; directory: string }>;
  },

  async saveNoteBundle(title: string, bundle: Blob, path = "") {
    const params = new URLSearchParams({ title });
    if (path) params.set("path", path);
    const response = await apiFetch(`/api/v1/notes/bundle?${params}`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: bundle
    });
    return response.json() as Promise<MarkdownDocument>;
  },

  async createNoteFromViki(input: {
    title: string;
    markdown: string;
    images: Array<{ path: string; archivePath: string }>;
  }) {
    const response = await apiFetch("/api/v1/notes/from-viki", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    return response.json() as Promise<MarkdownDocument>;
  },

  async captureNote(input: { path: string; title: string; collection?: string; suggestedUniverse?: string }) {
    const response = await apiFetch("/api/v1/notes/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    return response.json() as Promise<Job>;
  },

  async captureUrl(input: { url: string; title?: string; collection?: string; suggestedUniverse?: string }) {
    const response = await apiFetch("/api/v1/inbox/url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    return response.json() as Promise<Record<string, any>>;
  },

  async captureFile(
    file: File,
    input: { title?: string; collection?: string; suggestedUniverse?: string; sourcePath?: string; versionPath?: string },
    onProgress?: (uploaded: number, total: number) => void
  ) {
    if (file.size > 0) {
      let uploadId = "";
      try {
        const created = await apiFetch("/api/v1/inbox/file/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            title: input.title || "",
            collection: input.collection || "",
            suggestedUniverse: input.suggestedUniverse || "",
            sourcePath: input.sourcePath || "",
            versionPath: input.versionPath || "",
            size: file.size
          })
        });
        const upload = await created.json() as { id: string; offset: number; chunkSize: number };
        uploadId = upload.id;
        let offset = upload.offset;
        onProgress?.(offset, file.size);
        while (offset < file.size) {
          const end = Math.min(file.size, offset + upload.chunkSize);
          const response = await apiFetch(`/api/v1/inbox/file/uploads/${upload.id}?offset=${offset}`, {
            method: "PATCH",
            headers: { "content-type": "application/octet-stream" },
            body: file.slice(offset, end)
          });
          const next = await response.json() as { offset: number };
          if (next.offset !== end) throw new Error(`Upload offset mismatch; expected ${end}`);
          offset = next.offset;
          onProgress?.(offset, file.size);
        }
        const completed = await apiFetch(`/api/v1/inbox/file/uploads/${upload.id}/complete`, { method: "POST" });
        return completed.json() as Promise<Job>;
      } catch (error) {
        if (uploadId) {
          await apiFetch(`/api/v1/inbox/file/uploads/${uploadId}`, { method: "DELETE" }).catch(() => undefined);
        }
        throw error;
      }
    }
    const params = new URLSearchParams({ filename: file.name });
    if (input.title) params.set("title", input.title);
    if (input.collection) params.set("collection", input.collection);
    if (input.suggestedUniverse) params.set("suggestedUniverse", input.suggestedUniverse);
    if (input.sourcePath) params.set("sourcePath", input.sourcePath);
    const response = await apiFetch(`/api/v1/inbox/file?${params}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file
    });
    return response.json() as Promise<Job>;
  },

  async exportUniverse(universe: string) {
    const response = await apiFetch("/api/v1/universes/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ universe })
    });
    return response.json() as Promise<Job>;
  },

  async previewImport(file: File, as = "", onProgress?: (uploaded: number, total: number) => void) {
    if (file.size >= CHUNKED_UPLOAD_THRESHOLD) {
      let uploadId = "";
      try {
        const created = await apiFetch("/api/v1/universe-imports/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, as, size: file.size })
        });
        const upload = await created.json() as { id: string; offset: number; chunkSize: number };
        uploadId = upload.id;
        let offset = upload.offset;
        onProgress?.(offset, file.size);
        while (offset < file.size) {
          const end = Math.min(file.size, offset + upload.chunkSize);
          const response = await apiFetch(`/api/v1/universe-imports/uploads/${upload.id}?offset=${offset}`, {
            method: "PATCH",
            headers: { "content-type": "application/octet-stream" },
            body: file.slice(offset, end)
          });
          const next = await response.json() as { offset: number };
          if (next.offset !== end) throw new Error(`Upload offset mismatch; expected ${end}`);
          offset = next.offset;
          onProgress?.(offset, file.size);
        }
        const completed = await apiFetch(`/api/v1/universe-imports/uploads/${upload.id}/complete`, { method: "POST" });
        return completed.json() as Promise<Job>;
      } catch (error) {
        if (uploadId) {
          await apiFetch(`/api/v1/universe-imports/uploads/${uploadId}`, { method: "DELETE" }).catch(() => undefined);
        }
        throw error;
      }
    }
    const params = new URLSearchParams({ filename: file.name });
    if (as) params.set("as", as);
    const response = await apiFetch(`/api/v1/universe-imports?${params}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file
    });
    onProgress?.(file.size, file.size);
    return response.json() as Promise<Job>;
  },

  async applyImport(previewJobId: string, as = "") {
    const response = await apiFetch(`/api/v1/universe-imports/${previewJobId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ as })
    });
    return response.json() as Promise<Job>;
  },

  async job(id: string) {
    const response = await apiFetch(`/api/v1/jobs/${id}`);
    return response.json() as Promise<Job>;
  },

  async downloadUrl(path: string) {
    const current = await getSession();
    const url = new URL(path, window.location.href);
    url.searchParams.set("token", current.token);
    return url.href;
  },

  async vaultFileUrl(path: string) {
    const current = await getSession();
    const url = new URL("/api/v1/vault-file", window.location.href);
    url.searchParams.set("path", path);
    url.searchParams.set("token", current.token);
    return url.href;
  },

  async originalMarkdown(path: string, signal?: AbortSignal) {
    return (await apiFetch(`/api/v1/drive/markdown?${new URLSearchParams({ path })}`, { signal })).json() as Promise<MarkdownDocument>;
  },

  async markdown(path: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ path });
    const response = await apiFetch(`/api/v1/markdown?${params}`, { signal });
    return response.json() as Promise<MarkdownDocument>;
  },

  async saveMarkdown(path: string, body: string, expectedVersion: string) {
    const response = await apiFetch("/api/v1/markdown", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, body, expectedVersion })
    });
    return response.json() as Promise<MarkdownDocument & { graphRefreshed: boolean }>;
  },

  async markdownImageUrl(note: string, source: string) {
    const current = await getSession();
    const url = new URL("/api/v1/markdown-image", window.location.href);
    url.searchParams.set("note", note);
    url.searchParams.set("src", source);
    url.searchParams.set("token", current.token);
    return url.href;
  },

  async uploadMarkdownImage(note: string, file: File) {
    const params = new URLSearchParams({ note, filename: file.name || "image.png" });
    const response = await apiFetch(`/api/v1/markdown-image?${params}`, {
      method: "POST",
      headers: { "content-type": file.type },
      body: file
    });
    return response.json() as Promise<{ source: string; path: string; filename: string }>;
  }
};

export async function waitForJob(initial: Job, onUpdate?: (job: Job) => void) {
  let current = initial;
  onUpdate?.(current);
  while (current.status === "queued" || current.status === "running") {
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    current = await localApi.job(current.id);
    onUpdate?.(current);
  }
  if (current.status === "failed" || current.status === "cancelled") {
    throw new Error(current.error || (current.status === "cancelled" ? "My Wiki job was cancelled" : "My Wiki job failed"));
  }
  return current;
}

export async function waitForAnswer(initial: Job, onUpdate: (state: AnswerStream) => void, signal: AbortSignal) {
  let job = initial;
  let state = job.stream || { text: "", phase: "starting", revision: 0 };
  let failures = 0;
  while (job.status === "queued" || job.status === "running") {
    signal.throwIfAborted();
    if (!job.stream) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      job = await localApi.job(job.id);
      continue;
    }
    const connection = new AbortController();
    const abort = () => connection.abort();
    signal.addEventListener("abort", abort, { once: true });
    let watchdog: ReturnType<typeof setTimeout>;
    const activity = () => { clearTimeout(watchdog); watchdog = setTimeout(abort, 45000); };
    activity();
    let terminal: Job | undefined;
    try {
      const response = await apiFetch(`/api/v1/jobs/${job.id}/events`, { signal: connection.signal });
      await readAnswerEvents(response, (type, data) => {
        if (type === "done") { terminal = data as Job; return; }
        if (type === "snapshot" || type === "reset") state = data as AnswerStream;
        else if (type === "delta" && data.revision > state.revision) state = { ...state, text: state.text + data.delta, revision: data.revision };
        else if (type === "status" && data.revision > state.revision) state = { ...state, phase: data.phase, revision: data.revision };
        else if (type === "metadata" && data.revision > state.revision) state = { ...state, sources: data.sources, images: data.images, revision: data.revision };
        onUpdate(state);
      }, activity);
    } catch {
      signal.throwIfAborted();
      // A proxy/browser disconnect only reconnects this subscriber, not the agent.
    } finally {
      clearTimeout(watchdog!);
      connection.abort();
      signal.removeEventListener("abort", abort);
    }
    if (terminal) return terminal;
    signal.throwIfAborted();
    try {
      job = await localApi.job(job.id);
      failures = 0;
      if (job.stream) { state = job.stream; onUpdate(state); }
    } catch (error) {
      if (++failures >= 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return job;
}
