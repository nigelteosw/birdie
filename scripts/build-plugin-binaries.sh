#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

targets=(
  "bun-darwin-arm64:birdie-darwin-arm64"
  "bun-darwin-x64:birdie-darwin-x64"
  "bun-linux-x64:birdie-linux-x64"
  "bun-windows-x64:birdie-windows-x64.exe"
)

mkdir -p bin
for entry in "${targets[@]}"; do
  target="${entry%%:*}"
  name="${entry##*:}"
  echo "Building ${name} (${target})..."
  bun build --compile --minify --target="${target}" backend/src/cli.ts \
    --external @valibot/to-json-schema --external effect \
    --outfile "bin/${name}"
  gzip -9 -f "bin/${name}"
done

echo "Done. Compressed binaries are in bin/*.gz — commit them."
