import crypto from "node:crypto";

import { getWorkspaceA2ADerivedSecret } from "./derived-secret.js";

const DEFAULT_TTL_SECONDS = 600;

export interface ShortLivedTokenClaims {
  resourceId: string;
  viewerEmail?: string;
  /**
   * Optional display name of the agent the token was minted for. Signed so a
   * reader cannot rename itself, but audit/display-only like `viewerEmail` —
   * never consult it for authorisation.
   */
  agentLabel?: string;
  ttlSeconds?: number;
}

interface DecodedClaims {
  resourceId: string;
  viewerEmail?: string;
  agentLabel?: string;
  exp: number;
}

export type VerifyResult =
  | { ok: true; viewerEmail?: string; agentLabel?: string }
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
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signShortLivedToken(claims: ShortLivedTokenClaims): string {
  const ttl = claims.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const payload: DecodedClaims = {
    resourceId: claims.resourceId,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  if (claims.viewerEmail) payload.viewerEmail = claims.viewerEmail;
  if (claims.agentLabel) payload.agentLabel = claims.agentLabel;

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

  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) {
    crypto.timingSafeEqual(expBuf, expBuf);
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

  return {
    ok: true,
    viewerEmail: claims.viewerEmail,
    agentLabel: claims.agentLabel,
  };
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

export interface RealtimeSubscribeClaims {
  projectId: string;
  owner?: string;
  orgId?: string;
  ttlSeconds?: number;
  /**
   * Absolute unix-seconds ceiling, independent of `exp`. The gateway re-signs a
   * stream's token every few minutes without consulting the app, so `exp` alone
   * lets one mint be extended forever and a revoked session keeps streaming.
   * Rotation copies this verbatim and never extends it.
   */
  absExp?: number;
}

interface DecodedRealtimeClaims {
  typ: string;
  projectId: string;
  owner?: string;
  orgId?: string;
  exp: number;
  absExp?: number;
}

export type RealtimeVerifyResult =
  | {
      ok: true;
      projectId: string;
      owner?: string;
      orgId?: string;
      exp: number;
      absExp?: number;
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
    crypto.timingSafeEqual(expBuf, expBuf);
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

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
  if (claims.absExp) payload.absExp = claims.absExp;

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
  if (claims.absExp !== undefined) {
    if (typeof claims.absExp !== "number") {
      return { ok: false, reason: "bad_payload" };
    }
    if (claims.absExp * 1000 <= Date.now()) {
      return { ok: false, reason: "session_expired" };
    }
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
    absExp: claims.absExp,
  };
}

export const REALTIME_VOICE_CAPABILITY_TOKEN_TYPE = "rt-voice-capability";

export interface RealtimeVoiceCapabilityClaims {
  userEmail: string;
  orgId?: string;
  browserTabId?: string;
  toolNames: readonly string[];
  discoveredToolNames?: readonly string[];
  ttlSeconds?: number;
}

interface DecodedRealtimeVoiceCapabilityClaims {
  typ: string;
  userEmail: string;
  orgId?: string;
  browserTabId?: string;
  toolNames: string[];
  discovered?: string[];
  exp: number;
}

export type RealtimeVoiceCapabilityVerifyResult =
  | {
      ok: true;
      userEmail: string;
      orgId?: string;
      browserTabId?: string;
      toolNames: string[];
      discoveredToolNames: string[];
    }
  | { ok: false; reason: string };

/**
 * Mint a capability authorising `claims.toolNames` for one realtime voice
 * session. The token is a bounded manifest scope layered on top of the
 * caller's session cookie — never a standalone credential.
 */
export function signRealtimeVoiceCapability(
  claims: RealtimeVoiceCapabilityClaims,
  ttlSecondsDefault: number,
): string {
  const payload: DecodedRealtimeVoiceCapabilityClaims = {
    typ: REALTIME_VOICE_CAPABILITY_TOKEN_TYPE,
    userEmail: claims.userEmail.trim().toLowerCase(),
    toolNames: [...claims.toolNames],
    exp:
      Math.floor(Date.now() / 1000) + (claims.ttlSeconds ?? ttlSecondsDefault),
  };
  if (claims.orgId) payload.orgId = claims.orgId;
  if (claims.browserTabId) payload.browserTabId = claims.browserTabId;
  if (claims.discoveredToolNames?.length) {
    payload.discovered = [...claims.discoveredToolNames];
  }

  const payloadStr = base64UrlEncode(JSON.stringify(payload));
  return `${payloadStr}.${hmacB64(payloadStr, getSigningKey())}`;
}

export function verifyRealtimeVoiceCapability(
  token: string | undefined,
  expected: { userEmail: string; orgId?: string; browserTabId?: string },
): RealtimeVoiceCapabilityVerifyResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadStr, sig] = token.split(".", 2);
  if (!payloadStr || !sig) return { ok: false, reason: "malformed" };

  if (!timingSafeEqualB64(sig, hmacB64(payloadStr, getSigningKey()))) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: DecodedRealtimeVoiceCapabilityClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadStr).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (claims.typ !== REALTIME_VOICE_CAPABILITY_TOKEN_TYPE) {
    return { ok: false, reason: "wrong_type" };
  }
  if (typeof claims.exp !== "number" || !Array.isArray(claims.toolNames)) {
    return { ok: false, reason: "bad_payload" };
  }
  if (claims.exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  if (
    claims.userEmail !== expected.userEmail.trim().toLowerCase() ||
    claims.orgId !== expected.orgId ||
    claims.browserTabId !== expected.browserTabId
  ) {
    return { ok: false, reason: "identity_mismatch" };
  }

  const stringsOnly = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((name): name is string => typeof name === "string")
      : [];

  return {
    ok: true,
    userEmail: claims.userEmail,
    orgId: claims.orgId,
    browserTabId: claims.browserTabId,
    toolNames: stringsOnly(claims.toolNames),
    discoveredToolNames: stringsOnly(claims.discovered),
  };
}

