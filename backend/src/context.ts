import { openDb } from './db.js';
import { loadDomainProfile, parseTypologyCategories, type DomainProfile } from './domain.js';
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
  const traceService = new TraceService(traceRepo, lessonRepo, domainProfile);
  const lessonService = new LessonService(lessonRepo, traceRepo, domainProfile);
  return {
    traceService,
    lessonService,
    get domainProfile() {
      return domainProfile;
    },
    updateDomainProfile(content) {
      if (parseTypologyCategories(content).length === 0) {
        throw new Error('A domain profile needs at least one category under # Typology.');
      }
      const result = saveDomainProfileAt(domainPath, content);
      domainProfile = loadDomainProfile(domainPath);
      traceService.setDomainProfile(domainProfile);
      lessonService.setDomainProfile(domainProfile);
      return { ...result, profile: domainProfile };
    },
  };
}
