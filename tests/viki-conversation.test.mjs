import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { conversationFilename, conversationToMarkdown } from "../assets/dashboard/src/viki-conversation.js";

test("Viki exports a complete Markdown conversation with evidence and images", () => {
  const markdown = conversationToMarkdown({
    title: "Agent knowledge",
    messages: [
      { role: "user", content: "What is My Wiki?" },
      {
        role: "assistant",
        content: "An evidence-backed knowledge workspace.",
        images: [{ path: "references/assets/graph.png", caption: "Knowledge graph" }],
        sources: [
          { path: "references/sources/my-wiki.md", title: "My Wiki README" },
          { path: "https://example.com/research", title: "External research", type: "web" }
        ]
      }
    ]
  });
  assert.match(markdown, /^# Agent knowledge/m);
  assert.match(markdown, /^## User$/m);
  assert.match(markdown, /^## Viki$/m);
  assert.match(markdown, /!\[Knowledge graph\]\(references\/assets\/graph\.png\)/);
  assert.match(markdown, /My Wiki README \(`references\/sources\/my-wiki\.md`\)/);
  assert.match(markdown, /\[External research\]\(https:\/\/example\.com\/research\)/);
  assert.equal(conversationFilename('A/B: "chat"'), "A-B- -chat-.md");
});

test("Viki conversation history owns its wheel-scrolling region", async () => {
  const component = await readFile(new URL("../assets/dashboard/src/Viki.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../assets/dashboard/src/styles.css", import.meta.url), "utf8");
  assert.match(component, /viki-session-list" onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(styles, /\.viki-session-menu\s*\{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.viki-session-list\s*\{[\s\S]*overscroll-behavior: contain/);
});

test("Viki header icon buttons expose immediate localized tooltips", async () => {
  const component = await readFile(new URL("../assets/dashboard/src/Viki.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../assets/dashboard/src/styles.css", import.meta.url), "utf8");
  for (const label of ["l.history", "l.newConversation", "l.exportConversation", "l.close"]) {
    assert.match(component, new RegExp(`data-tooltip=\\{${label.replace(".", "\\.")}\\}`));
  }
  assert.match(component, /data-tooltip=\{`\$\{l\.webSearch\}:/);
  assert.match(component, /data-tooltip=\{`\$\{l\.pet\}:/);
  assert.match(styles, /\.viki-icon-tooltip::after\s*\{[\s\S]*content: attr\(data-tooltip\)/);
  assert.match(styles, /\.viki-icon-tooltip:hover::after/);
});
