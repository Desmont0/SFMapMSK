// Scrub legacy phone properties before data is persisted or migrated.
export function withoutPhone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => withoutPhone(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key.toLowerCase() !== 'phone')
    .map(([key, child]) => [key, withoutPhone(child)])) as T;
}
