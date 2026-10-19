import { EMBED_RESULT_SENSITIVE_KEYS } from "../mcp/embed-redaction.js";

const REDACTED = "[REDACTED]";

const SENSITIVE_FIELD_PATTERN =
  /^(authorization|cookie|api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|bearer)$/i;

// Only the trailing words of a compound name count. A `…Token` is a
// credential unless it is a cursor such as `nextPageToken`, which an agent
// needs for a retry. A `…Ticket` can redeem an embed session.
const SENSITIVE_LAST_WORDS = new Set([
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "passphrase",
  "password",
  "secret",
  "secrets",
  "ticket",
]);
const SENSITIVE_LAST_WORD_PAIRS = new Set([
  "access key",
  "api key",
  "private key",
  "secret key",
]);
const CURSOR_TOKEN_QUALIFIERS = new Set([
  "continuation",
  "cursor",
  "idempotency",
  "next",
  "page",
  "prev",
  "previous",
  "resume",
  "sync",
]);

function isSensitiveCompoundFieldName(key: string): boolean {
  if (
    SENSITIVE_FIELD_PATTERN.test(key) ||
    EMBED_RESULT_SENSITIVE_KEYS.has(key)
  ) {
    return true;
  }
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const last = words.at(-1);
  if (!last) return false;
  if (SENSITIVE_LAST_WORDS.has(last)) return true;
  if (last === "token") {
    return words.length > 1 && !CURSOR_TOKEN_QUALIFIERS.has(words.at(-2)!);
  }
  return (
    words.length > 1 && SENSITIVE_LAST_WORD_PAIRS.has(`${words.at(-2)} ${last}`)
  );
}

const OPENAI_LIKE_SECRET_PATTERN =
  /(^|[^A-Za-z0-9_-])(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,})(?=$|[^A-Za-z0-9_-])/g;

/**
 * `compoundNames` also redacts names such as `clientSecret`, `x-api-key`,
 * `githubToken` or `embedTicket`.
 * Tool-error text leaves it off and keeps names like `mySecret` readable.
 */
export function redactSensitiveFields(
  value: unknown,
  options: { compoundNames?: boolean } = {},
): unknown {
  const isSensitive = options.compoundNames
    ? isSensitiveCompoundFieldName
    : (key: string) => SENSITIVE_FIELD_PATTERN.test(key);
  return redactWalk(value, new WeakSet<object>(), isSensitive);
}

function redactWalk(
  value: unknown,
  seen: WeakSet<object>,
  isSensitive: (key: string) => boolean,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((v) => redactWalk(v, seen, isSensitive));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitive(key)
      ? REDACTED
      : redactWalk(entry, seen, isSensitive);
  }
  return out;
}

export function sanitizeToolErrorText(value: string): string {
  let out = value;
  out = out.replace(/\bBearer\s+[^,\s;)}\]]+/gi, `Bearer ${REDACTED}`);
  out = out.replace(OPENAI_LIKE_SECRET_PATTERN, `$1${REDACTED}`);
  out = out.replace(
    /([?&](?:authorization|cookie|api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|bearer)=)[^&#\s]+/gi,
    `$1${REDACTED}`,
  );
  out = out.replace(
    /((?:^|[^A-Za-z0-9_-])(?:"|')?(?:authorization|cookie|api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|bearer)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\s;)}\]]+)/gi,
    (_match, prefix: string) => `${prefix}${REDACTED}`,
  );
  return out;
}

export function sanitizeToolErrorValue(value: unknown): string {
  if (value instanceof Error) return sanitizeToolErrorText(value.message);
  if (typeof value === "string") return sanitizeToolErrorText(value);
  try {
    return sanitizeToolErrorText(
      JSON.stringify(redactSensitiveFields(value), null, 2),
    );
  } catch {
    return sanitizeToolErrorText(String(value));
  }
}
