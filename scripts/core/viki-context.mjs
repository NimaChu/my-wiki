import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const contextText = (value) => String(value || "").trim().slice(0, 4000);
const keys = new Map();

async function contextKey(vault) {
  const root = await fs.realpath(vault);
  if (!keys.has(root)) {
    const pending = (async () => {
      const directory = path.join(root, ".my-wiki");
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, "viki-context.key");
      // Publish a complete key atomically so concurrent processes cannot read a
      // partially written key. The key, unlike browser history, survives restart.
      const temporary = `${file}.${randomBytes(12).toString("hex")}`;
      try {
        await fs.writeFile(temporary, randomBytes(32), { mode: 0o600, flag: "wx" });
        await fs.link(temporary, file).catch((error) => { if (error.code !== "EEXIST") throw error; });
        const key = await fs.readFile(file);
        if (key.length !== 32) throw new Error("Invalid Viki context key");
        return key;
      } finally { await fs.rm(temporary, { force: true }); }
    })().catch((error) => { keys.delete(root); throw error; });
    keys.set(root, pending);
  }
  return keys.get(root);
}

export async function createVikiContext({ vault, conversationId, names = [], allowedPaths = [], webSearch = false }) {
  const key = await contextKey(vault);
  const signature = (question, answer) => createHmac("sha256", key)
    .update(JSON.stringify([2, conversationId, contextText(question), contextText(answer)]))
    .digest("hex");
  const legacyScope = createHash("sha256").update(JSON.stringify({
    names: [...names].sort(), paths: [...allowedPaths].sort(), webSearch: !!webSearch
  })).digest("hex");
  const legacySignature = (question, answer) => createHmac("sha256", key)
    .update(JSON.stringify([1, conversationId, legacyScope, contextText(question), contextText(answer)]))
    .digest("hex");
  return {
    receipt(question, answer) {
      return { question: contextText(question), signature: signature(question, answer) };
    },
    history(value) {
      if (!Array.isArray(value)) return [];
      return value.slice(-8).flatMap((item) => {
        const receipt = item?.contextReceipt;
        if (item?.role !== "assistant" || item.contextExcluded || !receipt
          || typeof receipt.question !== "string" || !/^[a-f0-9]{64}$/.test(receipt.signature || "")) return [];
        const supplied = Buffer.from(receipt.signature, "hex");
        const current = Buffer.from(signature(receipt.question, item.content), "hex");
        const legacy = Buffer.from(legacySignature(receipt.question, item.content), "hex");
        if (!timingSafeEqual(supplied, current) && !timingSafeEqual(supplied, legacy)) return [];
        return [{ role: "user", content: contextText(receipt.question) },
          { role: "assistant", content: contextText(item.content) }];
      }).slice(-8);
    }
  };
}
