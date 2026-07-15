#!/usr/bin/env node
import 'dotenv/config';
import type { Server } from 'node:http';
import { createBirdieAuth } from './auth.js';
import { initializeAuth } from './authBootstrap.js';
import { buildHostedContext } from './context.js';
import { startRemoteMcpServer } from './mcp/httpServer.js';
import { createRemoteMcpServer } from './mcp/server.js';
import { readHostedConfig, type HostedConfig } from './runtimeConfig.js';
import { createServer } from './server.js';
import { createConfiguredDBAdapter } from './adapters/factory.js';
import type { DBAdapter } from './adapters/types.js';

export interface BirdieService {
  config: HostedConfig;
  stop(): Promise<void>;
}

export async function serveBirdie(
  config = readHostedConfig(),
  db: DBAdapter = createConfiguredDBAdapter(config)
): Promise<BirdieService> {
  let mcp: ReturnType<typeof createRemoteMcpServer> | undefined;
  let publicServer: Server | undefined;
  try {
    const authRuntime = createBirdieAuth(config, db.authDatabase);
    await initializeAuth(authRuntime, config, db.users);
    await db.initialize();

    const ctx = buildHostedContext(db, config.domainPath);
    mcp = createRemoteMcpServer(ctx, authRuntime, config, db.users);
    await startRemoteMcpServer(mcp, config);

    const app = createServer(ctx, {
      auth: authRuntime.auth,
      authRuntime,
      userAdminStore: db.users,
      baseUrl: config.baseUrl,
      mcpTarget: `http://127.0.0.1:${config.mcpInternalPort}`,
    });
    publicServer = await listen(app, config.port);
  } catch (error) {
    await Promise.allSettled([
      ...(publicServer ? [close(publicServer)] : []),
      ...(mcp ? [mcp.stop()] : []),
      db.close(),
    ]);
    throw error;
  }

  console.error(`Birdie listening on ${config.baseUrl}`);
  let stopped = false;
  return {
    config,
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await Promise.all([close(publicServer), mcp.stop()]);
      } finally {
        await db.close();
      }
    },
  };
}

function listen(app: ReturnType<typeof createServer>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'serve';
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`Birdie\n\nUsage:\n  birdie [serve]   Start the hosted web, REST, OAuth, and MCP service`);
    return;
  }
  if (command !== 'serve') throw new Error(`Unknown command '${command}'.`);
  await serveBirdie();
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
