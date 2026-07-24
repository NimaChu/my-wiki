# My Wiki Workflows

## Ingest

1. Resolve the target vault.
2. Capture the source into flat `raw/sources/` storage with complete provenance and local snapshots when practical.
3. Preserve inline image order; run `images` for image-rich sources.
4. Distill reusable concepts into atomic `wiki/` pages.
5. Link claims to raw evidence and raw notes back to their primary wiki targets.
6. Update `wiki/index.md` and `wiki/log.md` when knowledge changes materially.
7. Run `lint`. Do not open the Dashboard unless requested.

## Query

1. Read `wiki/index.md`.
2. Search `wiki/` before `raw/`.
3. Inspect linked raw evidence for grounding.
4. Include one to three useful local images when visual evidence materially improves the answer.

## Maintain

Treat short requests such as "维护知识库" or "maintain this vault" as complete instructions:

1. Run `status` and inspect `garden`.
2. Process a coherent batch of inbox or weak raw notes.
3. Create, split, merge, and link atomic wiki pages.
4. Assign each wiki page one or more human-readable names in `universes`, with the primary universe first; review universes with a minimal-universe bias.
5. Repair links and update the index/log.
6. Run `lint` and report completed and remaining work.

Do not use Git as part of routine maintenance.

## Share A Universe

Treat short requests such as "export the FlexSim universe" or "import this My Wiki universe package" as complete instructions.

1. Run `universes` and confirm the requested human-readable universe name.
2. Export with `export-universe <name>`. The single `.mywiki` package contains wiki pages, linked raw Markdown, available source URLs, raw assets, and every snapshot or binary original referenced by those raw notes. Missing referenced snapshots stop export instead of producing an incomplete package.
3. Import with `import-universe <package>` for a dry-run. Review Wiki and raw writes, deduplicated evidence, safely renamed snapshots, and conflicts.
4. Apply with `import-universe <package> --apply`. Use `--as <name>` only to rename the universe for the receiving vault.
5. Run `lint` after import. The Dashboard watcher refreshes an already-running frontend; never start it only for import or export.

Universe packages use names rather than package IDs or universe IDs. Raw notes deduplicate by `content_hash`; snapshots and assets are checksum-verified. A same-name snapshot with different content is renamed and its raw references are rewritten when safe. Otherwise it is preserved in the import conflict receipt. Existing wiki pages with the same title are preserved and recorded as conflicts for the agent to merge instead of being overwritten silently.

## Raw Storage

- Keep source notes directly in `raw/sources/`; do not add classification subdirectories.
- Keep mirrored images and `image-index.json` in `raw/assets/<source>/`; the source-level directory is required to prevent images from different articles mixing.
- Keep snapshots and binary originals directly in `raw/snapshots/`; encode source identity in the filename when needed. A raw note with no `source_url`, especially a PDF or local attachment, must retain a snapshot field pointing to its original file.
- Treat source classifications such as `collection` as optional metadata only. They must not control file paths or wiki relationships.
- Do not reorganize raw notes by current wiki topic. Topic understanding belongs in `wiki/` and can evolve without moving evidence.
- Use `organize-raw` for a dry-run report before applying legacy layout cleanup with `organize-raw --apply`.

## Dashboard

Treat requests to view the graph, frontend, or Dashboard as permission to run `open-dashboard`. Each installed Skill uses a stable local port, so independent Codex and OpenCode copies do not serve one another's stale graph. Within one installation, opening another vault switches graph generation and the watcher to that vault.

## Vault Resolution

Resolution order is:

1. `--vault <registered-name-or-path>`
2. `MY_WIKI_VAULT` and legacy vault environment variables
3. the nearest `.my-wiki.json`
4. the default in `~/.my-wiki/config.json`
5. a nearby legacy `raw/` plus `wiki/` vault as a compatibility fallback
