import { readFileSync } from 'node:fs';

export interface DomainProfile {
  raw: string;
}

export const DEFAULT_PROFILE = `# Domain
A general legal practice reviewing contracts and client work product.

# What counts as mentorship-worthy
Capture edits that reflect a real judgment call - a risk tradeoff, a
playbook rule being applied, or a drafting principle. Skip pure typo
fixes, whitespace/formatting-only changes, and edits with no
identifiable reasoning behind them.
`;

export function loadDomainProfile(path: string): DomainProfile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    raw = DEFAULT_PROFILE;
  }
  return { raw };
}
