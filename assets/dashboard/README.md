# My Wiki Frontend

Local-first knowledge workspace for My Wiki. It combines knowledge graph visualization with deterministic vault operations while keeping AI maintenance and question answering available through the user's agent.

## Commands

```bash
npm install
npm run build
```

For normal use, launch through the registered My Wiki project so the selected vault is passed to the graph generator:

```bash
npm run wiki -- --vault personal open-dashboard
```

For frontend development, set `MY_WIKI_VAULT` before running `npm run graph` and `npm run dev` in this directory. The standalone graph command writes the ignored `public/wiki-graph.json` development artifact. The running service keeps each Vault graph private under `.my-wiki/dashboard-graph.json` and serves it through the authenticated `/api/v1/graph` endpoint.
Navigation, maintenance, template, README, and archive files are intentionally excluded from the graph so the visual surface focuses on knowledge nodes and source evidence.

The frontend reads that JSON and displays an Obsidian-like graph surface:

- knowledge-universe, knowledge-galaxy, and local graph browsing
- wiki-only Knowledge view by default
- Evidence drill-down for one wiki page and its directly linked raw sources
- built-in GFM reader/editor for Wiki and raw nodes, opened by double-clicking them in the Evidence layer
- authenticated local image rendering, protected frontmatter, and version-checked atomic Markdown saves
- mouse-wheel zoom on the graph surface
- search scoped to the current graph layer or universe
- grouped corpus labels for large documentation imports
- selected-node links, backlinks, tags, and status
- raw/concepts/link counts
- inbox, processed, broken-link, and universe-level counts
- webpage and local-file capture directly into Inbox
- Inbox and needs-followup inspection without starting maintenance
- local PDF/image OCR, DOCX/PPTX/XLSX conversion, folder batches, and Markdown-plus-images ZIP bundles
- knowledge-galaxy package export, download, import preview, and confirmed import
- bounded maintenance-queue batches through an authenticated local agent
- persistent Viki knowledge Q&A in a remembered, user-resizable 4:3 panel with independent Agent CLI and bundled pet selectors, validated evidence, and local images

The local service binds only to `127.0.0.1` by default. Browser writes require a same-origin session token, URL capture rejects local/private networks, uploads are streamed with a size limit, ZIP bundles reject unsafe paths and oversized expansion, and universe imports preserve preview/checksum/conflict behavior. The Markdown workspace reads and saves only files under `concepts/` or `references/sources/`, serves local images only from `references/assets/` or image originals, preserves frontmatter exactly, and rejects stale saves with HTTP 409. Web capture creates an OKF `Reference` with `status: stable` and `workflow_status: inbox`. Failed or incomplete extraction changes only `workflow_status` to `needs-followup` with explicit reasons. The maintenance button repeats evidence gates and sends valid `inbox` or `stale` References to the Agent. Viki remains read-only and only validated local image paths can be shown in the browser.

## GitHub-only public access

Create a GitHub OAuth App with callback `https://your-host/auth/github/callback`. The origin still binds to loopback; `cloudflared` connects to it locally. Store OAuth credentials in a mode-`0600` JSON file:

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "sessionSecret": "a-long-random-secret"
}
```

Required service environment variables:

```bash
MY_WIKI_DASHBOARD_PUBLIC_HOSTS=my-wiki.cloud
MY_WIKI_DASHBOARD_ORIGINS=https://my-wiki.cloud
MY_WIKI_ADMIN_GITHUB_LOGIN=your-github-login
MY_WIKI_GITHUB_OAUTH_CONFIG=/Users/you/.config/my-wiki/github-oauth.json
```

Public requests receive only the GitHub login page until OAuth succeeds. OAuth `state` is signed, and the authorized GitHub login is recorded in a signed, `HttpOnly`, `Secure`, `SameSite=Lax` session cookie. Access requires membership in the GitHub allowlist, initially seeded with `MY_WIKI_ADMIN_GITHUB_LOGIN`. Only that owner or the trusted local Dashboard can manage the list using the shield button. The owner cannot be removed. The list is stored in `github-allowlist.json` beside the external OAuth configuration; preserve it across updates and never commit it. Removal blocks subsequent browser and CLI requests. Every member uses the same `MY_WIKI_VAULT` as the local Dashboard. Requests through `127.0.0.1` continue to open the same Dashboard without the login gate.

### Remote Skill API

The same configuration enables `/auth/cli` and `/api/remote/v1/`. CLI login opens GitHub in the browser, then returns a one-use authorization code to an exact loopback callback. S256 PKCE and client state bind the exchange to the initiating CLI. No GitHub PAT or browser cookie needs to be copied. The OAuth App callback stays `/auth/github/callback`; no GitHub App changes are required.

Device credentials last 90 days. Only hashed identifiers and metadata are stored under `remote-devices/` beside the OAuth config file, with restricted file permissions; preserve this external directory across service updates. `remote devices`, `remote revoke <id>`, and `remote logout` manage authorization. Members manage only their own devices; the owner can revoke any device. There is no public registration or separate vault creation.

The remote namespace uses bearer authentication independently of Dashboard session tokens and an explicit operation allowlist. It supports scoped search, document reading/body editing with version checks, Reference original/asset downloads, file-upload chunks, URL capture, and task status. It does not expose Agent execution, server configuration, galaxy deletion, or complete maintenance commits. Search defaults to visible galaxies; exact-path reads and explicitly selecting hidden galaxies remain available to authorized members.

Use `NODE_ENV=production` and build the Dashboard before restarting a long-running public service. Keep the origin on loopback and route HTTPS through the authenticated service. Remote API authentication remains mandatory even for loopback requests.
