import type { FastMCP } from 'fastmcp';
import type { AppContext } from '../context.js';
import type { DomainProfile } from '../domain.js';
import type { McpSession } from './principal.js';

export function registerPrompts(server: FastMCP<McpSession>, ctx: AppContext): void {
  server.addPrompt({
    name: 'extract-lesson',
    description: 'Extract a mentorship lesson from a captured example.',
    arguments: [{ name: 'trace_id', description: 'The example to extract from', required: true }],
    load: async (args) => buildExtractLessonPrompt(ctx.domainProfile, args.trace_id!),
  });
  server.addPrompt({
    name: 'ask-lesson',
    description: "Answer a question from the team's promoted lessons, optionally scoped to one person.",
    arguments: [
      { name: 'question', description: 'What the user wants to know', required: true },
      { name: 'person', description: 'Only consider lessons submitted by this person', required: false },
    ],
    load: async (args) => buildAskLessonPrompt(args.question!, args.person),
  });
}

export function buildExtractLessonPrompt(profile: DomainProfile, traceId: string): string {
  return `Extract a mentorship lesson from trace_id="${traceId}".

${profile.raw}

Steps:
1. Call get_trace with trace_id="${traceId}".
2. Decide if the example is mentorship-worthy using the guidance above. Do not capture typo-only, formatting-only, subjective, one-off, or unsafe-to-store edits. If it is not mentorship-worthy, call skip_extraction with a short reason and stop.
3. If it is worth capturing, prepare quote, what_changed, and why_it_matters. Use what_changed for the correction and why_it_matters for the transferable principle.
4. Copy quote verbatim as the smallest contiguous excerpt from before_text that preserves the point. Never quote after_text or paraphrase the original.
5. Call save_extraction and inspect the returned lesson. Confirm its status is pending_review and quote_verified is true.
6. If quote_verified is false, use the trace's before_text to call review_lesson with a corrected exact quote. If verification still fails, leave the lesson pending and report the problem plainly.
7. Briefly tell the user what was saved and that it is waiting for review. Do not open the review queue unless asked.

Never call promote_lesson without explicit user approval of that lesson. Before promotion, remove client names, matter names, secrets, and other details that should not be shared.`;
}

export function buildAskLessonPrompt(question: string, person?: string): string {
  return `Answer this question using Birdie's promoted lessons: "${question}"${person ? ` (scoped to lessons submitted by ${person})` : ''}.

Steps:
1. Call ask_lesson with question="${question}"${person ? ` and person="${person}"` : ''}.
2. Synthesize an answer strictly from the returned lesson cards.
3. If nothing relevant comes back, say so plainly instead of inventing an answer.`;
}
