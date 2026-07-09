import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import { buildMcpContext, type McpContext } from '../mcpContext.js';
import type { BirdieConfig } from '../types.js';
import { copy } from '../copy.js';

export type McpContextFactory = () => McpContext;

// A discriminated union serializes to a top-level `anyOf` with no `type:
// "object"`, which Claude Code's MCP client rejects for tool inputSchemas.
// Flatten to one object and cross-validate server_url with superRefine.
const setupParams = z
  .object({
    mode: z.enum(['local', 'remote']),
    server_url: z.string().url().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'remote' && !data.server_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'server_url is required when mode is "remote"',
        path: ['server_url'],
      });
    }
  });

const domainProfileParams = z.object({ content: z.string().min(1) });
const emptyParams = z.object({});
const captureTraceParams = z.object({
  before_text: z.string().min(1),
  after_text: z.string().min(1),
  submitted_by: z.string().min(1),
  submitted_by_role: z.enum(['senior', 'junior']),
  junior_name: z.string().optional(),
  senior_name: z.string().optional(),
  playbook_ref: z.string().optional(),
  playbook_text: z.string().optional(),
  context_note: z.string().optional(),
});
const getTraceParams = z.object({ trace_id: z.string().min(1) });
const skipExtractionParams = z.object({ trace_id: z.string().min(1), reason: z.string().min(1) });
const saveExtractionParams = z.object({
  trace_id: z.string().min(1),
  quote: z.string().min(1),
  what_changed: z.string().min(1),
  why_it_matters: z.string().min(1),
  typology: z.string().min(1),
  playbook_alignment: z.enum(['aligned', 'diverges', 'not_applicable']).optional(),
  playbook_note: z.string().optional(),
});
const listLessonsParams = z.object({
  status: z.enum(['pending_review', 'rejected', 'promoted']).optional(),
  typology: z.string().optional(),
  playbook_ref: z.string().optional(),
  junior_name: z.string().optional(),
  senior_name: z.string().optional(),
});
const reviewLessonParams = z.object({
  lesson_id: z.string().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  typology: z.string().min(1).optional(),
  reject: z.boolean().optional(),
});
const promoteLessonParams = z.object({
  lesson_id: z.string().min(1),
  reviewer: z.string().trim().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  typology: z.string().min(1).optional(),
});
const askSeniorParams = z.object({ question: z.string().min(1), senior_name: z.string().optional() });
const askJuniorParams = z.object({ junior_name: z.string().optional() });

export function registerTools(server: FastMCP, ctxFactory: McpContextFactory = buildMcpContext): void {
  const mcp = server as any;

  mcp.addTool({
    name: 'complete_setup',
    description: "Finish Birdie's first-run setup by choosing local storage or a shared Birdie server.",
    parameters: setupParams,
    execute: async (args: z.infer<typeof setupParams>) => json(completeSetupHandler(ctxFactory(), args)),
  });
  mcp.addTool({
    name: 'save_domain_profile',
    description: "Save your team's categories and guidance after the setup interview.",
    parameters: domainProfileParams,
    execute: async (args: z.infer<typeof domainProfileParams>) => json(saveDomainProfileHandler(ctxFactory(), args)),
  });
  mcp.addTool({
    name: 'open_review_queue',
    description: 'Open the review queue in a browser-friendly web page.',
    parameters: emptyParams,
    execute: async () => json(await openReviewQueueHandler(ctxFactory())),
  });
  mcp.addTool({
    name: 'capture_trace',
    description: 'Capture a before/after edit as an example for later lesson extraction.',
    parameters: captureTraceParams,
    execute: async (args: z.infer<typeof captureTraceParams>) => json(await requireTraceService(ctxFactory()).capture(args)),
  });
  mcp.addTool({
    name: 'get_trace',
    description: 'Read an example before extracting a lesson from it.',
    parameters: getTraceParams,
    execute: async (args: z.infer<typeof getTraceParams>) => {
      const trace = await requireTraceService(ctxFactory()).get(args.trace_id);
      if (!trace) throw new Error(`Trace not found: ${args.trace_id}`);
      return json(trace);
    },
  });
  mcp.addTool({
    name: 'skip_extraction',
    description: 'Mark an example as not worth turning into a lesson.',
    parameters: skipExtractionParams,
    execute: async (args: z.infer<typeof skipExtractionParams>) =>
      json(await requireTraceService(ctxFactory()).skip(args.trace_id, args.reason)),
  });
  mcp.addTool({
    name: 'save_extraction',
    description: 'Save the candidate lesson. Birdie verifies the quote and category in code.',
    parameters: saveExtractionParams,
    execute: async (args: z.infer<typeof saveExtractionParams>) => json(await requireTraceService(ctxFactory()).extract(args)),
  });
  mcp.addTool({
    name: 'list_lessons',
    description: `List lessons, including those ${copy.pendingReview}.`,
    parameters: listLessonsParams,
    execute: async (args: z.infer<typeof listLessonsParams>) => json(await requireLessonService(ctxFactory()).list(args)),
  });
  mcp.addTool({
    name: 'review_lesson',
    description: 'Edit a lesson, save it for later, or reject it.',
    parameters: reviewLessonParams,
    execute: async (args: z.infer<typeof reviewLessonParams>) => {
      const { lesson_id, ...changes } = args;
      return json(await requireLessonService(ctxFactory()).review(lesson_id, changes));
    },
  });
  mcp.addTool({
    name: 'promote_lesson',
    description: `${copy.privacyReminder} Then ${copy.promote}.`,
    parameters: promoteLessonParams,
    execute: async (args: z.infer<typeof promoteLessonParams>) => {
      const { lesson_id, ...payload } = args;
      return json(await requireLessonService(ctxFactory()).promote(lesson_id, payload));
    },
  });
  mcp.addTool({
    name: 'ask_senior_approach',
    description: 'Find reviewed lessons matching a junior question, optionally filtered to one senior.',
    parameters: askSeniorParams,
    execute: async (args: z.infer<typeof askSeniorParams>) =>
      json(await requireLessonService(ctxFactory()).askSeniorApproach(args.question, args.senior_name)),
  });
  mcp.addTool({
    name: 'ask_junior_struggles',
    description: 'Find reviewed lessons for a junior, with category counts.',
    parameters: askJuniorParams,
    execute: async (args: z.infer<typeof askJuniorParams>) =>
      json(await requireLessonService(ctxFactory()).askJuniorStruggles(args.junior_name)),
  });
}

export function completeSetupHandler(ctx: McpContext, args: z.infer<typeof setupParams>): BirdieConfig {
  const config: BirdieConfig =
    args.mode === 'remote' ? { mode: 'remote', server_url: args.server_url! } : { mode: 'local' };
  return ctx.completeSetup(config);
}

export function saveDomainProfileHandler(ctx: McpContext, args: z.infer<typeof domainProfileParams>): { path: string } {
  return ctx.saveDomainProfile(args.content);
}

export function openReviewQueueHandler(ctx: McpContext): Promise<{ url: string }> {
  return ctx.openReviewQueue();
}

function requireTraceService(ctx: McpContext) {
  if (!ctx.traceService) throw new Error('Birdie is not set up yet. Use the setup-birdie prompt first.');
  return ctx.traceService;
}

function requireLessonService(ctx: McpContext) {
  if (!ctx.lessonService) throw new Error('Birdie is not set up yet. Use the setup-birdie prompt first.');
  return ctx.lessonService;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
