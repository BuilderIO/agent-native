const MAX_FORMATTER_CACHE = 256;

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const pluralRulesFormatters = new Map<string, Intl.PluralRules>();

function cacheKey(locale: string | undefined, options: object): string {
  const entries = Object.entries(options).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `${locale ?? ""}|${JSON.stringify(entries)}`;
}

function getOrInsert<T>(
  cache: Map<string, T>,
  key: string,
  create: () => T,
): T {
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  if (cache.size >= MAX_FORMATTER_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const created = create();
  cache.set(key, created);
  return created;
}

export function getCachedDateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return getOrInsert(
    dateTimeFormatters,
    cacheKey(locale, options),
    () => new Intl.DateTimeFormat(locale, options),
  );
}

export function getCachedNumberFormat(
  locale: string | undefined,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  return getOrInsert(
    numberFormatters,
    cacheKey(locale, options),
    () => new Intl.NumberFormat(locale, options),
  );
}

export function getCachedPluralRules(
  locale: string | undefined,
  options: Intl.PluralRulesOptions,
): Intl.PluralRules {
  return getOrInsert(
    pluralRulesFormatters,
    cacheKey(locale, options),
    () => new Intl.PluralRules(locale, options),
  );
}
