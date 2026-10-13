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

const MAX_AGE_MS = 5 * 60 * 1000;
const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000;

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
  if (a.length !== b.length) return false;
  try {
    return nodeTimingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function signInternalToken(taskId: string): string {
  const secret = getSecret();
  const ts = Date.now();
  const sig = hmacHex(secret, `${taskId}:${ts}`);
  return `${ts}.${sig}`;
}

export function verifyInternalToken(taskId: string, token: string): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const tsRaw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  if (now - ts > MAX_AGE_MS) return false;
  if (ts - now > FUTURE_SKEW_TOLERANCE_MS) return false;
  let expected: string;
  try {
    expected = hmacHex(getSecret(), `${taskId}:${ts}`);
  } catch {
    return false;
  }
  return safeEqual(sig, expected);
}

export function extractBearerToken(
  authHeader: string | undefined,
): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
