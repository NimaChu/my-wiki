# my-wiki-skill npm installer

This directory contains the public `npx my-wiki-skill` installer source.

The npm package ships only:

- `npm-dist/install.mjs`
- the clean `my-wiki/` Skill directory
- the MIT license and bilingual package documentation

The installer detects the standard Skill roots used by Claude Code, Codex, OpenCode, OpenClaw, Hermes Agent, and the shared Agent Skills convention. It installs or updates `my-wiki` atomically and preserves existing Dashboard dependencies.

Use `--target <agent>` for an explicit supported host, `--dir <skills-root>` for any other `SKILL.md`-compatible Agent, and `--list` to inspect detected destinations.
