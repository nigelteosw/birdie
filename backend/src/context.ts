import { openDb } from './db.js';
import { loadDomainProfile, type DomainProfile } from './domain.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LessonRepository } from './repositories/lessonRepository.js';
import { TraceRepository } from './repositories/traceRepository.js';
import { LessonService } from './services/lessonService.js';
import { TraceService } from './services/traceService.js';

export interface AppContext {
  traceService: TraceService;
  lessonService: LessonService;
  readonly domainProfile: DomainProfile;
  updateDomainProfile(content: string): { path: string; profile: DomainProfile };
}

export function buildHostedContext(dbPath: string, domainPath: string): AppContext {
  const db = openDb(dbPath);
  const traceRepo = new TraceRepository(db);
  const lessonRepo = new LessonRepository(db);
  let domainProfile = loadDomainProfile(domainPath);
  const traceService = new TraceService(traceRepo, lessonRepo);
  const lessonService = new LessonService(lessonRepo, traceRepo);
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
