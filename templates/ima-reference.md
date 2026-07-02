---
title: "{{title}}"
type: raw-source
source_type: ima-reference
status: ima-pointer
author:
published:
captured: {{date}}
source_url:
ima_source:
  knowledge_base_id: "{{knowledge_base_id}}"
  knowledge_base_name: "{{knowledge_base_name}}"
  folder_id: "{{folder_id}}"
  folder_name: "{{folder_name}}"
  media_id: "{{media_id}}"
  media_type: "{{media_type}}"
tags:
  - raw
  - ima-reference
related:
---

# {{title}}

> **IMA 指针条目**：原文档存放在 IMA 知识库，本地仅保留元数据和引用。查询原文请通过 `ima-mcp` 的 `fetch_media_content` 工具获取。

## IMA Source

- **知识库**: {{knowledge_base_name}}（ID: `{{knowledge_base_id}}`）
- **文件夹**: {{folder_name}}（ID: `{{folder_id}}`）
- **Media ID**: `{{media_id}}`
- **Media 类型**: {{media_type}}
- **可获取原文**: 通过 `mcp__ima-mcp__fetch_media_content` 获取

## 摘要

{{introduction}}

## 提取的关键概念

- 

## 对应 Wiki 页面

- 

## 处理记录

- Status: ima-pointer
- 本条目不存储原文，原文在 IMA 知识库中
- 如需深度阅读原文，使用 `fetch_media_content` 获取后决定是否创建本地 wiki 页面
