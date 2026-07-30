#!/bin/sh
set -eu

container_name="${MY_WIKI_CONTAINER_NAME:-my-wiki-demo}"
volume_name="${MY_WIKI_CONTAINER_VOLUME:-my-wiki-demo-vault}"

container stop "$container_name" >/dev/null 2>&1 || true
container delete "$container_name" >/dev/null 2>&1 || true
container volume delete "$volume_name"

printf 'Deleted demo vault volume: %s\n' "$volume_name"
