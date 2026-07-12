const REDACTED = "[REDACTED]";

const SENSITIVE_FIELD_PATTERN =
  /^(authorization|cookie|api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|bearer)$/i;

const OPENAI_LIKE_SECRET_PATTERN =
  /(^|[^A-Za-z0-9_-])(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,})(?=$|[^A-Za-z0-9_-])/g;

export function redactSensitiveFields(value: unknown): unknown {
  return redactWalk(value, new WeakSet<object>());
}

function redactWalk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactWalk(v, seen));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_FIELD_PATTERN.test(key)
      ? REDACTED
      : redactWalk(entry, seen);
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
