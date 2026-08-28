# My Wiki

![GitHub stars](https://img.shields.io/github/stars/NimaChu/my-wiki?style=flat-square)
![npm version](https://img.shields.io/npm/v/my-wiki-skill?style=flat-square)
![npm downloads](https://img.shields.io/npm/dm/my-wiki-skill?style=flat-square)
![Agent Skill](https://img.shields.io/badge/Agent-Skill-111111?style=flat-square)
![Local First](https://img.shields.io/badge/Local-First-2E7D32?style=flat-square)
![Markdown](https://img.shields.io/badge/Knowledge-Markdown-1565C0?style=flat-square)
![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-43853D?style=flat-square)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE.txt)

**My Wiki is a local-first knowledge project that an AI agent can use directly. The project provides the CLI, visual knowledge universe, maintenance workflows, and grounded Viki Q&A. A separate lightweight Skill adapter lets agents in other workspaces call an installed project.**

[简体中文](README.md) · [English](README.en.md)

<img width="1536" height="1024" alt="An AI agent organizing local sources into an evidence-backed knowledge base" src="https://github.com/user-attachments/assets/bea713c3-8d37-427b-ab04-5f601123f252" />

Useful knowledge is scattered across webpages, PDFs, scans, images, Office documents, conversations, and reference manuals. Saving those files is easy. Keeping them organized, connected, verifiable, and reusable over time is much harder.

My Wiki gives a local AI agent responsibility for the whole knowledge lifecycle: preserve References and originals, extract readable content, distill atomic Concepts, maintain relationships and evidence links, answer questions, repair the knowledge base, and present it through an interactive web application.

No hosted database, vector database, Obsidian installation, or paid API is required by default. Knowledge stays in Markdown, snapshots, original files, and images inside folders you control.

## Project And Skill Are Separate

The runnable My Wiki application lives at the repository root. Open the repository as an Agent workspace and the Agent can follow `AGENTS.md` to use the CLI, Dashboard, tests, and container deployment without installing a Skill first.

`my-wiki-skill/` is an optional adapter shipped as part of the project. It can be installed independently into Codex, Claude Code, OpenCode, and other clients, but it contains no application or Dashboard code. If the project or local vault is missing, the Agent first asks for confirmation, then installs the project and initializes a separate vault on the user's behalf.

```text
my-wiki/
  AGENTS.md          entry instructions when an Agent opens the project
  scripts/           CLI and knowledge-maintenance application
  assets/dashboard/  web application and local service
  deploy/            standalone deployment options
  tests/             project tests
  my-wiki-skill/     independently installable Agent adapter
```

| Entry point | Global Skill required | Project required | How it works |
|---|---:|---:|---|
| Open the `my-wiki` project in Codex/OpenCode | No | Yes | The Agent reads root `AGENTS.md` and the bundled workflow docs |
| Dashboard, Viki, and web maintenance | No | Yes | The backend invokes an authenticated local Agent CLI directly |
| Call My Wiki from a vault or another project | Yes | Yes | The Skill discovers or, after confirmation, provisions the project and vault |

The global Skill is not a runtime dependency of the Dashboard or CLI. Users who always work inside the My Wiki project do not need to install it globally for Codex or OpenCode.

My Wiki provides two interfaces over the same local knowledge vault:

| | Agent Project / Optional Skill | Knowledge Universe Web App |
|---|---|---|
| Best for | Conversational work inside Codex, Claude Code, OpenCode, and similar clients | Visual exploration, comparison, maintenance, and direct knowledge operations |
| Main interaction | Ask the agent to capture, maintain, search, and answer | Browse graphs, upload sources, process the queue, and ask Viki |
| Knowledge surface | Concepts, References, images, originals, and local files | Knowledge universe, galaxies, Concept planets, and Reference evidence views |
| Agent execution | Uses the current Agent client and its tools | Calls an authenticated local Codex, OpenCode, Qoder, or Claude CLI |
| Data location | A local vault at any path you choose | The same local vault |

Use either interface on its own or move between chat and the browser whenever useful. There is no second database to synchronize.

## Three Ways To Use My Wiki

### 1. Open The Project As An Agent Workspace

Clone and register the project, open its directory in Codex, Claude Code, OpenCode, or another Agent, then speak naturally:

```text
Create a My Wiki vault at D:\Knowledge\Personal and make it the default.
Save this article to my knowledge base: https://example.com/article
Capture this PDF and preserve its important images.
Maintain the knowledge base.
Answer this question from my local knowledge and show the relevant evidence images.
```

The agent resolves the active vault, preserves References, originals, and attachments, creates or updates atomic Concepts, maintains reciprocal links, and answers from Concepts while following evidence back to References when verification matters. You do not need to memorize a separate CLI.

### 2. Use The Skill From Another Workspace

Install `my-wiki-skill/` when an Agent working elsewhere should call the same My Wiki application and local vault. The Skill provides workflow guidance, project discovery, and confirmed provisioning. Missing project or vault layers are created only after user approval and never embedded inside the Skill directory.

### 3. Open The Knowledge Universe Web App

Tell the agent:

```text
Open the knowledge universe.
Open the My Wiki frontend.
Open the knowledge graph.
```

The agent starts the local web application. From there you can:

- see the full knowledge universe, its galaxies, and where they intersect;
- enter one galaxy and inspect its Concept network; hidden galaxies are excluded from both the universe and overview totals;
- read a Concept and drill into every Reference supporting it;
- search Concepts, relationships, and sources without losing the current graph level;
- open a Concept or Reference in the built-in Markdown workspace with rendered reading, source editing, live rendered editing, tables, formulas, and local image insertion;
- enter a webpage URL or upload files, folders, and Markdown-plus-images ZIP bundles;
- see uploads immediately in one processing queue with extraction progress and failures, then independently repair or distill each Reference; extraction and Agent maintenance use separate two-task lanes;
- ask Viki questions grounded in selected knowledge galaxies, References, and useful images, with optional web search and visible citations;
- keep multiple local Viki conversations, pause a request, use a full-screen chat, copy an answer, or export a conversation as Markdown, an image ZIP, or a quick note;
- create, import, edit, delete, and optionally capture local Markdown or image-ZIP quick notes;
- add, rename, hide, export, import, or delete a knowledge galaxy. Deletion first moves a complete package into `.my-wiki/trash/galaxies/`, where it can be restored or permanently removed without deleting shared knowledge or creating an `Uncategorized` galaxy.

The frontend binds to `127.0.0.1` by default. Routine capture and maintenance through an Agent do not start it. It opens only when you explicitly ask for the knowledge universe, frontend, graph, or Dashboard. For an isolated public demo, use the [Apple Container deployment](deploy/apple-container/README.md) behind a Cloudflare Tunnel.

## From Sources To Reusable Knowledge

```text
Webpages / PDFs / scans / images / Office files / external platforms
                              |
                              v
                      Reference evidence layer
                    originals, images, metadata
                              |
                          AI agent
                  distill, link, verify, repair
                              |
                              v
                       atomic Concepts
                 concepts, methods, APIs, entities
                              |
               +--------------+--------------+
               v                             v
         grounded answers            knowledge universe
```

My Wiki does not create one disposable summary per document. One Reference can update several durable Concepts, and one Concept can synthesize evidence from many References. A Reference's `workflow_status` becomes `processed` only after useful Concept targets exist, reciprocal evidence links close, and follow-up work is resolved.

That structure makes knowledge reusable. A Reference captured today can improve an existing Concept, a question tomorrow can reuse it, and important claims still lead back to the original text, image, or PDF.

## Explore The Knowledge Universe

<img width="1785" height="881" alt="My Wiki knowledge universe, knowledge galaxies, and Concept planets" src="https://raw.githubusercontent.com/NimaChu/my-wiki/main/.github/assets/knowledge-universe.png" />

- **Knowledge universe**: the global vault view, showing multiple galaxies and the shared Concepts that connect them.
- **Knowledge galaxy**: a coherent body of knowledge that can be understood and reused as a unit, such as FlexSim, Agent Development, or project experience.
- **Concept planet**: one atomic Concept describing a concept, method, entity, process, or durable conclusion.
- **Reference evidence layer**: the webpages, Markdown, PDFs, images, and other References supporting a Concept.

The graph is not a second database. It is generated directly from Concept and Reference relationships, and a running frontend refreshes as the vault changes.

## Share And Reuse Knowledge Galaxies

A knowledge galaxy can be exported as one `.mywiki` package. It is not merely a set of summaries. It is an evidence-backed knowledge collection containing:

- the galaxy's Concept Markdown;
- Reference Markdown linked by those Concepts;
- available source URLs;
- related images and image indexes;
- webpage snapshots, PDFs, and other originals explicitly referenced by those References.

Recipients preview duplicates, renames, and conflicts before confirming an import into their own knowledge universe. Evidence remains complete even when an original source, such as a local PDF, has no URL.

Import and export from the web app, or ask an agent:

```text
Export the "FlexSim" knowledge galaxy as a knowledge package.
Preview importing this flexsim.mywiki package.
Import it and rename the galaxy to "Simulation Engineering".
```

This lets My Wiki support a broader knowledge ecosystem: coherent knowledge can be shared, inspected, verified, extended, and maintained by another user's agent.

### Open Knowledge Format v0.2

Concepts use Markdown consumable by [Google Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format): standard YAML frontmatter, the `draft | stable | deprecated` lifecycle, structured sources, Markdown relationship links, and source-ID evidence footnotes. Galaxies and My Wiki's evidence-closure fields remain valid extension keys; successful distillation is never presented as human verification.

```bash
# Audit the current vault for OKF v0.2 compatibility
npm run wiki -- okf-audit

# Preview or apply migration of legacy knowledge pages
npm run wiki -- okf-migrate
npm run wiki -- okf-migrate --apply

# Export all knowledge or one galaxy as an OKF directory bundle
npm run wiki -- export-okf
npm run wiki -- export-okf --galaxy "AI" --output /path/to/ai-okf
```

A `.mywiki` file is an audited, portable galaxy package with the native `index.md`, `log.md`, `concepts/`, and `references/` layout. Generic OKF consumers can read the unpacked knowledge; My Wiki additionally restores workflow state, checksums, evidence closure, and conflict handling.

## Why My Wiki

- **Local first**: Markdown, originals, webpage snapshots, and images stay in folders you control.
- **Agent maintained**: short natural-language requests drive capture, distillation, linking, checks, and repairs.
- **Evidence backed**: Concept conclusions link to References, including useful images and original files.
- **Designed for reuse**: sources become atomic Concepts and relationships instead of disappearing into a retrieval black box.
- **An operational web app**: add sources, process maintenance queues, ask Viki, and exchange knowledge galaxies, not just view a graph.
- **Broad local-document support**: text PDFs, scanned PDFs, images, DOCX, PPTX, XLSX, folder batches, and ZIP bundles.
- **Quality-aware document extraction**: My Wiki owns one document IR and page-level acceptance gate; MinerU handles Chinese technical PDFs, Docling contributes structure and provenance, and a configured multimodal Agent CLI can repair only the pages identified by deterministic checks.
- **Failure stays visible**: empty, partial, unsupported, or low-confidence extraction is locked as `needs-followup` instead of pretending capture succeeded.
- **Portable by design**: move or back up the vault, open it in any Markdown editor, or connect Obsidian and RAG later.
- **Zero-cost starting point**: begin with Node.js and an available local Agent client rather than a cloud infrastructure stack.

## My Wiki, RAG, Or LLM + Obsidian?

My Wiki focuses on the organization layer before retrieval: turning source material into readable, connected, verifiable, and maintainable knowledge.

| | My Wiki | Traditional RAG | LLM + Obsidian |
|---|---|---|---|
| Getting started | Clone the Agent project and create a separate local vault; install the Skill only when useful | Build chunking, embeddings, retrieval, storage, and services | Install an editor and plugins, then define prompts and note conventions |
| Main storage | Markdown, originals, snapshots, and local images | Vector index plus an external source store | Markdown vault |
| Who organizes it | The agent maintains References, atomic Concepts, links, and health | The pipeline indexes chunks; readable synthesis is usually separate | Usually the user, with LLM assistance |
| Traceability | Concept and Reference links are reciprocal and automatically checkable | Depends on retrieval metadata and application design | Possible, but depends on user discipline |
| Web experience | Built-in universe, capture, maintenance, Viki, and package exchange | Usually requires a separately developed application | Primarily editor-based browsing and plugins |
| Shareable unit | A galaxy containing Concepts, References, images, and originals | An index or application-specific dataset | A folder or whole vault |
| Best fit | Long-term personal, team, and project knowledge management | Large-scale semantic retrieval and production services | Hands-on writing, linking, and note browsing |

My Wiki does not oppose RAG or Obsidian. Open the same vault in Obsidian whenever useful, and feed its clean Concepts and References into RAG when scale actually requires it.

## Quick Start

Requires Node.js 18+ and npm. Install and register the runnable project first:

```bash
git clone https://github.com/NimaChu/my-wiki.git
cd my-wiki
npm run setup
npm run wiki -- init /path/to/my-vault --name personal --use
```

You can now open the `my-wiki` directory directly as an Agent workspace or run the project CLI:

```bash
npm run wiki -- status
npm run dashboard:open
```

Install the lightweight Skill only when another workspace should call My Wiki:

```bash
npm run skill:install
# Or install the published Skill adapter
npx my-wiki-skill@latest
```

`npm run setup:all` registers the current project and installs the bundled Skill in one step. Networks using npmmirror can install the published adapter with `npx --registry=https://registry.npmmirror.com my-wiki-skill@latest`.

The installer detects common Agent Skill roots:

| Agent client | Default Skill root | Installer support |
|---|---|---|
| Claude Code | `~/.claude/skills` | Auto-detect or `--target claude` |
| Codex | `~/.codex/skills` | Auto-detect or `--target codex` |
| OpenCode | `~/.config/opencode/skills` | Auto-detect or `--target opencode` |
| OpenClaw | `~/.openclaw/workspace/skills` | Auto-detect or `--target openclaw` |
| Hermes Agent | `~/.hermes/skills` | Auto-detect or `--target hermes` |
| Other `SKILL.md`-compatible agents | Host-defined | Use `--dir <skills-root>` |

After installing the Skill, open or refresh the Agent session. The adapter calls the registered project; if the project or default vault is missing, it asks for confirmation before installing or initializing it and never writes knowledge into the Skill or source repository.

## Local Vault Structure

The vault can live anywhere on the computer and remains separate from both the runnable project and the installed Skill:

```text
my-vault/
  index.md                 OKF knowledge entry point
  log.md                   OKF update log
  concepts/                durable atomic Concept pages
  references/
    sources/               source evidence as Markdown References
    assets/                source images and image indexes
    originals/             webpage snapshots, PDFs, Office files, and originals
  templates/               Markdown templates used by this vault
  .my-wiki/                local cache, runtime state, and package records
```

`Concept.status` and `Reference.status` use the OKF lifecycle `draft | stable | deprecated`. My Wiki tracks maintenance separately with `workflow_status: inbox | needs-followup | processed | stale` on References.

The web app and Agent capture use the same extraction quality gate. Text PDFs are extracted page by page, scans and images use local OCR, and DOCX, PPTX, and XLSX become structured Markdown. Every original remains in `references/originals/`.

The code repository and npm Skill package contain no personal vault, MCP credentials, or runtime logs. You decide whether a vault is backed up, synchronized, encrypted, or kept on one machine.

## Optional Capabilities

- **Obsidian**: use it as a human editor for the same Markdown vault; My Wiki does not depend on it.
- **Firecrawl MCP**: improve capture for rendered or difficult webpages; full hosted crawling may require Firecrawl authentication.
- **IMA and other external platforms**: after user confirmation and authorization, migrate material into local References before using the same maintenance workflow.
- **RAG**: add embeddings and production retrieval later without discarding the readable Concept and Reference layers.

## License

My Wiki source code is released under the [MIT License](LICENSE.txt). Bundled Dashboard pet assets retain their own attribution and license terms; see the [pet asset notice](assets/dashboard/pets/NOTICE.md).
