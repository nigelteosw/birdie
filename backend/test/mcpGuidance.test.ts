import { describe, expect, it } from 'bun:test';
import type { AppContext } from '../src/context.js';
import { buildCheckGuidancePrompt, buildExtractLessonPrompt } from '../src/mcp/prompts.js';
import { registerTools } from '../src/mcp/tools.js';

interface RegisteredTool {
  name: string;
  description: string;
}

function toolDescriptions(): Map<string, string> {
  const registered: RegisteredTool[] = [];
  const server = {
    addTool(tool: RegisteredTool) {
      registered.push(tool);
    },
  };

  registerTools(server as never, {} as AppContext, 'https://birdie.example.com');
  return new Map(registered.map((tool) => [tool.name, tool.description]));
}

describe('MCP lesson guidance', () => {
  it('keeps extraction pending and repairs an unverified quote', () => {
    const prompt = buildExtractLessonPrompt({ raw: '# Domain\nEngineering' }, 'trace-123');

    expect(prompt).toContain('smallest contiguous excerpt from before_text');
    expect(prompt).toContain('status is pending_review');
    expect(prompt).toContain('quote_verified is true');
    expect(prompt).toContain('call review_lesson with a corrected exact quote');
    expect(prompt).toContain('Never call promote_lesson without explicit user approval');
  });

  it('excludes edits that should not become lessons', () => {
    const prompt = buildExtractLessonPrompt({ raw: '# Domain\nEngineering' }, 'trace-123');

    expect(prompt).toContain('typo-only');
    expect(prompt).toContain('formatting-only');
    expect(prompt).toContain('subjective');
    expect(prompt).toContain('one-off');
    expect(prompt).toContain('unsafe-to-store');
  });

  it('describes the same lifecycle on raw MCP tools', () => {
    const descriptions = toolDescriptions();

    expect(descriptions.get('capture_correction')).toContain('three-part');
    expect(descriptions.get('capture_correction')).toContain('same turn');
    expect(descriptions.get('capture_correction')).toContain('before_text');
    expect(descriptions.get('capture_trace')).toContain('clearly reusable');
    expect(descriptions.get('capture_trace')).toContain('verbatim');
    expect(descriptions.get('capture_trace')).toContain('same turn');
    expect(descriptions.get('save_extraction')).toContain('pending_review');
    expect(descriptions.get('save_extraction')).toContain('before_text');
    expect(descriptions.get('save_extraction')).toContain('quote_verified');
    expect(descriptions.get('review_lesson')).toContain('correct an unverified quote');
    expect(descriptions.get('open_review_queue')).toContain('when the user asks');
    expect(descriptions.get('promote_lesson')).toContain('explicit human approval');
  });

  it('requires grounded source text and capture boundaries on raw MCP tools', () => {
    const captureTrace = toolDescriptions().get('capture_trace');

    expect(captureTrace).toContain('both original and corrected content are visible');
    expect(captureTrace).toContain('Never invent either side');
    expect(captureTrace).toContain('typo-only');
    expect(captureTrace).toContain('formatting-only');
    expect(captureTrace).toContain('subjective');
    expect(captureTrace).toContain('one-off');
    expect(captureTrace).toContain('unsafe-to-store');
  });

  it('treats contextual retrieval as a shortlist rather than permission to interrupt', () => {
    const descriptions = toolDescriptions();
    const prompt = buildCheckGuidancePrompt({
      task: 'Prepare a final project update',
      stage: 'before sending',
    });

    expect(descriptions.get('check_guidance')).toContain('search similarity alone');
    expect(descriptions.get('check_guidance')).toContain('one sentence explaining why');
    expect(prompt).toContain('same kind of decision');
    expect(prompt).toContain('remain silent');
    expect(prompt).toContain('one sentence');
  });

  it('requires explicit human selection before merging duplicate evidence', () => {
    const descriptions = toolDescriptions();

    expect(descriptions.get('find_similar_lessons')).toContain('duplicate or conflict');
    expect(descriptions.get('merge_lesson')).toContain('explicitly selects');
    expect(descriptions.get('merge_lesson')).toContain('three fields remain unchanged');
  });
});
