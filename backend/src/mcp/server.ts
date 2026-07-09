import { FastMCP } from 'fastmcp';
import { buildMcpContext } from '../mcpContext.js';
import { registerPrompts } from './prompts.js';
import { registerTools, type McpContextFactory } from './tools.js';

export function createMcpServer(ctxFactory: McpContextFactory = buildMcpContext): FastMCP {
  const server = new FastMCP({ name: 'birdie', version: '0.1.0' });
  registerTools(server, ctxFactory);
  registerPrompts(server, ctxFactory);
  return server;
}
