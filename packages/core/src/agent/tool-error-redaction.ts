import { EMBED_RESULT_SENSITIVE_KEYS } from "../mcp/embed-redaction.js";
import { redactSecretsInText } from "../shared/secret-redaction.js";

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
  "delta",
  "idempotency",
  "next",
  "page",
  "prev",
  "previous",
  "resume",
  "skip",
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

// The prefix names the tool, and a tool called `create_token` is not a field.
const TOOL_ERROR_PREFIX = /^Error running [^\s:]+:(?=\s|$)\s*/;

export function sanitizeToolErrorText(value: string): string {
  const prefix = TOOL_ERROR_PREFIX.exec(value)?.[0] ?? "";
  return (
    prefix +
    redactSecretsInText(value.slice(prefix.length), {
      placeholder: REDACTED,
      names: "named",
    })
  );
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
