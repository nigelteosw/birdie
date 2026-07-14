import { openDb } from './db.js';
import { loadDomainProfile, type DomainProfile } from './domain.js';
import { domainProfilePath, localDbPath, saveDomainProfileAt } from './config.js';
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

export function buildContext(): AppContext {
  return buildLocalContext(process.env.DB_PATH ?? localDbPath(), process.env.DOMAIN_PROFILE_PATH ?? domainProfilePath());
}

export function buildLocalContext(dbPath: string, domainPath: string): AppContext {
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
      const result = saveDomainProfileAt(domainPath, content);
      domainProfile = loadDomainProfile(domainPath);
      return { ...result, profile: domainProfile };
    },
  };
}
