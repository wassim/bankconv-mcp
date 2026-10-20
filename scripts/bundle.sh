#!/usr/bin/env bash
# Packs bankconv.mcpb for Claude Desktop and Smithery: the built server, its production dependencies and the manifest.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

npm run build --prefix "$root"
cp -R "$root/dist" "$root/manifest.json" "$root/package.json" "$root/package-lock.json" "$root/README.md" "$root/LICENSE" "$stage/"
mkdir -p "$stage/assets" && cp "$root/assets/icon.png" "$stage/assets/"
npm ci --omit=dev --ignore-scripts --prefix "$stage" --silent
npx -y @anthropic-ai/mcpb@2.1.2 validate "$stage/manifest.json"
npx -y @anthropic-ai/mcpb@2.1.2 pack "$stage" "$root/bankconv.mcpb"
