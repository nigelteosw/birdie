import type { FastMCP } from 'fastmcp';
import type { HostedConfig } from '../runtimeConfig.js';
import type { McpSession } from './principal.js';

export async function startRemoteMcpServer(server: FastMCP<McpSession>, config: HostedConfig): Promise<void> {
  await server.start({
    transportType: 'httpStream',
    httpStream: {
      host: '127.0.0.1',
      port: config.mcpInternalPort,
      endpoint: '/mcp',
      stateless: true,
    },
  });
}
