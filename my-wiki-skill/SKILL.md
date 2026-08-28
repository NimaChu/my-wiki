---
name: my-wiki
description: Manage local OKF-compatible Markdown My Wiki vaults with an AI agent. Use for capturing webpages, PDFs, Office documents, notes, images, folders, and ZIP bundles as References; maintaining Reference-to-Concept evidence links; searching or answering from a vault; checking or repairing vault health; switching among local vaults; and opening the My Wiki knowledge graph or dashboard.
---

# My Wiki

This Skill is a thin Agent adapter, not the My Wiki application. Use its bundled `scripts/my-wiki.mjs` bridge, which locates and invokes a separately installed My Wiki project. Never expect application code, Dashboard assets, or a knowledge vault to live inside the installed Skill.

Use native OKF terminology in user-facing explanations and new knowledge: **Concept** means a durable synthesized page under `concepts/`, **Reference** means captured evidence under `references/sources/`, and **original** means its preserved snapshot or binary under `references/originals/`. My Wiki displays Concepts as concept planets. Legacy command names and internal fields such as `organize-raw`, `rawSources`, `wikiPages`, `export-universe`, and `workflow_status` remain compatibility APIs; they do not restore the old `raw/` or `wiki/` layout.

Before the first operation, run the bridge with `where`. If it reports that the My Wiki project is missing, explain that both components are required and ask the user before cloning or registering the project. The normal setup is:

```bash
git clone https://github.com/NimaChu/my-wiki.git
cd my-wiki
npm run setup
```

An existing checkout can instead be selected with `MY_WIKI_HOME=/path/to/my-wiki`. Do not silently install, update, or relocate the project.

After the user confirms the project location, the Agent may perform the clone and `npm run setup` on the user's behalf. Then ask where the local vault should live and run `init` for them. A separately installed Skill must therefore be able to guide and complete both missing layers, but only with explicit user confirmation; the Skill package itself remains a small adapter and never embeds either layer.

## Bootstrap Missing Layers

Use this flow only when the bridge reports a missing layer; do not repeat it during normal operations:

1. **Missing project:** Explain that the Skill is an adapter and ask where the user wants the standalone project installed. After confirmation, clone `https://github.com/NimaChu/my-wiki.git` into that location and run `npm run setup` from the cloned repository. Do not overwrite an existing directory or silently choose a different location.
2. **Existing project:** If the user already has a checkout, register it by running `npm run setup` there or set `MY_WIKI_HOME` when they explicitly prefer an environment-only configuration. Never clone a duplicate project merely because it is not registered.
3. **Missing vault:** Rerun `where`. If no vault is configured, ask where local knowledge should live, then run the bridge's `init <path> --name <name> --use`. Keep the vault outside both the project and installed Skill.
4. **Verify:** Run `where` and `status` through the bridge. Continue with the user's original request only after both resolve successfully.

Cloning, registration, and vault creation require user confirmation because they write outside the Skill directory. Reading an existing registration and using an existing vault do not require repeated confirmation.

## Select The Vault

Honor an explicit user path or registered vault name with `--vault <name-or-path>`. Otherwise run `where` and use the configured default:

```bash
node <skill-directory>/scripts/my-wiki.mjs where
```

If no vault is configured, ask the user where to create one, then use `init`. Never create a vault inside the installed Skill or the My Wiki project. A separate vault owns root `index.md`/`log.md`, `concepts/`, `references/`, `templates/`, and `.my-wiki/`.

## Core Commands

```bash
node <skill-directory>/scripts/my-wiki.mjs init /path/to/vault --name personal --use
node <skill-directory>/scripts/my-wiki.mjs --vault personal status
node <skill-directory>/scripts/my-wiki.mjs --vault personal search "query"
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --title "Title" --url "https://example.com"
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --file /path/to/document.pdf
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --directory /path/to/documents
node <skill-directory>/scripts/my-wiki.mjs --vault personal reextract --source references/sources/source-note.md
node <skill-directory>/scripts/my-wiki.mjs --vault personal reextract --all-followup
node <skill-directory>/scripts/my-wiki.mjs --vault personal images --source references/sources/source.md
node <skill-directory>/scripts/my-wiki.mjs --vault personal organize-raw
node <skill-directory>/scripts/my-wiki.mjs --vault personal lint
node <skill-directory>/scripts/my-wiki.mjs --vault personal garden
node <skill-directory>/scripts/my-wiki.mjs --vault personal universes
node <skill-directory>/scripts/my-wiki.mjs --vault personal export-universe "FlexSim"
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki --apply
node <skill-directory>/scripts/my-wiki.mjs --vault personal import-universe /path/to/flexsim.mywiki --as "Simulation" --apply
node <skill-directory>/scripts/my-wiki.mjs --vault personal repair-links
node <skill-directory>/scripts/my-wiki.mjs --vault personal okf-audit
node <skill-directory>/scripts/my-wiki.mjs --vault personal export-okf --galaxy "AI"
node <skill-directory>/scripts/my-wiki.mjs --vault personal dashboard
node <skill-directory>/scripts/my-wiki.mjs --vault personal open-dashboard
```

