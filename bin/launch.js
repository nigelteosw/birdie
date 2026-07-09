#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const BINARIES = {
  'darwin-arm64': 'birdie-darwin-arm64',
  'darwin-x64': 'birdie-darwin-x64',
  'linux-x64': 'birdie-linux-x64',
  'win32-x64': 'birdie-windows-x64.exe',
};

function main() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (!pluginRoot || !pluginData) {
    throw new Error('CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA must be set to launch Birdie.');
  }

  const key = `${process.platform}-${process.arch}`;
  const name = BINARIES[key];
  if (!name) {
    throw new Error(`Birdie has no compiled binary for platform "${key}". Supported: ${Object.keys(BINARIES).join(', ')}`);
  }

  const cachedPath = path.join(pluginData, name);
  if (!fs.existsSync(cachedPath)) {
    const gzPath = path.join(pluginRoot, 'bin', `${name}.gz`);
    const compressed = fs.readFileSync(gzPath);
    fs.mkdirSync(pluginData, { recursive: true });
    fs.writeFileSync(cachedPath, zlib.gunzipSync(compressed), { mode: 0o755 });
  }

  execFileSync(cachedPath, process.argv.slice(2), { stdio: 'inherit' });
}

main();
