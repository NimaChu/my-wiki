# Firecrawl MCP

Agent Wiki uses Firecrawl through MCP first. This keeps the vault lightweight and lets agents use hosted Firecrawl scrape/search/interact without adding Firecrawl service code or API SDK dependencies to this repository.

## Installed Workspace Config

The root `.mcp.json` points at the hosted keyless MCP endpoint:

```json
{
  "mcpServers": {
    "firecrawl": {
      "type": "http",
      "url": "https://mcp.firecrawl.dev/v2/mcp"
    }
  }
}
```

Keyless hosted MCP supports quick `scrape`, `search`, and `interact` workflows with rate limits. It is enough for many agent research and webpage capture tasks.

## Full Firecrawl Access

Full tools such as `crawl`, `map`, `agent`, and `extract` require Firecrawl auth. When the user has a key, switch the MCP URL to:

```text
https://mcp.firecrawl.dev/{FIRECRAWL_API_KEY}/v2/mcp
```

Do not commit real API keys. Keep authenticated config in the user's local MCP settings when possible.

## Agent Workflow

1. Use Firecrawl MCP to scrape, search, or interact with a page.
2. Review the returned content and select the evidence worth preserving.
3. Ingest into Agent Wiki with the existing capture command:

```bash
npm run wiki:capture -- --title "Source title" --url "https://example.com"
```

For MCP output that is already Markdown, pipe it into `wiki:capture` or save it to a temporary file and pass `--content-file`.

## Boundaries

- MCP output is not the durable source of truth until it is written into `raw/`.
- Do not refresh or start the dashboard after MCP capture unless visualization is requested.
- Respect site terms, robots policy, privacy constraints, and user authorization.
- If Firecrawl tools are not visible in the current Codex thread, reload/open a new thread so the workspace MCP config can be discovered.
