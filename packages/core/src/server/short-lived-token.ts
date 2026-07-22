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
 *   3. Hosted workspace deploys derive a per-purpose key from A2A_SECRET
 *   4. In dev only, an ephemeral random key (per-process)
 *
 * In production, throws if no usable server secret is set.
 */

import crypto from "node:crypto";

import { getWorkspaceA2ADerivedSecret } from "./derived-secret.js";

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
    process.env.OAUTH_STATE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    getWorkspaceA2ADerivedSecret("short-lived-token");
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Short-lived token signing requires a server secret. " +
        "Set OAUTH_STATE_SECRET, BETTER_AUTH_SECRET, or A2A_SECRET in production workspace deploys.",
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

// ── Realtime subscribe tokens ────────────────────────────────────────────────
//
// An identity-bearing extension of the same HMAC discipline, used by the hosted
// Realtime Gateway. Differs from the media token above in three ways the gateway
// depends on:
//   1. It is signed with a caller-supplied PER-PROJECT key (the app's HMAC
//      secret), not the single deployment-wide `getSigningKey()`. The app server
//      mints with it; the gateway (a second issuer for stream rotation) verifies
//      and re-mints with the same per-project key. A token minted for project A
//      fails signature verification against project B's key.
//   2. It carries authorization-bearing identity (`owner`/`orgId`) that the
//      gateway feeds to `canSeeChangeForUser` — the media token's `viewerEmail`
//      is audit-only by contract, so a new field is required, not repurposed.
//   3. It binds `projectId` as the channel and stamps a `typ` discriminator, so
//      it is verified against the connect channel and cannot be replayed as a
//      media token (or vice-versa) even if keys ever overlapped.

/** Payload `typ` discriminator for realtime subscribe tokens. */
export const REALTIME_SUBSCRIBE_TOKEN_TYPE = "rt-subscribe";
const DEFAULT_REALTIME_TTL_SECONDS = 600;

/** Inputs for {@link signRealtimeSubscribeToken}. */
export interface RealtimeSubscribeClaims {
  /** Channel — one Neon project per app. Verified at connect, not just carried. */
  projectId: string;
  /**
   * App end-user session email (NOT a Builder.io account — see the tech spec).
   * Fed to `canSeeChangeForUser`. Present in v0.
   */
  owner?: string;
  /** Framework org id for the app's end-user. */
  orgId?: string;
  /** Override default TTL (seconds). */
  ttlSeconds?: number;
}

interface DecodedRealtimeClaims {
  typ: string;
  projectId: string;
  owner?: string;
  orgId?: string;
  exp: number;
}

/**
 * Result of {@link verifyRealtimeSubscribeToken}. On success it returns the
 * identity claims the gateway uses to scope delivery.
 */
export type RealtimeVerifyResult =
  | {
      ok: true;
      projectId: string;
      owner?: string;
      orgId?: string;
      exp: number;
    }
  | { ok: false; reason: string };

function hmacB64(payloadStr: string, key: string): string {
  return base64UrlEncode(
    crypto.createHmac("sha256", key).update(payloadStr).digest(),
  );
}

function timingSafeEqualB64(sig: string, expected: string): boolean {
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) {
    crypto.timingSafeEqual(expBuf, expBuf); // burn ~equal cycles
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Mint a realtime subscribe token for `claims.projectId`, signed with the
 * app's per-project `key`. Safe to place on the connect query string (short
 * TTL, single-purpose, channel-bound). Verified by
 * {@link verifyRealtimeSubscribeToken} at connect.
 */
export function signRealtimeSubscribeToken(
  claims: RealtimeSubscribeClaims,
  key: string,
): string {
  if (!key) throw new Error("signRealtimeSubscribeToken requires a key");
  // Fail closed: a token with neither owner nor orgId carries no authorization
  // identity, so canSeeChangeForUser would only ever match global/unowned
  // events. Every issuer (mint endpoint + the gateway's rotation re-mint) must
  // supply at least one identity claim.
  if (!claims.owner && !claims.orgId) {
    throw new Error(
      "signRealtimeSubscribeToken requires an owner or orgId claim",
    );
  }
  const ttl = claims.ttlSeconds ?? DEFAULT_REALTIME_TTL_SECONDS;
  const payload: DecodedRealtimeClaims = {
    typ: REALTIME_SUBSCRIBE_TOKEN_TYPE,
    projectId: claims.projectId,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  if (claims.owner) payload.owner = claims.owner;
  if (claims.orgId) payload.orgId = claims.orgId;

  const payloadStr = base64UrlEncode(JSON.stringify(payload));
  return `${payloadStr}.${hmacB64(payloadStr, key)}`;
}

/**
 * Verify a realtime subscribe token against the app's per-project `key` and the
 * connect channel `projectId`. Returns the identity claims only when the shape,
 * signature (constant-time), `typ`, `exp`, and `projectId` binding all hold.
 */
export function verifyRealtimeSubscribeToken(
  token: string,
  expected: { projectId: string; key: string },
): RealtimeVerifyResult {
  if (!expected.key) return { ok: false, reason: "no_key" };
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadStr, sig] = token.split(".", 2);
  if (!payloadStr || !sig) return { ok: false, reason: "malformed" };

  if (!timingSafeEqualB64(sig, hmacB64(payloadStr, expected.key))) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: DecodedRealtimeClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadStr).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (claims.typ !== REALTIME_SUBSCRIBE_TOKEN_TYPE) {
    return { ok: false, reason: "wrong_type" };
  }
  if (typeof claims.exp !== "number") {
    return { ok: false, reason: "bad_payload" };
  }
  if (claims.exp * 1000 < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (claims.projectId !== expected.projectId) {
    return { ok: false, reason: "wrong_project" };
  }

  return {
    ok: true,
    projectId: claims.projectId,
    owner: claims.owner,
    orgId: claims.orgId,
    exp: claims.exp,
  };
}
