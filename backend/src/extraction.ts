export function verifyQuote(quote: string, beforeText: string): boolean {
  return quote.trim().length > 0 && beforeText.includes(quote);
}
