# My Wiki Workflows

## Ingest

1. Resolve the target vault.
2. Capture the source into flat `raw/sources/` storage with complete provenance and local snapshots when practical.
   For local files, use the bundled parser through `capture --file` or `capture --directory`; do not ask the host agent to improvise a binary conversion when the deterministic extractor supports the format.
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
4. Assign each Wiki planet one or more human-readable galaxy names in `universes`, with the primary galaxy first; review galaxies with a minimal-galaxy bias.
5. Repair links and update the index/log.
6. Run `lint` and report completed and remaining work.

Do not use Git as part of routine maintenance.

## Share A Galaxy

Treat short requests such as "export the FlexSim galaxy" or "import this My Wiki galaxy package" as complete instructions. Keep the existing `export-universe` and `import-universe` command names for compatibility.

1. Run `universes` and confirm the requested human-readable galaxy name.
2. Export with `export-universe <name>`. The single `.mywiki` package contains that galaxy's Wiki pages, linked raw Markdown, available source URLs, raw assets, and every snapshot or binary original referenced by those raw notes. Missing referenced snapshots stop export instead of producing an incomplete package.
3. Import with `import-universe <package>` for a dry-run. Review Wiki and raw writes, deduplicated evidence, safely renamed snapshots, and conflicts.
4. Apply with `import-universe <package> --apply`. Use `--as <name>` only to rename the galaxy for the receiving vault.
5. Run `lint` after import. The Dashboard watcher refreshes an already-running frontend; never start it only for import or export.

Galaxy packages use names rather than package IDs or galaxy IDs. The package schema retains its historical universe terminology for compatibility. Raw notes deduplicate by `content_hash`; snapshots and assets are checksum-verified. A same-name snapshot with different content is renamed and its raw references are rewritten when safe. Otherwise it is preserved in the import conflict receipt. Existing Wiki pages with the same title are preserved and recorded as conflicts for the agent to merge instead of being overwritten silently.

## Raw Storage

- Keep source notes directly in `raw/sources/`; do not add classification subdirectories.
- Keep mirrored images and `image-index.json` in `raw/assets/<source>/`; the source-level directory is required to prevent images from different articles mixing.
- Keep snapshots and binary originals directly in `raw/snapshots/`; encode source identity in the filename when needed. A raw note with no `source_url`, especially a PDF or local attachment, must retain a snapshot field pointing to its original file.
- Treat source classifications such as `collection` as optional metadata only. They must not control file paths or wiki relationships.
- Do not reorganize raw notes by current wiki topic. Topic understanding belongs in `wiki/` and can evolve without moving evidence.
- Use `organize-raw` for a dry-run report before applying legacy layout cleanup with `organize-raw --apply`.

## Dashboard

Treat requests to view the graph, frontend, or Dashboard as permission to run `open-dashboard`. Each installed Skill uses a stable local port, so independent Codex and OpenCode copies do not serve one another's stale graph. Within one installation, opening another vault switches graph generation and the watcher to that vault.

The local Dashboard can perform deterministic vault operations without calling an agent:

- Add a public HTTP/HTTPS URL to `raw/sources/` as `status: inbox`, with a local snapshot and mirrored inline images when available.
- Upload a local file into `raw/snapshots/` and create its corresponding raw note. Convert text PDFs, scanned PDFs, images, DOCX, PPTX, XLSX, and plain-text formats into structured `## Capture` Markdown with extraction metadata.
- Upload a folder as a batch of independent documents. Preserve each browser-relative path as provenance while keeping raw storage flat.
- Upload a ZIP bundle containing one or more Markdown files and their relative images. Create one raw note per Markdown file, rewrite image references into that raw note's asset directory, preserve the ZIP snapshot, reject unsafe archive paths, and enforce entry and expanded-size limits.
- List inbox, follow-up, and stale raw notes.
- Export a named knowledge galaxy and download its `.mywiki` package.
- Upload a `.mywiki` package, review the dry-run summary, and explicitly confirm the import.

It also exposes two explicit local-Agent actions:

- Process one bounded maintenance-queue batch, then refresh graph data after the agent completes the normal maintenance and lint workflow.
- Ask Viki a read-only knowledge question grounded first in Wiki pages and then raw evidence, with validated local evidence paths and useful images.

Web capture stops at inbox. Do not treat it as permission to distill, maintain, or mark the source processed. Agent work starts only from the batch button or a submitted Viki question. The local service must remain bound to `127.0.0.1`; do not weaken its session token, same-origin checks, upload limits, private-network URL protection, import conflict safeguards, Agent sandboxing, separate query/maintenance task locks, timeouts, structured output, or vault-path validation.

Every local PDF, image, Office document, or other binary source uses the same evidence gate. `extraction_status: complete` plus substantive captured text enters `inbox`; failed, partial, skipped, unsupported, empty, or low-confidence output enters `needs-followup` and is excluded from maintenance batches. Text PDFs use local page extraction, scanned PDFs and images use local OCR, DOCX preserves headings/tables/images, PPTX preserves slide sections and media, and XLSX preserves worksheets as Markdown tables. OCR needs no API key; the first OCR run downloads the configured Tesseract language data (`eng+chi_sim` by default) and caches it under `.my-wiki/ocr-cache/`. Legacy DOC/PPT/XLS files remain follow-up work until converted to DOCX/PPTX/XLSX.

## Vault Resolution

Resolution order is:

1. `--vault <registered-name-or-path>`
2. `MY_WIKI_VAULT` and legacy vault environment variables
3. the nearest `.my-wiki.json`
4. the default in `~/.my-wiki/config.json`
5. a nearby legacy `raw/` plus `wiki/` vault as a compatibility fallback
