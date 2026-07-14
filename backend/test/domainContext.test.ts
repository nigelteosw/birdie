import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { buildLocalContext } from '../src/context.js';

describe('shared domain profile', () => {
  it('updates the active server profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'birdie-domain-context-'));
    const ctx = buildLocalContext(':memory:', join(dir, 'domain.md'));
    ctx.updateDomainProfile('# Domain\nEngineering\n\n# What counts as mentorship-worthy\nReview guidance.');
    expect(ctx.domainProfile.raw).toBe('# Domain\nEngineering\n\n# What counts as mentorship-worthy\nReview guidance.\n');
    const trace = ctx.traceService.capture({ submitted_by: 'Ada', before_text: 'before', after_text: 'after' });
    expect(() =>
      ctx.traceService.extract({
        trace_id: trace.id,
        quote: 'before',
        what_changed: 'Improved it.',
        why_it_matters: 'Quality.',
      })
    ).not.toThrow();
  });
});
