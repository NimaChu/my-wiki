---
title: "Firecrawl MCP capture: 一文搞懂大模型RAG应用（附实践案例）"
type: raw-source
source_type: "webpage"
status: processed
author: "果壳PAI"
published: "2023-11-25"
captured: "2026-07-03T01:38:11.351Z"
source_url: "https://zhuanlan.zhihu.com/p/668082024"
snapshot_path: ""
content_hash: "565626d370569329281565f512884b5a5e9c5053f398e9a76d8dbe93676d0c41"
capture_method: "firecrawl-mcp:keyless-scrape-search"
source_quality: "primary-url-indexed-but-content-blocked"
capture_provider: "firecrawl-mcp"
capture_operation: "scrape+search"
provider_source_url: "https://zhuanlan.zhihu.com/p/668082024"
provider_api_url: "https://mcp.firecrawl.dev/v2/mcp"
robots_respected: "provider-default"
tags:
  - "raw"
  - "firecrawl"
related:
  - "[[检索增强生成 RAG]]"
---

# Firecrawl MCP capture: 一文搞懂大模型RAG应用（附实践案例）

## Source

- Author: 果壳PAI
- Published: 2023-11-25
- URL: https://zhuanlan.zhihu.com/p/668082024
- Captured: 2026-07-03T01:38:11.351Z
- Source type: webpage
- Capture method: firecrawl-mcp:keyless-scrape-search
- Snapshot: not available

## Capture

This note records a Firecrawl MCP keyless capture attempt for the Zhihu article. It is not a full-text capture of the original article.

Firecrawl MCP was reachable through a corporate HTTP proxy. Direct POST access to `https://mcp.firecrawl.dev/v2/mcp` without that proxy returned a corporate "Application Blocked" HTML page, while the proxy path successfully initialized the MCP server and listed Firecrawl tools.

`firecrawl_scrape` against the original Zhihu URL succeeded technically but returned Zhihu's safety/login gate instead of the article body. The returned metadata title was `安全验证 - 知乎`, the final URL was a Zhihu `/account/unhuman` safety verification URL, and the extracted Markdown only contained a login prompt plus Zhihu branding text.

`firecrawl_search` did find the original Zhihu article when querying `zhuanlan.zhihu.com/p/668082024`. The search result identified:

- URL: https://zhuanlan.zhihu.com/p/668082024
- Title: 一文搞懂大模型RAG应用（附实践案例） - 知乎专栏
- Description: 大模型（Large Language Model，LLM）的浪潮已经席卷了几乎各行业，但当涉及到专业场景或行业细分领域时，通用大模型会面临专业知识不足的问题。

A narrower search for `"668082024" "RAG"` also returned the same Zhihu URL and a description stating that RAG's architecture can be understood as retrieving relevant knowledge and integrating it into the prompt so the large model can reference that knowledge to produce a reasonable answer.

Firecrawl search also returned secondary pages that reference the original Zhihu URL, including:

- https://www.cnblogs.com/lightsong/p/18196970
- https://testerhome.com/topics/41492
- https://blog.csdn.net/aibishe/article/details/139570281
- https://blog.51cto.com/u_15790456/10537113

## Extracted Claims

- The hosted Firecrawl MCP keyless endpoint works from this environment when routed through the corporate proxy.
- Firecrawl MCP can search and identify the target Zhihu article by URL and article ID.
- Firecrawl MCP cannot directly retrieve this Zhihu article body in keyless scrape mode because Zhihu returns a safety/login gate.
- The original article is still identifiable as a RAG guide discussing professional/domain scenarios where general LLMs lack sufficient knowledge.
- The available search descriptions support the existing RAG synthesis that frames RAG as retrieval plus prompt-grounded generation.

## Candidate Wiki Links

- [[检索增强生成 RAG]]

## Processing Notes

- Status: processed
- Linked wiki page: [[检索增强生成 RAG]]
- Firecrawl scrape result should not be treated as article-body evidence; it is evidence about access behavior plus search-index metadata.