`dashboard` starts the service silently in the background. `open-dashboard` also opens the selected installation's frontend in the browser.

The Dashboard is a local knowledge workspace, not only a graph viewer. It may add a webpage, file, folder batch, or Markdown-plus-images ZIP bundle, declare an empty initial knowledge galaxy, optionally suggest a galaxy during capture, list pending References, manage galaxy names and visibility, export a named galaxy, and preview then apply a `.mywiki` import. Galaxy deletion is a recoverable recycle operation: export the complete galaxy to `.my-wiki/trash/galaxies/` first, then remove its exclusive Concepts and evidence no longer used by any retained Concept. Shared Concepts stay active with only the deleted membership removed; shared References, assets, and originals stay in place. Clean retained links to removed Concepts and never invent an `Uncategorized` galaxy. The Dashboard recycle bin can restore an entry through the audited `.mywiki` importer or permanently delete it after exact-name confirmation. In the Evidence layer, double-clicking a Concept or Reference node opens its Markdown in the built-in reader/editor; local images are resolved through the authenticated vault image service, frontmatter remains protected, and version-checked saves reject concurrent overwrites. File capture enters the visible processing queue as soon as upload completes, then persists the untouched original in `references/originals/` before parsing it. The queue shows waiting, extracting, and failed states even before a snapshot path exists; active capture receipts under `.my-wiki/capture-jobs/` let a Dashboard restart resume the retained upload and reuse the preserved original. Local extraction converts text PDFs, scanned PDFs, images, DOCX, PPTX, XLSX, and ZIP Markdown into structured Reference Markdown and assets. OCR runs locally without an API key; its free language data is downloaded once and cached in the vault. Substantive captures with a valid original and resolvable local attachments become `inbox`; failures record `followup_reasons` and become `needs-followup`. Maintenance is one per-Reference lifecycle: extraction is automatic, `inbox` or `stale` items can be distilled, and `needs-followup` items can be repaired. Batch maintenance shows repair and distillation counts for confirmation, then dispatches each selected Reference independently and chooses its action from the current state. Background local extraction has its own two task slots; Agent repair and distillation share a separate two-slot lane. Additional work remains visibly queued, and the same Reference cannot run twice concurrently. A repair may still perform deterministic re-extraction before its Agent phase when evidence gates require it. Capture remains deterministic and never starts repair or distillation automatically. Explicit browser actions may ask Viki a read-only vault question or dispatch maintenance to an authenticated local agent. Supported local CLIs include OpenCode, Qoder CN, Qoder, Codex, and Claude; the `qoder` provider prefers `qoderclicn`, and Qoder is exposed only after local login or PAT configuration with a restricted non-interactive tool set. Viki keeps browser-local multi-conversation history, sends only the latest eight eligible messages as explicit context, can pause the browser's matching active job, and applies CLI changes to the next question without interrupting the current answer. Viki questions have a short idle timeout; maintenance and repair use a bounded total timeout without an idle timeout so long document reads are not mistaken for stalled work. Viki opens in a 4:3 panel whose user-adjusted size is remembered; pet choice and Agent CLI choice are separate persisted preferences. Preserve the bundled pet attribution and license notices.

Read [workflows.md](references/workflows.md) when ingesting, querying, maintaining, sharing, or visualizing a vault.
Read [dashboard-agent.md](references/dashboard-agent.md) when changing Dashboard Agent invocation, Viki, maintenance batches, permissions, or provider support.

## Knowledge Galaxies

The Dashboard presents the whole vault graph as one knowledge universe, each human-named group as a knowledge galaxy, and each Concept as a concept planet. Keep galaxy names in each Concept's existing `universes` list. Prefer broad, durable domains such as `数学`, `AI`, or `FlexSim` over temporary collections, individual courses, projects, book series, or narrow subtopics. Reuse or merge into an existing broad galaxy whenever its meaning fits; create a new galaxy only for a durable top-level boundary. The first name is primary; additional names let one concept planet connect multiple galaxies. Do not create package IDs or galaxy IDs. Copy an existing galaxy name exactly. Write YAML string wrappers directly: a literal backslash-escaped value such as `\"数学\"`, or a value containing decorative wrappers such as `“AI”`, is malformed metadata rather than another spelling of the same galaxy.

