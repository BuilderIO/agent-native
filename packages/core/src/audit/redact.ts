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
  /(?:pass(?:word|phrase)?|secret|token|api[_-]?key|apikey|authorization|bearer|credential|cookie|session[_-]?(?:id|token)|private[_-]?key|client[_-]?secret|signing[_-]?secret|access[_-]?key|refresh[_-]?token|webhook[_-]?(?:url|secret))/i;

const REDACTED = "[redacted]";
const MAX_STRING = 2000;
const MAX_DEPTH = 6;
const MAX_KEYS = 100;
const MAX_ARRAY = 100;
const MAX_JSON = 8000;
/**
 * Head room reserved for the `…(N more chars)` marker so a truncated summary
 * still fits its caller's cap. Callers below this cannot carry a marker at all.
 */
const MARKER_SLACK = 32;

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

function redactString(value: string, maxString: number): string {
  if (looksSecret(value)) return REDACTED;
  if (value.length > maxString) {
    return `${value.slice(0, maxString)}…(${value.length - maxString} more chars)`;
  }
  return value;
}

function redactEmbeddedSecrets(value: string): string {
  const bearer = value.replace(/\b(bearer\s+)([^\s"',}]+)/gi, `$1${REDACTED}`);
  const credentialField = new RegExp(
    `(["']?\\b${SENSITIVE_KEY.source}\\b["']?\\s*[:=]\\s*)(["']?)(?!bearer\\b)([^"'\\s,}]+)\\2`,
    "gi",
  );
  return bearer.replace(credentialField, `$1$2${REDACTED}$2`);
}

function redact(value: unknown, depth: number, maxString: number): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value, maxString);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const out = value
      .slice(0, MAX_ARRAY)
      .map((v) => redact(v, depth + 1, maxString));
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
      out[k] = SENSITIVE_KEY.test(k)
        ? REDACTED
        : redact(v, depth + 1, maxString);
    }
    return out;
  }
  // Functions, symbols, bigint, etc. — not serializable / not interesting.
  return undefined;
}

export interface RedactLimits {
  /**
   * Hard cap on the serialized output, INCLUDING the truncation envelope.
   * Surfaces with their own wire budget (the A2A activity snapshot) pass a
   * tighter cap than the audit-log default.
   */
  maxJson?: number;
  /** Cap on any single string value before it gets a truncation marker. */
  maxString?: number;
}

/**
 * Redact and serialize call arguments to a capped JSON string, or `null` when
 * there is nothing to record. Never throws.
 */
export function redactArgsToJson(
  args: unknown,
  limits?: RedactLimits,
): string | null {
  const maxJson = Math.max(MARKER_SLACK * 4, limits?.maxJson ?? MAX_JSON);
  const maxString = limits?.maxString ?? MAX_STRING;
  try {
    if (args == null) return null;
    const redacted = redact(args, 0, maxString);
    if (redacted === undefined) return null;
    const json = JSON.stringify(redacted);
    if (json == null) return null;
    if (json.length <= maxJson) return json;
    // Slicing the serialized JSON would yield an unparseable string. Wrap a
    // preview in a valid envelope so `get-audit-event` can always JSON.parse
    // the stored `input`. JSON escaping makes the envelope overhead
    // content-dependent, so shrink the preview until the whole thing measures
    // under the cap rather than guessing at the overhead.
    const envelope = (preview: string) =>
      JSON.stringify({
        _auditTruncated: true,
        originalBytes: json.length,
        preview,
      });
    let take = maxJson;
    let out = envelope(json.slice(0, take));
    while (out.length > maxJson && take > 0) {
      take = Math.max(0, take - Math.max(1, out.length - maxJson));
      out = envelope(json.slice(0, take));
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Same bounds as `redactArgsToJson`, returned as a structural value for
 * surfaces whose consumers expect an object (transcript `metadata.input`).
 */
export function redactArgsToValue(
  args: unknown,
  limits?: RedactLimits,
): unknown {
  const json = redactArgsToJson(args, limits);
  if (json == null) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Bounded, redacted plain-text summary of a tool result. Oversized text keeps
 * its head and gains an explicit `…(N more chars)` marker, so a reader can
 * always tell a short result from a clipped one.
 */
export function redactTextToSummary(
  text: string,
  maxChars = MAX_STRING,
): string | null {
  if (!text) return null;
  // Only ever walk a bounded head: a multi-megabyte tool result must not be
  // scanned in full just to produce a preview of it.
  const head = text.slice(0, maxChars + MARKER_SLACK);
  const redactedHead = redactEmbeddedSecrets(head);
  if (looksSecret(redactedHead.trim())) return REDACTED;
  if (text.length <= maxChars && redactedHead.length <= maxChars) {
    return redactedHead;
  }
  const keep = Math.max(0, maxChars - MARKER_SLACK);
  return `${redactedHead.slice(0, keep)}…(${text.length - keep} more chars)`;
}

/** Exposed for tests. */
export const __test = {
  looksSecret,
  redact,
  redactEmbeddedSecrets,
  SENSITIVE_KEY,
};
