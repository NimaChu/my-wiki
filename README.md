# Agent Wiki

Agent Wiki is a self-contained Markdown knowledge vault for agent workflows.

It is inspired by Karpathy-style LLM Wiki workflows: preserve raw evidence, compile reusable wiki pages, keep links healthy, and expose an Obsidian-like local graph dashboard. It does not require Obsidian or any Codex skill install.

## Requirements

- Node.js 18+
- npm

Optional:

- Obsidian, if you want a human editor with backlinks, Graph View, Dataview, and templates.
- External knowledge connectors such as IMA, only after the user confirms and configures them.

## Quick Start

```bash
npm run wiki:status
npm run wiki:lint
npm run dashboard
```

Open the dashboard:

```text
http://127.0.0.1:5173/
```

## Project Layout

- `raw/` stores source notes and evidence metadata.
- `wiki/` stores durable synthesized knowledge pages.
- `templates/` stores reusable raw/wiki templates.
- `scripts/` stores the local CLI for status, lint, search, capture, repair, gardening, and dashboard refresh.
- `tools/wiki-dashboard/` stores the read-only graph dashboard.
- `AGENTS.md` is the operating contract for agents using this folder as a workspace.

## Commands

```bash
npm run wiki:status
npm run wiki:lint
npm run wiki:garden
npm run wiki:repair-links
npm run wiki:search -- "query terms"
npm run wiki:capture -- --title "Source title" --url "https://example.com"
npm run dashboard
npm run dashboard:build
```

Dashboard refresh and serving are intentionally on-demand. Routine captures and wiki edits should not start the dashboard; use dashboard commands only when you want to inspect the graph or work on visualization.

## Firecrawl MCP

This workspace includes a minimal `.mcp.json` for the hosted Firecrawl MCP server:

```text
https://mcp.firecrawl.dev/v2/mcp
```

The hosted keyless tier lets MCP-capable agents use `scrape`, `search`, and `interact` without a Firecrawl API key, subject to rate limits. Full tools such as `crawl`, `map`, `agent`, and `extract` require Firecrawl auth. If you later want the full tool set, replace the URL with:

```text
https://mcp.firecrawl.dev/{FIRECRAWL_API_KEY}/v2/mcp
```

Use Firecrawl MCP as an agent capture tool, not as the vault source of truth:

1. Ask the agent to scrape/search/interact with Firecrawl MCP.
2. Review or summarize the useful result.
3. Ingest the selected evidence through `npm run wiki:capture` using stdin or `--content-file`.

Example:

```bash
npm run wiki:capture -- --title "Source title" --url "https://example.com"
```

If the current Codex thread does not show Firecrawl tools immediately, reload/open a new thread after the workspace MCP config is detected.

Direct CLI:

```bash
node scripts/karpathy-wiki.mjs help
```

## Workflow

1. Capture sources into `raw/`.
2. Compile durable concepts, topics, people, companies, products, or methods into `wiki/`.
3. Link wiki claims back to raw evidence.
4. Keep `wiki/index.md` useful as the main entry point.
5. Run lint/garden/repair regularly.
6. Use the dashboard on demand for graph browsing, visualization, and health checks.

## External Knowledge Connectors

External knowledge bases are optional. Do not assume they exist.

Before using IMA or another connector, the agent should ask the user to confirm:

- which connector is available,
- what knowledge base or folder should be searched,
- whether local pointer notes may be created under `raw/external/` or `raw/ima/`,
- whether source identifiers may be written into wiki pages.

Keep external originals outside this repository unless the user explicitly requests local capture and has the right to store the material.
