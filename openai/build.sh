#!/bin/sh
# Builds the ChatGPT plugin ZIP (platform.openai.com/plugins) with plugin.json at the archive root.
set -e
cd "$(dirname "$0")"
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' plugin.json)
out="../dist/bankconv-chatgpt-$version.zip"
mkdir -p ../dist
rm -f "$out"
zip -qrX "$out" plugin.json mcp.json assets skills -x '*.DS_Store'
echo "$out"
