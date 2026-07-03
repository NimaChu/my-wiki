---
title: Raw Sources
type: index
status: active
tags:
  - raw
  - sources
---

# Raw Sources

Store captured source notes here.

Raw notes are evidence. Keep them faithful to the source and compile durable knowledge into `wiki/`.

Image-rich sources should keep visual evidence too. Use `npm run wiki:images -- --source raw/source-note.md` to mirror useful webpage images into `raw/assets/<source-note>/` and write an `image-index.json` file that agents can inspect when answering with screenshots or diagrams.

Typical statuses:

- `inbox`: captured but not yet compiled.
- `processed`: compiled into wiki pages with backlinks closed.
- `needs-followup`: requires more work before it can be processed.
- `stale`: superseded or no longer current.
