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

## Karpathy-Style Wiki Pages

Treat the wiki layer as an atomic LLM-maintained wiki, not as a folder of source summaries.

- Prefer one durable knowledge unit per wiki page: one concept, entity, method, API, workflow, comparison, or recurring question.
- A single raw source can update many wiki pages. Do not create only one summary page when the source contains multiple reusable ideas.
- Create missing concept pages when a source repeatedly mentions an important idea that has no durable home yet.
- Keep `wiki/index.md`, `wiki/log.md`, and README files as navigation or maintenance records, not graph knowledge nodes.
- Split pages that mix unrelated knowledge units; merge pages that are duplicate names for the same knowledge unit.
- Link every source-backed claim to raw evidence, but keep the wiki prose synthesis-oriented rather than copied from the source.

## Commands

Prefer root npm scripts:

```bash
npm run wiki:status
npm run wiki:lint
npm run wiki:garden
npm run wiki:repair-links
npm run wiki:search -- "query terms"
npm run wiki:capture -- --title "Source title" --url "https://example.com"
npm run wiki:images -- --source raw/source-note.md
npm run wiki:sync-ima
npm run wiki:fetch-ima -- raw/ima/source-note.md --metadata
npm run dashboard
npm run dashboard:open
```

Dashboard/frontend commands are on-demand visualization tools. Do not refresh, start, or open the dashboard during routine ingest or wiki edits unless the user explicitly asks to view the knowledge graph, open the frontend, inspect the dashboard, or work on visualization.

Treat short user requests such as `看知识图谱`, `打开知识图谱`, `打开前端`, `打开 dashboard`, `show the graph`, `open the frontend`, or `open the dashboard` as complete requests to run `npm run dashboard:open`. That command should refresh the graph, ensure the local Agent Wiki frontend is running, and open `http://127.0.0.1:5173/` in the browser.

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
4. For image-rich webpages, run `npm run wiki:images -- --source raw/source-note.md` after capture or after adding snapshot paths. This downloads images into `raw/assets/<source-note>/`, writes `image-index.json`, and updates the raw note's `## Images` section.
5. Promote only the most useful visual evidence into wiki pages. Keep exhaustive image inventories in raw notes.
6. Extract durable claims and entities into existing or new pages under `wiki/`.
7. Link wiki pages back to raw notes with `[[raw/path-or-title]]` links.
8. Add a short entry to `wiki/log.md`.
9. Do not refresh, start, or open the dashboard by default. Run `npm run dashboard:open` when the user asks to view the knowledge graph, open the frontend/dashboard, inspect the dashboard, or perform visualization work. Use `npm run dashboard` or `npm run wiki:refresh` only when opening the browser is not requested.

## Query

Use this when answering from the vault.

1. Read `wiki/index.md` first.
2. Search `wiki/` first, then inspect linked raw notes when claims need grounding.
3. Prefer linked synthesis over one-off summaries.
4. Use `npm run wiki:search -- "query terms"` for cross-layer aggregation when direct file search is not enough.
5. Inspect `## Visual Evidence`, `## Images`, and any `image_index_path` in source notes. If screenshots, diagrams, UI states, workflows, architecture, charts, or configuration images clarify the answer, include 1-3 relevant images with short captions. Avoid decorative or loosely related images.
6. When answering inside Codex Desktop, use absolute local image paths so images render, for example `![caption](E:/agent-wiki/raw/assets/source/image.png)`. In repository notes, keep relative Markdown paths.
7. If the answer reveals a missing durable concept and the user wants the vault updated, create or update the relevant wiki page.
8. Record material updates in `wiki/log.md`.

## Maintain

- Treat short user requests such as `维护知识库`, `维护本地知识库`, `maintain the knowledge base`, or `maintain this vault` as a complete local maintenance request. Do not require the user to restate the full workflow.
- A maintenance request means: run `npm run wiki:status`, review the queue with `npm run wiki:garden` when useful, process a coherent batch of `inbox`, `ima-pointer`, or weak raw notes, update or create atomic wiki pages, repair wiki-to-wiki and wiki-to-raw evidence links, update `wiki/index.md` and `wiki/log.md` when material knowledge changes, then run `npm run wiki:lint`.
- For large backlogs, work in reasonable batches. Prefer one corpus section, topic family, source folder, or high-value cluster at a time; report what was completed and what remains instead of trying to finish the whole vault in one oversized pass.
- Keep knowledge maintenance local. Do not `git add`, commit, push, or otherwise sync local raw/wiki knowledge just because the user asked to maintain the knowledge base.
- Do not refresh, build, start, or open the dashboard during maintenance unless the user explicitly asks to view or work on the graph/frontend/dashboard.
- Fix broken links and orphaned pages.
- Use `garden`, `lint`, and `repair-links` to review the maintenance queue.
- Merge duplicate concepts when one idea has multiple names.
- Split pages that mix unrelated ideas.
- Mark stale pages with `status: stale` and explain why.
- Keep `wiki/index.md` useful as the main entry point.
- Keep `processed` strict: a raw note is only processed when its primary wiki targets resolve, the wiki side links back, and follow-up flags are cleared. `ima-pointer` is not a final state; it is an unprocessed raw pointer whose original must be fetched from IMA before being promoted to `processed`.

## External Knowledge Connectors

External sources such as IMA are optional. Do not assume the connector exists, do not call connector tools speculatively, and do not store external identifiers without user consent.

Before using an external knowledge base, ask the user to confirm:

- connector name and availability,
- search scope,
- whether pointer notes may be created,
- whether external source identifiers may be written into raw or wiki pages.

If configured, keep local records lightweight: pointer notes plus extracted concepts are usually enough. Do not store full external content locally unless the user explicitly requests it and has the right to do so.

### IMA Pointer Maintenance

When the user has confirmed IMA use and credentials are configured:

1. Use `npm run wiki:sync-ima` to create lightweight pointer stubs in `raw/ima/`.
2. Treat `status: ima-pointer` as pending raw work, equivalent to `inbox` except the original lives in IMA.
3. Use `npm run wiki:fetch-ima -- raw/ima/source-note.md` or an available IMA connector/OpenAPI tool to fetch the original during maintenance.
4. Extract durable concepts into existing or new wiki pages.
5. Add `## IMA Sources` to touched wiki pages and link the pointer stub.
6. Change the pointer stub from `status: ima-pointer` to `status: processed` only after the wiki page links back.
7. Keep the full IMA original out of the repository unless the user explicitly asks and has the right to store it.

## Style

- Use Obsidian-compatible wiki links: `[[Page Name]]` or `[[Page Name|label]]`.
- Every source-backed wiki claim should link to raw evidence.
- Keep page names readable: `Topic Name.md`, not opaque IDs.
- Prefer small, durable pages over giant accumulation notes.
- Use `relation_hints` only from the supported set: `supports`, `challenges`, `related_to`, `applies_to`, `company_of`, `product_of`.
