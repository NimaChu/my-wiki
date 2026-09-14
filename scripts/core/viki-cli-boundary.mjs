import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./viki-query-mcp.mjs", import.meta.url));
export const queryMcp = (vault, allowWeb) => ({ command: process.execPath, args: [script, vault, allowWeb ? "web" : "local"] });
const disabledCodexFeatures = ["shell_tool", "unified_exec", "code_mode", "code_mode_host", "code_mode_only",
  "view_image", "browser_use", "browser_use_external", "computer_use", "apps", "plugins", "multi_agent",
  "memories", "hooks", "image_generation", "workspace_dependencies", "skill_search"];

export function scopedCodexArgs(vault, allowWeb) {
  const mcp = queryMcp(vault, allowWeb);
  return ["--ignore-user-config", "--ignore-rules",
    ...disabledCodexFeatures.flatMap((feature) => ["--disable", feature]),
    "--enable", "skip_host_skill_discovery",
    "-c", "web_search=\"disabled\"", "-c", "approval_policy=\"never\"",
    "-c", "project_doc_max_bytes=0",
    "-c", `mcp_servers.my_wiki={command=${JSON.stringify(mcp.command)},args=${JSON.stringify(mcp.args)},required=true}`];
}

export function scopedPrintArgs(configFile, provider) {
  return ["--tools", "", "--strict-mcp-config", "--mcp-config", configFile,
    provider === "qoder" ? "--allowed-tools" : "--allowedTools", "mcp__my_wiki__*",
    "--settings", JSON.stringify({ disableAllHooks: true })];
}

export function scopedOpenCodeConfig(vault, allowWeb) {
  const mcp = queryMcp(vault, allowWeb);
  const permission = { "*": "deny", read: "deny", glob: "deny", grep: "deny", list: "deny",
    lsp: "deny", edit: "deny", bash: "deny", task: "deny", external_directory: "deny", question: "deny",
    webfetch: "deny", websearch: "deny", skill: "deny", "my_wiki_*": "allow" };
  return { permission, mcp: { my_wiki: { type: "local", command: [mcp.command, ...mcp.args], enabled: true } },
    agent: { "my-wiki-viki": { mode: "primary", description: "Viki scoped read-only knowledge agent", permission } } };
}
