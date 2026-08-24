# My Wiki Agent Project

This repository is the runnable My Wiki application. It is neither a knowledge vault nor merely an installed Agent Skill.

## Project Map

- `scripts/` contains the CLI and knowledge-maintenance implementation.
- `assets/dashboard/` contains the web application and local service.
- `deploy/` contains standalone deployment options.
- `tests/` covers application and workflow contracts.
- `my-wiki-skill/SKILL.md` is the canonical Agent playbook for capture, query, maintenance, evidence, galaxies, sharing, and Dashboard operations.
- The user's vault is external to this repository and owns root `index.md`/`log.md`, `concepts/`, `references/`, templates, and `.my-wiki/` runtime state.

The project can run directly with `npm run wiki -- <command>` and does not require a globally installed Skill. The adapter under `my-wiki-skill/` is optional for Agents working from other workspaces.

## Knowledge Model

Use the native OKF terms in explanations and new documentation: a durable knowledge page is a **Concept**, captured evidence is a **Reference**, and the preserved binary or webpage snapshot is an **original**. My Wiki visualizes Concepts as concept planets grouped into knowledge galaxies. Historical command names, internal variables, and package fields may still contain `wiki`, `raw`, or `universe` for compatibility; do not infer the old `wiki/` or `raw/` directories from those identifiers.

## Route Requests

Classify the request before acting:

1. **Knowledge operation:** For capturing sources, answering knowledge questions, searching the vault, maintaining knowledge, inspecting evidence, managing galaxies, importing/exporting, or opening the Dashboard, read `my-wiki-skill/SKILL.md` first and follow the relevant reference it names. Ordinary questions about concepts, people, products, methods, events, companies, or named projects belong to this route unless the user explicitly asks about repository code.
2. **Project development:** For implementation, architecture, tests, bugs, CLI behavior, frontend behavior, or deployment code, work from this repository and preserve its existing engineering patterns.
3. **Installation or bootstrap:** Enter setup only when the user asks to install/configure My Wiki or when the operational playbook reports that the project registration or vault is missing. Follow the README and Skill guidance; do not repeat initialization during normal use.
4. **Repository publishing:** Code may be committed and pushed when requested. Vault knowledge, originals, exports, credentials, and local runtime state must never enter this repository.

Do not use the application source tree as a substitute for searching the vault. Do not duplicate operational workflows in this file; keep their single source of truth in `my-wiki-skill/`.

## Development Checks

- Run `npm test` after backend or workflow changes.
- Run `npm run dashboard:build` after frontend changes.
- Preserve cross-platform Node paths and the Windows dashboard launchers.
- Build Apple Container deployments from the repository root.
