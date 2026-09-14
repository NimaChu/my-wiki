import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { listOriginalsDrive, resolveDriveOriginal } from "./originals-drive.mjs";

const requests = new Map();
const queue = [];
let active = 0;
function schedule(work, background) {
  return new Promise((resolve, reject) => { queue[background ? "push" : "unshift"]({ work, resolve, reject }); drain(); });
}
function drain() {
  while (active < 2 && queue.length) {
    const task = queue.shift(); active++;
    Promise.resolve().then(task.work).then(task.resolve, task.reject).finally(() => { active--; drain(); });
  }
}

export async function originalPreview(vault, relative, dependencyRoot, { background = false } = {}) {
  const { file, stat } = await resolveDriveOriginal(vault, relative);
  const key = createHash("sha256").update(`${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:v1`).digest("hex");
  const directory = path.join(vault, ".my-wiki/library-previews", key);
  const cached = async () => {
    for (const [name, type] of [["preview.png", "image/png"], ["preview.json", "application/json"]]) {
      const result = path.join(directory, name);
      if ((await fs.stat(result).catch(() => null))?.isFile()) return { file: result, type };
    }
    return null;
  };
  const hit = await cached();
  if (hit) return hit;
  if (requests.has(directory)) return requests.get(directory);
  if (queue.length > 100) throw Object.assign(new Error("Preview queue is full"), { statusCode: 429 });
  const request = schedule(async () => {
    const temporary = `${directory}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(temporary, { recursive: true });
      const supported = /\.(png|jpe?g|gif|webp|bmp|pdf|docx|pptx|xlsx|md|txt|html?|csv|json)$/i.test(file);
      const maxBytes = /\.pdf$/i.test(file) ? 256 * 1024 * 1024 : 32 * 1024 * 1024;
      if (!supported || stat.size > maxBytes) await fs.writeFile(path.join(temporary, "preview.json"), '{"kind":"unavailable"}');
      else await new Promise((resolve, reject) => {
        const env = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
        const child = spawn(process.execPath, ["--max-old-space-size=256", fileURLToPath(new URL("./original-preview-worker.mjs", import.meta.url)), file, temporary, path.resolve(dependencyRoot)], { env, windowsHide: true, stdio: "ignore", timeout: 20000 });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Preview unavailable")));
      }).catch(async () => fs.writeFile(path.join(temporary, "preview.json"), '{"kind":"unavailable"}'));
      await fs.rename(temporary, directory).catch(async (error) => { if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error; });
      return await cached();
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }, background).finally(() => requests.delete(directory));
  requests.set(directory, request);
  return request;
}

const warmers = new Map();
export function previewPreparationStatus(vault) {
  const entry = warmers.get(path.resolve(vault));
  return entry ? { running: Boolean(entry.promise), completed: entry.completed, total: entry.total, failed: entry.failed } : { running: false, completed: 0, total: 0, failed: 0 };
}

// One background producer leaves a worker available for an explicit preview request.
export function prepareLibraryPreviews(vault, dependencyRoot) {
  const root = path.resolve(vault);
  const previous = warmers.get(root);
  if (previous?.promise) return previous.promise;
  const state = { completed: 0, total: 0, failed: 0, promise: null };
  state.promise = (async () => {
    const { files } = await listOriginalsDrive(root);
    state.total = files.length;
    for (const file of files) {
      await originalPreview(root, file.path, dependencyRoot, { background: true }).catch(() => { state.failed++; });
      state.completed++;
    }
  })().finally(() => { state.promise = null; });
  warmers.set(root, state);
  return state.promise;
}
