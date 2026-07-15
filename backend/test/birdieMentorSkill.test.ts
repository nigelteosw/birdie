import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

const skillPath = fileURLToPath(new URL('../../skills/birdie-mentor/SKILL.md', import.meta.url));
const skill = readFileSync(skillPath, 'utf8');

describe('birdie-mentor skill contract', () => {
  it('triggers on reusable corrections without requiring names', () => {
    expect(skill).toContain('regardless of whether anyone is named');
    expect(skill).toContain('original and corrected content are both visible');
    expect(skill).toContain('reason can guide similar future work');
    expect(skill).toContain('Skip typo-only, formatting-only, purely subjective, one-off');
  });

  it('captures and extracts a verified pending lesson in the same turn', () => {
    expect(skill).toContain('same turn');
    expect(skill).toContain('capture_trace');
    expect(skill).toContain('save_extraction');
    expect(skill).toContain('smallest exact contiguous excerpt from before_text');
    expect(skill).toContain('quote_verified');
    expect(skill).toContain('review_lesson');
    expect(skill).toContain('pending_review');
  });

  it('uses a brief notification and requires explicit promotion approval', () => {
    expect(skill).toContain('Saved a pending Birdie lesson:');
    expect(skill).toContain('Never call `promote_lesson` without explicit user approval');
    expect(skill).toContain('Call `open_review_queue` only when the user asks');
    expect(skill).toContain('If capture fails, report it and stop');
  });
});
