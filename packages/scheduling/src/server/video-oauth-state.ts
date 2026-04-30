/**
 * HMAC-signed state for video conferencing OAuth flows.
 *
 * The `state` value sent to the OAuth provider must round-trip back to our
 * callback verbatim. We use HMAC-SHA256 to bind the state to the kind +
 * authenticated user email + a server secret + a freshness timestamp.
 * The callback re-derives the HMAC and rejects mismatches — this prevents
 * an attacker from forging a callback for someone else's account or
 * replaying an old completed flow.
 *
 * Output format:
 *   <random-nonce>.<timestamp>.<kind>.<base64url-hmac>
 *
 * The nonce keeps every issued state distinct even if the same user
 * starts two parallel OAuth flows for the same provider. The timestamp
 * lets us bound replay attempts (default: 10 minutes).
 */
import crypto from "node:crypto";

const SEPARATOR = ".";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getStateSecret(): string {
  const secret =
    process.env.SCHEDULING_OAUTH_STATE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "OAuth state secret is not configured. Set BETTER_AUTH_SECRET (or SCHEDULING_OAUTH_STATE_SECRET).",
    );
  }
  return secret;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function hmac(message: string, secret: string): string {
  return b64url(
    crypto.createHmac("sha256", secret).update(message).digest(),
  );
}

function safeFragment(value: string): string {
  // The encoded payload uses dots as separators, so any literal dot in the
  // user email would corrupt parsing. Replace dots and any non-printable
  // characters before signing.
  return value.replace(/[^A-Za-z0-9_@-]/g, "_");
}

/**
 * Mint a fresh signed state value bound to the current authenticated user
 * and the requested OAuth `kind`.
 */
export function signVideoOAuthState(opts: {
  kind: string;
  userEmail: string;
}): string {
  const nonce = crypto.randomBytes(12).toString("hex");
  const timestamp = Date.now().toString(36);
  const safeKind = safeFragment(opts.kind);
  const safeEmail = safeFragment(opts.userEmail.toLowerCase());
  const message = [nonce, timestamp, safeKind, safeEmail].join(SEPARATOR);
  const sig = hmac(message, getStateSecret());
  return [nonce, timestamp, safeKind, sig].join(SEPARATOR);
}

/**
 * Verify a state value returned from the OAuth provider matches one
 * minted by `signVideoOAuthState` for the same authenticated user.
 *
 * Returns `true` only when:
 *   1. The state has the expected shape
 *   2. The HMAC matches (kind + user-email + secret)
 *   3. The state is not older than STATE_TTL_MS
 *
 * Uses `crypto.timingSafeEqual` to prevent timing-based recovery of the
 * signature.
 */
export function verifyVideoOAuthState(opts: {
  state: string | undefined | null;
  kind: string;
  userEmail: string;
  /** Override default 10-minute TTL (for tests). */
  ttlMs?: number;
}): boolean {
  if (!opts.state || typeof opts.state !== "string") return false;
  const parts = opts.state.split(SEPARATOR);
  if (parts.length !== 4) return false;
  const [nonce, timestamp, kindFragment, providedSig] = parts;
  if (!nonce || !timestamp || !kindFragment || !providedSig) return false;

  const expectedKind = safeFragment(opts.kind);
  if (kindFragment !== expectedKind) return false;

  const safeEmail = safeFragment(opts.userEmail.toLowerCase());
  const message = [nonce, timestamp, kindFragment, safeEmail].join(SEPARATOR);
  const expectedSig = hmac(message, getStateSecret());

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  // Freshness check.
  const ttl = opts.ttlMs ?? STATE_TTL_MS;
  const issuedAt = Number.parseInt(timestamp, 36);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > ttl) return false;

  return true;
}
