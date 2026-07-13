import type { Server } from 'node:http';
import { readConfigState, writeConfig, saveDomainProfile, localDbPath, domainProfilePath, localWebPort } from './config.js';
import { buildLocalContext, type AppContext } from './context.js';
import { openDb } from './db.js';
import { createServer } from './server.js';
import { loadDomainProfile, type DomainProfile } from './domain.js';
import { RemoteLessonService } from './services/remoteLessonService.js';
import { RemoteTraceService } from './services/remoteTraceService.js';
import { RemoteDomainService } from './services/remoteDomainService.js';
import type { BirdieConfig, LessonServiceLike, TraceServiceLike } from './types.js';

export interface McpContext {
  firstRun: boolean;
  mode: 'local' | 'remote' | 'unconfigured';
  traceService?: TraceServiceLike;
  lessonService?: LessonServiceLike;
  completeSetup(config: BirdieConfig): BirdieConfig;
  getDomainProfile(): Promise<DomainProfile>;
  saveDomainProfile(content: string): Promise<{ path: string }>;
  openReviewQueue(): Promise<{ url: string }>;
}

let runningWebServer: Server | undefined;
let runningWebUrl: string | undefined;

export function buildMcpContext(): McpContext {
  const state = readConfigState();
  if (state.firstRun || !state.config) {
    return unconfiguredContext();
  }
  if (state.config.mode === 'remote') {
    const serverUrl = state.config.server_url.replace(/\/+$/, '');
    const domainService = new RemoteDomainService(serverUrl);
    return {
      firstRun: false,
      mode: 'remote',
      traceService: new RemoteTraceService(serverUrl),
      lessonService: new RemoteLessonService(serverUrl),
      completeSetup,
      getDomainProfile: () => domainService.get(),
      saveDomainProfile: async (content) => {
        await domainService.save(content);
        return { path: `${serverUrl}/domain` };
      },
      openReviewQueue: async () => ({ url: serverUrl }),
    };
  }
  const local = buildLocalContext(localDbPath(), domainProfilePath());
  return {
    firstRun: false,
    mode: 'local',
    traceService: local.traceService,
    lessonService: local.lessonService,
    completeSetup,
    getDomainProfile: async () => local.domainProfile,
    saveDomainProfile: async (content) => saveDomainProfile(content),
    openReviewQueue: () => startLocalReviewQueue(local),
  };
}

function unconfiguredContext(): McpContext {
  return {
    firstRun: true,
    mode: 'unconfigured',
    completeSetup,
    getDomainProfile: async () => loadDomainProfile(domainProfilePath()),
    saveDomainProfile: async (content) => saveDomainProfile(content),
    openReviewQueue: async () => {
      throw new Error('Birdie is not set up yet. Use the setup-birdie prompt first.');
    },
  };
}

function completeSetup(config: BirdieConfig): BirdieConfig {
  if (config.mode === 'local') {
    const db = openDb(localDbPath());
    db.close();
  }
  return writeConfig(config);
}

async function startLocalReviewQueue(ctx: AppContext): Promise<{ url: string }> {
  if (runningWebUrl) return { url: runningWebUrl };
  const requestedPort = localWebPort();
  const app = createServer(ctx);
  try {
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(requestedPort, '127.0.0.1');
      server.once('listening', () => {
        runningWebServer = server;
        resolve();
      });
      server.once('error', reject);
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      const candidateUrl = `http://127.0.0.1:${requestedPort}`;
      if (await isBirdieServer(candidateUrl)) {
        // Another Birdie session already owns this port — reuse it instead of
        // failing, so multiple Claude Code windows share one review queue.
        runningWebUrl = candidateUrl;
        return { url: runningWebUrl };
      }
      // Something else is bound to the fixed port. Fall back to any free port
      // rather than assuming it's Birdie and handing back the wrong URL.
      return startOnEphemeralPort(app);
    }
    throw err;
  }
  const address = runningWebServer!.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  runningWebUrl = `http://127.0.0.1:${port}`;
  return { url: runningWebUrl };
}

async function isBirdieServer(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/__birdie`, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { birdie?: boolean };
    return body.birdie === true;
  } catch {
    return false;
  }
}

async function startOnEphemeralPort(app: ReturnType<typeof createServer>): Promise<{ url: string }> {
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('listening', () => {
      runningWebServer = server;
      resolve();
    });
    server.once('error', reject);
  });
  const address = runningWebServer!.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  runningWebUrl = `http://127.0.0.1:${port}`;
  return { url: runningWebUrl };
}
