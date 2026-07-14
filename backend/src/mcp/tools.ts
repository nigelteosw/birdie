import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import { buildMcpContext, type McpContext } from '../mcpContext.js';
import type { BirdieConfig } from '../types.js';
import { copy } from '../copy.js';
import { openDb } from '../db.js';
import { readDomainProfileFile, readSettingsSummary, writeConfig } from '../config.js';

export type McpContextFactory = () => McpContext;

// A discriminated union serializes to a top-level `anyOf` with no `type:
// "object"`, which Claude Code's MCP client rejects for tool inputSchemas.
// Flatten to one object and cross-validate server_url with superRefine.
const setupParams = z
  .object({
    mode: z.enum(['local', 'remote']),
    server_url: z.string().url().optional(),
    user_name: z.string().min(1).optional(),
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
const updateSettingsParams = z
  .object({
    mode: z.enum(['local', 'remote']).optional(),
    server_url: z.string().url().optional(),
    user_name: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'remote' && !data.server_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'server_url is required when mode is "remote"',
        path: ['server_url'],
      });
    }
    if (!data.mode && data.server_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'mode is required when server_url is provided',
        path: ['mode'],
      });
    }
    if (!data.mode && !data.server_url && !data.user_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least mode or user_name to update.',
        path: ['mode'],
      });
    }
  });
const captureTraceParams = z.object({
  before_text: z.string().min(1),
  after_text: z.string().min(1),
  submitted_by: z.string().min(1).optional(),
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
  reviewer: z.string().trim().min(1),
  quote: z.string().min(1).optional(),
  what_changed: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
});
const askLessonParams = z.object({
  question: z
    .string()
    .trim()
    .min(2)
    .refine(hasSearchTerms, 'Ask a question containing at least one letter or number.'),
  person: z.string().min(1).optional(),
});

export function registerTools(server: FastMCP, ctxFactory: McpContextFactory = buildMcpContext): void {
  const mcp = server as any;

  mcp.addTool({
    name: 'complete_setup',
    description:
      "Finish Birdie's first-run setup by choosing local storage or a shared Birdie server. Pass user_name so Birdie remembers who's chatting without asking again.",
    parameters: setupParams,
    execute: async (args: z.infer<typeof setupParams>) => json(completeSetupHandler(ctxFactory(), args)),
  });
  mcp.addTool({
    name: 'get_birdie_settings',
    description:
      'Show whether Birdie is configured, which mode it uses, the shared server URL if any, the remembered user_name, and local file paths.',
    parameters: emptyParams,
    execute: async () => json(getBirdieSettingsHandler()),
  });
  mcp.addTool({
    name: 'update_birdie_settings',
    description:
      'Switch Birdie between local storage and a shared remote server, and/or update the remembered user_name. Use mode="local" for local storage or mode="remote" with server_url for a shared Birdie backend.',
    parameters: updateSettingsParams,
    execute: async (args: z.infer<typeof updateSettingsParams>) => json(updateBirdieSettingsHandler(args)),
  });
  mcp.addTool({
    name: 'get_domain_profile',
    description: "Read the current team/domain profile so users can review Birdie's mentorship-worthy guidance.",
    parameters: emptyParams,
    execute: async () => json(await getDomainProfileHandler(ctxFactory())),
  });
  mcp.addTool({
    name: 'birdie_doctor',
    description: 'Run quick setup checks and explain what the user should fix next.',
    parameters: emptyParams,
    execute: async () => json(await birdieDoctorHandler(ctxFactory())),
  });
  mcp.addTool({
    name: 'save_domain_profile',
    description: "Save your team's domain guidance after the setup interview.",
    parameters: domainProfileParams,
    execute: async (args: z.infer<typeof domainProfileParams>) => json(await saveDomainProfileHandler(ctxFactory(), args)),
  });
  mcp.addTool({
    name: 'open_review_queue',
    description:
      'Open the review queue in a browser-friendly web page. Defaults to http://127.0.0.1:6677; override with the PORT env var. Falls back to a random free port if 6677 is already in use by something other than Birdie.',
    parameters: emptyParams,
    execute: async () => json(await openReviewQueueHandler(ctxFactory())),
  });
  mcp.addTool({
    name: 'capture_trace',
    description:
      "Capture a before/after edit as an example for later lesson extraction. Omit submitted_by to use the remembered user_name.",
    parameters: captureTraceParams,
    execute: async (args: z.infer<typeof captureTraceParams>) => json(await captureTraceHandler(ctxFactory(), args)),
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
    description: 'Save the candidate lesson. Birdie verifies the quote in code.',
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
    name: 'ask_lesson',
    description:
      'Find promoted lessons relevant to a question, optionally scoped to one person, for you to synthesize an answer from.',
    parameters: askLessonParams,
    execute: async (args: z.infer<typeof askLessonParams>) =>
      json(
        await requireLessonService(ctxFactory()).list({
          status: 'promoted',
          submitted_by: args.person,
          q: args.question,
          limit: 12,
        })
      ),
  });
}

