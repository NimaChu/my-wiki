---
title: 检索增强生成 RAG
type: concept
status: active
aliases:
  - RAG
  - Retrieval-Augmented Generation
  - 检索增强生成
source_count: 2
sources:
  - "[[raw/2026-07-03--一文搞懂大模型rag应用-附实践案例]]"
  - "[[raw/2026-07-03--firecrawl-mcp-一文搞懂大模型rag应用-附实践案例]]"
relation_hints:
  - "supports [[raw/2026-07-03--一文搞懂大模型rag应用-附实践案例]]"
  - "supports [[raw/2026-07-03--firecrawl-mcp-一文搞懂大模型rag应用-附实践案例]]"
tags:
  - llm
  - rag
  - knowledge-base
---

# 检索增强生成 RAG

RAG is a pattern for grounding large-language-model answers in retrieved knowledge instead of relying only on the model's parametric memory. A typical RAG application retrieves relevant material from a private or external knowledge store, injects that material into the prompt, and asks the model to answer against that context. [[raw/2026-07-03--一文搞懂大模型rag应用-附实践案例]]

## Why It Matters

- It can be a lower-cost route than post-training or SFT when the problem is mainly missing domain, private, offline, or recent knowledge. [[raw/2026-07-03--一文搞懂大模型rag应用-附实践案例]]
- It can reduce hallucination risk by giving the model explicit retrieved evidence to use during generation. [[raw/2026-07-03--一文搞懂大模型rag应用-附实践案例]]
- It can keep sensitive enterprise data in an application-side knowledge store instead of making model training the default integration path. [[raw/2026-07-03--一文搞懂大模型rag应用-附实践案例]]

## Core Workflow

RAG has two broad phases. The preparation phase loads source data, cleans or normalizes it, captures metadata, chunks text, embeds the chunks, builds an index, and stores the searchable representation. The runtime phase accepts a user query, retrieves relevant chunks, inserts the retrieved context into the prompt, and asks the LLM to produce the answer. [[raw/2026-07-03--一文搞懂大模型rag应用-附实践案例]]

## Design Notes

- Chunking has to balance model token limits against semantic completeness.
- Embedding model choice strongly affects retrieval quality; specialized domains may need tuned or custom embeddings.
- Storage choices such as FAISS, ChromaDB, Elasticsearch, and Milvus depend on scenario, hardware, and performance constraints.
- Hybrid retrieval, such as combining vector similarity with full-text retrieval, can improve recall.
- Prompt construction usually includes a task description, retrieved background knowledge, and the user's question or instruction, then gets tuned iteratively.

## Source

- [[raw/2026-07-03--一文搞懂大模型rag应用-附实践案例]]
- [[raw/2026-07-03--firecrawl-mcp-一文搞懂大模型rag应用-附实践案例]]
