# Document extraction architecture

My Wiki owns the evidence contract. Extractors provide observations; they do not decide whether a Raw source is safe to distill.

## Pipeline

```text
preserved snapshot
  -> format probe and engine routing
  -> extractor adapter
  -> my-wiki.document-ir/v1
  -> central evidence gates
  -> Markdown rendering and local assets
  -> Raw source + extraction report
```

The untouched input remains under `references/originals/`. Runtime extraction artifacts are stored under `.my-wiki/extractions/` and are not part of a shared knowledge package unless an export explicitly includes them.

## Engine responsibilities

- `mineru`: primary PDF parser, optimized for Chinese technical documents, formulas, tables, and page-local images.
- `docling`: structured adapter for Office, OpenDocument, EPUB, and PDF fallback. Its JSON is mapped into My Wiki blocks with type, reading order, page, bounding box, and provenance.
- `agent-vision`: built-in page-only visual repair inspired by doc7's method. My Wiki renders selected risk pages and attaches them to an existing OpenCode or Codex CLI session. It never replaces a complete document wholesale, and a deterministic differential gate decides whether each candidate is accepted.
- `pdfjs` and `tesseract`: degraded local fallbacks when high-fidelity engines are unavailable.

An engine that actually ran and failed is not hidden by a lower-fidelity fallback. `auto` routing may move to the next engine only when the preferred engine reports `unavailable`.

## Document IR

`my-wiki.document-ir/v1` contains source identity, producer/version, pages, ordered blocks, assets, metadata, and diagnostics. A block may carry:

```text
id, type, page, order, bbox, text, markdown, latex, table,
asset_ref, confidence, provenance
```

The compressed IR is an audit artifact. Raw Markdown remains the human- and Agent-facing evidence surface.

## Acceptance report

`my-wiki.extraction-report/v1` records every attempted engine, selected method, expected and represented pages, missing-page warnings, quality results, and final gates.

Blocking failures include extractor failure, empty output, missing page provenance for paginated documents, globally poor quality, deterministic formula syntax/strict failures, Unicode replacement characters, and missing local attachments. Degraded quality is advisory only when every hard gate passes and risky pages have been reviewed.

The report path is stored in `extraction_report`; the compressed IR path is stored in `extraction_document_ir`.

## Configuration

```text
MY_WIKI_PDF_ENGINE=auto|mineru|docling|pdfjs|tesseract
MY_WIKI_DOCLING_MODE=auto|off
MY_WIKI_DOCLING_PYTHON=/absolute/path/to/python
MY_WIKI_DOCLING_TIMEOUT_MS=14400000
MY_WIKI_VISUAL_REPAIR_MODE=auto|off|required
MY_WIKI_VISUAL_REPAIR_PROVIDER=opencode|codex
MY_WIKI_VISUAL_REPAIR_MODEL=provider/model
MY_WIKI_VISUAL_REPAIR_MAX_PAGES=12
MY_WIKI_VISUAL_REPAIR_BATCH_PAGES=2
MY_WIKI_VISUAL_REPAIR_SCALE=1.8
MY_WIKI_VISUAL_REPAIR_TIMEOUT_MS=1800000
```

Run `npm run document:doctor` to inspect the effective local capabilities.
