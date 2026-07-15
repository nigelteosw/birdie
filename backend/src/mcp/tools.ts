import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { AppContext } from '../context.js';
import { copy } from '../copy.js';
import type { BirdieScope } from '../authPrincipal.js';
import type { McpSession } from './principal.js';

const emptyParams = z.object({});
const domainProfileParams = z.object({ content: z.string().min(1) });
const captureTraceParams = z.object({
  before_text: z.string().min(1),
  after_text: z.string().min(1),
  context_note: z.string().optional(),
});
const getTraceParams = z.object({ trace_id: z.string().min(1) });
const skipExtractionParams = z.object({ trace_id: z.string().min(1), reason: z.string().min(1) });
const saveExtractionParams = z.object({
  trace_id: z.string().min(1),
  quote: z.string().min(1),
  what_changed: z.string().min(1),
  why_it_matters: z.string().min(1),
});
const listLessonsParams = z.object({
  status: z.enum(['pending_review', 'rejected', 'promoted']).optional(),
  mine: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
const reviewLessonParams = z.object({
  lesson_id: z.string().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  reject: z.boolean().optional(),
});
const promoteLessonParams = z.object({
  lesson_id: z.string().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
});
const askLessonParams = z.object({
  question: z
    .string()
    .trim()
    .min(2)
    .refine((question) => /[\p{L}\p{N}]/u.test(question), 'Ask a question containing at least one letter or number.'),
  person: z.string().min(1).optional(),
});

export function registerTools(server: FastMCP<McpSession>, ctx: AppContext, baseUrl: string): void {
  server.addTool({
    name: 'get_domain_profile',
    description: "Read the current team's domain guidance.",
    parameters: emptyParams,
    canAccess: hasScope('birdie:read'),
    execute: async () => json({ content: ctx.domainProfile.raw }),
  });
  server.addTool({
    name: 'save_domain_profile',
    description: "Update the team's shared domain guidance.",
    parameters: domainProfileParams,
    canAccess: hasScope('birdie:write'),
    execute: async (args) => json(ctx.updateDomainProfile(args.content)),
  });
  server.addTool({
    name: 'open_review_queue',
    description: 'Return the hosted Birdie web UI URL when the user asks to open or review the queue.',
    parameters: emptyParams,
    canAccess: hasScope('birdie:read'),
    execute: async () => json({ url: baseUrl }),
  });
  server.addTool({
    name: 'capture_trace',
    description: 'Capture a clearly reusable before/after correction using verbatim original and corrected text, then extract a pending lesson in the same turn.',
    parameters: captureTraceParams,
    canAccess: hasScope('birdie:write'),
    execute: async (args, request) => {
      const user = requireSession(request.session).user;
      return json(ctx.traceService.capture({
        ...args,
        submitted_by: user.name,
        submitted_by_user_id: user.id,
      }));
    },
  });
  server.addTool({
    name: 'get_trace',
    description: 'Read an example before extracting a lesson from it.',
    parameters: getTraceParams,
    canAccess: hasScope('birdie:read'),
    execute: async (args) => {
      const trace = ctx.traceService.get(args.trace_id);
      if (!trace) throw new Error(`Trace not found: ${args.trace_id}`);
      return json(trace);
    },
  });
  server.addTool({
    name: 'skip_extraction',
    description: 'Mark an example as not worth turning into a lesson.',
    parameters: skipExtractionParams,
    canAccess: hasScope('birdie:write'),
    execute: async (args) => json(ctx.traceService.skip(args.trace_id, args.reason)),
  });
  server.addTool({
    name: 'save_extraction',
    description: 'Save a candidate lesson in pending_review. Copy quote exactly from the trace before_text and inspect quote_verified in the result.',
    parameters: saveExtractionParams,
    canAccess: hasScope('birdie:write'),
    execute: async (args) => json(ctx.traceService.extract(args)),
  });
  server.addTool({
    name: 'list_lessons',
    description: `List lessons, including those ${copy.pendingReview}.`,
    parameters: listLessonsParams,
    canAccess: hasScope('birdie:read'),
    execute: async (args, request) => {
      const user = requireSession(request.session).user;
      return json(ctx.lessonService.list({
        status: args.status,
        submitted_by_user_id: args.mine ? user.id : undefined,
        limit: args.limit,
      }));
    },
  });
  server.addTool({
    name: 'review_lesson',
    description: 'Edit, defer, or reject a pending lesson. Supply an exact before_text quote to correct an unverified quote.',
    parameters: reviewLessonParams,
    canAccess: hasScope('birdie:write'),
    execute: async (args) => {
      const { lesson_id, ...changes } = args;
      return json(ctx.lessonService.review(lesson_id, changes));
    },
  });
  server.addTool({
    name: 'promote_lesson',
    description: `${copy.privacyReminder} Promote only after explicit human approval of this lesson. Then ${copy.promote}.`,
    parameters: promoteLessonParams,
    canAccess: hasScope('birdie:write'),
    execute: async (args, request) => {
      const user = requireSession(request.session).user;
      const { lesson_id, ...changes } = args;
      return json(ctx.lessonService.promote(lesson_id, {
        ...changes,
        reviewer: user.name,
        reviewer_user_id: user.id,
      }));
    },
  });
  server.addTool({
    name: 'ask_lesson',
    description: 'Find promoted lessons relevant to a question for the client to synthesize.',
    parameters: askLessonParams,
    canAccess: hasScope('birdie:read'),
    execute: async (args) => json(ctx.lessonService.list({
      status: 'promoted',
      submitted_by: args.person,
      q: args.question,
      limit: 12,
    })),
  });
}

function hasScope(scope: BirdieScope): (session: McpSession) => boolean {
  return (session) => session.user.scopes.has(scope);
}

function requireSession(session: McpSession | undefined): McpSession {
  if (!session) throw new Error('Authentication required');
  return session;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
