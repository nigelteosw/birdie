import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { loadDomainProfile, parseTypologyCategories } from '../src/domain.js';

describe('domain profile', () => {
  it('extracts typology categories', () => {
    const raw = '# Domain\nAudit.\n\n# Typology\n- materiality: Judgment.\n- control_design: Control design.\n\n# What counts as mentorship-worthy\nCalls.';
    expect(parseTypologyCategories(raw)).toEqual(['materiality', 'control_design']);
  });

  it('falls back when the file is missing', () => {
    expect(loadDomainProfile('/nonexistent/domain.md').typology_categories).toContain('substantive_risk');
  });

  it('loads from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'birdie-domain-'));
    const path = join(dir, 'domain.md');
    writeFileSync(path, '# Domain\nTax.\n\n# Typology\n- tax_risk: Risk.\n\n# What counts as mentorship-worthy\nRisk calls.');
    expect(loadDomainProfile(path).typology_categories).toEqual(['tax_risk']);
  });
});
