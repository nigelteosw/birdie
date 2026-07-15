import { describe, expect, it } from 'bun:test';
import type { AppContext } from '../src/context.js';
import { buildExtractLessonPrompt } from '../src/mcp/prompts.js';
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

  it('describes the same lifecycle on raw MCP tools', () => {
    const descriptions = toolDescriptions();

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
});
