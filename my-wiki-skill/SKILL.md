---
name: my-wiki
description: Manage local Markdown-first My Wiki knowledge vaults with an AI agent. Use for capturing webpages, PDFs, Office documents, notes, images, folders, and ZIP bundles; maintaining raw-to-wiki evidence links; searching or answering from a vault; checking or repairing vault health; switching among local vaults; and opening the My Wiki knowledge graph or dashboard.
---

# My Wiki

This Skill is a thin Agent adapter, not the My Wiki application. Use its bundled `scripts/my-wiki.mjs` bridge, which locates and invokes a separately installed My Wiki project. Never expect application code, Dashboard assets, or a knowledge vault to live inside the installed Skill.

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

If no vault is configured, ask the user where to create one, then use `init`. Never create a vault inside the installed Skill or the My Wiki project. A separate vault owns its `raw/`, `wiki/`, `templates/`, and `.my-wiki/` directories.

## Core Commands

```bash
node <skill-directory>/scripts/my-wiki.mjs init /path/to/vault --name personal --use
node <skill-directory>/scripts/my-wiki.mjs --vault personal status
node <skill-directory>/scripts/my-wiki.mjs --vault personal search "query"
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --title "Title" --url "https://example.com"
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --file /path/to/document.pdf
node <skill-directory>/scripts/my-wiki.mjs --vault personal capture --directory /path/to/documents
node <skill-directory>/scripts/my-wiki.mjs --vault personal reextract --source raw/sources/source-note.md
node <skill-directory>/scripts/my-wiki.mjs --vault personal reextract --all-followup
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

The Dashboard is a local knowledge workspace, not only a graph viewer. It may add a webpage, file, folder batch, or Markdown-plus-images ZIP bundle, declare an empty initial knowledge galaxy, optionally suggest a galaxy during capture, list pending raw notes, export a named universe, and preview then apply a `.mywiki` import. In the Evidence layer, double-clicking a Wiki or raw node opens its Markdown in the built-in reader/editor; local images are resolved through the authenticated vault image service, frontmatter remains protected, and version-checked saves reject concurrent overwrites. Dashboard file uploads enter a visible Inbox processing queue as soon as transfer completes, while extraction continues in the background. Processing queue entries are UI state, not maintainable raw notes. File capture persists the untouched original in `raw/snapshots/` before parsing it. Local extraction then converts text PDFs, scanned PDFs, images, DOCX, PPTX, XLSX, and ZIP Markdown into structured raw Markdown and assets. OCR runs locally without an API key; its free language data is downloaded once and cached in the vault. Only substantive captures with a valid snapshot and resolvable local attachments enter `inbox`; every failure is recorded in `followup_reasons` and remains `needs-followup`. The maintenance button repeats this deterministic preflight and never sends follow-up material to an Agent. Capture remains deterministic and never starts maintenance automatically. Explicit browser actions may ask Viki a read-only vault question or send one bounded maintenance-queue batch to an authenticated local agent. Supported local CLIs include OpenCode, Qoder CN, Qoder, Codex, and Claude; the `qoder` provider prefers `qoderclicn`, and Qoder is exposed only after local login or PAT configuration with a restricted non-interactive tool set. Viki keeps browser-local multi-conversation history, sends only the latest eight eligible messages as explicit context, can pause the browser's matching active job, and applies CLI changes to the next question without interrupting the current answer. Viki questions have a short idle timeout; maintenance uses a bounded total timeout without an idle timeout so long document reads are not mistaken for stalled work. Viki opens in a 4:3 panel whose user-adjusted size is remembered; pet choice and Agent CLI choice are separate persisted preferences. Preserve the bundled pet attribution and license notices.

Read [workflows.md](references/workflows.md) when ingesting, querying, maintaining, sharing, or visualizing a vault.
Read [dashboard-agent.md](references/dashboard-agent.md) when changing Dashboard Agent invocation, Viki, maintenance batches, permissions, or provider support.

## Knowledge Galaxies

The Dashboard presents the whole vault graph as one knowledge universe, each human-named group as a knowledge galaxy, and each Wiki page as a Wiki planet. Keep galaxy names in each wiki page's existing `universes` list. Prefer broad, durable domains such as `数学`, `AI`, or `FlexSim` over temporary collections, individual courses, projects, book series, or narrow subtopics. Reuse or merge into an existing broad galaxy whenever its meaning fits; create a new galaxy only for a durable top-level boundary. The first name is primary; additional names let one Wiki planet connect multiple galaxies. Do not create package IDs or galaxy IDs.

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
- Keep `wiki/` pages atomic, synthesized, linked, and evidence-backed. Assign one or more broad, durable human-readable `universes`; do not turn source collections or narrow topics into galaxies, and do not organize raw storage by evolving wiki topics.
- Apply the same entity-extraction principle to every source format, including webpages, articles, notes, slide decks, transcripts, and books. Distill concepts, people, organizations, products, methods, processes, APIs, models, theorems, comparisons, and other durable claims when they remain useful for independent retrieval, linking, or reuse outside the source. Prefer updating an existing page over creating a duplicate; combine fragments that are too narrow to stand alone and split unrelated knowledge units. A source-summary or collection page may be kept as an index, but it does not replace the durable atomic knowledge represented by the source or by a coherent maintenance batch.
- Treat `collection` and source classification as optional provenance metadata only. They never control paths, universes, or wiki relationships.
- Keep `.my-wiki/` for local runtime state, exports, import receipts, backups, and conflicts. Do not treat it as knowledge content.
- Run `organize-raw` before `organize-raw --apply`; keep source, snapshot, asset, Wiki, and image-index links synchronized.

Read [ima-local-import.md](references/ima-local-import.md) only when the user explicitly asks to use or migrate IMA knowledge. Read [firecrawl-mcp.md](references/firecrawl-mcp.md) when Firecrawl capture is requested or ordinary webpage capture fails.

## Safety

- Keep raw captures factual and preserve source metadata.
- Keep wiki pages atomic, synthesized, linked, and evidence-backed.
- Treat `processed` as an evidence-closure state, not a progress label.
- Require `extraction_status: complete` and substantive `## Capture` content before maintaining any local PDF, image, Office document, or other binary source. Keep every other extraction state locked as `needs-followup`. PDF extraction records page-quality and formula-layout risk summaries; MinerU scans also use low-resolution ink, contrast, and mirrored-neighbor analysis plus text-density and templated-repetition checks. Automatic visual blank/show-through classifications are advisory when substantive front-side text exists: preserve that text, record the page in `extraction_visual_review_pages`, and require visual review instead of suppressing it. Only explicit human-confirmed blank pages or candidates corroborated by sparse/repetitive text may be omitted, and every page anchor must remain. Low-quality output must not be treated as readable evidence. Large scanned PDFs use resumable page checkpoints and bounded OCR worker batches; use `reextract` to retry an existing Raw in place instead of capturing a duplicate. MinerU is an optional high-fidelity PDF backend, never a base installation requirement.
- For scanned mathematical or technical PDFs, visually inspect every low-quality, suppressed, and visual-review page, all detected diagram pages, chapter openers, the first and last pages, and a representative sample of formula-risk pages before closing maintenance. Never copy a damaged OCR formula into a Wiki page merely because the surrounding prose is readable; verify important formulas against the preserved PDF, and record uncertain worked examples or answer tables as OCR risks.
- Preserve topology-heavy figures such as content maps, flowcharts, relationship diagrams, mind maps, and organization charts as local image assets whenever OCR cannot faithfully retain both nodes and edges. Insert each image at its source page, maintain `raw/assets/<source>/image-index.json`, and verify the Markdown reference. A later `reextract` must restore indexed page assets rather than silently dropping them.
- Treat `extraction_quality: degraded` as an evidence-quality warning, not by itself as a workflow status. A degraded source may be `inbox` or `processed` only when extraction is complete, substantive evidence is readable, attachments resolve, risky pages were reviewed, and Wiki evidence closure is complete; otherwise keep it `needs-followup`.
- Verify local Markdown and HTML image references after capture and again before maintenance. Never ask an Agent to distill a raw note with missing attachments.
- Keep vault data local. Do not commit or push it unless the user explicitly requests that exact action.
- Do not start the Dashboard during ordinary ingest or maintenance. Open it only for graph/frontend requests.
- Keep the normal local web service bound to `127.0.0.1`. A deliberately isolated
  public sandbox may override the bind host and explicit browser origins through
  deployment environment variables; never expose a personal vault this way.
  Preserve the session token, upload limits, URL private-network checks, import
  preview, checksum validation, and no-overwrite behavior.
