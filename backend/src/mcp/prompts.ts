import type { FastMCP } from 'fastmcp';
import { buildMcpContext, type McpContext } from '../mcpContext.js';
import type { DomainProfile } from '../domain.js';

export function registerPrompts(server: FastMCP, ctxFactory: () => McpContext = buildMcpContext): void {
  const mcp = server as any;
  mcp.addPrompt({
    name: 'setup-birdie',
    description: 'Guide a first-time user through local or shared-server setup and optional category setup.',
    arguments: [],
    load: async () => buildSetupPrompt(ctxFactory().domainProfile),
  });
  mcp.addPrompt({
    name: 'configure-birdie',
    description: 'Inspect or change Birdie settings, including local vs shared server mode and category/domain profile.',
    arguments: [],
    load: async () => buildConfigurePrompt(),
  });
  mcp.addPrompt({
    name: 'extract-lesson',
    description: 'Extract a mentorship lesson from a captured example.',
    arguments: [{ name: 'trace_id', description: 'The example to extract from', required: true }],
    load: async (args: { trace_id: string }) => buildExtractLessonPrompt(ctxFactory().domainProfile, args.trace_id),
  });
  mcp.addPrompt({
    name: 'ask-lesson',
    description: "Answer a question from the team's promoted lessons, optionally scoped to one person.",
    arguments: [
      { name: 'question', description: 'What the user wants to know', required: true },
      { name: 'person', description: 'Only consider lessons submitted by this person', required: false },
    ],
    load: async (args: { question: string; person?: string }) => buildAskLessonPrompt(args.question, args.person),
  });
}

export function buildSetupPrompt(profile: DomainProfile): string {
  return `Birdie needs a one-time setup.

Ask the user, in plain language, whether they already have a Birdie server URL from their team, and what their own name is (so Birdie can remember it and skip asking again later).

If they provide a URL, call complete_setup with mode="remote", server_url set to that URL, and user_name set to their name.
If they do not have one, call complete_setup with mode="local" and user_name set to their name.

Then offer to customize their team's categories. If they want to customize, ask what field they are in and what kinds of edits matter. Turn their answer into this markdown shape and call save_domain_profile:

# Domain
One paragraph.

# Typology
- category_name: one-line definition

# What counts as mentorship-worthy
Guidance.

Current default:
${profile.raw}`;
}

export function buildConfigurePrompt(): string {
  return `Help the user inspect or change Birdie settings.

Steps:
1. Call get_birdie_settings and summarize the current mode, shared server URL if present, remembered user_name if present, review queue URL, and config/domain file paths.
2. Ask what they want to change only if their request is ambiguous.
3. To switch to local storage, call update_birdie_settings with mode="local".
4. To connect to a shared local or remote backend, call update_birdie_settings with mode="remote" and server_url set to the provided URL.
5. To update their remembered name, call update_birdie_settings with just user_name set — mode is not required for a name-only change.
6. To review categories, call get_domain_profile.
7. To change categories, ask for the domain and what edits matter, then write a markdown profile with # Domain, # Typology, and # What counts as mentorship-worthy, and call save_domain_profile.
8. If something looks broken, call birdie_doctor and explain the failing check in plain language.`;
}

export function buildExtractLessonPrompt(profile: DomainProfile, traceId: string): string {
  return `Extract a mentorship lesson from trace_id="${traceId}".

${profile.raw}

Steps:
1. Call get_trace with trace_id="${traceId}".
2. Decide if the example is mentorship-worthy using the guidance above. If not, call skip_extraction with a short reason and stop.
3. If it is worth capturing, prepare quote, what_changed, why_it_matters, typology, and optional playbook_alignment/playbook_note.
4. The quote must be copied verbatim from before_text. Birdie checks this in code.
5. If the edit differs from the playbook, say that directly in playbook_note.
6. Call save_extraction.`;
}

export function buildAskLessonPrompt(question: string, person?: string): string {
  return `Answer this question using Birdie's promoted lessons: "${question}"${person ? ` (scoped to lessons submitted by ${person})` : ''}.

Steps:
1. Call ask_lesson with question="${question}"${person ? ` and person="${person}"` : ''}.
2. Synthesize an answer strictly from the returned lesson cards (quote / what_changed / why_it_matters).
3. If nothing relevant comes back, say so plainly instead of inventing an answer.`;
}
