/**
 * Quote-or-demote: an extracted direct statement is only trustworthy if the
 * model's quote is a verbatim substring of the source message at the
 * offsets it claims. Anything that fails this mechanical check is demoted
 * (never filters as a constraint; at most becomes a hunch).
 */
export function verifyQuote(
  sourceMessage: string,
  quote: string | null | undefined,
  quoteStart: number | null | undefined,
  quoteEnd: number | null | undefined
): boolean {
  if (!quote || quoteStart == null || quoteEnd == null) return false;
  if (quoteStart < 0 || quoteEnd <= quoteStart || quoteEnd > sourceMessage.length) return false;
  const slice = sourceMessage.slice(quoteStart, quoteEnd);
  if (slice !== quote) return false;
  return sourceMessage.includes(quote);
}
