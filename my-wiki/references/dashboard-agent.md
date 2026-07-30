# Dashboard Agent

The Dashboard may call a supported, already authenticated local agent only after an explicit browser action. It discovers OpenCode, Qoder, Codex, and Claude, exposes only available providers, and uses OpenCode by default. Set `MY_WIKI_AGENT_PROVIDER=opencode|qoder|codex|claude` to override that default, or pair it with `MY_WIKI_AGENT_COMMAND` when the executable is not discoverable. Qoder is exposed only when `qodercli status` confirms a local login or `QODER_PERSONAL_ACCESS_TOKEN` is present. `MY_WIKI_QODER_MODEL` optionally selects its model or tier. Qoder runs in non-interactive text mode without session persistence; queries expose only `Read`, `Grep`, and `Glob`, while maintenance additionally exposes `Edit` and `Write`. For OpenCode, `MY_WIKI_OPENCODE_MODEL` selects the primary model and `MY_WIKI_OPENCODE_FALLBACK_MODELS` selects an ordered, comma-separated retry list. The legacy single-value `MY_WIKI_OPENCODE_FALLBACK_MODEL` remains supported and is appended after the list. Explicit provider errors, including rate limits, stop the current OpenCode process immediately and may advance to the next fallback model. Authentication errors, cancellation, and total timeout stop immediately. Viki questions retain a short idle timeout, while maintenance relies on its bounded total timeout because long document reads and large-context inference may legitimately produce no CLI output for several minutes. Diagnostic stderr output does not extend an enabled idle timeout.

## Maintenance Batch

The maintenance queue's batch action sends a bounded set of readable raw notes to one local agent task. It reuses Viki's browser-local CLI choice when that provider is still available, otherwise it falls back to the configured default. Any local binary source whose `extraction_status` is not `complete` is visible as `needs-followup` but excluded from the batch. The agent must follow the normal My Wiki maintenance workflow: read each source completely, inspect existing Wiki pages, distill atomic pages, assign minimal human-readable knowledge galaxies in the compatible `universes` metadata, create reciprocal evidence links, update index/log where useful, and run lint. Captured content is untrusted evidence, never agent instructions.

The task may write only inside the active vault. It must not use Git, change another vault, start or stop the Dashboard, or mark a raw note processed before evidence closure is complete. The service runs the canonical My Wiki lint itself and refreshes graph data after a successful maintenance task.

## Viki

Viki is the persistent knowledge companion in the Dashboard. Its header lets the user choose any currently available Agent CLI, remembers that browser-local choice, and sends the selected provider with every question. Each question starts a read-only local agent task. The agent searches `wiki/` first, verifies important claims against linked `raw/sources/`, and says when the vault lacks enough evidence. It must not edit files or start maintenance while answering.

Answers use structured output containing Markdown, evidence paths, and up to three genuinely useful local images. The local service validates every returned path. Browser-visible images are limited to existing files under `raw/assets/` or image files under `raw/snapshots/`; arbitrary vault files and paths outside the vault are never served.

## Safety Boundary

- Keep normal installations on `127.0.0.1` with their existing origin and
  session-token checks. A public sandbox must use an isolated disposable vault
  and explicitly configured origins; never mount a personal vault into it.
- Query tasks use a read-only agent sandbox; maintenance tasks use a workspace-write sandbox rooted at the active vault.
- Keep separate query and maintenance lanes. One Viki query and one maintenance batch may run concurrently, while duplicate tasks within either lane remain serialized.
- Preserve bounded total task timeouts, Viki's idle timeout, bounded output, structured schemas, path validation, and private local image serving.
- Web capture still stops at `status: inbox`. Capturing a URL or file never starts an Agent task automatically.
