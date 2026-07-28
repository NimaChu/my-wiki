---
name: my-wiki
description: Manage local Markdown-first My Wiki knowledge vaults with an AI agent. Use for capturing webpages, PDFs, notes, and images; maintaining raw-to-wiki evidence links; searching or answering from a vault; checking or repairing vault health; switching among local vaults; and opening the My Wiki knowledge graph or dashboard.
---

# My Wiki

Use the bundled `scripts/my-wiki.mjs` entry point. Resolve it relative to this `SKILL.md`; do not assume the user's current directory contains the My Wiki source repository. Do not call files outside this Skill for core My Wiki operations.

## Select The Vault

Honor an explicit user path or registered vault name with `--vault <name-or-path>`. Otherwise run `where` and use the configured default:

```bash
node <skill-directory>/scripts/my-wiki.mjs where
```

Never store knowledge inside the installed skill. A vault owns its `raw/`, `wiki/`, `templates/`, and `.my-wiki/` directories.

## Core Commands

```bash
node <skill-directory>/scripts/my-wiki.mjs init /path/to/vault --name personal --use
node <skill-directory>/scripts/my-wiki.mjs --vault personal status
node <skill-directory>/scripts/my-wiki.mjs --vault personal search "query"
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --title "Title" --url "https://example.com"
node <skill-directory>/scripts/my-wiki.mjs --vault personal images --source raw/sources/source.md
node <skill-directory>/scripts/my-wiki.mjs --vault personal organize-raw
node <skill-directory>/scripts/my-wiki.mjs --vault personal lint
node <skill-directory>/scripts/my-wiki.mjs --vault personal garden
node <skill-directory>/scripts/my-wiki.mjs --vault personal universes
node <skill-directory>/scripts/my-wiki.mjs --vault personal export-universe "FlexSim"
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki --apply
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki --as "Simulation" --apply
node <skill-directory>/scripts/my-wiki.mjs --vault personal repair-links
node <skill-directory>/scripts/my-wiki.mjs --vault personal dashboard
node <skill-directory>/scripts/my-wiki.mjs --vault personal open-dashboard
```

`dashboard` starts the service silently in the background. `open-dashboard` also opens the selected installation's frontend in the browser.

The Dashboard is a local knowledge workspace, not only a graph viewer. It may add a webpage URL or uploaded file directly to `status: inbox`, list pending raw notes, export a named universe, and preview then apply a `.mywiki` import. Text-based PDFs are extracted locally into page-marked Markdown while the original PDF remains in `raw/snapshots/`; PDFs without searchable text must stay `needs-followup` until OCR is available. Capture remains deterministic and never starts maintenance automatically. Explicit browser actions may ask Viki a read-only vault question or send one bounded maintenance-queue batch to an authenticated local agent.

Read [workflows.md](references/workflows.md) when ingesting, querying, maintaining, sharing, or visualizing a vault.
Read [dashboard-agent.md](references/dashboard-agent.md) when changing Dashboard Agent invocation, Viki, maintenance batches, permissions, or provider support.

## Knowledge Galaxies

The Dashboard presents the whole vault graph as one knowledge universe, each human-named group as a knowledge galaxy, and each Wiki page as a Wiki planet. Keep galaxy names in each wiki page's existing `universes` list. The first name is primary; additional names let one Wiki planet connect multiple galaxies. Do not create package IDs or galaxy IDs.

For backward compatibility, storage, CLI, and package schemas retain the `universes`, `export-universe`, and `import-universe` names. `export-universe` creates one `.mywiki` file containing that galaxy's Wiki pages, linked raw Markdown, available source URLs, related assets, and every snapshot or binary original referenced by those raw notes. `import-universe` previews by default; inspect writes, deduplication, renames, and conflicts, then rerun with `--apply`. Use `--as` only when the recipient wants a different galaxy name. Never start the Dashboard only for sharing.

## Vault Structure

```text
<vault>/
  raw/sources/<source>.md
  raw/assets/<source>/...
  raw/snapshots/<snapshot>.*
  wiki/<atomic-page>.md
  templates/...
  .my-wiki/...
```

- Keep source notes flat in `raw/sources/`. They preserve readable captured evidence, provenance, and links to durable wiki pages.
- Keep one source-level directory in `raw/assets/` for images and `image-index.json`; never mix images from different sources.
- Keep snapshots flat in `raw/snapshots/`. Store webpage captures, PDFs, attachments, and other original files here. `source_url` may be empty for local material, but a local or binary source must retain `snapshot_path` or another snapshot field.
- Keep `wiki/` pages atomic, synthesized, linked, and evidence-backed. Assign one or more human-readable `universes`; do not organize raw storage by evolving wiki topics.
- Treat `collection` and source classification as optional provenance metadata only. They never control paths, universes, or wiki relationships.
- Keep `.my-wiki/` for local runtime state, exports, import receipts, backups, and conflicts. Do not treat it as knowledge content.
- Run `organize-raw` before `organize-raw --apply`; keep source, snapshot, asset, Wiki, and image-index links synchronized.

Read [ima-local-import.md](references/ima-local-import.md) only when the user explicitly asks to use or migrate IMA knowledge. Read [firecrawl-mcp.md](references/firecrawl-mcp.md) when Firecrawl capture is requested or ordinary webpage capture fails.

## Safety

- Keep raw captures factual and preserve source metadata.
- Keep wiki pages atomic, synthesized, linked, and evidence-backed.
- Treat `processed` as an evidence-closure state, not a progress label.
- Keep vault data local. Do not commit or push it unless the user explicitly requests that exact action.
- Do not start the Dashboard during ordinary ingest or maintenance. Open it only for graph/frontend requests.
- Keep the local web service bound to `127.0.0.1`. Preserve its same-origin session token, upload limits, URL private-network checks, import preview, checksum validation, and no-overwrite behavior.