For backward compatibility, CLI and package schemas retain the `universes`, `export-universe`, and `import-universe` names. `export-universe` creates one `.mywiki` file containing that galaxy's Concepts, linked References, available source URLs, related assets, and every referenced original. `import-universe` previews by default; inspect writes, deduplication, renames, and conflicts, then rerun with `--apply`. Use `--as` only when the recipient wants a different galaxy name. Never start the Dashboard only for sharing.

## Vault Structure

```text
<vault>/
  index.md
  log.md
  references/sources/<source>.md
  references/assets/<source>/...
  references/originals/<snapshot>.*
  concepts/<atomic-page>.md
  templates/...
  .my-wiki/...
```

- Keep References flat in `references/sources/`. They preserve readable captured evidence, provenance, and links to durable Concepts.
- Write every source note as an OKF `Reference` with `status: stable` unless its knowledge lifecycle truly changes. Store My Wiki queue state independently in `workflow_status: inbox | needs-followup | processed | stale`; never write workflow values into OKF `status`.
- Keep one source-level directory in `references/assets/` for images and `image-index.json`; never mix images from different sources.
- Keep snapshots flat in `references/originals/`. Store webpage captures, PDFs, attachments, and other original files here. `source_url` may be empty for local material, but a local or binary source must retain `snapshot_path` or another snapshot field.
- Keep `concepts/` pages atomic, synthesized, linked, and evidence-backed. Assign one or more broad, durable human-readable `universes`; do not turn source collections or narrow topics into galaxies, and do not organize Reference storage by evolving Concept topics.
- Write every Wiki concept as OKF v0.2-compatible UTF-8 Markdown with parseable YAML frontmatter. Require non-empty `type`; normally include `title`, one-sentence `description`, `status: stable`, tags, structured `sources` entries, and truthful `generated` metadata. Each `sources` item must be a mapping with a concrete `resource`; give it a stable `id` when body footnotes cite it. Use standard Markdown links rather than creating new Obsidian Wikilinks, and use source-ID footnotes for claim attribution. Keep My Wiki fields such as `universes`, `aliases`, `reviewed_at`, `source_count`, and `relation_hints` as allowed extension keys. Never infer `verified` from evidence closure or `reviewed_at`; record verification only when a named actor actually performed it. Treat `index.md` and `log.md` as OKF reserved files.
- Apply the same entity-extraction principle to every source format, including webpages, articles, notes, slide decks, transcripts, and books. Distill concepts, people, organizations, products, methods, processes, APIs, models, theorems, comparisons, and other durable claims when they remain useful for independent retrieval, linking, or reuse outside the source. Prefer updating an existing page over creating a duplicate; combine fragments that are too narrow to stand alone and split unrelated knowledge units. A source-summary or collection page may be kept as an index, but it does not replace the durable atomic knowledge represented by the source or by a coherent maintenance batch.
- Treat `collection` and source classification as optional provenance metadata only. They never control paths, universes, or wiki relationships.
- Keep `.my-wiki/` for local runtime state, exports, import receipts, backups, and conflicts. Do not treat it as knowledge content.
- `organize-raw` now validates and normalizes the Reference layout; preview before `--apply` and keep source, original, asset, Concept, and image-index links synchronized.

Read [ima-local-import.md](references/ima-local-import.md) only when the user explicitly asks to use or migrate IMA knowledge. Read [firecrawl-mcp.md](references/firecrawl-mcp.md) when Firecrawl capture is requested or ordinary webpage capture fails.

## Safety

