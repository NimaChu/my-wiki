# My Wiki

**A zero-cost, beginner-friendly local knowledge base that AI agents can build and maintain for you.**

[简体中文](README.zh-CN.md)

<img width="1536" height="1024" alt="AI agent organizing local knowledge into an evidence-backed wiki" src="https://github.com/user-attachments/assets/bea713c3-8d37-427b-ab04-5f601123f252" />

Your useful knowledge is scattered across webpages, PDFs, screenshots, chat history, notes, and documentation. My Wiki gives a local AI agent a durable place to turn those sources into a connected wiki you actually own.

Install one Agent Skill, choose any folder for your knowledge, and speak naturally. The agent captures sources, preserves evidence and images, distills atomic wiki pages, repairs links, answers questions, and opens an interactive graph when you want to explore.

No hosted database. No vector database. No required Obsidian setup. No paid API by default.

## Why My Wiki

- **Local first**: Markdown, source snapshots, and images stay in folders you control.
- **Agent maintained**: ask for an article to be saved or the knowledge base to be maintained; the agent handles the workflow.
- **Evidence backed**: synthesized knowledge remains linked to the raw material it came from.
- **Image aware**: diagrams, screenshots, charts, and other useful visuals can be preserved and returned with answers.
- **Knowledge graph included**: explore knowledge universes, wiki relationships, and the raw evidence behind a page.
- **Portable by design**: use ordinary files, move the vault, open it with any Markdown editor, or index it with a future RAG system.
- **Zero-cost starting point**: begin with Node.js and a local AI agent instead of a cloud service or infrastructure stack.

## My Wiki, RAG, Or LLM + Obsidian?

They solve different parts of the knowledge problem. My Wiki focuses on the missing middle: turning source material into readable, linked, evidence-closed knowledge before retrieval.

| | My Wiki | Traditional RAG | LLM + Obsidian |
|---|---|---|---|
| Getting started | Install one Skill and choose a folder | Build ingestion, chunking, embeddings, retrieval, and services | Install an editor, choose plugins, then design prompts and conventions |
| Main storage | Markdown, snapshots, and local images | Vector index plus an external source store | Markdown vault |
| Who organizes it | The agent maintains raw evidence, atomic wiki pages, links, and health checks | The pipeline indexes chunks; human-readable synthesis is separate | Usually the user, assisted by plugins or chat |
| Traceability | Wiki claims link back to raw evidence and backlinks are checked | Depends on retrieval metadata and application design | Possible, but depends on the user's note discipline |
| Images | Preserved as evidence and available for answers | Requires multimodal ingestion and retrieval design | Stored well, but answer-time selection needs extra workflow |
| Visualization | Built-in universe, wiki-network, and evidence views | Usually a separate observability or graph system | Excellent note graph, primarily for the vault itself |
| Best fit | Personal and project knowledge that should stay readable, grounded, and easy to maintain | Large-scale semantic retrieval and production applications | Hands-on writing, linking, and browsing by a human |

My Wiki does not oppose either approach. Open a My Wiki vault in Obsidian whenever you want its editor, and use the clean Markdown evidence layer as input to RAG when scale or production retrieval eventually requires it.

## From Sources To Durable Knowledge

```text
Webpages / PDFs / notes / images / external platforms
                         |
                         v
                 raw evidence layer
             originals, metadata, images
                         |
                    AI agent
             distill, link, check, repair
                         |
                         v
                 atomic wiki pages
           concepts, methods, APIs, entities
                         |
               +---------+---------+
               v                   v
        grounded answers     knowledge graph
```

My Wiki does not merely create one summary per document. A useful source can update many durable wiki pages, while one wiki page can draw evidence from many sources. A raw item is only considered processed after its wiki targets exist, the evidence links close in both directions, and follow-up flags are resolved.

## Explore The Knowledge Universe

<img width="1895" height="936" alt="My Wiki interactive knowledge universes and vault overview" src=".github/assets/knowledge-universe.png" />

The optional local frontend is more than a folder graph:

