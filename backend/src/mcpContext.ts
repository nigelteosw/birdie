import type { Server } from 'node:http';
import { readConfigState, writeConfig, saveDomainProfile, localDbPath, domainProfilePath } from './config.js';
import { buildLocalContext, type AppContext } from './context.js';
import { openDb } from './db.js';
import { createServer } from './server.js';
import { loadDomainProfile, type DomainProfile } from './domain.js';
import { RemoteLessonService } from './services/remoteLessonService.js';
import { RemoteTraceService } from './services/remoteTraceService.js';
import type { BirdieConfig, LessonServiceLike, TraceServiceLike } from './types.js';

export interface McpContext {
  firstRun: boolean;
  mode: 'local' | 'remote' | 'unconfigured';
  traceService?: TraceServiceLike;
  lessonService?: LessonServiceLike;
  domainProfile: DomainProfile;
  completeSetup(config: BirdieConfig): BirdieConfig;
  saveDomainProfile(content: string): { path: string };
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
    return {
      firstRun: false,
      mode: 'remote',
      traceService: new RemoteTraceService(serverUrl),
      lessonService: new RemoteLessonService(serverUrl),
      domainProfile: loadDomainProfile(domainProfilePath()),
      completeSetup,
      saveDomainProfile,
      openReviewQueue: async () => ({ url: serverUrl }),
    };
  }
  const local = buildLocalContext(localDbPath(), domainProfilePath());
  return {
    firstRun: false,
    mode: 'local',
    traceService: local.traceService,
    lessonService: local.lessonService,
    domainProfile: local.domainProfile,
    completeSetup,
    saveDomainProfile,
    openReviewQueue: () => startLocalReviewQueue(local),
  };
}

function unconfiguredContext(): McpContext {
  return {
    firstRun: true,
    mode: 'unconfigured',
    domainProfile: loadDomainProfile(domainProfilePath()),
    completeSetup,
    saveDomainProfile,
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
  const requestedPort = Number(process.env.PORT ?? 0);
  const app = createServer(ctx);
  await new Promise<void>((resolve) => {
    runningWebServer = app.listen(requestedPort, '127.0.0.1', resolve);
  });
  const address = runningWebServer!.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  runningWebUrl = `http://127.0.0.1:${port}`;
  return { url: runningWebUrl };
}
