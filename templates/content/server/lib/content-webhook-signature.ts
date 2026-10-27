import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Content webhooks follow the Standard Webhooks signing scheme
 * (https://www.standardwebhooks.com), so receivers can verify them with the
 * `standardwebhooks` library or a few lines of HMAC code:
 *
 *   webhook-id:        the event id, the same on every retry
 *   webhook-timestamp: unix seconds when this attempt was sent
 *   webhook-signature: v1,<base64 HMAC-SHA256(key, "{id}.{timestamp}.{body}")>
 *
 * The secret is `whsec_` followed by base64; the HMAC key is the decoded bytes.
 */
export const CONTENT_WEBHOOK_SECRET_PREFIX = "whsec_";

/** Receivers should reject a timestamp further than this from their clock. */
export const CONTENT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export function generateContentWebhookSecret(): string {
  return `${CONTENT_WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString("base64")}`;
}

function secretKeyBytes(secret: string): Buffer {
  if (!secret.startsWith(CONTENT_WEBHOOK_SECRET_PREFIX)) {
    throw new Error("Content webhook secrets start with whsec_.");
  }
  return Buffer.from(
    secret.slice(CONTENT_WEBHOOK_SECRET_PREFIX.length),
    "base64",
  );
}

export function signContentWebhook(args: {
  secret: string;
  id: string;
  timestamp: number;
  body: string;
}): string {
  const digest = createHmac("sha256", secretKeyBytes(args.secret))
    .update(`${args.id}.${args.timestamp}.${args.body}`)
    .digest("base64");
  return `v1,${digest}`;
}

export function contentWebhookHeaders(args: {
  secret: string;
  id: string;
  timestamp: number;
  body: string;
}): Record<string, string> {
  return {
    "webhook-id": args.id,
    "webhook-timestamp": String(args.timestamp),
    "webhook-signature": signContentWebhook(args),
  };
}

/**
 * The receiver's side of the check, used by tests and as a reference for
 * anyone writing a receiver without the library.
 */
export function verifyContentWebhook(args: {
  secret: string;
  headers: Record<string, string | undefined>;
  body: string;
  nowSeconds?: number;
}): boolean {
  const id = args.headers["webhook-id"];
  const timestamp = Number(args.headers["webhook-timestamp"]);
  const signatures = args.headers["webhook-signature"];
  if (!id || !Number.isFinite(timestamp) || !signatures) return false;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > CONTENT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = Buffer.from(
    signContentWebhook({ secret: args.secret, id, timestamp, body: args.body }),
  );
  return signatures.split(" ").some((candidate) => {
    const actual = Buffer.from(candidate);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  });
}
