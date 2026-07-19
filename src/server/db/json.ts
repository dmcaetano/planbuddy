/** PostgreSQL JSONB rejects the escaped NUL sequence even though JSON permits it. */
function withoutNul(value: unknown): unknown {
  if (typeof value === "string") return value.split("\u0000").join("");
  if (Array.isArray(value)) return value.map(withoutNul);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key.split("\u0000").join(""),
        withoutNul(item),
      ])
    );
  }
  return value;
}

export function stringifyJsonForDb(value: unknown): string {
  return JSON.stringify(withoutNul(value));
}
