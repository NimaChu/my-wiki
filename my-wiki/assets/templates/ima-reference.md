---
title: "{{title}}"
type: raw-source
source_type: ima
status: inbox
author:
published:
captured: {{date}}
source_url:
snapshot_path:
image_index_path:
image_count:
mirrored_image_count:
content_hash:
capture_method: ima-openapi
source_quality: imported
ima_source:
  knowledge_base_id: "{{knowledge_base_id}}"
  knowledge_base_name: "{{knowledge_base_name}}"
  folder_id: "{{folder_id}}"
  folder_name: "{{folder_name}}"
  media_id: "{{media_id}}"
  media_type: "{{media_type}}"
  content_type: "{{content_type}}"
tags:
  - raw
  - ima
  - external
related:
---

# {{title}}

## Source

- Origin: IMA
- Knowledge base: {{knowledge_base_name}}
- Folder: {{folder_name}}
- Media ID: {{media_id}}
- Media type: {{media_type}}
- URL: {{source_url}}
- Captured: {{date}}
- Snapshot: {{snapshot_path}}

## IMA Source

- Knowledge base ID: {{knowledge_base_id}}
- Knowledge base name: {{knowledge_base_name}}
- Folder ID: {{folder_id}}
- Folder name: {{folder_name}}
- Media ID: {{media_id}}
- Media type: {{media_type}}
- Content type: {{content_type}}

## Capture

{{content}}

## Images

- Inline Markdown/HTML images are preserved in Capture. Run `my-wiki images --source raw/sources/source-note.md` when image references are present.

## Extracted Claims

- 

## Candidate Wiki Links

- 

## Processing Notes

- Status: inbox
- Imported locally from IMA; do not depend on the external platform during routine maintenance or query.
- Next action: compile durable ideas into wiki pages, close core related links, then mark processed.
