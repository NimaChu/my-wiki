#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_root="$(CDPATH= cd -- "$script_dir/../.." && pwd)"
container_name="${MY_WIKI_CONTAINER_NAME:-my-wiki-demo}"
image_name="${MY_WIKI_CONTAINER_IMAGE:-my-wiki-demo:local}"
volume_name="${MY_WIKI_CONTAINER_VOLUME:-my-wiki-demo-vault}"
host_port="${MY_WIKI_HOST_PORT:-8787}"
public_hosts="${MY_WIKI_DASHBOARD_PUBLIC_HOSTS:-my-wiki.cloud,www.my-wiki.cloud}"
public_origins="${MY_WIKI_DASHBOARD_ORIGINS:-https://my-wiki.cloud,https://www.my-wiki.cloud,http://127.0.0.1:${host_port},http://localhost:${host_port}}"
env_file="${MY_WIKI_CONTAINER_ENV_FILE:-$HOME/.my-wiki-demo/opencode.env}"
seed_dir="${MY_WIKI_DEMO_SEED:-$HOME/.my-wiki-demo/seed}"
build_context="${MY_WIKI_CONTAINER_BUILD_CONTEXT:-$HOME/Library/Caches/my-wiki-container/build-context}"
host_proxy="${MY_WIKI_CONTAINER_PROXY:-${HTTPS_PROXY:-${https_proxy:-}}}"
container_proxy=""

if [ -z "$host_proxy" ] && command -v scutil >/dev/null 2>&1; then
  system_proxy="$(scutil --proxy)"
  proxy_enabled="$(printf '%s\n' "$system_proxy" | awk '$1 == "HTTPSEnable" { print $3; exit }')"
  proxy_host="$(printf '%s\n' "$system_proxy" | awk '$1 == "HTTPSProxy" { print $3; exit }')"
  proxy_port="$(printf '%s\n' "$system_proxy" | awk '$1 == "HTTPSPort" { print $3; exit }')"
  if [ "$proxy_enabled" = "1" ] && [ -n "$proxy_host" ] && [ -n "$proxy_port" ]; then
    host_proxy="http://${proxy_host}:${proxy_port}"
  fi
fi

if [ -n "$host_proxy" ]; then
  container_proxy="$(printf '%s' "$host_proxy" | sed \
    -e 's|//127\.0\.0\.1:|//192.168.64.1:|' \
    -e 's|//localhost:|//192.168.64.1:|')"
fi

mkdir -p "$build_context"
rsync -a --delete \
  --exclude '.dashboard-server.pid' \
  --exclude '.my-wiki-runtime.json' \
  --exclude 'dist' \
  --exclude 'node_modules' \
  --exclude 'public/wiki-graph.json' \
  "$project_root/" "$build_context/"

if [ -n "$container_proxy" ]; then
  container build \
    --build-arg "HTTP_PROXY=$container_proxy" \
    --build-arg "HTTPS_PROXY=$container_proxy" \
    --file "$build_context/deploy/apple-container/Containerfile" \
    --tag "$image_name" \
    "$build_context"
else
  container build \
    --file "$build_context/deploy/apple-container/Containerfile" \
    --tag "$image_name" \
    "$build_context"
fi

container stop "$container_name" >/dev/null 2>&1 || true
container delete "$container_name" >/dev/null 2>&1 || true
container volume create -s 8G "$volume_name" >/dev/null 2>&1 || true

set -- \
  --detach \
  --init \
  --name "$container_name" \
  --cpus 4 \
  --memory 6G \
  --publish "127.0.0.1:${host_port}:5173" \
  --mount "type=volume,source=${volume_name},target=/vault" \
  --env "MY_WIKI_DASHBOARD_PUBLIC_HOSTS=${public_hosts}" \
  --env "MY_WIKI_DASHBOARD_ORIGINS=${public_origins}"

if [ -n "$container_proxy" ]; then
  set -- "$@" \
    --env "HTTP_PROXY=$container_proxy" \
    --env "HTTPS_PROXY=$container_proxy" \
    --env "NO_PROXY=127.0.0.1,localhost"
fi

if [ -f "$env_file" ]; then
  set -- "$@" --env-file "$env_file"
fi

if [ -d "$seed_dir" ]; then
  set -- "$@" --mount "type=bind,source=${seed_dir},target=/seed,readonly"
fi

container run "$@" "$image_name"

printf 'My Wiki container: http://127.0.0.1:%s/\n' "$host_port"
