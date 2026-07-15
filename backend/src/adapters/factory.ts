import type { DBAdapter } from './types.js';
import { PostgresDBAdapter } from './postgres/dbAdapter.js';
import { SQLiteDBAdapter } from './sqlite/dbAdapter.js';
import type { HostedConfig } from '../runtimeConfig.js';

export function createConfiguredDBAdapter(config: HostedConfig): DBAdapter {
  if (config.dbAdapter === 'postgres') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required when BIRDIE_DB_ADAPTER=postgres.');
    return new PostgresDBAdapter({ connectionString: config.databaseUrl });
  }
  return new SQLiteDBAdapter(config.dbPath);
}
