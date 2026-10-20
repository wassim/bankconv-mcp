#!/usr/bin/env bash
# Packs bankconv.mcpb for Claude Desktop, and bankconv-smithery.mcpb, whose manifest also carries each tool's input schema as Smithery's registry requires.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage" "$root/smithery-tools.json"' EXIT

npm run build --prefix "$root"
node "$root/scripts/manifest-tools.mjs"
cp -R "$root/dist" "$root/manifest.json" "$root/package.json" "$root/package-lock.json" "$root/README.md" "$root/LICENSE" "$stage/"
mkdir -p "$stage/assets" && cp "$root/assets/icon.png" "$stage/assets/"
npm ci --omit=dev --ignore-scripts --prefix "$stage" --silent
npx -y @anthropic-ai/mcpb@2.1.2 validate "$stage/manifest.json"
npx -y @anthropic-ai/mcpb@2.1.2 pack "$stage" "$root/bankconv.mcpb"

node -e '
const fs = require("fs");
const [manifestPath, toolsPath] = process.argv.slice(1);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.tools = JSON.parse(fs.readFileSync(toolsPath, "utf8"));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
' "$stage/manifest.json" "$root/smithery-tools.json"
rm -f "$root/bankconv-smithery.mcpb"
(cd "$stage" && zip -qr -X "$root/bankconv-smithery.mcpb" .)
