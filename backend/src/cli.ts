#!/usr/bin/env node
import 'dotenv/config';
import { buildContext } from './context.js';
import { localWebPort } from './config.js';
import { buildMcpContext } from './mcpContext.js';
import { createMcpServer } from './mcp/server.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'both';

  if (!['both', 'mcp', 'web'].includes(mode)) {
    throw new Error(`Unknown mode '${mode}'. Use 'mcp', 'web', or omit the mode for both.`);
  }

  if (mode === 'web' || mode === 'both') {
    const port = localWebPort();
    createServer(buildContext()).listen(port, () => {
      console.error(`Birdie REST API + web UI listening on http://localhost:${port}`);
    });
  }

  if (mode === 'mcp' || mode === 'both') {
    const server = createMcpServer(buildMcpContext);
    await server.start({ transportType: 'stdio' });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
