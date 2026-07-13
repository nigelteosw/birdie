import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readConfigState, saveDomainProfile } from '../src/config.js';
import { buildMcpContext } from '../src/mcpContext.js';
import {
  completeSetupHandler,
  getBirdieSettingsHandler,
  getDomainProfileHandler,
  updateBirdieSettingsHandler,
} from '../src/mcp/tools.js';

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

  it('exposes settings before setup', () => {
    expect(getBirdieSettingsHandler()).toMatchObject({ configured: false, mode: 'unconfigured' });
  });

  it('updates settings from MCP tools', () => {
    expect(updateBirdieSettingsHandler({ mode: 'remote', server_url: 'https://birdie.example.com/' })).toEqual({
      mode: 'remote',
      server_url: 'https://birdie.example.com',
    });
    expect(readConfigState().config).toEqual({ mode: 'remote', server_url: 'https://birdie.example.com' });
  });

  it('remembers user_name from complete_setup', () => {
    completeSetupHandler(buildMcpContext(), { mode: 'local', user_name: 'Nigel' });
    expect(getBirdieSettingsHandler()).toMatchObject({ mode: 'local', user_name: 'Nigel' });
  });

  it('updates just user_name without requiring mode, preserving the current mode', () => {
    completeSetupHandler(buildMcpContext(), { mode: 'remote', server_url: 'https://birdie.example.com' });
    updateBirdieSettingsHandler({ user_name: 'Nigel' });
    expect(getBirdieSettingsHandler()).toMatchObject({
      mode: 'remote',
      server_url: 'https://birdie.example.com',
      user_name: 'Nigel',
    });
  });

  it('rejects update_birdie_settings with nothing to change', () => {
    expect(() => updateBirdieSettingsHandler({})).toThrow();
  });

  it('reads domain profile from MCP tools', () => {
    saveDomainProfile('# Domain\nEngineering\n\n# Typology\n- design_feedback: Feedback on design.\n');
    expect(getDomainProfileHandler()).toMatchObject({
      customized: true,
      typology_categories: ['design_feedback'],
    });
  });
});
