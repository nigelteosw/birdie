import { describe, expect, it } from 'bun:test';
import { registerTools } from '../src/mcp/tools.js';
import { buildLocalContext } from '../src/context.js';
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
