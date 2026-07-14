#!/usr/bin/env node
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { buildContext } from './context.js';
import {
  localWebPort,
  readConfigState,
  readDomainProfileFile,
  readSettingsSummary,
  saveDomainProfile,
  writeConfig,
} from './config.js';
import { buildMcpContext } from './mcpContext.js';
import { createMcpServer } from './mcp/server.js';
import { createServer } from './server.js';
import { openDb } from './db.js';
import { loadDomainProfile } from './domain.js';
import type { BirdieConfig } from './types.js';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'both';

  if (['both', 'mcp', 'web'].includes(mode)) {
    await runServerMode(mode as 'both' | 'mcp' | 'web');
    return;
  }

  const args = process.argv.slice(3);
  switch (mode) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case 'status':
      printStatus();
      return;
    case 'doctor':
      await runDoctor();
      return;
    case 'setup':
      runSetup(args);
      return;
    case 'config':
      runConfig(args);
      return;
    case 'domain':
      runDomain(args);
      return;
    default:
      throw new Error(`Unknown command '${mode}'. Run 'birdie help' for usage.`);
  }
}

async function runServerMode(mode: 'both' | 'mcp' | 'web'): Promise<void> {
  if (mode === 'web' || mode === 'both') {
    const port = localWebPort();
    createServer(buildContext()).listen(port, () => {
      console.error(`Birdie REST API + web UI listening on http://localhost:${port}`);
    });
  }

  if (mode === 'mcp' || mode === 'both') {
    const server = createMcpServer(buildMcpContext);
    await server.start({ transportType: 'stdio' });
  }
}

function printHelp(): void {
  console.log(`Birdie

Usage:
  birdie [both|mcp|web]              Start Birdie servers (default: both)
  birdie status                      Show current setup and file paths
  birdie doctor                      Check config, database, domain, and remote server reachability
  birdie setup local                 Use local ~/.birdie storage
  birdie setup remote <url>          Use a shared Birdie server
  birdie config show                 Print config JSON
  birdie config path                 Print config/domain/db paths
  birdie config set-name <name>      Update the remembered user_name
  birdie domain show                 Print the saved domain profile, or the default if unset
  birdie domain set <file>           Save a domain profile from a markdown file

Environment overrides:
  BIRDIE_CONFIG_PATH, DB_PATH, DOMAIN_PROFILE_PATH, PORT
`);
}

function printStatus(): void {
  const summary = readSettingsSummary();
  console.log(JSON.stringify(summary, null, 2));
}

async function runDoctor(): Promise<void> {
  const summary = readSettingsSummary();
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({
    name: 'config',
    ok: summary.configured,
    detail: summary.configured ? `${summary.mode} mode in ${summary.configPath}` : `not configured; run 'birdie setup local' or 'birdie setup remote <url>'`,
  });
  checks.push({
    name: 'user_name',
    ok: Boolean(summary.user_name),
    detail: summary.user_name
      ? `Remembered as "${summary.user_name}".`
      : `no user_name remembered; run 'birdie config set-name <name>'`,
  });

  if (summary.mode === 'local') {
    if (typeof Bun === 'undefined') {
      checks.push(nodeVersionCheck());
    }
    try {
      const db = openDb(summary.dbPath);
      db.close();
      checks.push({ name: 'database', ok: true, detail: summary.dbPath });
    } catch (err) {
      checks.push({ name: 'database', ok: false, detail: errorMessage(err) });
    }
  }

  if (summary.mode === 'remote' && summary.server_url) {
    checks.push(await checkRemote(summary.server_url));
  }

  const domainFile = readDomainProfileFile();
  const domain = loadDomainProfile(summary.domainPath);
  checks.push({
    name: 'domain',
    ok: domain.raw.length > 0,
    detail: domainFile.customized
      ? `Customized domain profile loaded from ${summary.domainPath}`
      : 'Still using the generic built-in default — run \'birdie domain set <file>\' to customize it.',
  });

  for (const check of checks) {
    console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`);
  }
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

function runSetup(args: string[]): void {
  const mode = args[0];
  if (mode === 'local') {
    const db = openDb(readSettingsSummary().dbPath);
    db.close();
    printWrittenConfig(writeConfig({ mode: 'local' }));
    return;
  }
  if (mode === 'remote') {
    const serverUrl = args[1];
    if (!serverUrl) throw new Error("Usage: birdie setup remote <url>");
    printWrittenConfig(writeConfig({ mode: 'remote', server_url: normalizeUrl(serverUrl) }));
    return;
  }
  throw new Error("Usage: birdie setup local | birdie setup remote <url>");
}

function runConfig(args: string[]): void {
  const action = args[0] ?? 'show';
  const state = readConfigState();
  if (action === 'show') {
    console.log(JSON.stringify(state.config ?? { mode: 'unconfigured' }, null, 2));
    return;
  }
  if (action === 'path' || action === 'paths') {
    console.log(
      JSON.stringify(
        {
          configPath: state.configPath,
          birdieDir: state.birdieDir,
          dbPath: state.dbPath,
          domainPath: state.domainPath,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === 'set-name') {
    const name = args[1];
    if (!name) throw new Error('Usage: birdie config set-name <name>');
    if (!state.config) {
      throw new Error("Birdie is not set up yet. Run 'birdie setup local' or 'birdie setup remote <url>' first.");
    }
    const config: BirdieConfig =
      state.config.mode === 'remote'
        ? { mode: 'remote', server_url: state.config.server_url, user_name: name }
        : { mode: 'local', user_name: name };
    printWrittenConfig(writeConfig(config));
    return;
  }
  throw new Error("Usage: birdie config show | birdie config path | birdie config set-name <name>");
}

function runDomain(args: string[]): void {
  const action = args[0] ?? 'show';
  if (action === 'show') {
    const profile = readDomainProfileFile();
    if (profile.customized) {
      console.log(profile.content.trimEnd());
    } else {
      console.log(loadDomainProfile(profile.path).raw.trimEnd());
    }
    return;
  }
  if (action === 'set') {
    const file = args[1];
    if (!file) throw new Error("Usage: birdie domain set <file>");
    const result = saveDomainProfile(readFileSync(file, 'utf-8'));
    console.log(`Saved domain profile to ${result.path}`);
    return;
  }
  throw new Error("Usage: birdie domain show | birdie domain set <file>");
}

function printWrittenConfig(config: BirdieConfig): void {
  console.log(`Birdie configured for ${config.mode} mode.`);
  if (config.mode === 'remote') console.log(`Server: ${config.server_url}`);
}

async function checkRemote(serverUrl: string): Promise<{ name: string; ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/__birdie`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { name: 'remote', ok: false, detail: `${serverUrl} returned HTTP ${res.status}` };
    const body = (await res.json()) as { birdie?: boolean };
    return body.birdie === true
      ? { name: 'remote', ok: true, detail: serverUrl }
      : { name: 'remote', ok: false, detail: `${serverUrl} did not identify as Birdie` };
  } catch (err) {
    return { name: 'remote', ok: false, detail: errorMessage(err) };
  }
}

function nodeVersionCheck(): { name: string; ok: boolean; detail: string } {
  const version = process.versions.node;
  const [major, minor] = version.split('.').map(Number);
  const ok = major > 22 || (major === 22 && minor >= 13);
  return {
    name: 'node_version',
    ok,
    detail: ok
      ? `Node ${version} supports the built-in SQLite driver local mode needs.`
      : `Node ${version} is too old — local mode needs Node 22.13+ for built-in SQLite support. Upgrade Node.`,
  };
}

function normalizeUrl(value: string): string {
  return new URL(value).toString().replace(/\/+$/, '');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
