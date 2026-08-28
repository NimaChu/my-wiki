import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { conversationExportBundle, conversationFilename, conversationNoteBundle, conversationToMarkdown } from "../assets/dashboard/src/viki-conversation.js";

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

test("Viki switches image conversations to a portable Markdown ZIP manifest", () => {
  const bundle = conversationExportBundle({
    title: "Visual answer",
    messages: [{
      role: "assistant",
      content: "See the evidence.",
      images: [
        { path: "references/assets/session/diagram one.png", caption: "Diagram" },
        { path: "references/assets/session/diagram one.png", caption: "Duplicate" }
      ]
    }]
  });
  assert.equal(bundle.archiveFilename, "Visual answer.zip");
  assert.deepEqual(bundle.images, [{
    path: "references/assets/session/diagram one.png",
    archivePath: "images/001-diagram-one.png",
    type: "vault"
  }]);
  assert.match(bundle.markdown, /!\[Diagram\]\(images\/001-diagram-one\.png\)/);
});

test("Viki exports answers and relative images into a quick note", () => {
  const bundle = conversationNoteBundle({
    title: "Fallback title",
    messages: [
      { role: "user", content: "How does My Wiki work?" },
      { role: "assistant", content: "It preserves evidence.", images: [{ path: "references/assets/flow.png", caption: "Flow" }] },
      { role: "user", content: "What about sharing?" },
      { role: "assistant", content: "Export a galaxy." }
    ]
  });
  assert.equal(bundle.title, "How does My Wiki work?");
  assert.match(bundle.markdown, /^# How does My Wiki work\?$/m);
  assert.match(bundle.markdown, /It preserves evidence\./);
  assert.match(bundle.markdown, /^## What about sharing\?$/m);
  assert.doesNotMatch(bundle.markdown, /^## User$/m);
  assert.deepEqual(bundle.images, [{ path: "references/assets/flow.png", archivePath: "assets/001-flow.png", type: "vault" }]);
  assert.match(bundle.markdown, /!\[Flow\]\(assets\/001-flow\.png\)/);
});

test("Viki makes web images portable in conversation and note exports", () => {
  const conversation = {
    title: "Current chart",
    messages: [{
      role: "assistant",
      content: "Current data.",
      images: [{ path: "https://cdn.example.com/chart.jpg", caption: "Chart", type: "web" }]
    }]
  };
  const exported = conversationExportBundle(conversation);
  const note = conversationNoteBundle(conversation);
  assert.deepEqual(exported.images, [{ path: "https://cdn.example.com/chart.jpg", archivePath: "images/001-chart.jpg", type: "web" }]);
  assert.deepEqual(note.images, [{ path: "https://cdn.example.com/chart.jpg", archivePath: "assets/001-chart.jpg", type: "web" }]);
  assert.match(exported.markdown, /!\[Chart\]\(images\/001-chart\.jpg\)/);
  assert.match(note.markdown, /!\[Chart\]\(assets\/001-chart\.jpg\)/);
});

test("Markdown editor image toolbar opens a real file picker", async () => {
  const component = await readFile(new URL("../assets/dashboard/src/MarkdownLiveEditor.tsx", import.meta.url), "utf8");
  assert.match(component, /imageItem\.onRun = \(\) => imageInputRef\.current\?\.click\(\)/);
  assert.match(component, /type="file"[\s\S]*accept="image\/png/);
  assert.match(component, /addBlockTypeCommand\.key/);
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
  assert.match(styles, /\.viki-icon-tooltip::after\s*\{[\s\S]*bottom: calc\(100% \+ 7px\)/);
  assert.doesNotMatch(styles, /top: calc\(100% \+ 7px\)/);
  assert.match(styles, /\.viki-panel\s*\{[\s\S]*?overflow: visible/);
  assert.doesNotMatch(component, /<div className="viki-identity">\s*<span className="viki-avatar">/);
  assert.match(styles, /\.viki-pet\s*\{[\s\S]*?overflow: hidden/);
  assert.match(component, /<div className="viki-identity">\s*<strong>Viki<\/strong>/);
  assert.doesNotMatch(component, /conversation\?\.title \|\| l\.companion/);
  assert.match(component, /className="viki-agent-toggle"/);
  assert.match(component, /className="viki-agent-menu"/);
  assert.match(component, /fullscreen \? <Minimize2/);
  assert.match(component, /className="viki-fullscreen-sidebar"/);
  assert.match(component, /className="viki-composer-toolbar"/);
  assert.match(component, /GalaxyScopePicker/);
  assert.match(component, /galaxies: string\[\]/);
  assert.match(styles, /\.viki-panel\.is-fullscreen\s*\{[\s\S]*grid-template-columns: 268px minmax\(0, 1fr\)/);
  assert.match(styles, /\.viki-panel\.is-fullscreen \.viki-conversation > \*/);
});

test("Viki full screen uses composer controls and per-conversation sidebar actions", async () => {
  const component = await readFile(new URL("../assets/dashboard/src/Viki.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../assets/dashboard/src/styles.css", import.meta.url), "utf8");
  assert.match(component, /<div className="viki-composer-toolbar-left">[\s\S]*GalaxyScopePicker[\s\S]*viki-composer-web-toggle/);
  assert.match(component, /<div className="viki-composer-toolbar-right">[\s\S]*viki-agent-picker is-full/);
  assert.match(component, /!fullscreen && pets\.length \? \([\s\S]*className="viki-pet-picker"/);
  assert.match(component, /!fullscreen \? <button[\s\S]*aria-label=\{l\.newConversation\}/);
  assert.match(component, /!fullscreen \? <div className="viki-export-picker">/);
  assert.match(component, /className="viki-session-actions"[\s\S]*exportConversationLocally\(item\)[\s\S]*exportConversationToNote\(item\)[\s\S]*className="viki-session-delete"/);
  assert.match(styles, /\.viki-composer-toolbar-left,[\s\S]*\.viki-composer-toolbar-right/);
  assert.match(styles, /\.viki-panel\.is-fullscreen \.viki-composer > button\s*\{[\s\S]*grid-row: 2/);
  assert.match(styles, /\.viki-composer-toolbar \.viki-agent-picker\s*\{[\s\S]*width: max-content;[\s\S]*max-width: min\(420px, 44vw\)/);
});

test("Viki compact controls keep the requested order and open the pet menu to the right", async () => {
  const component = await readFile(new URL("../assets/dashboard/src/Viki.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../assets/dashboard/src/styles.css", import.meta.url), "utf8");
  const status = component.slice(component.indexOf('<div className="viki-status">'), component.indexOf('<span className={busy'));
  assert.ok(status.indexOf("aria-label={l.newConversation}") < status.indexOf('className="viki-session-picker"'));
  assert.ok(status.indexOf("viki-web-toggle") < status.indexOf("<GalaxyScopePicker"));
  assert.match(styles, /\.viki-pet-menu\s*\{[\s\S]*top: 0;[\s\S]*left: calc\(100% \+ 8px\)/);
});

test("Viki renders assistant Markdown with GFM tables", async () => {
  const component = await readFile(new URL("../assets/dashboard/src/Viki.tsx", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../assets/dashboard/src/VikiMarkdown.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../assets/dashboard/src/styles.css", import.meta.url), "utf8");
  assert.match(component, /lazy\(\(\) => import\("\.\/VikiMarkdown"\)\)/);
  assert.match(renderer, /import ReactMarkdown from "react-markdown"/);
  assert.match(renderer, /remarkPlugins=\{\[remarkGfm, remarkMath\]\}/);
  assert.match(renderer, /table: \(\{ children \}\) => <div className="viki-table-scroll">/);
  assert.doesNotMatch(component, /block\.replace\(\/\\n\/g, " "\)/);
  assert.match(styles, /\.viki-table-scroll table\s*\{[\s\S]*border-collapse: collapse/);
});
