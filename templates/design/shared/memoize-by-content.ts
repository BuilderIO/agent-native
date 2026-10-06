const DERIVE_CANDIDATES = 4;
// Each edit makes a new document, so a count limit alone keeps hundreds of
// stale copies of a large screen alive.
export const MAX_CACHED_CONTENT_CHARS = 24_000_000;

export interface ContentMemo<T> {
  (content: string): T;
  has(content: string): boolean;
  /** Stores a result computed elsewhere, such as in a worker. */
  prime(content: string, value: T): void;
}

// Keyed on the whole string, not a hash: a collision would hand one document's
// result to another. Results are shared — callers must not mutate them.
export function memoizeByContent<T>(
  limit: number,
  compute: (content: string) => T,
  derive?: (previousContent: string, previous: T, content: string) => T | null,
): ContentMemo<T> {
  const cache = new Map<string, T>();
  let cachedChars = 0;
  const store = (content: string, value: T) => {
    cache.set(content, value);
    cachedChars += content.length;
    while (
      cache.size > 1 &&
      (cache.size > limit || cachedChars > MAX_CACHED_CONTENT_CHARS)
    ) {
      const oldest = cache.keys().next().value as string;
      cache.delete(oldest);
      cachedChars -= oldest.length;
    }
  };
  const deriveFromRecent = (content: string): T | null => {
    if (!derive) return null;
    const recent = [...cache].slice(-DERIVE_CANDIDATES).reverse();
    for (const [previousContent, previous] of recent) {
      const derived = derive(previousContent, previous, content);
      if (derived !== null) return derived;
    }
    return null;
  };
  const memo = ((content: string) => {
    if (cache.has(content)) {
      const cached = cache.get(content) as T;
      cache.delete(content);
      cache.set(content, cached);
      return cached;
    }
    const value = deriveFromRecent(content) ?? compute(content);
    store(content, value);
    return value;
  }) as ContentMemo<T>;
  memo.has = (content) => cache.has(content);
  memo.prime = (content, value) => {
    if (!cache.has(content)) store(content, value);
  };
  return memo;
}
