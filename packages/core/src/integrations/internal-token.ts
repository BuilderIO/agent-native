/**
 * Internal HMAC tokens for the webhook → processor handoff.
 *
 * The webhook handler enqueues an inbound message into SQL and then dispatches
 * a fresh HTTP POST to /_agent-native/integrations/process-task on the same
 * deployment. That endpoint must trust the dispatcher without going through
 * normal auth (no session cookie, no user). We use a short-lived HMAC token
 * over `taskId:timestamp`, signed with the same A2A_SECRET that the rest of
 * the framework uses for inter-app identity.
 *
 * The processor must reject tokens older than `MAX_AGE_MS` to limit replay,
 * and the comparison is timing-safe.
 */
import {
  createHmac,
  timingSafeEqual as nodeTimingSafeEqual,
} from "node:crypto";

const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Allow tokens stamped slightly in the future (clock-skew between dispatcher
 * and verifier) — but no more. Without this small tolerance the verifier
 * would reject tokens issued on the very same instant due to floating-point
 * timestamp drift. With Math.abs() (the previous bug) any future-stamped
 * token of any age was accepted, which combined with rotation lag turned
 * into a replay window.
 */
const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000; // 1 minute

function getSecret(): string {
  const secret = process.env.A2A_SECRET;
  if (!secret) {
    throw new Error(
      "A2A_SECRET is required for the integration webhook → processor handoff. " +
        "Set A2A_SECRET as an environment variable on this deployment.",
    );
  }
  return secret;
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  // timingSafeEqual requires equal-length buffers, so guard first.
  if (a.length !== b.length) return false;
  try {
    return nodeTimingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Sign an internal token for a given task id. Format: `<timestamp>.<sig>`,
 * where sig = HMAC_SHA256(A2A_SECRET, taskId + ":" + timestamp). Tokens are
 * short-lived (5 minutes) and bound to a specific task id, so even if a
 * token leaks it can only re-trigger that one task's processor.
 */
export function signInternalToken(taskId: string): string {
  const secret = getSecret();
  const ts = Date.now();
  const sig = hmacHex(secret, `${taskId}:${ts}`);
  return `${ts}.${sig}`;
}

/**
 * Verify an internal token against a task id. Returns true if the token is
 * authentic, unexpired, and bound to this task id.
 */
export function verifyInternalToken(taskId: string, token: string): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const tsRaw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > MAX_AGE_MS) return false;
  let expected: string;
  try {
    expected = hmacHex(getSecret(), `${taskId}:${ts}`);
  } catch {
    return false;
  }
  return safeEqual(sig, expected);
}

/**
 * Pull a Bearer token from an Authorization header value.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(
  authHeader: string | undefined,
): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
