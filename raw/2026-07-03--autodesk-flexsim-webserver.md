---
title: "Autodesk FlexSim 2025 Help: Webserver"
type: raw-source
source_type: webpage
status: processed
author: "Autodesk"
published:
captured: 2026-07-03T01:48:58Z
source_url: "https://help.autodesk.com/view/FLEXSIMIN/2025/ENU/?guid=FlexSim_User_Manual_reference_developeradvanceduser_webserver_html"
snapshot_path: "raw/snapshots/2026-07-03--autodesk-flexsim-webserver.firecrawl.txt"
snapshot_markdown_path: "raw/snapshots/2026-07-03--autodesk-flexsim-webserver.firecrawl.txt"
snapshot_html_path: "raw/snapshots/2026-07-03--autodesk-flexsim-webserver.firecrawl.html"
snapshot_json_path: "raw/snapshots/2026-07-03--autodesk-flexsim-webserver.firecrawl.json"
content_hash: "e8f4d7658542e1d09b71e7a63f670b37ce8df67e2bb5830290e59eb93baca633"
capture_method: "firecrawl-mcp:keyless-scrape"
capture_provider: "firecrawl-mcp"
capture_operation: "scrape"
provider_api_url: "https://mcp.firecrawl.dev/v2/mcp"
source_quality: "official-documentation"
tags:
  - raw
  - flexsim
  - autodesk
  - webserver
related:
  - "[[FlexSim Webserver]]"
---

# Autodesk FlexSim 2025 Help: Webserver

## Source

- Author: Autodesk
- Published:
- URL: https://help.autodesk.com/view/FLEXSIMIN/2025/ENU/?guid=FlexSim_User_Manual_reference_developeradvanceduser_webserver_html
- Captured: 2026-07-03T01:48:58Z
- Source type: webpage
- Capture method: firecrawl-mcp:keyless-scrape
- Snapshot: `raw/snapshots/2026-07-03--autodesk-flexsim-webserver.firecrawl.txt`
- Capture result: HTTP 200, official Autodesk FlexSim 2025 Help page, main article captured.

## Capture

The full captured article is stored in the snapshot files listed in frontmatter. The Markdown snapshot starts at the official `# Webserver` article heading and preserves Autodesk's section structure, images, configuration example, query examples, IIS notes, and NGINX reverse proxy snippet.

## Extracted Claims

- FlexSim Webserver is a query-driven manager and communication interface that lets users run FlexSim models through a browser. See [[FlexSim Webserver]].
- The Webserver uses a text configuration file for FlexSim program directory, model directory, port, reply timeout, instance limits, thread limits, auto-save filtering, headless mode, remote model operations, job queue limits, Windows Authentication, Active Directory, and session settings.
- The Webserver has higher resource needs than ordinary desktop FlexSim runs because it runs models, renders graphics, compresses and streams graphics/dashboard output, and may serve multiple concurrent users.
- Autodesk does not recommend running FlexSim Webserver in a virtual machine, especially with Video Streaming mode, unless the environment provides suitable 3D graphics acceleration.
- The 3D view supports Video Streaming and WebGL Streaming. FlexSim 2020 Update 2 and later use WebGL Streaming by default.
- Custom integrations use `webserver.dll` queries such as `availablemodels`, `configuration`, `instancelist`, `createinstance`, `queryinstance`, `terminateinstance`, `submitjob`, job status/result queries, library/module listing, and optional upload/download/delete operations.
- Instance-level customization is done through FlexSim query handlers under `MAIN:/project/exec/globals/serverinterface/queryhandlers` or model-level nodes under `MODEL:/Tools/serverinterface/queryhandlers`.
- IIS deployment requires iisnode, IIS Management Tools, ASP.NET, and URL Rewrite. Autodesk calls out visibility, threading, authentication, WebSocket, and desktop heap memory differences.
- NGINX reverse proxy deployment must forward HTTP upgrade headers for WebSockets when proxying to the FlexSim Webserver.

## Candidate Wiki Links

- [[FlexSim Webserver]]

## Processing Notes

- Status: processed
- Firecrawl MCP keyless scrape captured the official page successfully. No dashboard refresh was run.