// ── Gateway access-check tokens ──────────────────────────────────────────────
//
// The hosted gateway has no access to an app's shareable-resource registry, so
// it cannot resolve sharee visibility itself. It signs one of these with the
// app's per-project key and calls the app's `/_agent-native/can-see`, which runs
// `resolveAccess` and answers. The full access query is bound into the token so
// the app authenticates the params, not merely the caller.

/** Payload `typ` discriminator for gateway access-check tokens. */
export const GATEWAY_ACCESS_TOKEN_TYPE = "rt-access-check";
const DEFAULT_GATEWAY_ACCESS_TTL_SECONDS = 60;

export interface GatewayAccessClaims {
  projectId: string;
  resourceType: string;
  resourceId: string;
  userEmail: string;
  orgId?: string;
  ttlSeconds?: number;
}

interface DecodedGatewayAccessClaims {
  typ: string;
  projectId: string;
  resourceType: string;
  resourceId: string;
  userEmail: string;
  orgId?: string;
  exp: number;
}

export type GatewayAccessVerifyResult =
  | {
      ok: true;
      projectId: string;
      resourceType: string;
      resourceId: string;
      userEmail: string;
      orgId?: string;
    }
  | { ok: false; reason: string };

export function signGatewayAccessToken(
  claims: GatewayAccessClaims,
  key: string,
): string {
  if (!key) throw new Error("signGatewayAccessToken requires a key");
  const ttl = claims.ttlSeconds ?? DEFAULT_GATEWAY_ACCESS_TTL_SECONDS;
  const payload: DecodedGatewayAccessClaims = {
    typ: GATEWAY_ACCESS_TOKEN_TYPE,
    projectId: claims.projectId,
    resourceType: claims.resourceType,
    resourceId: claims.resourceId,
    userEmail: claims.userEmail,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  if (claims.orgId) payload.orgId = claims.orgId;
  const payloadStr = base64UrlEncode(JSON.stringify(payload));
  return `${payloadStr}.${hmacB64(payloadStr, key)}`;
}

export function verifyGatewayAccessToken(
  token: string,
  key: string,
  expectedProjectId?: string,
): GatewayAccessVerifyResult {
  if (!key) return { ok: false, reason: "no_key" };
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadStr, sig] = token.split(".", 2);
  if (!payloadStr || !sig) return { ok: false, reason: "malformed" };

  if (!timingSafeEqualB64(sig, hmacB64(payloadStr, key))) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: DecodedGatewayAccessClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadStr).toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (claims.typ !== GATEWAY_ACCESS_TOKEN_TYPE) {
    return { ok: false, reason: "wrong_type" };
  }
  if (typeof claims.exp !== "number")
    return { ok: false, reason: "bad_payload" };
  if (claims.exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  if (
    !claims.projectId ||
    !claims.resourceType ||
    !claims.resourceId ||
    !claims.userEmail
  ) {
    return { ok: false, reason: "bad_payload" };
  }
  // Optional channel binding, mirroring verifyRealtimeSubscribeToken. The
  // per-project key already scopes verification to one app; this is belt-and-
  // suspenders for a future multi-tenant secret store. Skipped when the caller
  // can't cheaply resolve its own project id (scoped-secret apps).
  if (expectedProjectId && claims.projectId !== expectedProjectId) {
    return { ok: false, reason: "wrong_project" };
  }

  return {
    ok: true,
    projectId: claims.projectId,
    resourceType: claims.resourceType,
    resourceId: claims.resourceId,
    userEmail: claims.userEmail,
    orgId: claims.orgId,
  };
}
