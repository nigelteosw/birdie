import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readConfigState } from '../src/config.js';
import { buildMcpContext } from '../src/mcpContext.js';
import { completeSetupHandler } from '../src/mcp/tools.js';

describe('mcp context setup', () => {
  let oldConfigPath: string | undefined;
  let oldDomainPath: string | undefined;
  let oldDbPath: string | undefined;
  let dir: string;

  beforeEach(() => {
    oldConfigPath = process.env.BIRDIE_CONFIG_PATH;
    oldDomainPath = process.env.DOMAIN_PROFILE_PATH;
    oldDbPath = process.env.DB_PATH;
    dir = mkdtempSync(join(tmpdir(), 'birdie-mcp-context-'));
    process.env.BIRDIE_CONFIG_PATH = join(dir, 'config.json');
    process.env.DOMAIN_PROFILE_PATH = join(dir, 'domain.md');
    process.env.DB_PATH = join(dir, 'birdie.db');
  });

  afterEach(() => {
    process.env.BIRDIE_CONFIG_PATH = oldConfigPath;
    process.env.DOMAIN_PROFILE_PATH = oldDomainPath;
    process.env.DB_PATH = oldDbPath;
  });

  it('does not write local config if database initialization fails', () => {
    const dbDirectory = join(dir, 'not-a-db-file');
    mkdirSync(dbDirectory);
    process.env.DB_PATH = dbDirectory;

    expect(() => completeSetupHandler(buildMcpContext(), { mode: 'local' })).toThrow();
    expect(readConfigState().firstRun).toBe(true);
  });
});
