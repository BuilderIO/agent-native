const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_STRING_LENGTH = 20_000;
const MAX_COLLECTION_ITEMS = 50;
const MAX_DEPTH = 4;

// Substrings checked against a normalized (letters/digits only, lowercased)
// key name. Matching on substrings — instead of an exact-name allow-list —
// catches compound and snake_case/camelCase variants like access_token,
// clientSecret, secretAccessKey, and credentials without listing every
// spelling individually.
const SENSITIVE_KEY_TERMS = [
  "authorization",
  "cookie",
  "password",
  "passphrase",
  "secret",
  "token",
  "apikey",
  "privatekey",
  "credential",
  "signingkey",
  "accesskey",
];
const ASSIGNMENT_PATTERN =
  /([A-Za-z][A-Za-z0-9_-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/g;
const BEARER_TOKEN = /(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_TERMS.some((term) => normalized.includes(term));
}

export function redactLogString(value: string): string {
  const truncated =
    value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`
      : value;
  return truncated
    .replace(ASSIGNMENT_PATTERN, (match, key: string, sep: string) =>
      isSensitiveKey(key) ? `${key}${sep}${REDACTED}` : match,
    )
    .replace(BEARER_TOKEN, `$1${REDACTED}`)
    .replace(JWT, REDACTED);
}

export function redactLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return redactLogString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogString(value.message),
      stack: value.stack ? redactLogString(value.stack) : undefined,
    };
  }
  if (value instanceof Uint8Array) {
    return `[${value.constructor.name} ${value.byteLength} bytes]`;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_COLLECTION_ITEMS)
      .map((item) => redactLogValue(item, depth + 1, seen));
    if (value.length > MAX_COLLECTION_ITEMS) items.push(TRUNCATED);
    return items;
  }

  const entries = Object.entries(value).slice(0, MAX_COLLECTION_ITEMS);
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    redacted[key] = isSensitiveKey(key)
      ? REDACTED
      : redactLogValue(item, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_COLLECTION_ITEMS) {
    redacted.__truncated__ = true;
  }
  return redacted;
}
