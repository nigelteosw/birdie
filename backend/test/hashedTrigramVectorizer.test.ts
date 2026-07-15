import { describe, expect, it } from 'bun:test';
import { hashedTrigramVector, vectorSimilarity } from '../src/adapters/postgres/hashedTrigramVectorizer.js';

describe('hashed trigram vectors', () => {
  it('returns deterministic finite normalized vectors', () => {
    const first = hashedTrigramVector('Limit the liability exposure.');
    const second = hashedTrigramVector('Limit the liability exposure.');

    expect(first).toEqual(second);
    expect(first).toHaveLength(512);
    expect(first.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...first)).toBeCloseTo(1, 8);
  });

  it('ranks overlapping text above unrelated text', () => {
    const query = hashedTrigramVector('liability cap');
    const related = hashedTrigramVector('cap the liability exposure');
    const unrelated = hashedTrigramVector('schedule a team meeting');

    expect(vectorSimilarity(query, related)).toBeGreaterThan(vectorSimilarity(query, unrelated));
  });
});
