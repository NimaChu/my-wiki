# Viki Execution Transports

Viki has one answer-job protocol and two streaming execution paths. Repair and
distillation remain on the existing CLI task lane and cannot select the API agent.
The existing Codex, Qoder and Claude answer paths still deliver completed answers.

| Path | Runtime | Retrieval | Configuration |
| --- | --- | --- | --- |
| OpenCode Server | A temporary, password-protected loopback `opencode serve` process per question | My Wiki's private stdio MCP read tools, using a scoped snapshot | Existing OpenCode login, providers and models |
| DeepSeek API | A bounded tool loop inside the My Wiki service; no Agent CLI process | My Wiki keyword retrieval, paginated document reading and image inspection | Private server-side DeepSeek API key |

The API path is an agent, not a single prompt containing the entire vault. It
prefetches up to three relevant documents, then allows up to three additional
tool rounds before a separate final answer round. That completion receives the
original question/context, retrieved results and inspected images, but no tools,
tool-call transcript or reasoning trace. It uses native JSON output mode. Valid
answers produced earlier in the retrieval phase still finish immediately. Search uses MiniSearch with Chinese word
segmentation, title/alias weighting, and at most 24,000 indexed characters per
document. Long documents can be read in pages. This is not semantic/vector search;
synonyms, deeply buried passages and complex investigations may need more retrieval
work than this initial bounded path supports.

## Private API Configuration

Set `DEEPSEEK_API_KEY` in the service environment, or create a private JSON file:

```json
{
  "deepseek": {
    "apiKey": "YOUR_PRIVATE_KEY",
    "model": "deepseek-flash",
    "reasoningEffort": "high"
  }
}
```

The default file is `~/.config/my-wiki/providers.json` (or under
`XDG_CONFIG_HOME`). `MY_WIKI_PROVIDERS_FILE` can select another location outside
the application repository and vault. Restrict the directory/file to the server
user, for example modes `0700`/`0600` on Unix or equivalent Windows ACLs. Do not
commit this file, bundle it with a galaxy, or put a key in browser storage.

The API option appears when a key is configured. Configuration presence does not
prove a valid key or sufficient balance; the actual request reports authentication,
balance and rate-limit errors. Keys are never returned by the provider catalog.
Models currently exposed are `deepseek-flash` (text and image input) and
`deepseek-v4-pro` (text input). The server uses high thinking by default; `low`,
`high` and `max` are accepted private configuration values.

Use **Settings > API configuration** to update the supported DeepSeek connection,
default model and reasoning effort. Only the server owner (or a local user) can
manage this configuration; keys are write-only through the browser and stored in
the private server configuration file. A blank key keeps the saved key. Keys
provided by the service environment cannot be replaced or removed in the UI.

Use **Settings > Viki settings** to select **API > DeepSeek API** or
**CLI > OpenCode Server / Codex / ...**. Viki's chat toolbar only selects the
model for that configured service or tool, directly from a menu of actual model
names without a separate default-model entry. Both compact and full-screen chat
keep galaxy scope, web search and model selection inside the composer. Existing
default selections resolve to the configured provider's actual default model.
OpenCode still uses the Server
streaming transport. Existing selections are preserved; configuring an API does
not select it automatically. Unavailable saved services are not silently replaced.

**Settings > Repair agent settings** and **Settings > Distillation agent settings**
each select a CLI and model. The maintenance queue no longer has inline settings.
Preferences persist server-side, with browser caching for compatibility. Partial
updates preserve the other tools, models and task settings. Changing settings
during a question or maintenance task applies only to subsequent tasks.

Direct API calls send the question, bounded conversation context, selected
evidence and any explicitly inspected image to DeepSeek, with normal API billing.
This removes the CLI runtime, not the cloud model or its data-processing boundary.

## Streaming And Lifecycle

1. `POST /api/v1/agent/ask` creates an authenticated, vault-scoped answer job.
2. `GET /api/v1/jobs/:id/events` streams snapshots, text deltas, resets, phase
   updates and completion, with heartbeats. It uses the existing session-token,
   same-origin and remote-authorization checks.
3. Only decoded `answerMarkdown` text is rendered provisionally. Reasoning traces,
   tool arguments and credential-bearing logs are not shown.
4. The completed JSON answer is formatted for display. There is no final evidence
   gate, citation/file-existence audit or forced answer replacement. Safe URL/path
   formatting, secret redaction and Markdown rendering remain. Citations and
   images are model-provided, not certified by My Wiki; copying and exports use
   the actual answer. File serving and image downloads retain their access checks.

