---
title: References
type: index
status: stable
tags:
  - raw
  - sources
---

# References

References are the durable evidence layer. Keep source and original storage flat:

```text
references/
  sources/<source>.md
  assets/<source>/...
  originals/<original>.*
```

Do not add classification subdirectories below `sources/` or `originals/`. The one directory level below `assets/` belongs to one Reference and keeps different sources' images separate. Classification may remain optional metadata, but it does not control paths or Concept relationships.

Every evidence note is an OKF `Reference`. Its OKF `status` is normally `stable`; My Wiki queue state lives separately in `workflow_status: inbox | processed | needs-followup | stale`. `processed` means the primary Concept targets and backlinks are closed.

`sources/` contains readable evidence notes, `assets/` contains visual evidence, and `originals/` contains immutable webpage captures, PDFs, attachments, and other originals. A local or binary source may have no `source_url`; in that case its Reference must retain a snapshot field that points to the original file.
