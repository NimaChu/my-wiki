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

### Scanned Mathematical And Technical PDFs

Before distilling or marking a scanned mathematical or technical PDF as processed:

1. Confirm that page anchors cover the complete declared page range, without missing or duplicate pages.
2. Visually inspect every `extraction_low_quality_pages`, `extraction_suppressed_hallucination_pages`, and `extraction_visual_review_pages` entry, plus chapter openers, the first and last pages, every detected diagram page, and a representative sample of `extraction_formula_risk_pages`.
3. Treat automatic blank/show-through signals as review candidates whenever the page contains substantive text. Use `MY_WIKI_PDF_BLANK_PAGES` only for pages confirmed against the high-resolution source during that one capture or re-extraction.
4. Verify every key formula used in a Wiki page against the preserved PDF. Do not promote damaged exercise formulas, numerical answers, subscripts, inequality signs, inverse markers, or Greek symbols into durable claims without visual corroboration.
5. When OCR cannot retain the nodes and edges of a content map, flowchart, relationship diagram, mind map, or organization chart, preserve the figure as a page-local image asset, insert it beneath the matching `### Page N`, and record it in `image-index.json`.
6. After re-extraction, confirm that current quality warnings replaced prior-engine warnings and that indexed page assets were restored. Run `lint` and require zero raw attachment issues before evidence closure.
7. Require formula-aware MinerU or formula-risk output to pass the shared KaTeX parse and strict-warning gate. Treat parse failures, array-column mismatches, unsupported math Unicode, and math/text command misuse as blocking follow-up work with page and line details. Keep formulas that pass deterministic KaTeX checks but remain semantically suspicious in visual review.
8. A `needs-followup` Raw may enter the single-source repair Agent flow only after an explicit user action. The Agent edits only that Raw; the service owns status metadata, reruns deterministic extraction, attachment, and formula gates, and changes the Raw to `inbox` only when every blocking reason is cleared.

## Query

Treat ordinary questions about concepts, people, products, methods, events, companies, or named projects as vault queries unless the user explicitly asks about My Wiki's implementation. Do not inspect the application source tree as a proxy for the vault.

1. Resolve the selected vault, then read `wiki/index.md` for its current knowledge map.
2. Search the user's exact wording. When wording may cross Chinese and English, abbreviations, aliases, or translations, search the likely variants as well.
3. Search and read `wiki/` before `raw/`. Prefer the highest-ranking relevant atomic Wiki page and follow useful Wiki links.
4. Inspect linked `raw/sources/` evidence when a claim needs verification, provenance, recency, or more detail.
5. Answer from the vault and separate supported knowledge from clearly labeled general background. Say that the vault has no relevant knowledge only after searching; then ask for context or offer a general answer.
6. Include one to three useful local images when visual evidence materially improves the answer.

Never substitute model memory for an existing vault page. For example, a question such as `Loop 工程是什么` should retrieve the `Loop Engineering` Wiki page and its evidence rather than infer from the term or search the My Wiki repository.

## Maintain

Treat short requests such as "维护知识库" or "maintain this vault" as complete instructions:

1. Run `status` and inspect `garden`.
2. Process a coherent batch of inbox or weak raw notes.
3. Create, split, merge, and link atomic wiki pages.
4. Assign each Wiki planet one or more broad, durable galaxy names in `universes`, with the primary galaxy first. Prefer stable top-level domains over courses, projects, source collections, book series, or narrow subtopics; reuse and merge existing galaxies whenever their meaning fits, keeping the total galaxy count low.
5. Repair links and update the index/log.
6. Run `lint` and report completed and remaining work.

Apply one entity-extraction principle to every Raw regardless of whether it came from a webpage, article, note, slide deck, transcript, book, or another format. Create or update an atomic Wiki when a concept, person, organization, product, method, process, API, model, theorem, comparison, or other durable claim remains useful for independent retrieval, linking, or reuse outside its source. Prefer an existing Wiki over a duplicate, combine fragments that are too narrow to stand alone, and split unrelated knowledge units. A source-summary or collection page may be useful as an index, but it does not replace the durable atomic knowledge represented by the source or coherent batch. Link the resulting pages to one another and back to exact Raw evidence; do not mark a Raw `processed` when only a source or collection overview was created despite reusable knowledge remaining in its evidence.

Connectivity health counts unique Wiki-to-Wiki topic peers. Raw evidence, index/log/README pages, and other excluded utility pages do not prevent a Wiki page from being reported as orphaned or weakly connected.

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
- Treat `suggested_universe` as an optional user preference for maintenance. Reuse it when it fits the evidence, but do not let a misleading suggestion override accurate broad classification; an empty value leaves galaxy assignment entirely to the Agent.
- Do not reorganize raw notes by current wiki topic. Topic understanding belongs in `wiki/` and can evolve without moving evidence.
- Use `organize-raw` for a dry-run report before applying legacy layout cleanup with `organize-raw --apply`.

## Dashboard

Treat requests to view the graph, frontend, or Dashboard as permission to run `open-dashboard`. Each registered My Wiki project uses a stable local port, so separate project installations do not serve one another's stale graph. Within one installation, opening another vault switches graph generation and the watcher to that vault.

