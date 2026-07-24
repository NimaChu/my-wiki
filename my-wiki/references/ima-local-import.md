# IMA Local Import

Use this guide only when the user explicitly asks to use IMA, import IMA knowledge, maintain IMA-backed raw notes, or upgrade legacy IMA pointers.

IMA is optional. Do not assume the connector exists, do not call IMA tools speculatively, and do not store external content or external identifiers without user consent.

## Consent Check

Before using IMA, confirm:

- connector availability and credentials,
- search or sync scope,
- whether full IMA content may be downloaded into local raw notes,
- whether IMA source identifiers may be written into raw or wiki pages.

Only import content the user has the right to store locally.

## Local-First Rule

Prefer local-first ingest. IMA knowledge should become normal local raw evidence before it is distilled:

1. Import selected IMA items directly into `raw/sources/` as `status: inbox`.
2. Store fetched text in `## Capture`.
3. Mirror binary originals directly under `raw/snapshots/` with source-specific filenames.
4. Mirror/index image items or image-rich text under `raw/assets/` when practical.
5. Maintain imported IMA notes through the normal raw -> wiki -> processed workflow.

Do not keep IMA as a pointer-only dependency for routine maintenance or future query.

## Commands

```bash
node <skill-directory>/scripts/my-wiki.mjs sync-ima
node <skill-directory>/scripts/my-wiki.mjs sync-ima --kb "Knowledge base name" --max-items 100
node <skill-directory>/scripts/my-wiki.mjs sync-ima --dry-run --summary
node <skill-directory>/scripts/my-wiki.mjs sync-ima --no-images
node <skill-directory>/scripts/my-wiki.mjs fetch-ima raw/sources/source-note.md
node <skill-directory>/scripts/my-wiki.mjs fetch-ima raw/sources/source-note.md --metadata
node <skill-directory>/scripts/my-wiki.mjs fetch-ima raw/sources/source-note.md --force
```

Use `--dry-run` before broad imports. It plans imports without fetching originals or writing files.

Use `--metadata` for inspection only. It should not modify the vault.

Use `--force` only when intentionally replacing an existing substantial `## Capture` section.

## Maintenance

Imported IMA raw notes are ordinary inbox sources:

1. Read the local raw note first.
2. Extract durable concepts into existing or new pages under `wiki/`.
3. Link wiki claims back to the raw IMA evidence.
4. Update `wiki/index.md` and `wiki/log.md` when material knowledge changes.
5. Mark the raw note `processed` only after primary wiki targets resolve and backlinks close.
6. Run `node <skill-directory>/scripts/my-wiki.mjs lint`.

Keep imported raw/wiki knowledge local unless the user explicitly asks to commit it and has the right to publish it.

## Legacy IMA Pointers

`status: ima-pointer` is a legacy pending state. It is not a processed state.

Upgrade a legacy pointer before distillation:

```bash
node <skill-directory>/scripts/my-wiki.mjs fetch-ima raw/sources/source-note.md
```

After fetch, treat the note as a normal `status: inbox` raw source. Do not mark a pointer `processed` directly.
