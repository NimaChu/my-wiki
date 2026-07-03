# Agent Wiki Rules

This project is a self-contained Markdown-first LLM wiki. Any agent can use this folder as its working directory and run all core workflows from local files and npm scripts.

Obsidian is optional. Codex skills are optional. The source of truth is this repository.

## Bootstrap

When starting in this workspace:

1. Read this `AGENTS.md`.
2. Read `README.md`.
3. Read `wiki/index.md` before answering from the knowledge base.
4. Run `npm run wiki:status` before broad maintenance, link repair, or dashboard work.
5. Use root npm scripts or `node scripts/karpathy-wiki.mjs ...` for automation.

Do not create a separate `codex.md`; this file is the agent rule source of truth.

## Operating Model

- `raw/` is the factual source layer. Do not rewrite source captures after they are stored except for small metadata fixes.
- `wiki/` is the compiled knowledge layer. Synthesize, link, correct, split, and merge wiki pages as understanding improves.
- `templates/` contains shared capture and wiki templates.
- `scripts/` contains the local CLI. Do not depend on globally installed skills.
- `tools/wiki-dashboard/` is read-only graph/dashboard code. It reads Markdown and generated JSON; it is never the source of truth.
- `.obsidian/`, if added by a user, is optional editor configuration and must not become a runtime dependency.

## Commands

Prefer root npm scripts:

```bash
npm run wiki:status
npm run wiki:lint
npm run wiki:garden
npm run wiki:repair-links
npm run wiki:search -- "query terms"
npm run wiki:capture -- --title "Source title" --url "https://example.com"
npm run dashboard
```

Dashboard commands are on-demand visualization tools. Do not refresh or start the dashboard during routine ingest or wiki edits unless the user explicitly asks to view the graph, inspect the dashboard, or work on visualization.

## Firecrawl MCP

This workspace provides `.mcp.json` for hosted Firecrawl MCP at `https://mcp.firecrawl.dev/v2/mcp`.

- Treat Firecrawl MCP as an optional agent capture tool, not as a required project dependency.
- The hosted keyless tier supports quick `scrape`, `search`, and `interact` workflows without a Firecrawl API key, with rate limits.
- Full Firecrawl tools such as `crawl`, `map`, `agent`, and `extract` require Firecrawl auth; only use them when the user has configured access.
- Prefer Firecrawl MCP when direct capture fails, when pages need rendering/interactions, or when web search is needed before selecting sources.
- After using MCP, ingest selected evidence into `raw/` with `npm run wiki:capture` via stdin or `--content-file`; do not treat MCP output alone as durable vault state.
- Respect site terms, robots policy, privacy constraints, and user authorization before crawling or mirroring content.
- If Firecrawl MCP tools are not visible in the current thread, the agent may need a thread/app reload after `.mcp.json` is added.

## Ingest

Use this when adding a webpage, article, PDF, transcript, or long-form note.

1. Create a raw source note in `raw/` using `templates/raw-source.md` or `npm run wiki:capture`.
2. Preserve bibliographic details and evidence metadata: title, author, date, URL, captured date, type, status, `snapshot_path`, `content_hash`, `capture_method`, and `source_quality`.
3. Preserve inline image order and mirror remote images when practical.
4. Extract durable claims and entities into existing or new pages under `wiki/`.
5. Link wiki pages back to raw notes with `[[raw/path-or-title]]` links.
6. Add a short entry to `wiki/log.md`.
7. Do not refresh or start the dashboard by default. Run `npm run dashboard` or `npm run wiki:refresh` only when the user asks to view the knowledge graph, inspect the dashboard, or perform visualization work.

## Query

Use this when answering from the vault.

1. Read `wiki/index.md` first.
2. Search `wiki/` first, then inspect linked raw notes when claims need grounding.
3. Prefer linked synthesis over one-off summaries.
4. Use `npm run wiki:search -- "query terms"` for cross-layer aggregation when direct file search is not enough.
5. If the answer reveals a missing durable concept and the user wants the vault updated, create or update the relevant wiki page.
6. Record material updates in `wiki/log.md`.

## Maintain

- Fix broken links and orphaned pages.
- Use `garden`, `lint`, and `repair-links` to review the maintenance queue.
- Merge duplicate concepts when one idea has multiple names.
- Split pages that mix unrelated ideas.
- Mark stale pages with `status: stale` and explain why.
- Keep `wiki/index.md` useful as the main entry point.
- Keep `processed` strict: a raw note is only processed when its primary wiki targets resolve, the wiki side links back, and follow-up flags are cleared.

## External Knowledge Connectors

External sources such as IMA are optional. Do not assume the connector exists, do not call connector tools speculatively, and do not store external identifiers without user consent.

Before using an external knowledge base, ask the user to confirm:

- connector name and availability,
- search scope,
- whether pointer notes may be created,
- whether external source identifiers may be written into raw or wiki pages.

If configured, keep local records lightweight: pointer notes plus extracted concepts are usually enough. Do not store full external content locally unless the user explicitly requests it and has the right to do so.

## Style

- Use Obsidian-compatible wiki links: `[[Page Name]]` or `[[Page Name|label]]`.
- Every source-backed wiki claim should link to raw evidence.
- Keep page names readable: `Topic Name.md`, not opaque IDs.
- Prefer small, durable pages over giant accumulation notes.
- Use `relation_hints` only from the supported set: `supports`, `challenges`, `related_to`, `applies_to`, `company_of`, `product_of`.