The local Dashboard can perform deterministic vault operations without calling an agent:

- Add a public HTTP/HTTPS URL to `raw/sources/` as `status: inbox`, with a local snapshot and mirrored inline images when available.
- Upload a local file into the visible Inbox processing queue as soon as transfer completes. Continue extraction in the background, persist the untouched original in `raw/snapshots/`, then parse that durable copy and create its corresponding raw note. Processing queue entries must not be treated as maintainable raw notes. Convert text PDFs, scanned PDFs, images, DOCX, PPTX, XLSX, and plain-text formats into structured `## Capture` Markdown with extraction metadata.
- Upload a folder as a batch of independent documents. Preserve each browser-relative path as provenance while keeping raw storage flat.
- Upload a ZIP bundle containing one or more Markdown files and their relative images. Create one raw note per Markdown file, preserve literal Markdown/HTML references while resolving decoded archive paths, rewrite every occurrence into that raw note's asset directory with portable URL encoding, preserve the ZIP snapshot, reject unsafe archive paths, and enforce entry and expanded-size limits.
- List inbox, follow-up, and stale raw notes.
- Declare an empty initial knowledge galaxy without creating a placeholder Wiki page. Store the declaration as local vault runtime metadata until maintained Wiki pages adopt it.
- Optionally select an existing galaxy while capturing a source, or create one from the capture dialog. Preserve the choice as `suggested_universe`; leaving it blank must not block capture.
- Export a named knowledge galaxy and download its `.mywiki` package.
- Upload a `.mywiki` package, review the dry-run summary, and explicitly confirm the import.

It also exposes two explicit local-Agent actions:

- Process one bounded maintenance-queue batch, then refresh graph data after the agent completes the normal maintenance and lint workflow.
- Ask Viki a read-only knowledge question grounded first in Wiki pages and then raw evidence, with validated local evidence paths and useful images.

Web capture stops at inbox. Do not treat it as permission to distill, maintain, or mark the source processed. Agent work starts only from the batch button or a submitted Viki question. The local service must remain bound to `127.0.0.1`; do not weaken its session token, same-origin checks, upload limits, private-network URL protection, import conflict safeguards, Agent sandboxing, separate query/maintenance task locks, timeouts, structured output, or vault-path validation.

Every local PDF, image, Office document, ZIP, or other file source uses the same evidence gate. Preserve the original snapshot before extraction. `extraction_status: complete` plus substantive captured text, an existing snapshot, and resolvable local attachments enters `inbox`; failed, partial, skipped, unsupported, empty, low-confidence, low-page-quality, or attachment-incomplete output enters `needs-followup` with explicit `followup_reasons`. The maintenance button repeats the deterministic content, extraction, snapshot, and attachment preflight before invoking an Agent; only valid `inbox` material and previously valid `stale` material may be selected. PDF pages are scored for sparse text, mojibake, symbol noise, fragmented layout, OCR confidence, and formula-layout risk. MinerU scans additionally receive a low-resolution visual preflight that compares ink coverage, contrast, and horizontally mirrored neighboring pages; the output gate combines those signals with OCR text density, compression, and templated repetition. Automatic blank/show-through candidates with substantive text remain preserved and are listed in `extraction_visual_review_pages`; only explicit human-confirmed pages or candidates corroborated by sparse/repetitive text are suppressed, without removing page anchors. Record suppressed, blank, show-through, and visual-review page numbers in extraction metadata and keep the original PDF as the authoritative visual reference. MinerU image blocks are materialized under the source asset directory; sparse relationship-diagram pages without a usable image block are rendered as page-local PNG fallbacks, indexed, and restored after later re-extraction. Chinese cleanup joins OCR-inserted spaces only between CJK characters and adjacent CJK punctuation. Text PDFs use local page extraction, scanned PDFs and images use local OCR, DOCX preserves headings/tables/images, PPTX preserves slide sections and media, and XLSX preserves worksheets as Markdown tables. OCR needs no API key; the first OCR run downloads the configured Tesseract language data (`eng+chi_sim` by default) and caches it under `.my-wiki/ocr-cache/`. Large scanned PDFs run in bounded worker batches with per-page checkpoints, so interrupted extraction resumes without repeating completed pages. The default limit is 1000 pages (`MY_WIKI_OCR_MAX_PDF_PAGES=0` disables it), and `MY_WIKI_OCR_PDF_BATCH_PAGES` controls batch size. When the optional MinerU command is installed, automatic PDF extraction uses its local layout, formula, and table parser for degraded or scanned documents, with the lightweight parser retained as a cross-platform fallback. Set `MY_WIKI_PDF_BLANK_PAGES` only for one capture or re-extraction when a human has confirmed explicit blank/show-through pages. Retry an existing Raw with `reextract` instead of capturing a duplicate. Legacy DOC/PPT/XLS files remain follow-up work until converted to DOCX/PPTX/XLSX.

## Vault Resolution

Resolution order is:

1. `--vault <registered-name-or-path>`
2. `MY_WIKI_VAULT` and legacy vault environment variables
3. the nearest `.my-wiki.json`
4. the default in `~/.my-wiki/config.json`
5. a nearby legacy `raw/` plus `wiki/` vault as a compatibility fallback
