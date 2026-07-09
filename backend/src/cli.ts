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

  if (summary.mode === 'local') {
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

  const domain = loadDomainProfile(summary.domainPath);
  checks.push({
    name: 'domain',
    ok: domain.typology_categories.length > 0,
    detail: `${domain.typology_categories.length} categories from ${existsSync(summary.domainPath) ? summary.domainPath : 'default profile'}`,
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
  throw new Error("Usage: birdie config show | birdie config path");
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
