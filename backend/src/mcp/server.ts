import { FastMCP } from 'fastmcp';
import type { BirdieAuthRuntime } from '../auth.js';
import type { AppContext } from '../context.js';
import type { HostedConfig } from '../runtimeConfig.js';
import { createMcpAuthenticator, type McpSession } from './principal.js';
import { registerPrompts } from './prompts.js';
import { registerTools } from './tools.js';

export function createRemoteMcpServer(
  ctx: AppContext,
  authRuntime: BirdieAuthRuntime,
  config: HostedConfig
): FastMCP<McpSession> {
  const server = new FastMCP<McpSession>({
    name: 'birdie',
    version: '0.1.0',
    authenticate: createMcpAuthenticator(authRuntime, config),
    health: { enabled: false },
    oauth: {
      enabled: true,
      protectedResource: {
        resource: `${config.baseUrl}/mcp`,
        authorizationServers: [`${config.baseUrl}/api/auth`],
        scopesSupported: ['birdie:read', 'birdie:write'],
        bearerMethodsSupported: ['header'],
      },
    },
  });
  registerTools(server, ctx, config.baseUrl);
  registerPrompts(server, ctx);
  return server;
}
