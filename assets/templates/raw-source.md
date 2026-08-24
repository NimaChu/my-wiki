---
title: "{{title}}"
type: Reference
description: "Captured evidence for {{title}}."
source_type: webpage
collection:
status: stable
workflow_status: inbox
author:
published:
captured: {{date}}
source_url:
snapshot_path:
text_extraction:
extracted_pages:
extracted_characters:
image_index_path:
image_count:
mirrored_image_count:
content_hash:
capture_method:
source_quality:
tags:
  - raw
related:
---

# {{title}}

## Source

- Author:
- Published:
- URL:
- Captured: {{date}}
- Source type: webpage
- Capture method:
- Snapshot:

`source_url` is optional for local files. For a PDF, attachment, or other source without a URL, preserve the original under `references/originals/` and set `snapshot_path` (or the matching snapshot field). Do not replace the original with an AI summary.

## Capture

Paste or capture the source material here without rewriting it into a wiki article. Preserve meaningful image placement.

## Images

- Preserve remote images as Markdown image links during initial capture.
- For image-rich sources, run `my-wiki images --source references/sources/<source-note>.md`.
- Store local copied images under `references/assets/<source-note>/`.
- Keep a concise table of visual evidence here and the complete machine-readable inventory in `image-index.json`.
- Prefer image placement that matches the original reading flow.

## Extracted Claims

- 

## Candidate Wiki Links

- 

## Processing Notes

- Workflow status: inbox
- Next action: compile durable ideas into `concepts/`, close core related links, then mark processed.
