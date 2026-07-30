#!/bin/sh
set -eu

vault="${MY_WIKI_VAULT:-/vault}"
config="${MY_WIKI_CONFIG_PATH:-/runtime/config.json}"

mkdir -p "$(dirname "$config")"

if [ ! -f "$vault/.my-wiki.json" ]; then
  node /opt/my-wiki/scripts/my-wiki.mjs init "$vault" --name demo --use
fi

if [ -d /seed ] && [ ! -f "$vault/.my-wiki-demo-seeded" ]; then
  cp -R /seed/. "$vault/"
  touch "$vault/.my-wiki-demo-seeded"
fi

MY_WIKI_VAULT="$vault" node /opt/my-wiki/assets/dashboard/scripts/generate-graph.mjs

exec node /opt/my-wiki/assets/dashboard/server.mjs
