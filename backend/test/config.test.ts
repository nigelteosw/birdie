import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readConfigState, saveDomainProfile, writeConfig } from '../src/config.js';

describe('config', () => {
  let oldConfigPath: string | undefined;
  let oldDomainPath: string | undefined;
  let oldDbPath: string | undefined;
  let dir: string;

  beforeEach(() => {
    oldConfigPath = process.env.BIRDIE_CONFIG_PATH;
    oldDomainPath = process.env.DOMAIN_PROFILE_PATH;
    oldDbPath = process.env.DB_PATH;
    dir = mkdtempSync(join(tmpdir(), 'birdie-config-'));
    process.env.BIRDIE_CONFIG_PATH = join(dir, 'config.json');
    process.env.DOMAIN_PROFILE_PATH = join(dir, 'domain.md');
    process.env.DB_PATH = join(dir, 'birdie.db');
  });

  afterEach(() => {
    process.env.BIRDIE_CONFIG_PATH = oldConfigPath;
    process.env.DOMAIN_PROFILE_PATH = oldDomainPath;
    process.env.DB_PATH = oldDbPath;
  });

  it('treats missing config as first run', () => {
    expect(readConfigState().firstRun).toBe(true);
  });

  it('writes local config', () => {
    writeConfig({ mode: 'local' });
    expect(readConfigState().config).toEqual({ mode: 'local' });
  });

  it('falls back to first run for corrupt config', () => {
    writeFileSync(join(dir, 'config.json'), '{ nope');
    expect(readConfigState().firstRun).toBe(true);
  });

  it('saves a domain profile', () => {
    const result = saveDomainProfile('# Domain\nTest');
    expect(readFileSync(result.path, 'utf-8')).toContain('# Domain');
  });
});
