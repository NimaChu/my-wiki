# Agent Wiki

<img width="1536" height="1024" alt="baa1975d853c5267d8b005b65569c09c_origin" src="https://github.com/user-attachments/assets/bea713c3-8d37-427b-ab04-5f601123f252" />

Zero-cost, beginner-friendly local knowledge base for AI agents.

[简体中文](README.zh-CN.md)

Agent Wiki gives you a practical way to own a private Markdown knowledge base without paying for a SaaS app, running a database, learning Obsidian, or building a RAG stack from scratch. Drop it into a workspace, ask your coding agent to capture sources, and let the agent maintain `raw/` evidence, `wiki/` pages, image references, search, lint, and an optional graph dashboard.

If you can open a terminal and talk to an agent, you can have a local knowledge base.

## Why Agent Wiki

- **Zero cost by default**: plain files, local scripts, no hosted database, no required API subscription.
- **Zero foundation friendly**: the workflow is made for people who want the agent to do the organizing, linking, and maintenance.
- **Local first**: your notes, raw sources, snapshots, and images stay in your workspace.
- **Agent native**: every folder and command is designed so Codex, Claude Code, Cursor, or another coding agent can keep the vault healthy.
- **Evidence based**: raw captures stay separate from distilled wiki pages, so answers can point back to sources.
- **Image aware**: screenshots and diagrams can be mirrored locally and promoted into answer-ready visual evidence.
- **No dashboard tax**: the graph dashboard is only built or started when you actually want visualization.
- **GitHub friendly**: publish the tool, keep your private knowledge local.

## What You Get

```text
raw/        source notes, snapshots, evidence, image inventories
wiki/       durable knowledge pages synthesized from raw sources
templates/  reusable raw and wiki page templates
scripts/    local CLI for capture, search, lint, repair, images, dashboard
tools/      optional local graph dashboard
```
And graph visualization
<img width="1895" height="936" alt="75d483a7df92c5e45cd101f3b44775c6_origin" src="https://github.com/user-attachments/assets/30230076-f34e-4749-bfef-84f3a6293b75" />


Agent Wiki is intentionally simple: Markdown in, Markdown out. You can inspect everything with a text editor, search it with ripgrep, sync the tool code with GitHub, and keep private knowledge out of commits.

## Quick Start

```bash
git clone https://github.com/NimaChu/agent-wiki.git
cd agent-wiki
npm install
npm run wiki:status
npm run wiki:lint
```

Then ask your agent:

```text
Maintain this local knowledge base.
```

That short request is enough. Project rules tell the agent to process raw sources in batches, distill durable wiki pages, keep evidence links healthy, avoid GitHub sync for local knowledge, and start the dashboard only when you ask for visualization.

## Capture A Source

```bash
npm run wiki:capture -- --title "Source title" --url "https://example.com"
```

Search the vault:

```bash
npm run wiki:search -- "query terms"
```

Check health:

```bash
npm run wiki:lint
npm run wiki:garden
npm run wiki:universes
npm run wiki:repair-links
```

Open the graph only when you want to see it:

```bash
npm run dashboard:open
```

```text
http://127.0.0.1:5173/
```

Agents should treat requests like "show the graph", "open the frontend", or "open the dashboard" as a request to run `npm run dashboard:open`.

## Core Workflow

1. Capture source material into `raw/`.
2. Preserve the original evidence, metadata, snapshots, links, and images.
3. Distill reusable concepts into `wiki/`.
4. Link wiki claims back to raw evidence.
5. Run lint, search, garden, and repair commands as maintenance.
6. Open the dashboard only when graph visualization is useful.

This keeps the knowledge base honest: raw evidence remains available, while the wiki becomes increasingly useful for agent answers.

## Karpathy-Style Wiki Pages

Agent Wiki follows a simple LLM-wiki habit: one durable knowledge unit gets one wiki page.

That means a raw source is not merely summarized once. A useful article, manual, PDF, or transcript may update many wiki pages: one for a concept, one for an API, one for a workflow, one for a comparison, and one for a product or entity. Over time, the wiki becomes a linked map of reusable ideas instead of a pile of one-off summaries.

Good wiki pages are:

