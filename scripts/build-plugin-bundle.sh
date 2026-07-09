#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p bin
bun x esbuild backend/src/cli.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --external:@valibot/to-json-schema \
  --external:effect \
  --banner:js="import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" \
  --outfile=bin/birdie.mjs

echo "Done. Bundle is at bin/birdie.mjs — commit it."
