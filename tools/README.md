# Tools

This directory contains helper tools for the Obsidian knowledge vault.

## Dashboard

`wiki-dashboard/` is a local read-only React graph dashboard. It does not require Obsidian and does not replace the agent workflows. It helps with:

- Obsidian-like graph browsing
- vault health counts
- inbox and follow-up queue snapshots
- unresolved link and processed-gate summaries
- selected-node links, backlinks, tags, and status

Run from the vault root:

```bash
npm run dashboard
```

Or run inside the dashboard package:

```bash
cd tools/wiki-dashboard
npm run graph
npm run dev
```
