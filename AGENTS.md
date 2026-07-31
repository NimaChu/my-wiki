# My Wiki Agent Project

This repository is the runnable My Wiki application, not a knowledge vault and not merely an Agent Skill.

## First Run

1. Run `npm run setup` to register this checkout as the installed My Wiki project.
2. Run `npm run wiki -- where` to inspect the active vault.
3. If no vault exists, ask the user where their local knowledge should live, then run `npm run wiki -- init /path/to/vault --name personal --use`.
4. Keep vault content outside this repository. Never commit or push a user's `raw/`, `wiki/`, snapshots, assets, exports, or local credentials.

The optional adapter Skill lives in `my-wiki-skill/`. Install it with `npm run skill:install`, or register the project and install the Skill together with `npm run setup:all`. The project itself runs directly through `npm run wiki -- <command>` and does not require the Skill.

## Core Commands

```bash
npm run wiki -- status
npm run wiki -- capture --url "https://example.com" --title "Example"
npm run wiki -- search "query"
npm run wiki -- lint
npm run wiki -- garden
npm run dashboard:open
```

Use an explicit vault with `--vault <name-or-path>`. Read `my-wiki-skill/SKILL.md` and its references for ingestion, maintenance, evidence, universe, and Dashboard behavior.

## Development

- Run `npm test` after backend or workflow changes.
- Run `npm run dashboard:build` after frontend changes.
- The Apple Container deployment is under `deploy/apple-container/` and must use the repository root as its build context.
- Preserve cross-platform Node paths and the Windows dashboard launchers.
