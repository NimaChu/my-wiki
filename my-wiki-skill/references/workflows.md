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
7. Require formula-aware MinerU or formula-risk output to pass the shared KaTeX parse and strict-warning gate before any Wiki distillation begins. Treat parse failures, array-column mismatches, unsupported math Unicode, and math/text command misuse as blocking follow-up work with page and line details. Review every flagged formula against the preserved original, then either restore a verified formula or preserve the original page as visual evidence when dense layout cannot be transcribed safely. Never turn a failed formula into a code block or plain-text quarantine merely to make the gate pass. Keep formulas that pass deterministic KaTeX checks but remain semantically suspicious in visual review.
8. Require zero U+FFFD Unicode replacement characters in the final `## Capture` body. Recheck the actual persisted body after capture, re-extraction, Agent repair, and maintenance preflight; any occurrence is deterministic encoding loss and keeps the Raw in `needs-followup` with count and page metadata.
9. A `needs-followup` Raw may enter the single-source repair Agent flow only after an explicit user action. The Agent edits only that Raw; the service owns status metadata, reruns deterministic extraction, attachment, formula, and encoding gates, and changes the Raw to `inbox` only when every blocking reason is cleared.
10. Treat a page with fewer than 24 meaningful extracted characters, measurable original-page ink and contrast, and no extracted image as missing visual evidence rather than merely “sparse text.” Record exact pages in the extraction report, frontmatter, and `followup_reasons`. Render each omitted page into the Raw-owned asset directory and update the image index before considering the gap closed. A Repair action reruns this deterministic extraction/asset stage with the selected repair CLI/model available for bounded visual reconstruction, then supplies any remaining Agent step with the structured gate context.

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
6. Write YAML frontmatter values directly without JSON- or shell-style escaped wrapper quotes. Reuse the exact existing galaxy name; `\"数学\"` is malformed and must never be treated as a distinct galaxy.
7. Run `lint` and report completed and remaining work. Treat any `malformedFrontmatterMetadata` finding as blocking: maintenance postflight returns the affected Raw to `inbox` until the metadata is corrected.

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
- Upload a local file into the visible Inbox processing queue as soon as transfer completes. Persist an active capture receipt under `.my-wiki/capture-jobs/`, continue extraction in the background, persist the untouched original in `raw/snapshots/`, then parse that durable copy and create its corresponding raw note. After a Dashboard restart, resume valid receipts from the retained upload and reuse an already-preserved snapshot. Processing queue entries must not be treated as maintainable raw notes. Convert text PDFs, scanned PDFs, images, DOCX, PPTX, XLSX, and plain-text formats into structured `## Capture` Markdown with extraction metadata.
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

Every local PDF, image, Office document, ZIP, or other file source uses the same My Wiki evidence standard. Preserve the original snapshot before extraction. Normalize extractor output to `my-wiki.document-ir/v1`, persist the compressed IR plus `my-wiki.extraction-report/v1` under `.my-wiki/extractions/`, and treat the report rather than an extractor's own success claim as authoritative. `extraction_status: complete` plus substantive captured text, an existing snapshot, resolvable attachments, and a passing report enters `inbox`; all other output enters `needs-followup`. MinerU is the primary Chinese technical PDF parser. Docling supplies structure and provenance for Office/OpenDocument/EPUB and is attempted for PDF only when MinerU is unavailable. For central-gate risk pages, My Wiki may render page images and attach them to the existing OpenCode or Codex CLI; preserve provider/model/page provenance and accept a page only when it passes the deterministic differential gate. PDF.js/Tesseract remain degraded fallbacks and must never hide an engine that actually ran and failed. The maintenance preflight repeats content, extraction, snapshot, attachment, formula, and encoding checks. PDF pages are scored for sparse text, mojibake, symbol noise, fragmented layout, OCR confidence, formula risk, blank noise, show-through, and templated repetition. Preserve substantive visual candidates, keep every page anchor, materialize page-local images, and restore indexed assets after re-extraction. Large MinerU and OCR jobs remain batched and resumable. Retry an existing Raw with `reextract` instead of capturing a duplicate.

## Vault Resolution

Resolution order is:

1. `--vault <registered-name-or-path>`
2. `MY_WIKI_VAULT` and legacy vault environment variables
3. the nearest `.my-wiki.json`
4. the default in `~/.my-wiki/config.json`
5. a nearby legacy `raw/` plus `wiki/` vault as a compatibility fallback