- Keep References factual and preserve source metadata.
- Keep Concepts atomic, synthesized, linked, and evidence-backed.
- Treat `processed` as an evidence-closure state, not a progress label.
- Require `extraction_status: complete`, substantive `## Capture` content, and a passing My Wiki evidence report before maintaining any local PDF, image, Office document, or other binary source. New extractions store `extraction_report` and compressed `extraction_document_ir` under `.my-wiki/extractions/`; the report combines engine attempts, page coverage, quality, formula, encoding, attachment, and visual-evidence gates. Keep every other extraction state locked as `needs-followup`. MinerU is the primary Chinese technical PDF parser, and Docling supplies structured document blocks and provenance or an unavailable-engine fallback. When the original PDF page has measurable ink and contrast but MinerU returns almost no content and no image asset, record the exact page in `extraction_missing_visual_pages` and the follow-up reason `missing-visual-evidence:pages=...`. The extraction service must render that page into the Raw's owned asset directory, insert it beneath the matching page anchor, update `image-index.json`, and record it in `extraction_rendered_visual_pages`; unresolved pages remain blocking. Repair re-extracts the preserved original first and passes the complete structured gate context to the selected CLI/model. Binary page assets remain service-owned instead of granting the Agent arbitrary vault writes. My Wiki may render only pages selected by the central risk gate and send those images to an existing OpenCode or Codex multimodal model; an Agent-repaired page replaces primary evidence only after the deterministic differential gate accepts it. PDF extraction records page-quality and formula-layout risk summaries; MinerU scans also use low-resolution ink, contrast, and mirrored-neighbor analysis plus text-density and templated-repetition checks. Automatic visual blank/show-through classifications are advisory when substantive front-side text exists: preserve that text, record the page in `extraction_visual_review_pages`, and require visual review instead of suppressing it. Only explicit human-confirmed blank pages or candidates corroborated by sparse/repetitive text may be omitted, and every page anchor must remain. Low-quality output must not be treated as readable evidence. Use `reextract` to retry an existing Raw in place instead of capturing a duplicate. External high-fidelity engines remain optional installation capabilities, never a base requirement.
- For scanned mathematical or technical PDFs, visually inspect every low-quality, suppressed, and visual-review page, all detected diagram pages, chapter openers, the first and last pages, and a representative sample of formula-risk pages before closing maintenance. Never copy a damaged OCR formula into a Concept merely because the surrounding prose is readable; verify important formulas against the preserved PDF, and record uncertain worked examples or answer tables as OCR risks.
- Formula-aware PDF extraction validates real Markdown math nodes with the same KaTeX runtime used by the Dashboard. A definite KaTeX parse failure or strict warning records exact pages and lines and keeps the Raw in `needs-followup`; this includes array-column mismatches, unsupported math Unicode, and math/text command misuse. Formula density and semantic OCR risk without a deterministic KaTeX finding remain advisory. Only a complete `\\(...\\)` or `\\[...\\]` wrapper nested inside one display-math block may be removed automatically, and the repaired formula must pass both parse and strict checks before it is accepted. Do not guess through duplicate equation tags or other ambiguous OCR damage. `lint` reports formula syntax and strict-warning failures introduced by later edits.
- Treat every U+FFFD Unicode replacement character in the final extracted `## Capture` body as deterministic encoding loss. Record its count and page numbers, keep the Raw in `needs-followup`, and rerun this gate after capture transformations, re-extraction, Agent repair, and immediately before maintenance; `lint` must also report replacement characters introduced by later edits. Mentions in Processing Notes do not trigger the gate.
- Maintenance postflight normalizes only an exact whole-value JSON-style quote wrapper when its intended YAML value is unambiguous. It rejects remaining escaped quotes, boundary backslashes, and unbalanced wrapper quotes in Concept titles or galaxy metadata, returns affected References to `inbox`, and reports `malformedFrontmatterMetadata` through `lint`; do not treat a rejected task as evidence closure.
- Preserve topology-heavy figures such as content maps, flowcharts, relationship diagrams, mind maps, and organization charts as local image assets whenever OCR cannot faithfully retain both nodes and edges. Insert each image at its source page, maintain `references/assets/<source>/image-index.json`, and verify the Markdown reference. A later `reextract` must restore indexed page assets rather than silently dropping them.
- Treat `extraction_quality: degraded` as an evidence-quality warning, not by itself as a workflow status. A degraded source may be `inbox` or `processed` only when extraction is complete, substantive evidence is readable, attachments resolve, risky pages were reviewed, and Wiki evidence closure is complete; otherwise keep it `needs-followup`.
- Verify local Markdown and HTML image references after capture and again before maintenance. Never ask an Agent to distill a Reference with missing attachments.
- Keep vault data local. Do not commit or push it unless the user explicitly requests that exact action.
- Do not start the Dashboard during ordinary ingest or maintenance. Open it only for graph/frontend requests.
- Keep the normal local web service bound to `127.0.0.1`. A deliberately isolated
  public sandbox may override the bind host and explicit browser origins through
  deployment environment variables; never expose a personal vault this way.
  Preserve the session token, upload limits, URL private-network checks, import
  preview, checksum validation, and no-overwrite behavior.
