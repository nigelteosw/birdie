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

export interface BirdieService {
  config: HostedConfig;
  stop(): Promise<void>;
}

export async function serveBirdie(config = readHostedConfig()): Promise<BirdieService> {
  const authRuntime = createBirdieAuth(config);
  await initializeAuth(authRuntime, config);

  const ctx = buildHostedContext(config.dbPath, config.domainPath);
  const mcp = createRemoteMcpServer(ctx, authRuntime, config);
  await startRemoteMcpServer(mcp, config);

  const app = createServer(ctx, {
    auth: authRuntime.auth,
    authRuntime,
    baseUrl: config.baseUrl,
    mcpTarget: `http://127.0.0.1:${config.mcpInternalPort}`,
  });

  let publicServer: Server;
  try {
    publicServer = await listen(app, config.port);
  } catch (error) {
    await mcp.stop();
    authRuntime.database.close();
    throw error;
  }

  console.error(`Birdie listening on ${config.baseUrl}`);
  return {
    config,
    async stop() {
      await Promise.all([close(publicServer), mcp.stop()]);
      authRuntime.database.close();
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
