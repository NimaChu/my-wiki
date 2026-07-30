#!/bin/sh
set -u

container_bin="${MY_WIKI_CONTAINER_BIN:-/usr/local/bin/container}"
container_name="${MY_WIKI_CONTAINER_NAME:-my-wiki-demo}"

"$container_bin" system start >/dev/null 2>&1 || true

while :; do
  "$container_bin" start "$container_name" >/dev/null 2>&1 || true
  "$container_bin" logs --follow -n 0 "$container_name" >/dev/null 2>&1 || sleep 5
done