- zoom out to see multiple knowledge universes and where shared wiki concepts connect them;
- enter one universe to rotate and inspect its three-dimensional wiki network;
- select a wiki node to highlight meaningful relationships and read the rendered page;
- enter the evidence layer to see every raw source supporting that wiki page;
- search without permanently hiding the rest of the graph;
- let the running watcher refresh the graph automatically as knowledge changes.

The Dashboard stays off during ordinary capture and maintenance. It starts only when you ask to see the graph or frontend.

## Install By Asking Your Agent

Requirements: Node.js 18+ and a local AI agent that can load Skills or run local scripts. Copy this prompt into your agent:

```text
Install the My Wiki Skill from https://github.com/NimaChu/my-wiki-skill.
The installable Skill is the `my-wiki/` subdirectory. Use your native Skill installer
or a GitHub subdirectory download to install only that directory as `my-wiki` in your
local Skills folder. Do not clone or retain the whole repository, and do not include any
generated runtime files in the installed copy. Verify that `SKILL.md` and
`scripts/my-wiki.mjs` exist, then tell me the installed path and whether
the agent host needs to be restarted. Do not modify or delete any existing knowledge vault.
```

Codex's native Skill installer downloads the public `my-wiki/` subdirectory directly and falls back to Git sparse checkout only when necessary. Other Skill-capable agents can use the equivalent subdirectory installation workflow.

A normal `git clone` downloads every public tracked file in the repository, including both READMEs, the license, Zenodo metadata, and GitHub image assets. It still does **not** download anyone's private vault, local MCP configuration, paper folder, workspace rules, or source-only tests because those files are not part of the public repository. The prompt above is the cleaner choice for ordinary users.

After installation, speak naturally:

```text
Create a My Wiki vault in D:\Knowledge\Personal and use it by default.
Save this webpage to my knowledge base: https://example.com/article
Maintain the knowledge base.
Answer this question from my local knowledge and show the relevant evidence images.
Open the knowledge graph.
```

You do not need to memorize the CLI. The Skill resolves the selected vault and runs the capture, maintenance, search, image, and visualization workflows for the agent.

## What You Can Do

### Capture without losing the source

Store webpages, PDFs, transcripts, long notes, and external-platform exports in `raw/`. Preserve titles, URLs, dates, content hashes, snapshots, image order, and source quality instead of keeping only an AI summary.

### Let the wiki improve over time

Ask the agent to maintain the knowledge base. It processes a coherent batch, creates or updates atomic pages, merges duplicates, repairs evidence links, keeps the number of universes small, and reports what remains.

### Ask grounded questions

The agent searches synthesized wiki pages first and follows links back to raw evidence when a claim needs verification. Relevant screenshots, diagrams, charts, or UI states can accompany the answer instead of being forgotten in an attachment folder.

### Keep several independent vaults

Personal, work, research, and project vaults can live anywhere on the computer. Install the Skill once, register each vault by name, and keep their knowledge completely separate from this source repository.

## Your Files Stay Yours

Each vault is an ordinary folder:

```text
my-vault/
  raw/          captured evidence, snapshots, and images
  wiki/         durable, linked knowledge pages
  templates/    Markdown templates copied into this vault
  .my-wiki/     local cache and runtime state
```

The public repository contains the Skill, templates, and Dashboard. It does not contain your vault, local MCP credentials, workspace-specific agent rules, or local regression tests. You decide whether a vault is backed up, synced, encrypted, or never leaves one computer.

## Optional, Not Required

- **Obsidian**: use it as an excellent human editor for the same Markdown vault; My Wiki does not depend on it.
- **Firecrawl MCP**: improve capture for rendered or difficult webpages. A keyless hosted endpoint is available with limits; full crawling requires Firecrawl authentication.
- **IMA and other external platforms**: import authorized material into local raw notes first, then maintain it through the same evidence workflow.
- **RAG**: add embeddings and production retrieval later without throwing away the readable source and wiki layers.

## License

My Wiki is released under the [MIT License](LICENSE.txt).
