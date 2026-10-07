import { redactToolErrorMessage } from "./trace-error.js";

const SENSITIVE_FIELD_PATTERN =
  /^(authorization|cookie|jwt|password|secret|token|bearer)$/i;
const SENSITIVE_FIELD_SUFFIXES = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "privatekey",
  "secretkey",
  "signingkey",
  "encryptionkey",
  "databaseurl",
  "databaseuri",
  "dburl",
  "dburi",
  "connectionstring",
  "connectionurl",
  "connectionuri",
  "postgresurl",
  "postgresqlurl",
  "mysqlurl",
  "mariadburl",
  "mongodburl",
  "mongourl",
  "mongouri",
  "redisurl",
  "redissurl",
  "amqpurl",
  "mssqlurl",
  "cockroachdburl",
  "dsn",
  "jwt",
  "token",
  "secret",
  "password",
  "accesskeyid",
  "accesskey",
  "authorization",
  "subscriptionkey",
  "webhookurl",
];

const SLACK_WEBHOOK_URL_PATTERN =
  /https?:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/gi;
const LABELED_WEBHOOK_URL_PATTERN =
  /(\b[A-Za-z0-9_.-]*webhook[_ -]?url\b["']?\s*[:=]\s*["']?)(https?:\/\/[^\s"'<>()[\]{}]+)/gi;

function isSensitiveFieldName(field: string): boolean {
  return field.split(/[.:/\[\]]+/).some((part) => {
    if (SENSITIVE_FIELD_PATTERN.test(part)) return true;
    const normalized = part.toLowerCase().replace(/[^a-z0-9]/g, "");
    return SENSITIVE_FIELD_SUFFIXES.some((field) => normalized.endsWith(field));
  });
}

export function redactSensitiveFields(value: unknown): unknown {
  return redactWalk(value, new WeakSet<object>());
}

export function redactCapturedString(
  value: string,
  options: { truncated?: boolean } = {},
): string {
  return redactToolErrorMessage(value, options)
    .replace(
      LABELED_WEBHOOK_URL_PATTERN,
      (_match, prefix: string, rawUrl: string) => {
        const trailingPunctuation = rawUrl.match(/[.,;!?]+$/)?.[0] ?? "";
        return `${prefix}[REDACTED]${trailingPunctuation}`;
      },
    )
    .replace(SLACK_WEBHOOK_URL_PATTERN, "[REDACTED]");
}

function redactWalk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactCapturedString(value);
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
