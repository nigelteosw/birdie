export const HASHED_TRIGRAM_DIMENSIONS = 512;
export const HASHED_TRIGRAM_VECTORIZER_ID = 'birdie-hashed-trigram-v1';

export function hashedTrigramVector(text: string): number[] {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
  const vector = Array<number>(HASHED_TRIGRAM_DIMENSIONS).fill(0);
  if (!normalized) return vector;

  const characters = Array.from(`  ${normalized}  `);
  for (let index = 0; index <= characters.length - 3; index += 1) {
    const hash = fnv1a(characters.slice(index, index + 3).join(''));
    const bucket = hash & (HASHED_TRIGRAM_DIMENSIONS - 1);
    const sign = (hash & HASHED_TRIGRAM_DIMENSIONS) === 0 ? 1 : -1;
    vector[bucket] += sign;
  }

  const magnitude = Math.hypot(...vector);
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

export function vectorSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) throw new Error('Cannot compare vectors with different dimensions.');
  return left.reduce((total, value, index) => total + value * right[index], 0);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
