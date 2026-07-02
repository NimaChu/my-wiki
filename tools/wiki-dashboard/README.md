# Knowledge Graph Dashboard

Local read-only graph dashboard for the Markdown vault. It is Obsidian-compatible but does not require Obsidian to be installed.

## Commands

```bash
npm install
npm run graph
npm run dev
npm run build
```

`npm run graph` scans Markdown files in `raw/`, `wiki/`, `templates/`, and `_archive/`, then writes `public/wiki-graph.json`.

The dashboard reads that JSON and displays an Obsidian-like graph surface:

- force-directed wiki/raw graph
- search and section/type/status filters
- selected-node links, backlinks, tags, and status
- raw/wiki/link counts
- inbox, follow-up, stale, broken-link, and processed-gate counts

The dashboard does not write to the vault.
