import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { registerTools } from '../src/mcp/tools.js';
import { buildLocalContext } from '../src/context.js';
import { writeConfig } from '../src/config.js';
import type { McpContext } from '../src/mcpContext.js';

interface FakeTool {
  name: string;
  execute: (args: unknown) => Promise<string>;
}

class FakeServer {
  tools = new Map<string, FakeTool>();
  addTool(tool: FakeTool): void {
    this.tools.set(tool.name, tool);
  }
}

function fakeCtx(): McpContext {
  const local = buildLocalContext(':memory:', '/nonexistent/domain.md');
  return {
    firstRun: false,
    mode: 'local',
    traceService: local.traceService,
    lessonService: local.lessonService,
    completeSetup: () => ({ mode: 'local' }),
    getDomainProfile: async () => local.domainProfile,
    saveDomainProfile: async () => ({ path: '/nonexistent/domain.md' }),
    openReviewQueue: async () => ({ url: 'http://127.0.0.1:6677' }),
  };
}

describe('capture_trace tool', () => {
  let oldConfigPath: string | undefined;
  let dir: string;

  beforeEach(() => {
    oldConfigPath = process.env.BIRDIE_CONFIG_PATH;
    dir = mkdtempSync(join(tmpdir(), 'birdie-tools-'));
    process.env.BIRDIE_CONFIG_PATH = join(dir, 'config.json');
  });

  afterEach(() => {
    process.env.BIRDIE_CONFIG_PATH = oldConfigPath;
  });

  it('defaults submitted_by to the remembered user_name when omitted', async () => {
    writeConfig({ mode: 'local', user_name: 'Nigel' });
    const ctx = fakeCtx();
    const server = new FakeServer();
    registerTools(server as unknown as Parameters<typeof registerTools>[0], () => ctx);

    const captureTrace = server.tools.get('capture_trace')!;
    const result = JSON.parse(await captureTrace.execute({ before_text: 'before', after_text: 'after' }));
    expect(result.submitted_by).toBe('Nigel');
  });

  it('throws when submitted_by is omitted and no user_name is remembered', async () => {
    writeConfig({ mode: 'local' });
    const ctx = fakeCtx();
    const server = new FakeServer();
    registerTools(server as unknown as Parameters<typeof registerTools>[0], () => ctx);

    const captureTrace = server.tools.get('capture_trace')!;
    await expect(captureTrace.execute({ before_text: 'before', after_text: 'after' })).rejects.toThrow(
      'submitted_by is required'
    );
  });
});

describe('birdie_doctor tool', () => {
  let oldConfigPath: string | undefined;
  let oldDomainPath: string | undefined;
  let dir: string;
  let domainPath: string;

  beforeEach(() => {
    oldConfigPath = process.env.BIRDIE_CONFIG_PATH;
    oldDomainPath = process.env.DOMAIN_PROFILE_PATH;
    dir = mkdtempSync(join(tmpdir(), 'birdie-doctor-'));
    domainPath = join(dir, 'domain.md');
    process.env.BIRDIE_CONFIG_PATH = join(dir, 'config.json');
    process.env.DOMAIN_PROFILE_PATH = domainPath;
  });

  afterEach(() => {
    process.env.BIRDIE_CONFIG_PATH = oldConfigPath;
    process.env.DOMAIN_PROFILE_PATH = oldDomainPath;
  });

  it('flags a missing user_name and an uncustomized domain profile', async () => {
    writeConfig({ mode: 'local' });
    const ctx = fakeCtx();
    const server = new FakeServer();
    registerTools(server as unknown as Parameters<typeof registerTools>[0], () => ctx);

    const doctor = server.tools.get('birdie_doctor')!;
    const result = JSON.parse(await doctor.execute({}));
    const userNameCheck = result.checks.find((c: { name: string }) => c.name === 'user_name');
    const domainCheck = result.checks.find((c: { name: string }) => c.name === 'domain_profile');

    expect(userNameCheck.ok).toBe(false);
    expect(domainCheck.detail).toContain('generic built-in default');
  });

  it('reports a remembered user_name and a customized domain profile', async () => {
    writeConfig({ mode: 'local', user_name: 'Nigel' });
    writeFileSync(domainPath, '# Domain\nSoftware team.\n');
    const ctx = fakeCtx();
    const server = new FakeServer();
    registerTools(server as unknown as Parameters<typeof registerTools>[0], () => ctx);

    const doctor = server.tools.get('birdie_doctor')!;
    const result = JSON.parse(await doctor.execute({}));
    const userNameCheck = result.checks.find((c: { name: string }) => c.name === 'user_name');
    const domainCheck = result.checks.find((c: { name: string }) => c.name === 'domain_profile');

    expect(userNameCheck.ok).toBe(true);
    expect(userNameCheck.detail).toContain('Nigel');
    expect(domainCheck.detail).toContain('Customized domain profile');
  });
});

describe('ask_lesson tool', () => {
  it('returns matching promoted lessons, scoped by person and keyword', async () => {
    const ctx = fakeCtx();
    const server = new FakeServer();
    registerTools(server as unknown as Parameters<typeof registerTools>[0], () => ctx);

    const trace = await ctx.traceService!.capture({
      submitted_by: 'Sarah',
      before_text: 'uncapped indemnity',
      after_text: 'capped indemnity',
    });
    const lesson = await ctx.traceService!.extract({
      trace_id: trace.id,
      quote: 'uncapped indemnity',
      what_changed: 'Capped it.',
      why_it_matters: 'Risk control.',
    });
    await ctx.lessonService!.promote(lesson.id, { reviewer: 'Sarah' });

    const askLesson = server.tools.get('ask_lesson')!;
    const result = JSON.parse(await askLesson.execute({ question: 'indemnity', person: 'Sarah' }));
    expect(result).toHaveLength(1);
    expect(result[0].why_it_matters).toBe('Risk control.');

    const noMatch = JSON.parse(await askLesson.execute({ question: 'indemnity', person: 'Amir' }));
    expect(noMatch).toHaveLength(0);
  });

  it('keeps short technical terms searchable instead of returning the entire pool', async () => {
    const ctx = fakeCtx();
    const server = new FakeServer();
    registerTools(server as unknown as Parameters<typeof registerTools>[0], () => ctx);

    for (const [submitted_by, before_text] of [
      ['Ada', 'UI alignment'],
      ['Grace', 'database transaction'],
    ]) {
      const trace = await ctx.traceService!.capture({ submitted_by, before_text, after_text: 'after' });
      const lesson = await ctx.traceService!.extract({
        trace_id: trace.id,
        quote: before_text,
        what_changed: 'Improved it.',
        why_it_matters: 'Quality.',
      });
      await ctx.lessonService!.promote(lesson.id, { reviewer: 'Sarah' });
    }

    const askLesson = server.tools.get('ask_lesson')!;
    const result = JSON.parse(await askLesson.execute({ question: 'UI' }));
    expect(result).toHaveLength(1);
    expect(result[0].submitted_by).toBe('Ada');
  });
});
