/**
 * Short-lived HMAC-signed access tokens for media URLs.
 *
 * Used by clips and calls to mint a single-use bearer token after a password
 * gate passes, then bake `?t=<token>` into the video/blob URL handed to the
 * `<video>` element — instead of `?password=<plaintext>` (which ends up in
 * browser history, CDN logs, and Referer headers).
 *
 * Token shape: `<payloadB64Url>.<sigB64Url>`
 *   payload = base64url(JSON.stringify({ resourceId, viewerEmail?, exp }))
 *   sig     = base64url(HMAC-SHA256(payload, key))
 *
 * Key resolution mirrors `google-oauth.ts:getStateSigningKey`:
 *   1. OAUTH_STATE_SECRET (preferred — dedicated to short-lived signing)
 *   2. BETTER_AUTH_SECRET (already used as a server secret)
 *   3. In dev only, an ephemeral random key (per-process)
 *
 * In production, throws if neither secret is set.
 */

import crypto from "node:crypto";

/** Default token TTL, in seconds. 10 minutes covers a typical video session. */
const DEFAULT_TTL_SECONDS = 600;

/**
 * Inputs for {@link signShortLivedToken}.
 */
export interface ShortLivedTokenClaims {
  /** Resource id the token authorises (recording id, call id, snippet id, …). */
  resourceId: string;
  /** Optional viewer email for audit / analytics — not used for authorisation. */
  viewerEmail?: string;
  /** Override default TTL (seconds). */
  ttlSeconds?: number;
}

interface DecodedClaims {
  resourceId: string;
  viewerEmail?: string;
  exp: number;
}

/**
 * Result of {@link verifyShortLivedToken}. Discriminated by the literal
 * `ok` field so callers can `if (!result.ok) return …`.
 */
export type VerifyResult =
  | { ok: true; viewerEmail?: string }
  | { ok: false; reason: string };

let _devSigningKey: string | undefined;

function getSigningKey(): string {
  const secret =
    process.env.OAUTH_STATE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Short-lived token signing requires a server secret. " +
        "Set OAUTH_STATE_SECRET or BETTER_AUTH_SECRET in production.",
    );
  }

  if (!_devSigningKey) {
    _devSigningKey = crypto.randomBytes(32).toString("hex");
  }
  return _devSigningKey;
}

function base64UrlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Buffer {
  // Re-pad to a multiple of 4 so Buffer.from('base64') decodes cleanly.
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Mint a signed token authorising read access to `claims.resourceId` until
 * `exp = now + ttl`. The result is safe to drop into a query string —
 * `?t=<token>` — and verified by {@link verifyShortLivedToken} on the
 * downstream route.
 */
export function signShortLivedToken(claims: ShortLivedTokenClaims): string {
  const ttl = claims.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const payload: DecodedClaims = {
    resourceId: claims.resourceId,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  if (claims.viewerEmail) payload.viewerEmail = claims.viewerEmail;

  const payloadStr = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(
    crypto.createHmac("sha256", getSigningKey()).update(payloadStr).digest(),
  );
  return `${payloadStr}.${sig}`;
}

/**
 * Verify a token previously produced by {@link signShortLivedToken}.
 *
 * Returns `{ ok: true, viewerEmail? }` only when:
 *  - the token has the expected shape (`<payload>.<sig>`),
 *  - the signature matches via constant-time comparison,
 *  - the token has not expired,
 *  - the embedded `resourceId` matches `expectedResourceId`.
 *
 * Otherwise returns `{ ok: false, reason: <error string> }`. Callers should
 * not surface the reason to viewers (it's useful for server-side logs only).
 */
export function verifyShortLivedToken(
  token: string,
  expectedResourceId: string,
): VerifyResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadStr, sig] = token.split(".", 2);
  if (!payloadStr || !sig) return { ok: false, reason: "malformed" };

  const expected = base64UrlEncode(
    crypto.createHmac("sha256", getSigningKey()).update(payloadStr).digest(),
  );

  // Constant-time compare. Length-mismatched inputs would throw under
  // `crypto.timingSafeEqual`, so we check length first and fall back to a
  // dummy compare to keep timing roughly constant on the failure path.
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) {
    crypto.timingSafeEqual(expBuf, expBuf); // burn ~equal cycles
    return { ok: false, reason: "bad_signature" };
  }
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: DecodedClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadStr).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (typeof claims.exp !== "number") {
    return { ok: false, reason: "bad_payload" };
  }
  if (claims.exp * 1000 < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (claims.resourceId !== expectedResourceId) {
    return { ok: false, reason: "wrong_resource" };
  }

  return { ok: true, viewerEmail: claims.viewerEmail };
}
