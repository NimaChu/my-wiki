#!/bin/sh
set -eu

vault="${MY_WIKI_VAULT:-/vault}"
config="${MY_WIKI_CONFIG_PATH:-/runtime/config.json}"

mkdir -p "$(dirname "$config")"

if [ -d /host-opencode-config ]; then
  mkdir -p /root/.config/opencode
  cp -R /host-opencode-config/. /root/.config/opencode/
fi
if [ -f /host-opencode-data/auth.json ]; then
  mkdir -p /root/.local/share/opencode
  cp /host-opencode-data/auth.json /root/.local/share/opencode/auth.json
  chmod 600 /root/.local/share/opencode/auth.json
fi

if [ ! -f "$vault/.my-wiki.json" ]; then
  node /opt/my-wiki/scripts/my-wiki.mjs init "$vault" --name demo --use
fi

if [ -d /seed ] && [ ! -f "$vault/.my-wiki-demo-seeded" ]; then
  cp -R /seed/. "$vault/"
  touch "$vault/.my-wiki-demo-seeded"
fi

MY_WIKI_VAULT="$vault" node /opt/my-wiki/assets/dashboard/scripts/generate-graph.mjs

exec node /opt/my-wiki/assets/dashboard/server.mjs
