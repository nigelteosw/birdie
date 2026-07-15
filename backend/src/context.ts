import { loadDomainProfile, type DomainProfile } from './domain.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DBAdapter } from './adapters/types.js';
import { SQLiteDBAdapter } from './adapters/sqlite/dbAdapter.js';
import { LessonService } from './services/lessonService.js';
import { TraceService } from './services/traceService.js';

export interface AppContext {
  traceService: TraceService;
  lessonService: LessonService;
  readonly domainProfile: DomainProfile;
  updateDomainProfile(content: string): { path: string; profile: DomainProfile };
}

export function buildHostedContext(dbOrPath: DBAdapter | string, domainPath: string): AppContext {
  const db = typeof dbOrPath === 'string' ? new SQLiteDBAdapter(dbOrPath) : dbOrPath;
  let domainProfile = loadDomainProfile(domainPath);
  const traceService = new TraceService(db);
  const lessonService = new LessonService(db);
  return {
    traceService,
    lessonService,
    get domainProfile() {
      return domainProfile;
    },
    updateDomainProfile(content) {
      if (!content.trim()) throw new Error('Domain profile cannot be empty.');
      mkdirSync(dirname(domainPath), { recursive: true });
      writeFileSync(domainPath, content.endsWith('\n') ? content : `${content}\n`);
      domainProfile = loadDomainProfile(domainPath);
      return { path: domainPath, profile: domainProfile };
    },
  };
}
