---
title: "FlexSim Webserver"
type: topic
status: active
aliases:
  - "Autodesk FlexSim Webserver"
  - "FlexSim Server"
reviewed_at: 2026-07-03
source_count: 1
relation_hints:
tags:
  - topic
  - flexsim
  - webserver
  - simulation
sources:
  - "[[raw/2026-07-03--autodesk-flexsim-webserver]]"
---

# FlexSim Webserver

## Summary

FlexSim Webserver is Autodesk FlexSim's browser-facing server for running and interacting with FlexSim models. It acts as a query-driven manager around FlexSim instances: users can start model instances, connect to generated model interfaces, stream 3D views and dashboards, and call `webserver.dll` endpoints from custom web applications. [[raw/2026-07-03--autodesk-flexsim-webserver]]

The official documentation frames it as an advanced-user/developer feature rather than a general dashboard. Treat it as both a deployment surface and an integration API: configuration controls where models live and how many FlexSim instances may run, while the query interface controls model discovery, instance lifecycle, jobs, and model-specific request handlers. [[raw/2026-07-03--autodesk-flexsim-webserver]]

## Key Ideas

- Installation and launch: FlexSim Webserver has its own installer. Starting the FlexSim Server hosts a local website, with the default local access address documented as `http://127.0.0.1/`. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- Configuration file: The server is configured before launch through `flexsim webserver configuration.txt`, including FlexSim program directory, model directory, port, reply timeout, maximum instances, maximum threads per instance, auto-save filtering, and headless instances. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- Remote operations: Upload, download, and delete operations are explicit security hazards and are disabled/enabled through configuration. Max upload size is also configured there. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- Jobs: The job manager stores job files in the configured FlexSim data directory and enforces queue length and timeout limits. A submitted job describes setup commands and result commands, then the server creates an instance, runs setup, polls run state, and stores results. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- Sessions: When sessions are enabled, instances started by a session are only accessible to that same session and are terminated when the session expires. [[raw/2026-07-03--autodesk-flexsim-webserver]]

## Rendering And Clients

- System requirements follow FlexSim's recommended requirements, with extra load for compressing and streaming graphics and dashboards, especially under concurrent use. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- Autodesk warns that VM environments are not broadly tested for FlexSim Webserver and are not recommended, especially for Video Streaming mode, because 3D graphics acceleration is a central requirement. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- The generated browser UI can display model windows, 3D views, dashboards, and experimenter/optimizer interfaces, but not every FlexSim window type is supported. Unsupported windows may appear without data. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- 3D streaming has two modes: Video Streaming renders on the server and streams compressed images, while WebGL Streaming streams scene data and renders on the client. FlexSim 2020 Update 2 and later default to WebGL Streaming. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- Tablets and smartphones must connect through the host machine's LAN/WLAN IP address rather than `127.0.0.1`. Public internet access requires a globally reachable IP and network administration. [[raw/2026-07-03--autodesk-flexsim-webserver]]

## Query Surface

The server exposes `webserver.dll` queries that can be tested directly in the browser URL bar and used by custom web applications. Important groups:

- General discovery/configuration: `availablemodels`, `allfiles`, `configuration`.
- Optional remote file operations: `uploadmodel`, `deletemodel=...`, `downloadfile=...`.
- Instance lifecycle: `instancelist`, `numinstances`, `createinstance=...`, `queryinstance=...`, `terminateinstance=...`.
- Library/module discovery: `getlibraries`, `getmodules`.
- Job manager: `submitjob`, `getjobquery=1`, `getjobresults=1`, `getjobstatus=1`, `getjobqueuelength`, `canceljob=1`.

Instance queries are the main extension mechanism. Default handlers live under `MAIN:/project/exec/globals/serverinterface/queryhandlers`; model-specific handlers can be added under `MODEL:/Tools/serverinterface/queryhandlers`. For custom reply behavior, a model can implement `MODEL:/Tools/serverinterface/sendreply` and send a reply with `webcommand("httpsendreply", replynode)`. [[raw/2026-07-03--autodesk-flexsim-webserver]]

## Deployment Notes

- IIS deployment is supported through iisnode and requires IIS Management Tools, ASP.NET, and URL Rewrite. Autodesk calls out three behavior differences: FlexSim instances are hidden because IIS runs in the background, IIS can reply in parallel threads, and model directory access can be restricted through Windows Authentication. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- IIS WebSocket support requires IIS 8.x, which matters for faster video streaming. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- IIS may need desktop heap memory adjustment when many FlexSim instances are opened by non-interactive processes. The relevant Windows registry value is the `SharedSection` setting under the Windows subsystem key. [[raw/2026-07-03--autodesk-flexsim-webserver]]
- NGINX reverse proxy deployment should forward WebSocket upgrade headers while proxying to the bound FlexSim Webserver port. [[raw/2026-07-03--autodesk-flexsim-webserver]]

## Related Concepts

- Simulation model serving
- Browser-based model control
- WebSocket video streaming
- WebGL client rendering
- IIS reverse-hosting with iisnode

## Relations

- product_of: Autodesk
- applies_to: FlexSim advanced-user and developer integrations

## Contradictions

- None captured.

## Supersedes

- None.

## Sources

- [[raw/2026-07-03--autodesk-flexsim-webserver]] - Autodesk FlexSim 2025 Help: Webserver, captured with Firecrawl MCP.

## Open Questions

- Which FlexSim server version is installed in the target environment, and does it match the 2025 documentation behavior?
- Should agent-wiki eventually split the query API, IIS deployment, and streaming-mode notes into separate subpages if more FlexSim documentation is ingested?
