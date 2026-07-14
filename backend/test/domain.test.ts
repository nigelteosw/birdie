import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { DEFAULT_PROFILE, loadDomainProfile } from '../src/domain.js';

describe('domain profile', () => {
  it('falls back to the default profile when the file is missing', () => {
    expect(loadDomainProfile('/nonexistent/domain.md').raw).toBe(DEFAULT_PROFILE);
  });

  it('loads from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'birdie-domain-'));
    const path = join(dir, 'domain.md');
    const content = '# Domain\nTax.\n\n# What counts as mentorship-worthy\nRisk calls.';
    writeFileSync(path, content);
    expect(loadDomainProfile(path).raw).toBe(content);
  });
});
