---
title: Raw Sources
type: index
status: active
tags:
  - raw
  - sources
---

# Raw Sources

Raw is the immutable evidence layer. Keep source and snapshot storage flat:

```text
raw/
  sources/<source>.md
  assets/<source>/...
  snapshots/<snapshot>.*
```

Do not add classification subdirectories below `sources/` or `snapshots/`. The one directory level below `assets/` belongs to the source article and keeps different articles' images separate. Classification may remain optional metadata, but it does not control paths or wiki relationships.

Raw source statuses are `inbox`, `processed`, `needs-followup`, or `stale`. `processed` means the primary wiki targets and backlinks are closed.

`sources/` contains readable evidence notes, `assets/` contains visual evidence, and `snapshots/` contains immutable webpage captures, PDFs, attachments, and other originals. A local or binary source may have no `source_url`; in that case its raw note must retain a snapshot field that points to the original file.
