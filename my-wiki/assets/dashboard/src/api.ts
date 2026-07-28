export type InboxItem = {
  id: string;
  path: string;
  title: string;
  status: string;
  sourceType: string;
  sourceUrl: string;
  snapshotPath: string;
  collection: string;
  captured: string;
  preview: string;
};

export type UniverseSummary = {
  name: string;
  wiki: number;
  raw: number;
};

export type Job = {
  id: string;
  type: "export" | "import-preview" | "import-apply" | "agent-maintenance" | "agent-answer";
  meta: Record<string, any>;
  status: "queued" | "running" | "complete" | "failed";
  createdAt: string;
  completedAt: string;
  result: Record<string, any> | null;
  error: string;
  downloadUrl: string;
};

export type AgentProvider = {
  provider: string;
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
};

export type PetAppearance = {
  id: string;
  displayName: string;
  spriteVersionNumber: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  spritesheetUrl: string;
};

export type AgentAnswer = {
  answerMarkdown: string;
  sources: Array<{ path: string; title: string }>;
  images: Array<{ path: string; caption: string }>;
};

export type MaintenanceResult = {
  summary: string;
  processed: string[];
  createdWiki: string[];
  updatedWiki: string[];
  remainingNotes: string;
  lintIssues: number;
};

let session: Promise<{ token: string; vault: string }> | null = null;

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
  const current = await getSession();
  const headers = new Headers(init.headers);
  headers.set("x-my-wiki-token", current.token);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response));
  return response;
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

  async collections() {
    const response = await apiFetch("/api/v1/collections");
    return response.json() as Promise<{ collections: Array<{ name: string; count: number }> }>;
  },

  async universes() {
    const response = await apiFetch("/api/v1/universes");
    return response.json() as Promise<{ universes: UniverseSummary[] }>;
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

  async maintain(paths: string[], batchSize = 8, provider = "") {
    const response = await apiFetch("/api/v1/agent/maintenance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths, batchSize, provider })
    });
    return response.json() as Promise<Job>;
  },

  async ask(question: string, history: Array<{ role: "user" | "assistant"; content: string }>, language: "en" | "zh", provider: string) {
    const response = await apiFetch("/api/v1/agent/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, history, language, provider })
    });
    return response.json() as Promise<Job>;
  },

  async captureUrl(input: { url: string; title?: string; collection?: string }) {
    const response = await apiFetch("/api/v1/inbox/url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    return response.json() as Promise<Record<string, any>>;
  },

  async captureFile(file: File, input: { title?: string; collection?: string; sourcePath?: string }) {
    const params = new URLSearchParams({ filename: file.name });
    if (input.title) params.set("title", input.title);
    if (input.collection) params.set("collection", input.collection);
    if (input.sourcePath) params.set("sourcePath", input.sourcePath);
    const response = await apiFetch(`/api/v1/inbox/file?${params}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file
    });
    return response.json() as Promise<Record<string, any>>;
  },

  async exportUniverse(universe: string) {
    const response = await apiFetch("/api/v1/universes/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ universe })
    });
    return response.json() as Promise<Job>;
  },

  async previewImport(file: File, as = "") {
    const params = new URLSearchParams({ filename: file.name });
    if (as) params.set("as", as);
    const response = await apiFetch(`/api/v1/universe-imports?${params}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file
    });
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
  if (current.status === "failed") throw new Error(current.error || "My Wiki job failed");
  return current;
}
