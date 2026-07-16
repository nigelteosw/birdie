import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

const skillPath = fileURLToPath(new URL('../../skills/birdie-mentor/SKILL.md', import.meta.url));
const skill = readFileSync(skillPath, 'utf8');

describe('birdie-mentor skill contract', () => {
  it('triggers on reusable corrections without requiring names', () => {
    expect(skill).toContain('Everyone can contribute and everyone can learn');
    expect(skill).toContain('regardless of whether anyone is named');
    expect(skill).toContain('original and corrected content are both visible');
    expect(skill).toContain('reason can guide similar future work');
    expect(skill).toContain('Skip typo-only, formatting-only, purely subjective, one-off');
  });

  it('captures a verified three-part pending lesson in the same turn', () => {
    expect(skill).toContain('same turn');
    expect(skill).toContain('capture_correction');
    expect(skill).toContain('What was initially wrong');
    expect(skill).toContain('What to do instead');
    expect(skill).toContain('Why it matters');
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

  it('checks for guidance at deliberate moments without noisy interruptions', () => {
    expect(skill).toContain('At task start');
    expect(skill).toContain('Before a consequential final action');
    expect(skill).toContain('search similarity is only a shortlist');
    expect(skill).toContain('remain silent');
  });
});
