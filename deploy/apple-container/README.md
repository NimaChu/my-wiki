# Apple Container public sandbox

This deployment keeps the public writable demo separate from every personal
vault. The image contains only the My Wiki application plus OpenCode and Qoder
CLIs. A named Apple Container volume stores all captures, Wiki edits, imports,
exports, and Viki maintenance results.

## Start

```bash
mkdir -p ~/.my-wiki-demo
cp deploy/apple-container/opencode.env.example ~/.my-wiki-demo/opencode.env
chmod 600 ~/.my-wiki-demo/opencode.env
./deploy/apple-container/start.sh
```

The host publishes only `127.0.0.1:8787`. Put Cloudflare Tunnel in front of that
loopback address instead of opening a router or macOS firewall port.

When macOS uses a localhost HTTP proxy, `start.sh` automatically rewrites that
address to the Apple Container VM gateway for image builds, web capture, and
OpenCode requests. Override detection with `MY_WIKI_CONTAINER_PROXY`.
The script stages only application files under
`~/Library/Caches/my-wiki-container/build-context` before building, because
Apple Container cannot reliably send a BuildKit context from macOS temporary
directories.

An optional seed vault may be placed at `~/.my-wiki-demo/seed`. It is copied into
the named volume only on first boot. Keep real vault content and credentials out
of the repository and image.

To rebuild the container without losing the demo vault, run `start.sh` again. To
discard every public edit and return to a fresh volume:

```bash
./deploy/apple-container/reset-vault.sh
./deploy/apple-container/start.sh
```

Install the login-time container watchdog after the first successful start:

```bash
./deploy/apple-container/install-launch-agent.sh
```

It starts the Apple Container system, starts `my-wiki-demo` when needed, and
waits for the container so launchd can recover it after an exit. It never rebuilds
the image or deletes the named vault volume.

The normal local Dashboard remains loopback-only. Public hosts and HTTPS origins
are enabled solely through deployment environment variables.

The launcher forwards an explicit `MY_WIKI_CONTAINER_PROXY` or shell HTTPS proxy
into the container. When neither is set, it reads the active macOS HTTPS proxy
from `scutil` and maps a loopback proxy to the Apple Container host gateway.

OpenCode uses `MY_WIKI_OPENCODE_PROVIDER` to limit both the model selector and
runtime provider configuration. It uses `MY_WIKI_OPENCODE_MODEL` as its primary
model, while the Viki selector lets users choose another available model for a
request. The container template enables automatic fallback through the
comma-separated `MY_WIKI_OPENCODE_FALLBACK_MODELS` list; the legacy single-value
`MY_WIKI_OPENCODE_FALLBACK_MODEL` is also supported. A manually selected model
is used only for that request and does not enter the automatic fallback chain.
Explicit cancellation, timeout, and authentication failures do not retry.

Qoder CN is optional and is installed in the container from `https://qoder.cn/install`.
Add a dedicated `QODERCN_PERSONAL_ACCESS_TOKEN` to the same private environment
file to expose it as `Qoder CN` in Viki's Agent CLI selector. Without a token,
the preinstalled but unsigned-in Qoder CN CLI stays hidden. Set
`MY_WIKI_QODER_MODEL` only when a specific Qoder model or tier is required;
otherwise Qoder uses the account default. Viki invokes Qoder in non-interactive,
non-persistent mode: questions receive read/search tools only, while maintenance
also receives edits inside the mounted vault. Bash, web, MCP, and subagent tools
are not exposed by this integration.
