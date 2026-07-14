import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { BirdieConfig } from './types.js';

export interface ConfigState {
  firstRun: boolean;
  configPath: string;
  birdieDir: string;
  dbPath: string;
  domainPath: string;
  config?: BirdieConfig;
}

export interface SettingsSummary {
  configured: boolean;
  mode: 'local' | 'remote' | 'unconfigured';
  server_url?: string;
  user_name?: string;
  configPath: string;
  birdieDir: string;
  dbPath: string;
  domainPath: string;
  reviewQueueUrl: string;
}

export const DEFAULT_PORT = 6677;

export function birdieDir(): string {
  return resolve(homedir(), '.birdie');
}

export function localWebPort(): number {
  return Number(process.env.PORT ?? DEFAULT_PORT);
}

export function configPath(): string {
  return expandHome(process.env.BIRDIE_CONFIG_PATH ?? join(birdieDir(), 'config.json'));
}

export function localDbPath(): string {
  return expandHome(process.env.DB_PATH ?? join(birdieDir(), 'birdie.db'));
}

export function domainProfilePath(): string {
  return expandHome(process.env.DOMAIN_PROFILE_PATH ?? join(birdieDir(), 'domain.md'));
}

export function readConfigState(): ConfigState {
  const path = configPath();
  const dir = dirname(path);
  const state = {
    firstRun: true,
    configPath: path,
    birdieDir: dir,
    dbPath: localDbPath(),
    domainPath: domainProfilePath(),
  };
  if (!existsSync(path)) return state;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as BirdieConfig;
    if (parsed.mode === 'local' || (parsed.mode === 'remote' && typeof parsed.server_url === 'string')) {
      return { ...state, firstRun: false, config: parsed };
    }
  } catch {
    return state;
  }
  return state;
}

export function readSettingsSummary(): SettingsSummary {
  const state = readConfigState();
  const mode = state.config?.mode ?? 'unconfigured';
  return {
    configured: !state.firstRun && Boolean(state.config),
    mode,
    server_url: state.config?.mode === 'remote' ? state.config.server_url : undefined,
    user_name: state.config?.user_name,
    configPath: state.configPath,
    birdieDir: state.birdieDir,
    dbPath: state.dbPath,
    domainPath: state.domainPath,
    reviewQueueUrl: state.config?.mode === 'remote' ? state.config.server_url : `http://127.0.0.1:${localWebPort()}`,
  };
}

export function writeConfig(config: BirdieConfig): BirdieConfig {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const userName = config.user_name?.trim() ? { user_name: config.user_name.trim() } : {};
  const normalized =
    config.mode === 'remote'
      ? { mode: 'remote' as const, server_url: config.server_url.replace(/\/+$/, ''), ...userName }
      : { mode: 'local' as const, ...userName };
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`);
  if (normalized.mode === 'local') {
    mkdirSync(dirname(localDbPath()), { recursive: true });
  }
  return normalized;
}

export function saveDomainProfile(content: string): { path: string } {
  return saveDomainProfileAt(domainProfilePath(), content);
}

export function saveDomainProfileAt(path: string, content: string): { path: string } {
  if (!content.trim()) {
    throw new Error('Domain profile cannot be empty.');
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
  return { path };
}

export function readDomainProfileFile(): { path: string; content: string; customized: boolean } {
  const path = domainProfilePath();
  try {
    return { path, content: readFileSync(path, 'utf-8'), customized: true };
  } catch {
    return { path, content: '', customized: false };
  }
}

function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}
