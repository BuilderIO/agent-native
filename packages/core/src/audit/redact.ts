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
// What a cut leaves behind. `redactedArgsWereCut` reads these back.
const DEPTH_CUT = "[…]";
const KEYS_CUT_KEY = "…";
const KEYS_CUT = "(truncated)";
const STRING_CUT = /…\(\d+ more chars\)$/;
const ARRAY_CUT = /^…\(\d+ more\)$/;
const MAX_STRING = 2000;
const MAX_DEPTH = 6;
const MAX_KEYS = 100;
const MAX_ARRAY = 100;
const MAX_JSON = 8000;
const MARKER_SLACK = 32;

function looksSecret(value: string): boolean {
  if (/^bearer\s+\S/i.test(value)) return true;
  if (value.length >= 32 && /^[A-Za-z0-9_\-+/=.]+$/.test(value)) return true;
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

function redactString(value: string, maxString: number): string {
  if (looksSecret(value)) return REDACTED;
  // A credential can sit inside ordinary text: `Authorization: Bearer …`.
  const scrubbed = redactEmbeddedSecrets(value);
  if (scrubbed.length > maxString) {
    return `${scrubbed.slice(0, maxString)}…(${scrubbed.length - maxString} more chars)`;
  }
  return scrubbed;
}

const QUOTED_CREDENTIAL = String.raw`"(?:\\[\s\S]|[^"\\])*(?:"|\\?$)|'(?:\\[\s\S]|[^'\\])*(?:'|\\?$)`;
const EMBEDDED_BEARER = new RegExp(
  String.raw`\b(bearer[ \t]+)(${QUOTED_CREDENTIAL}|[^\s"',}]+)`,
  "gi",
);
const EMBEDDED_AUTHORIZATION = new RegExp(
  String.raw`(["']?\b(?:proxy-)?authorization\b["']?[ \t]*[:=][ \t]*)(${QUOTED_CREDENTIAL}|[^\r\n]+)`,
  "gi",
);
const EMBEDDED_CREDENTIAL_FIELD = new RegExp(
  String.raw`(["']?\b${SENSITIVE_KEY.source}\b["']?[ \t]*[:=][ \t]*)((?:bearer[ \t]+)?(?:${QUOTED_CREDENTIAL}|[^"'\s,}]+))`,
  "gi",
);

function redactEmbeddedField(
  _match: string,
  prefix: string,
  value: string,
): string {
  const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
  return `${prefix}${quote}${REDACTED}${quote}`;
}

function redactEmbeddedSecrets(value: string): string {
  // Token matching can consume an escape that belongs to a quoted field,
  // so complete field values must be redacted first.
  return value
    .replace(EMBEDDED_AUTHORIZATION, redactEmbeddedField)
    .replace(EMBEDDED_CREDENTIAL_FIELD, redactEmbeddedField)
    .replace(EMBEDDED_BEARER, `$1${REDACTED}`);
}

function redact(value: unknown, depth: number, maxString: number): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value, maxString);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return DEPTH_CUT;
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
        out[KEYS_CUT_KEY] = KEYS_CUT;
        break;
      }
      n += 1;
      out[k] = SENSITIVE_KEY.test(k)
        ? REDACTED
        : redact(v, depth + 1, maxString);
    }
    return out;
  }
  return undefined;
}

export interface RedactLimits {
  maxJson?: number;
  maxString?: number;
}

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
 * Whether `value`, parsed from `redactArgsToJson`, lost part of the
 * arguments to its limits: a shortened string or array, dropped keys, depth,
 * or the whole payload replaced by its `_auditTruncated` preview. A redacted
 * secret is not a cut. Text that only looks like a marker reads as cut,
 * which errs toward telling a reader something is missing.
 */
export function redactedArgsWereCut(value: unknown): boolean {
  if (typeof value === "string") {
    return value === DEPTH_CUT || STRING_CUT.test(value);
  }
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return (
      (typeof last === "string" && ARRAY_CUT.test(last)) ||
      value.some(redactedArgsWereCut)
    );
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      record._auditTruncated === true ||
      record[KEYS_CUT_KEY] === KEYS_CUT ||
      Object.values(record).some(redactedArgsWereCut)
    );
  }
  return false;
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
