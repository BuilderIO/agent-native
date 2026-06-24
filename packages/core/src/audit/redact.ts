/**
 * Redaction for audit-captured arguments.
 *
 * The audit log must never become a secondary store of secrets. Before any
 * call arguments are persisted we:
 *  - drop values under credential-looking keys (token, secret, password, …),
 *  - redact string values that look like bearer tokens / long opaque keys,
 *  - truncate oversized strings and cap the serialized payload size.
 *
 * This mirrors the framework's standing rule that credential-looking literals
 * never land in source, logs, or fixtures.
 */

const SENSITIVE_KEY =
  /(pass(word|phrase)?|secret|token|api[_-]?key|apikey|authorization|bearer|credential|cookie|session[_-]?(id|token)|private[_-]?key|client[_-]?secret|signing[_-]?secret|access[_-]?key|refresh[_-]?token|webhook[_-]?(url|secret))/i;

const REDACTED = "[redacted]";
const MAX_STRING = 2000;
const MAX_DEPTH = 6;
const MAX_KEYS = 100;
const MAX_ARRAY = 100;
const MAX_JSON = 8000;

/** Heuristic: does a bare string value look like a secret? */
function looksSecret(value: string): boolean {
  if (/^bearer\s+\S/i.test(value)) return true;
  // Long, unbroken, high-entropy-ish opaque token (hex/base64url, no spaces).
  if (value.length >= 32 && /^[A-Za-z0-9_\-+/=.]+$/.test(value)) return true;
  // Common secret prefixes (Stripe, GitHub, OpenAI, Slack, AWS, …).
  if (/^(sk|pk|rk|ghp|gho|xox[baprs]|AKIA|AIza|ya29)[-_]/i.test(value)) {
    return true;
  }
  // Webhook URLs carry their secret in the path — redact regardless of the key
  // they arrive under (e.g. a generic `value` field holding a Slack webhook).
  if (
    /^https?:\/\/(hooks\.slack\.com\/|[^/]*\.webhook\.office\.com\/|(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/|hooks\.zapier\.com\/|maker\.ifttt\.com\/|discord\.com\/api\/webhooks\/)/i.test(
      value,
    )
  ) {
    return true;
  }
  return false;
}

function redactString(value: string): string {
  if (looksSecret(value)) return REDACTED;
  if (value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…(${value.length - MAX_STRING} more chars)`;
  }
  return value;
}

function redact(value: unknown, depth: number): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ARRAY)
      out.push(`…(${value.length - MAX_ARRAY} more)`);
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n >= MAX_KEYS) {
        out["…"] = "(truncated)";
        break;
      }
      n += 1;
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  // Functions, symbols, bigint, etc. — not serializable / not interesting.
  return undefined;
}

/**
 * Redact and serialize call arguments to a capped JSON string, or `null` when
 * there is nothing to record. Never throws.
 */
export function redactArgsToJson(args: unknown): string | null {
  try {
    if (args == null) return null;
    const redacted = redact(args, 0);
    if (redacted === undefined) return null;
    const json = JSON.stringify(redacted);
    if (json == null) return null;
    if (json.length > MAX_JSON) {
      // Slicing the serialized JSON would yield an unparseable string. Wrap a
      // preview in a valid envelope so `get-audit-event` can always JSON.parse
      // the stored `input`.
      return JSON.stringify({
        _auditTruncated: true,
        originalBytes: json.length,
        preview: json.slice(0, MAX_JSON),
      });
    }
    return json;
  } catch {
    return null;
  }
}

/** Exposed for tests. */
export const __test = { looksSecret, redact, SENSITIVE_KEY };
