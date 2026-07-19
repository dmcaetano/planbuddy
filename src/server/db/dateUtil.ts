/**
 * Normalizes a Postgres DATE column value to a plain "YYYY-MM-DD" string.
 * node-postgres parses DATE/TIMESTAMPTZ columns into JS `Date` objects by
 * default, while PGlite may return a string — this makes both consistent so
 * JS-side string comparisons (e.g. History's upcoming/past split) are safe.
 */
export function toDateOnlyString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}
