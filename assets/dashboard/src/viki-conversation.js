export function conversationToMarkdown(conversation, labels = {}) {
  const title = String(conversation?.title || labels.untitled || "Viki conversation").trim();
  const userLabel = String(labels.user || "User");
  const assistantLabel = String(labels.assistant || "Viki");
  const evidenceLabel = String(labels.evidence || "Evidence");
  const lines = [`# ${title}`, ""];
  for (const message of Array.isArray(conversation?.messages) ? conversation.messages : []) {
    lines.push(`## ${message.role === "user" ? userLabel : assistantLabel}`, "", String(message.content || "").trim(), "");
    if (Array.isArray(message.images)) {
      for (const image of message.images) {
        const path = String(image?.path || "").trim();
        if (path) lines.push(`![${String(image?.caption || "")}](${path})`, "");
      }
    }
    if (Array.isArray(message.sources) && message.sources.length > 0) {
      lines.push(`### ${evidenceLabel}`, "");
      for (const source of message.sources) {
        const path = String(source?.path || "").trim();
        if (!path) continue;
        const title = String(source?.title || path).trim();
        lines.push(/^https?:\/\//i.test(path) || source?.type === "web" ? `- [${title}](${path})` : `- ${title} (\`${path}\`)`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function conversationFilename(title) {
  const normalized = String(title || "viki-conversation")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${normalized || "viki-conversation"}.md`;
}