export async function captureTraceHandler(ctx: McpContext, args: z.infer<typeof captureTraceParams>) {
  const submitted_by = args.submitted_by ?? readSettingsSummary().user_name;
  if (!submitted_by) {
    throw new Error('submitted_by is required: no remembered user_name to fall back to. Pass submitted_by explicitly.');
  }
  return requireTraceService(ctx).capture({ ...args, submitted_by });
}

export function completeSetupHandler(ctx: McpContext, args: z.infer<typeof setupParams>): BirdieConfig {
  const config: BirdieConfig =
    args.mode === 'remote'
      ? { mode: 'remote', server_url: args.server_url!, user_name: args.user_name }
      : { mode: 'local', user_name: args.user_name };
  return ctx.completeSetup(config);
}

export function getBirdieSettingsHandler() {
  return readSettingsSummary();
}

export function updateBirdieSettingsHandler(args: z.infer<typeof updateSettingsParams>): BirdieConfig {
  const current = readSettingsSummary();
  const mode = args.mode ?? (current.mode === 'unconfigured' ? undefined : current.mode);
  if (!mode) throw new Error('mode is required.');
  const user_name = args.user_name ?? current.user_name;
  const config: BirdieConfig =
    mode === 'remote'
      ? { mode: 'remote', server_url: args.server_url ?? current.server_url!, user_name }
      : { mode: 'local', user_name };
  if (config.mode === 'local') {
    const db = openDb(readSettingsSummary().dbPath);
    db.close();
  }
  return writeConfig(config);
}

export async function getDomainProfileHandler(ctx: McpContext) {
  const loaded = await ctx.getDomainProfile();
  const saved = ctx.mode === 'remote' ? undefined : readDomainProfileFile();
  return {
    path: ctx.mode === 'remote' ? `${readSettingsSummary().server_url}/domain` : saved!.path,
    customized: ctx.mode === 'remote' || saved!.customized,
    content: loaded.raw,
  };
}

export async function birdieDoctorHandler(ctx: McpContext) {
  const settings = readSettingsSummary();
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    {
      name: 'config',
      ok: settings.configured,
      detail: settings.configured
        ? `Birdie is configured for ${settings.mode} mode.`
        : 'Birdie is not configured. Run setup-birdie or update_birdie_settings.',
    },
    {
      name: 'user_name',
      ok: Boolean(settings.user_name),
      detail: settings.user_name
        ? `Remembered as "${settings.user_name}".`
        : 'No user_name remembered yet — capture_trace will need submitted_by passed explicitly until one is set.',
    },
  ];

  if (settings.mode === 'local') {
    if (typeof Bun === 'undefined') {
      checks.push(nodeVersionCheck());
    }
    try {
      const db = openDb(settings.dbPath);
      db.close();
      checks.push({ name: 'database', ok: true, detail: settings.dbPath });
    } catch (err) {
      checks.push({ name: 'database', ok: false, detail: errorMessage(err) });
    }
  }

  if (settings.mode === 'remote' && settings.server_url) {
    checks.push(await checkRemoteServer(settings.server_url));
  }

  try {
    const domainInfo = await getDomainProfileHandler(ctx);
    checks.push({
      name: 'domain_profile',
      ok: domainInfo.content.length > 0,
      detail: domainInfo.customized
        ? `Customized domain profile loaded from ${domainInfo.path}.`
        : 'Still using the generic built-in default — ask Birdie to customize it for your team.',
    });
  } catch (err) {
    checks.push({ name: 'domain_profile', ok: false, detail: errorMessage(err) });
  }

  return { settings, checks, ok: checks.every((check) => check.ok) };
}

export function saveDomainProfileHandler(ctx: McpContext, args: z.infer<typeof domainProfileParams>): Promise<{ path: string }> {
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

async function checkRemoteServer(serverUrl: string): Promise<{ name: string; ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/__birdie`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { name: 'remote_server', ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { birdie?: boolean };
    return body.birdie === true
      ? { name: 'remote_server', ok: true, detail: serverUrl }
      : { name: 'remote_server', ok: false, detail: 'Server did not identify as Birdie.' };
  } catch (err) {
    return { name: 'remote_server', ok: false, detail: errorMessage(err) };
  }
}

function nodeVersionCheck(): { name: string; ok: boolean; detail: string } {
  const version = process.versions.node;
  const [major, minor] = version.split('.').map(Number);
  const ok = major > 22 || (major === 22 && minor >= 13);
  return {
    name: 'node_version',
    ok,
    detail: ok
      ? `Node ${version} supports the built-in SQLite driver local mode needs.`
      : `Node ${version} is too old — local mode needs Node 22.13+ for built-in SQLite support. Upgrade Node.`,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hasSearchTerms(question: string): boolean {
  return /[\p{L}\p{N}]/u.test(question);
}
