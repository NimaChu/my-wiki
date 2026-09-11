import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const error = (status, message) => Object.assign(new Error(message), { status, statusCode: status });
export function githubLogin(value) {
  const login = String(value || "").trim();
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login) || login.includes("--")) throw error(400, "Invalid GitHub username");
  return login;
}

export async function createGithubAllowlist({ file, owner, enabled }) {
  let accounts = [];
  let queue = Promise.resolve();
  const ownerKey = owner.toLowerCase();
  async function persist(next) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, accounts: next }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, file);
      accounts = next;
    } finally { await fs.rm(temporary, { force: true }); }
  }
  if (enabled) {
    githubLogin(owner);
    try {
      const stored = JSON.parse(await fs.readFile(file, "utf8"));
      if (stored.version !== 1 || !Array.isArray(stored.accounts)) throw new Error("Invalid GitHub allowlist file");
      accounts = [...new Map(stored.accounts.map((value) => { const login = githubLogin(value); return [login.toLowerCase(), login]; })).values()];
    } catch (failure) { if (failure.code !== "ENOENT") throw failure; }
    if (!accounts.some((login) => login.toLowerCase() === ownerKey)) await persist([owner, ...accounts]);
  }
  const allowed = (login) => enabled && accounts.some((item) => item.toLowerCase() === String(login).toLowerCase());
  const list = () => ({ accounts: accounts.map((login) => ({ login, owner: login.toLowerCase() === ownerKey })), owner });
  function update(value, remove) {
    const run = queue.then(async () => {
      if (!enabled) throw error(503, "Public GitHub access is not configured");
      const login = githubLogin(value);
      if (remove && login.toLowerCase() === ownerKey) throw error(400, "The owner cannot be removed");
      const next = accounts.filter((item) => item.toLowerCase() !== login.toLowerCase());
      if (!remove) next.push(login.toLowerCase() === ownerKey ? owner : login);
      await persist(next);
      return list();
    });
    queue = run.catch(() => {});
    return run;
  }
  return { allowed, list, add: (login) => update(login, false), remove: (login) => update(login, true) };
}
