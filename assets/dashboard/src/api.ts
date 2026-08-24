export type InboxItem = {
  id: string;
  jobId?: string;
  jobStatus?: "queued" | "running" | "failed";
  path: string;
  title: string;
  status: string;
  sourceType: string;
  sourceUrl: string;
  snapshotPath: string;
  collection: string;
  suggestedUniverse: string;
  captured: string;
  preview: string;
  progress?: TaskProgress;
};

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
};

export type Job = {
  id: string;
  type: "capture-file" | "export" | "import-preview" | "import-apply" | "agent-maintenance" | "agent-repair" | "agent-answer";
  meta: Record<string, any>;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  createdAt: string;
  completedAt: string;
  result: Record<string, any> | null;
  error: string;
  downloadUrl: string;
};

export type AgentProvider = {
  provider: string;
  label: string;
  defaultModel: string;
  models: AgentModel[];
};

export type AgentModel = {
  id: string;
  label: string;
};

export type AgentInfo = {
  available: boolean;
  provider: string;
  label: string;
  defaultProvider: string;
  providers: AgentProvider[];
  message: string;
  busy: boolean;
  maintenanceBusy: boolean;
  activeJob: Job | null;
  activeMaintenanceJob: Job | null;
  rawTaskLimit?: number;
  activeRawJobs?: Job[];
};

export type AgentTaskSelection = {
  provider: string;
  model: string;
};

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
  sources: Array<{ path: string; title: string }>;
  images: Array<{ path: string; caption: string; afterBlock: number }>;
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
};

let session: Promise<{ token: string; vault: string }> | null = null;
const CHUNKED_UPLOAD_THRESHOLD = 1024 * 1024;

async function getSession() {
  if (!session) {
    session = fetch("/api/v1/session", { cache: "no-store" }).then(async (response) => {
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
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    if (response.ok) return response;
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
  async vault() {
    const response = await apiFetch("/api/v1/vault");
    return response.json() as Promise<{ vault: string; stats: Record<string, number> }>;
  },

  async inbox() {
    const response = await apiFetch("/api/v1/inbox");
    return response.json() as Promise<{ items: InboxItem[] }>;
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

  async agent() {
    const response = await apiFetch("/api/v1/agent");
    return response.json() as Promise<AgentInfo>;
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
    history: Array<{ role: "user" | "assistant"; content: string }>,
    language: "en" | "zh",
    provider: string,
    model: string,
    conversationId: string
  ) {
    const response = await apiFetch("/api/v1/agent/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, history, language, provider, model, conversationId })
    });
    return response.json() as Promise<Job>;
  },

  async cancelQuery(jobId: string) {
    const params = new URLSearchParams({ job: jobId });
    const response = await apiFetch(`/api/v1/agent/query?${params}`, { method: "DELETE" });
    return response.json() as Promise<{ cancelled: boolean; job: Job | null }>;
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
    input: { title?: string; collection?: string; suggestedUniverse?: string; sourcePath?: string },
    onProgress?: (uploaded: number, total: number) => void
  ) {
    if (file.size >= CHUNKED_UPLOAD_THRESHOLD) {
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

  async markdown(path: string) {
    const params = new URLSearchParams({ path });
    const response = await apiFetch(`/api/v1/markdown?${params}`);
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
