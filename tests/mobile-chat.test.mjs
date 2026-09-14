import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../assets/dashboard/src/${file}`, import.meta.url), "utf8");

test("mobile entry mounts chat without the graph, workspace or maintenance pollers", async () => {
  const main = await read("main.tsx");
  const mobile = await read("MobileViki.tsx");
  assert.match(main, /return mobile \? <MobileViki[^\n]*: <DashboardApp \/>/);
  assert.match(mobile, /\(hover: none\) and \(pointer: coarse\)/);
  assert.match(mobile, /<Viki language=\{language\} standalone/);
  assert.doesNotMatch(mobile, /localApi\.graph|WorkspaceActions|SettingsMenu|setInterval/);
  assert.match(mobile, /DocumentPreview source=\{\{ kind: "note", path: documentPath \}\}/);
});

test("mobile chat cannot exit to a hidden dashboard and keeps touch and keyboard navigation", async () => {
  const viki = await read("Viki.tsx");
  const mobile = await read("MobileViki.tsx");
  const css = await read("mobile-chat.css");
  assert.match(viki, /const open = standalone \|\| windowOpen/);
  assert.match(viki, /const fullscreen = standalone \|\| windowFullscreen/);
  assert.match(viki, /if \(!standalone && event.key === "Escape"/);
  assert.match(viki, /if \(!standalone && shouldSubmitVikiComposer/);
  assert.match(viki, /if \(standalone\) return;\s*localApi.pets/);
  assert.match(viki, /role=\{standalone \? "dialog"/);
  assert.match(viki, /setAttribute\("inert", ""\)/);
  assert.match(viki, /removeAttribute\("inert"\)/);
  assert.match(mobile, /window.visualViewport/);
  assert.match(mobile, /removeEventListener\("resize", update\)/);
  assert.match(css, /min-height: 44px; min-width: 44px/);
  assert.match(css, /\.viki-composer textarea\s*\{\s*font-size: 16px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("mobile composer keeps galaxy, web and model controls on one row at every width", async () => {
  const css = await read("mobile-chat.css");
  assert.match(css, /\.viki-composer-toolbar\s*\{\s*flex-wrap: nowrap;/);
  assert.doesNotMatch(css, /flex-wrap: wrap|flex: 1 1 100%/);
  assert.match(css, /\.viki-agent-toggle span\s*\{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.viki-galaxy-picker\s*\{[^}]*min-width: 0/);
});
