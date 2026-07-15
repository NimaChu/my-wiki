# Agent Wiki FlexSim 2026 Case-Study Dataset

This dataset is a public, derived snapshot of the FlexSim portion of the Agent
Wiki case study. It supports inspection of corpus provenance, structural
features, evidence links, and graph-health measurements without redistributing
the captured Autodesk documentation.

## Contents

- `raw-sources.jsonl`: whitelisted source metadata, hashes, and structural
  features for the captured FlexSim help pages.
- `wiki-pages.jsonl`: metadata and link-derived features for the synthesized
  FlexSim wiki pages.
- `edges.jsonl`: resolved evidence and wiki-link edges within the public subset.
- `typed-relations.jsonl`: supported typed relations within the subset.
- `metrics.json`: aggregate counts and explicit disclosure flags.
- `schema.json`: file-level schema and omission policy.

The authoritative counts for this snapshot are recorded in `metrics.json`.

## Exclusions

The dataset does not contain Autodesk help-page text, HTML snapshots, screenshots,
images, software binaries, or local absolute paths. Source URLs and SHA-256
content hashes are retained so authorized researchers can retrieve the official
documentation and compare their own captures.

FlexSim and Autodesk are trademarks of Autodesk, Inc. This independent research
dataset is not affiliated with or endorsed by Autodesk. Autodesk-provided titles,
URLs, documentation, images, and trademarks remain subject to their respective
owners' terms and are not relicensed here.

## Reproduction

From an Agent Wiki workspace containing an authorized local FlexSim 2026 capture:

```bash
npm run dataset:flexsim
```

The exporter uses an explicit field whitelist. It reads the local source and wiki
layers, resolves links with Agent Wiki's standard resolver, and rewrites the JSONL
and metrics files in this directory.

## Scope

This is the public FlexSim subset, not the author's complete private vault. The
SoftwareX manuscript reports full-vault health metrics and separately identifies
the size of this public subset. The snapshot enables provenance and graph-structure
inspection but does not reproduce semantic correctness judgments or the complete
private-vault node count.

## License

The original dataset schema, selection, annotations, derived features, and graph
structure contributed by Zijun Chu are licensed under the Creative Commons
Attribution 4.0 International license. See `DATA-LICENSE.md`.
