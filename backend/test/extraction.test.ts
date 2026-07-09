import { describe, expect, it } from 'bun:test';
import { verifyQuote } from '../src/extraction.js';

describe('verifyQuote', () => {
  it('accepts an exact substring', () => {
    expect(verifyQuote('shall indemnify', 'The party shall indemnify all losses.')).toBe(true);
  });

  it('rejects text that is not present', () => {
    expect(verifyQuote('shall not indemnify', 'The party shall indemnify all losses.')).toBe(false);
  });

  it('is sensitive to whitespace differences', () => {
    expect(verifyQuote('shall  indemnify', 'The party shall indemnify all losses.')).toBe(false);
  });

  it('rejects an empty quote', () => {
    expect(verifyQuote('', 'The party shall indemnify all losses.')).toBe(false);
  });
});
