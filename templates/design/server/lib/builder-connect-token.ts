/**
 * Verify the short-lived token Builder mints to hand a branch to this app.
 * Narrow on purpose (HS256 only, exact issuer/audience/scope) and never returns
 * a partial result, so "unsigned" and "signed but wrong shape" are
 * indistinguishable to a caller.
 */

import { jwtVerify, type JWTPayload } from "jose";

export const BUILDER_CONNECT_ISSUER = "builder.io";
export const BUILDER_CONNECT_AUDIENCE = "design.agent-native.com";
export const BUILDER_CONNECT_SCOPE = "design-embed";

/** `_NEXT` lets Builder rotate the secret with no downtime. */
const SECRET_ENV_KEYS = [
  "BUILDER_DESIGN_PARTNER_SECRET",
  "BUILDER_DESIGN_PARTNER_SECRET_NEXT",
] as const;

const MIN_SECRET_LENGTH = 32;

export interface BuilderConnectClaims {
  builderOrgId: string;
  projectId: string;
  branchName: string;
  jti: string | null;
}

/** A token that must not be honoured. Maps to 401. */
export class BuilderConnectTokenError extends Error {
  readonly statusCode = 401;
  constructor(reason: string) {
    super(`Invalid Builder connect token: ${reason}`);
    this.name = "BuilderConnectTokenError";
  }
}

/** No partner secret deployed. Maps to 503 — a config gap, not an auth failure. */
export class BuilderPartnerNotConfiguredError extends Error {
  readonly statusCode = 503;
  constructor() {
    super(
      "Builder design partner handshake is not configured: set BUILDER_DESIGN_PARTNER_SECRET.",
    );
    this.name = "BuilderPartnerNotConfiguredError";
  }
}

/**
 * The single resolver for the partner secret — grep this key name before
 * reading it anywhere else. Returns every currently-valid secret, primary
 * first, so verification accepts both sides of a rotation.
 */
export function resolveBuilderPartnerSecrets(): string[] {
  const secrets: string[] = [];
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (
      value &&
      value.length >= MIN_SECRET_LENGTH &&
      !secrets.includes(value)
    ) {
      secrets.push(value);
    }
  }
  return secrets;
}

export function isBuilderPartnerConfigured(): boolean {
  return resolveBuilderPartnerSecrets().length > 0;
}

/**
 * Replay guard, stated rather than implied: this is per-process memory, so a
 * replay routed to another serverless instance is not caught. Proportionate for
 * a 60s single-audience token that only ever travels over postMessage. Put the
 * jti in SQL if that stops being true.
 */
const seenJtis = new Map<string, number>();

/** Retained ≥ the token TTL so a jti cannot outlive its own guard entry. */
const JTI_RETENTION_MS = 180_000;

/** Exposed so tests do not leak replay state between cases. */
export function __resetBuilderConnectReplayGuardForTests(): void {
  seenJtis.clear();
}

function requireStringClaim(payload: JWTPayload, claim: string): string {
  const value = payload[claim];
  if (typeof value !== "string" || !value.trim()) {
    throw new BuilderConnectTokenError(`missing "${claim}" claim`);
  }
  return value.trim();
}

export async function verifyBuilderConnectToken(
  token: unknown,
  options: { now?: () => number } = {},
): Promise<BuilderConnectClaims> {
  if (typeof token !== "string" || !token.trim()) {
    throw new BuilderConnectTokenError("no token supplied");
  }

  const secrets = resolveBuilderPartnerSecrets();
  if (secrets.length === 0) throw new BuilderPartnerNotConfiguredError();

  const encoder = new TextEncoder();
  let payload: JWTPayload | undefined;
  for (const secret of secrets) {
    try {
      const verified = await jwtVerify(token, encoder.encode(secret), {
        issuer: BUILDER_CONNECT_ISSUER,
        audience: BUILDER_CONNECT_AUDIENCE,
        algorithms: ["HS256"],
      });
      payload = verified.payload;
      break;
    } catch {
      // coercion-ok: try the next secret during rotation; the loop throws a
      // typed error once every candidate has failed.
    }
  }
  if (!payload) {
    throw new BuilderConnectTokenError(
      "signature, issuer, audience, or expiry check failed",
    );
  }

  if (payload.scope !== BUILDER_CONNECT_SCOPE) {
    throw new BuilderConnectTokenError(
      `scope must be "${BUILDER_CONNECT_SCOPE}"`,
    );
  }

  const claims: BuilderConnectClaims = {
    builderOrgId: requireStringClaim(payload, "builderOrgId"),
    projectId: requireStringClaim(payload, "projectId"),
    branchName: requireStringClaim(payload, "branchName"),
    jti: typeof payload.jti === "string" && payload.jti ? payload.jti : null,
  };

  // A token with no `jti` has nothing to consume, so it would stay replayable
  // for its whole TTL — every replay mints another embed session.
  if (!claims.jti) {
    throw new BuilderConnectTokenError("token is missing a jti");
  }

  {
    const now = options.now?.() ?? Date.now();
    for (const [jti, expiresAt] of seenJtis) {
      if (expiresAt <= now) seenJtis.delete(jti);
    }
    if (seenJtis.has(claims.jti)) {
      throw new BuilderConnectTokenError("token has already been used");
    }
    seenJtis.set(claims.jti, now + JTI_RETENTION_MS);
  }

  return claims;
}
