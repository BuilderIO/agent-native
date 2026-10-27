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
const MARKER_SLACK = 32;
const GOOGLE_API_KEY = /AIzaSy[A-Za-z0-9_-]{20,}/g;

function looksCredential(value: string): boolean {
  if (/^bearer\s+\S/i.test(value)) return true;
  if (/^AIzaSy[A-Za-z0-9_-]{20,}$/i.test(value)) return true;
  if (/^(sk|pk|rk|ghp|gho|xox[baprs]|AKIA|AIza|ya29)[-_]/i.test(value)) {
    return true;
  }
  if (
    /^https?:\/\/(hooks\.slack\.com\/|[^/]*\.webhook\.office\.com\/|(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/|hooks\.zapier\.com\/|maker\.ifttt\.com\/|discord\.com\/api\/webhooks\/)/i.test(
      value,
    )
  ) {
    return true;
  }
  return false;
}

function looksSecret(value: string): boolean {
  return (
    looksCredential(value) ||
    (value.length >= 32 && /^[A-Za-z0-9_\-+/=.]+$/.test(value))
  );
}

function redactString(
  value: string,
  limits: Required<Pick<RedactLimits, "maxString" | "overflow">> &
    Pick<RedactLimits, "redactEmbeddedSecrets" | "redactGenericOpaqueStrings">,
): string {
  if (
    limits.redactGenericOpaqueStrings === false
      ? looksCredential(value)
      : looksSecret(value)
  ) {
    return REDACTED;
  }
  if (value.length > limits.maxString && limits.overflow === "throw") {
    throw new Error("Redacted value exceeds the configured string limit.");
  }
  const redactedValue = limits.redactEmbeddedSecrets
    ? redactEmbeddedSecrets(value)
    : value;
  if (redactedValue.length > limits.maxString) {
    return `${redactedValue.slice(0, limits.maxString)}…(${redactedValue.length - limits.maxString} more chars)`;
  }
  return redactedValue;
}

function redactEmbeddedSecrets(value: string): string {
  const bearer = value
    .replace(/\b(bearer\s+)([^\s"',}]+)/gi, `$1${REDACTED}`)
    .replace(GOOGLE_API_KEY, REDACTED);
  const credentialField = new RegExp(
    `(["']?\\b${SENSITIVE_KEY.source}\\b["']?\\s*[:=]\\s*)(["']?)(?!bearer\\b)([^"'\\s,}]+)\\2`,
    "gi",
  );
  return bearer.replace(credentialField, `$1$2${REDACTED}$2`);
}

function redact(
  value: unknown,
  depth: number,
  limits: Required<
    Pick<
      RedactLimits,
      "maxString" | "maxDepth" | "maxKeys" | "maxArray" | "overflow"
    >
  > &
    Pick<RedactLimits, "redactEmbeddedSecrets" | "redactGenericOpaqueStrings">,
): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value, limits);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= limits.maxDepth) {
    if (limits.overflow === "throw") {
      throw new Error("Redacted value exceeds the configured depth limit.");
    }
    return "[…]";
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArray && limits.overflow === "throw") {
      throw new Error("Redacted value exceeds the configured array limit.");
    }
    const out = value
      .slice(0, limits.maxArray)
      .map((v) => redact(v, depth + 1, limits));
    if (value.length > limits.maxArray)
      out.push(`…(${value.length - limits.maxArray} more)`);
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n >= limits.maxKeys) {
        if (limits.overflow === "throw") {
          throw new Error("Redacted value exceeds the configured key limit.");
        }
        out["…"] = "(truncated)";
        break;
      }
      n += 1;
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1, limits);
    }
    return out;
  }
  if (limits.overflow === "throw") {
    throw new Error("Redacted value contains a non-JSON value.");
  }
  return undefined;
}

export interface RedactLimits {
  maxJson?: number;
  maxString?: number;
  maxDepth?: number;
  maxKeys?: number;
  maxArray?: number;
  overflow?: "truncate" | "throw";
  redactEmbeddedSecrets?: boolean;
  redactGenericOpaqueStrings?: boolean;
}

export function redactArgsToJson(
  args: unknown,
  limits?: RedactLimits,
): string | null {
  const maxJson = Math.max(MARKER_SLACK * 4, limits?.maxJson ?? MAX_JSON);
  const normalizedLimits = {
    maxString: limits?.maxString ?? MAX_STRING,
    maxDepth: limits?.maxDepth ?? MAX_DEPTH,
    maxKeys: limits?.maxKeys ?? MAX_KEYS,
    maxArray: limits?.maxArray ?? MAX_ARRAY,
    overflow: limits?.overflow ?? "truncate",
    redactEmbeddedSecrets: limits?.redactEmbeddedSecrets,
    redactGenericOpaqueStrings: limits?.redactGenericOpaqueStrings,
  } satisfies Required<
    Pick<
      RedactLimits,
      "maxString" | "maxDepth" | "maxKeys" | "maxArray" | "overflow"
    >
  > &
    Pick<RedactLimits, "redactEmbeddedSecrets" | "redactGenericOpaqueStrings">;
  try {
    if (args == null) return null;
    const redacted = redact(args, 0, normalizedLimits);
    if (redacted === undefined) return null;
    const json = JSON.stringify(redacted);
    if (json == null) return null;
    if (json.length <= maxJson) return json;
    if (normalizedLimits.overflow === "throw") {
      throw new Error("Redacted value exceeds the configured JSON limit.");
    }
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
  } catch (error) {
    if (normalizedLimits.overflow === "throw") throw error;
    return null;
  }
}

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

export function redactTextToSummary(
  text: string,
  maxChars = MAX_STRING,
): string | null {
  if (!text) return null;
  const head = text.slice(0, maxChars + MARKER_SLACK);
  const redactedHead = redactEmbeddedSecrets(head);
  if (looksSecret(redactedHead.trim())) return REDACTED;
  if (text.length <= maxChars && redactedHead.length <= maxChars) {
    return redactedHead;
  }
  const keep = Math.max(0, maxChars - MARKER_SLACK);
  return `${redactedHead.slice(0, keep)}…(${text.length - keep} more chars)`;
}

export const __test = {
  looksSecret,
  redact,
  redactEmbeddedSecrets,
  SENSITIVE_KEY,
};