- **Atomic**: one concept, entity, method, API, workflow, comparison, or recurring question.
- **Reusable**: written so a future agent can answer from it without rereading the full source first.
- **Linked**: connected to related concepts with Obsidian-style `[[Page Name]]` links.
- **Evidence backed**: important claims point back to raw source notes.
- **Small enough to maintain**: split pages that become mixed grab bags; merge pages that are duplicates; keep universes few, broad, and stable, preferring merge or rename over creating new top-level groups.

## Image Evidence

For image-rich articles, tutorials, and official docs, treat images as evidence.

```bash
npm run wiki:images -- --source raw/source-note.md
```

The image workflow:

- extracts Markdown and HTML image references,
- mirrors useful remote images into `raw/assets/<source-note>/`,
- writes `image-index.json`,
- updates the raw note with image counts and a `## Images` table.

When a topic page needs visual support, promote only the best images into a `## Visual Evidence` section. Agents can then include the relevant screenshots or diagrams when answering questions.

## Firecrawl MCP, Optional

Agent Wiki works without Firecrawl, but this repo includes a minimal `.mcp.json` for the hosted Firecrawl MCP endpoint:

```text
https://mcp.firecrawl.dev/v2/mcp
```

The hosted keyless MCP tier can expose tools such as `scrape`, `search`, and `interact` to MCP-capable agents without a Firecrawl API key, subject to Firecrawl limits. Full Firecrawl tools may require authentication.

Use Firecrawl as a capture helper, not as the source of truth:

1. Ask the agent to scrape or search.
2. Review the useful result.
3. Save selected evidence into Agent Wiki with `npm run wiki:capture`.

## IMA Bridge, Optional

Agent Wiki can also import external IMA knowledge base items into local raw notes.

This is optional and requires user-confirmed IMA OpenAPI credentials plus permission to store the selected content locally. The default is now local-first: `wiki:sync-ima` downloads each selected IMA item into `raw/ima/` as a normal `status: inbox` source note. Text goes into `## Capture`, binary originals are mirrored under `raw/snapshots/ima/`, and image-rich notes can be indexed under `raw/assets/`.

```bash
npm run wiki:sync-ima
npm run wiki:fetch-ima -- raw/ima/source-note.md --metadata
```

Maintenance treats imported IMA notes like any other inbox raw source: distill durable concepts into `wiki/`, close backlinks to the raw evidence, then mark the raw note `processed`. Older `ima-pointer` notes are legacy records; run `npm run wiki:fetch-ima -- raw/ima/source-note.md` to upgrade one into a local inbox raw note before normal maintenance.

Detailed agent workflow: `docs/ima-local-import.md`.

## Commands

```bash
npm run wiki:status
npm run wiki:lint
npm run wiki:garden
npm run wiki:universes
npm run wiki:repair-links
npm run wiki:search -- "query terms"
npm run wiki:capture -- --title "Source title" --url "https://example.com"
npm run wiki:images -- --source raw/source-note.md
npm run wiki:sync-ima
npm run wiki:fetch-ima -- raw/ima/source-note.md --metadata
npm run dashboard
npm run dashboard:open
npm run dashboard:build
```

Direct CLI:

```bash
node scripts/karpathy-wiki.mjs help
```

## What To Commit

Agent Wiki separates project code from personal knowledge:

- Commit and push reusable tool improvements: scripts, templates, dashboard code, docs.
- Keep private or bulky knowledge local: raw captures, snapshots, mirrored assets, personal wiki pages.

This makes the repository useful as open source while keeping your actual knowledge base under your control.

## Requirements

- Node.js 18+
- npm

Optional:

- Obsidian, if you want a human editor with backlinks and graph view.
- MCP tools such as Firecrawl, when your agent environment supports them.
- External knowledge connectors, only when you intentionally configure them.

## Who It Is For

Agent Wiki is for people who want:

- a local second brain that an agent can maintain,
- source-grounded answers instead of loose chat history,
- a private knowledge workflow without SaaS lock-in,
- an open, inspectable alternative to heavyweight RAG stacks,
- a simple bridge between web capture, Markdown notes, images, and agent search.

Bring your questions. Let the agent tend the garden.
