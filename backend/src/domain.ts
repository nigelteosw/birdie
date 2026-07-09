import { readFileSync } from 'node:fs';

export interface DomainProfile {
  raw: string;
  typology_categories: string[];
}

export const DEFAULT_PROFILE = `# Domain
A general legal practice reviewing contracts and client work product.

# Typology
- playbook_compliance: The edit enforces a documented firm playbook/style-guide rule.
- editorial_style: A stylistic or formatting preference with no risk or playbook basis.
- substantive_risk: A legal risk or liability judgment call.
- clarity_precision: The edit resolves ambiguity or tightens vague drafting.
- other: Doesn't fit the above.

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
  const typology_categories = parseTypologyCategories(raw);
  return {
    raw: typology_categories.length > 0 ? raw : DEFAULT_PROFILE,
    typology_categories: typology_categories.length > 0 ? typology_categories : parseTypologyCategories(DEFAULT_PROFILE),
  };
}

export function parseTypologyCategories(raw: string): string[] {
  const section = raw.split(/^# Typology\s*$/m)[1];
  if (!section) return [];
  const body = section.split(/^# /m)[0];
  const categories: string[] = [];
  for (const line of body.split('\n')) {
    const match = line.match(/^-\s*([a-zA-Z0-9_ -]+?)\s*:/);
    if (match) categories.push(match[1].trim().replace(/\s+/g, '_'));
  }
  return categories;
}
