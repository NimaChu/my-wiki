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

> **IMA 指针条目**：原文档存放在 IMA 知识库，本地仅保留元数据和引用。查询原文请通过 IMA connector / OpenAPI，或 `npm run wiki:fetch-ima -- raw/ima/source-note.md` 获取。

## IMA Source

- **知识库**: {{knowledge_base_name}}
- **文件夹**: {{folder_name}}
- **Media 类型**: {{media_type}}
- **可获取原文**: 通过 IMA connector / OpenAPI 获取

## 摘要

{{introduction}}

## 提取的关键概念

- 

## 对应 Wiki 页面

- 

## 处理记录

- Status: ima-pointer
- 本条目不存储原文，原文在 IMA 知识库中
- 后续维护时获取原文，提取关键概念，再更新对应 wiki 页面
- 完成 wiki 反链闭环后，将本条目改为 `processed`
