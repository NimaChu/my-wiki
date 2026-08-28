export function conversationToMarkdown(conversation, labels = {}, imagePaths = new Map()) {
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
        if (path) lines.push(`![${String(image?.caption || "")}](${imagePaths.get(path) || path})`, "");
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

export function conversationExportBundle(conversation, labels = {}) {
  const { images, imagePaths } = collectConversationImages(conversation, "images");
  const markdownFilename = conversationFilename(conversation?.title || labels.untitled || "viki-conversation");
  return {
    markdown: conversationToMarkdown(conversation, labels, imagePaths),
    markdownFilename,
    archiveFilename: markdownFilename.replace(/\.md$/i, ".zip"),
    images
  };
}

export function conversationNoteBundle(conversation, labels = {}) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const firstUserIndex = messages.findIndex((message) => message?.role === "user" && String(message?.content || "").trim());
  const firstQuestion = firstUserIndex >= 0 ? String(messages[firstUserIndex].content || "") : "";
  const title = headingText(firstQuestion) || headingText(conversation?.title) || String(labels.untitled || "Viki note");
  const evidenceLabel = String(labels.evidence || "Evidence");
  const { images, imagePaths } = collectConversationImages(conversation, "assets");
  const lines = [`# ${title}`, ""];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "user") {
      if (index !== firstUserIndex) lines.push(`## ${headingText(message?.content) || String(labels.user || "Question")}`, "");
      continue;
    }
    const content = String(message?.content || "").trim();
    if (content) lines.push(content, "");
    for (const image of Array.isArray(message?.images) ? message.images : []) {
      const imagePath = String(image?.path || "").trim().replace(/\\/g, "/");
      const source = imagePaths.get(imagePath) || (/^https?:\/\//i.test(imagePath) ? imagePath : "");
      if (source) lines.push(`![${String(image?.caption || "")}](${source})`, "");
    }
    if (Array.isArray(message?.sources) && message.sources.length > 0) {
      lines.push(`### ${evidenceLabel}`, "");
      for (const source of message.sources) {
        const sourcePath = String(source?.path || "").trim();
        if (!sourcePath) continue;
        const sourceTitle = String(source?.title || sourcePath).trim();
        lines.push(/^https?:\/\//i.test(sourcePath) || source?.type === "web" ? `- [${sourceTitle}](${sourcePath})` : `- ${sourceTitle} (\`${sourcePath}\`)`);
      }
      lines.push("");
    }
  }
  return { title, markdown: `${lines.join("\n").trim()}\n`, images };
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

function portableImageName(value) {
  const source = String(value || "");
  let name = source.split("/").pop() || "image.png";
  if (/^https?:\/\//i.test(source)) {
    try {
      name = new URL(source).pathname.split("/").pop() || "image.jpg";
    } catch {
      // Fall through to the sanitized source filename.
    }
  }
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the encoded filename when it is not valid URI text.
  }
  const sanitized = name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .slice(-120) || "image.jpg";
  return /\.(?:png|jpe?g|gif|webp)$/i.test(sanitized) ? sanitized : `${sanitized}.jpg`;
}

function collectConversationImages(conversation, directory) {
  const images = [];
  const imagePaths = new Map();
  const seen = new Set();
  for (const message of Array.isArray(conversation?.messages) ? conversation.messages : []) {
    for (const image of Array.isArray(message?.images) ? message.images : []) {
      const path = String(image?.path || "").trim().replace(/\\/g, "/");
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const archivePath = `${directory}/${String(images.length + 1).padStart(3, "0")}-${portableImageName(path)}`;
      imagePaths.set(path, archivePath);
      images.push({ path, archivePath, type: /^https?:\/\//i.test(path) || image?.type === "web" ? "web" : "vault" });
    }
  }
  return { images, imagePaths };
}

function headingText(value) {
  return String(value || "").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim().slice(0, 160);
}