This is real model output, not a simulated typing effect. Initial reasoning and
retrieval can still take several seconds before the first visible character.
Both streaming paths have an eight-minute total deadline and no 90-second
silence timeout. Pause cancels the matching upstream job; partial visible text is
retained as incomplete and excluded from future model context. There is no
automatic paid retry of failed HTTP requests, disconnected streams, output-limit
errors, cancellation or timeouts. A completed but malformed/empty API answer is
finalized from the existing evidence; if that tool-free JSON completion is also
malformed, it gets at most one additional completion attempt. No retrieval is
repeated and no leaked tool markup is executed. This bounded format recovery can
incur an extra API charge (at most five requests per question). Metrics include
`finalizationAttempts`; terminal errors name DeepSeek API rather than a local CLI.
Failed turns retain the reported error beside the incomplete answer, including
after a page reload. Dangling captured-source footnotes are omitted from displayed
and finalized answers; the model supplies citations separately in its sources list.

Refreshing the browser reattaches to the same job and its current snapshot; a
temporary stream disconnect does not submit the question again. Jobs survive a
page reload, not a My Wiki backend restart. Completed conversation history remains
browser-local. Each completed answer includes a server-signed context receipt
bound to its question, answer, conversation, selected galaxies, document allowlist
and web-search setting. Only matching receipts enter subsequent model context.
Old or mismatched messages remain visible but are not reused as model context.
The private signing key lives at `.my-wiki/viki-context.key` and survives service
restarts; no chat transcript is stored there. The OpenCode process/session is cleaned up on completion, error or
cancellation. API turns do not leave a terminal or Agent CLI running.

`MY_WIKI_OPENCODE_STREAM=0` in the service environment is an emergency rollback
to the previous OpenCode CLI completed-answer path.

## Knowledge And Web Boundaries

- There is no greeting classifier or evidence-count requirement. The agent decides
  when retrieval is useful and how to explain missing evidence. Answers may use
  general background, clearly distinguished from knowledge actually read.
- Both paths enforce selected galaxy scope at retrieval, not after generation.
  Hidden galaxies are absent from Viki's picker and rejected even in explicit
  requests from stale pages. Native reads require membership in that scope and a resolved path
  inside the vault. Symlink aliases are rejected before indexing and again when
  reading. The native agent has no shell, file-write or maintenance tool.
- All CLI query paths receive a temporary snapshot, even with all galaxies selected;
  originals, runtime state, other conversations and unselected documents are not
  copied. Only referenced images are included. The private stdio MCP adapter uses
  the same read/path checks as the API and includes search, paginated listing,
  document reading and image inspection. It is started automatically, not installed
  globally or exposed as a public MCP endpoint.
- CLI queries disable general file/shell/browser tools and unrelated MCP tools.
  OpenCode uses a dedicated deny-by-default agent. Codex ignores user execution
  configuration/rules and disables native tools, plugins, host skills and memory,
  while retaining its login. Qoder/Claude use an empty native tool set and a strict
  MCP configuration. Unsupported CLI flags fail the request rather than falling
  back to unrestricted reads. Repair and distillation retain their existing tools.
- Galaxy selection restricts local knowledge, not public web evidence. With web
  search enabled, missing local evidence should trigger web retrieval; a web-only
  answer can use public sources. The service does not replace a response because
  the model omitted or invented a citation. Hidden private knowledge is excluded
  from inputs; galaxy hiding cannot remove facts already in a model's training
  data or available on the public web.
- Native image inspection is limited to PNG/JPEG/WebP files under
  `references/assets/` or `references/originals/`, referenced by inspected
  evidence, at most 4 MiB each. It is enabled only for the image-capable model.
- With web search off, the native agent has no web tools. With it on, public
  search uses Exa's web-search MCP endpoint, and page reading validates public
  HTTP(S) targets, redirect destinations and DNS results. Private/loopback
  networks, credentials in URLs and oversized/non-text responses are rejected.
- Web results and document contents are untrusted evidence, not instructions.
  Search requires network availability and can hit upstream service limits.
  Web-image output can reference safely formatted public image URLs; visual
  inspection in this first version is for local evidence images.

## Reproducible Comparison

```bash
node scripts/benchmarks/viki-transports.mjs --repeats 2 --output /private/path/viki-benchmark
```

This makes **20 billable model requests** by default: five scenarios, two paths,
two repetitions. Configure both paths first. The harness supplies the same
DeepSeek API credential to OpenCode for the test only, uses `deepseek-flash`,
disables web search, alternates order, and creates a temporary synthetic vault.
It never replaces the user's vault or their OpenCode credentials.

Scenarios cover current versus superseded facts, a cross-document table, numbers
present only in an image, out-of-scope knowledge, and a multi-turn follow-up.
Results include full answers, citations, images, first-text and total latency,
tool calls and per-provider usage metadata. Keyword checks are not a complete
quality score; review the answers against the fixture. Usage fields differ by
provider, so do not derive a cost comparison by naively comparing token totals.

The output must stay outside the repository and vault, especially for any
supplemental evaluation involving private knowledge. This is an end-to-end
architecture comparison, including startup, retrieval and validation, not an
isolated HTTP-versus-CLI benchmark. Small repeated samples establish observed
behavior, not universal quality or latency guarantees.

## Upstream References

- [OpenCode Server](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [DeepSeek tool calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls/)
- [DeepSeek thinking mode](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)
- [Exa MCP](https://exa.ai/docs/reference/exa-mcp)
