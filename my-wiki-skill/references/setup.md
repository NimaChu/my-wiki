# Local Setup

Before the first operation, run the bridge with `where`. For local mode only, if it reports that the My Wiki project is missing, explain that both components are required and ask the user before cloning or registering the project. The normal local setup is:

```bash
git clone https://github.com/NimaChu/my-wiki.git
cd my-wiki
npm run setup
```

An existing checkout can instead be selected with `MY_WIKI_HOME=/path/to/my-wiki`. Do not silently install, update, or relocate the project.

After the user confirms the project location, the Agent may perform the clone and `npm run setup` on the user's behalf. Then ask where the local vault should live and run `init` for them. A separately installed Skill must therefore be able to guide and complete both missing layers, but only with explicit user confirmation; the Skill package itself remains a small adapter and never embeds either layer.

## Bootstrap Missing Layers

Use this flow only when the bridge reports a missing layer; do not repeat it during normal operations:

1. **Missing project:** Explain that the Skill is an adapter and ask where the user wants the standalone project installed. After confirmation, clone `https://github.com/NimaChu/my-wiki.git` into that location and run `npm run setup` from the cloned repository. Do not overwrite an existing directory or silently choose a different location.
2. **Existing project:** If the user already has a checkout, register it by running `npm run setup` there or set `MY_WIKI_HOME` when they explicitly prefer an environment-only configuration. Never clone a duplicate project merely because it is not registered.
3. **Missing vault:** Rerun `where`. If no vault is configured, ask where local knowledge should live, then run the bridge's `init <path> --name <name> --use`. Keep the vault outside both the project and installed Skill.
4. **Verify:** Run `where` and `status` through the bridge. Continue with the user's original request only after both resolve successfully.

Cloning, registration, and vault creation require user confirmation because they write outside the Skill directory. Reading an existing registration and using an existing vault do not require repeated confirmation.

## Select The Vault

Honor an explicit user path or registered vault name with `--vault <name-or-path>`. Otherwise run `where` and use the configured default:

```bash
node <skill-directory>/scripts/my-wiki.mjs where
```

If no vault is configured, ask the user where to create one, then use `init`. Never create a vault inside the installed Skill or the My Wiki project. A separate vault owns root `index.md`/`log.md`, `concepts/`, `references/`, `templates/`, and `.my-wiki/`.
