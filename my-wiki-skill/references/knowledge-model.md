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

Read [ima-local-import.md](ima-local-import.md) only when the user explicitly asks to use or migrate IMA knowledge. Read [firecrawl-mcp.md](firecrawl-mcp.md) when Firecrawl capture is requested or ordinary webpage capture fails.
