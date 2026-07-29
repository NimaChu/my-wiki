# My Wiki Frontend

Local-first knowledge workspace for My Wiki. It combines knowledge graph visualization with deterministic vault operations while keeping AI maintenance and question answering available through the user's agent.

## Commands

```bash
npm install
npm run build
```

For normal use, launch through the installed Skill so the selected vault is passed to the graph generator:

```bash
node <skill-directory>/scripts/my-wiki.mjs --vault personal open-dashboard
```

For frontend development, set `MY_WIKI_VAULT` before running `npm run graph` and `npm run dev` in this directory. The graph command scans the selected vault's `wiki/` and `raw/`, then writes the ignored `public/wiki-graph.json` runtime artifact.
Navigation, maintenance, template, README, and archive files are intentionally excluded from the graph so the visual surface focuses on knowledge nodes and source evidence.

The frontend reads that JSON and displays an Obsidian-like graph surface:

- knowledge-universe, knowledge-galaxy, and local graph browsing
- wiki-only Knowledge view by default
- Evidence drill-down for one wiki page and its directly linked raw sources
- mouse-wheel zoom on the graph surface
- search scoped to the current graph layer or universe
- grouped corpus labels for large documentation imports
- selected-node links, backlinks, tags, and status
- raw/wiki/link counts
- inbox, processed, broken-link, and universe-level counts
- webpage and local-file capture directly into Inbox
- Inbox and needs-followup inspection without starting maintenance
- local PDF/image OCR, DOCX/PPTX/XLSX conversion, folder batches, and Markdown-plus-images ZIP bundles
- knowledge-galaxy package export, download, import preview, and confirmed import
- bounded maintenance-queue batches through an authenticated local agent
- persistent Viki knowledge Q&A in a remembered, user-resizable 4:3 panel with independent Agent CLI and bundled pet selectors, validated evidence, and local images

The local service binds only to `127.0.0.1`. Browser writes require a same-origin session token, URL capture rejects local/private networks, uploads are streamed with a size limit, ZIP bundles reject unsafe paths and oversized expansion, and universe imports preserve the existing preview/checksum/conflict behavior. Web capture creates `status: inbox` evidence only. Local file and ZIP capture first persists the untouched upload in `raw/snapshots/`, then parses that durable copy into raw Markdown and assets. Failed, unsupported, empty, partial, low-confidence, snapshot-incomplete, or attachment-incomplete extraction is locked as `needs-followup` with explicit reasons. The maintenance button repeats content, extraction, snapshot, and attachment checks and sends only valid `inbox` or `stale` material to the Agent. Viki questions remain read-only, maintenance is restricted to the active vault, and only validated local image paths can be shown in the browser. Viki serves only the pet packages bundled under `pets/`; changing pets never changes the selected Agent CLI. Keep [the pet asset notice](pets/NOTICE.md) with redistributed copies.
