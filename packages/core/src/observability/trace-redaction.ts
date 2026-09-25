/** Keys whose values are stripped from persisted tool inputs. Matched
 *  case-insensitively across namespace, snake/kebab, camelCase, and
 *  credential suffixes. */
const SENSITIVE_FIELD_PATTERN =
  /^(authorization|cookie|jwt|password|secret|token|bearer)$/i;
const SENSITIVE_FIELD_SUFFIXES = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "privatekey",
  "jwt",
  "token",
  "secret",
  "password",
  "accesskeyid",
  "accesskey",
  "authorization",
  "subscriptionkey",
];

function isSensitiveFieldName(field: string): boolean {
  return field.split(/[.:/\[\]]+/).some((part) => {
    if (SENSITIVE_FIELD_PATTERN.test(part)) return true;
    const normalized = part.toLowerCase().replace(/[^a-z0-9]/g, "");
    return SENSITIVE_FIELD_SUFFIXES.some((field) => normalized.endsWith(field));
  });
}

/** Recursively redact sensitive fields without mutating the input. */
export function redactSensitiveFields(value: unknown): unknown {
  return redactWalk(value, new WeakSet<object>());
}

function redactWalk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((v) => redactWalk(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    out[key] = isSensitiveFieldName(key)
      ? "[REDACTED]"
      : redactWalk(nested, seen);
  }
  return out;
}
