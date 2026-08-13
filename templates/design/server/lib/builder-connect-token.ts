/**
 * Verify the short-lived token Builder mints to hand a branch to this app.
 * Narrow on purpose (HS256 only, exact issuer/audience/scope) and never returns
 * a partial result, so "unsigned" and "signed but wrong shape" are
 * indistinguishable to a caller.
 */

import { lt } from "drizzle-orm";
import { jwtVerify, type JWTPayload } from "jose";

import { getDb, schema } from "../db/index.js";

export const BUILDER_CONNECT_ISSUER = "builder.io";
export const BUILDER_CONNECT_AUDIENCE = "design.agent-native.com";
export const BUILDER_CONNECT_SCOPE = "design-embed";

/** Builder mints these for 60s; the rest is clock-skew allowance. */
export const BUILDER_CONNECT_MAX_TOKEN_AGE_SECONDS = 120;

/** `_NEXT` lets Builder rotate the secret with no downtime. */
const SECRET_ENV_KEYS = [
  "BUILDER_DESIGN_PARTNER_SECRET",
  "BUILDER_DESIGN_PARTNER_SECRET_NEXT",
] as const;

const MIN_SECRET_LENGTH = 32;

function requireClaimOrigin(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BuilderConnectTokenError('missing "previewOrigin" claim');
  }
  try {
    return new URL(value.trim()).origin;
  } catch {
    throw new BuilderConnectTokenError('"previewOrigin" is not a valid URL');
  }
}

export interface BuilderConnectClaims {
  builderOrgId: string;
  projectId: string;
  branchName: string;

  /**
   * The container origin Builder resolved from the branch record. Required: a
   * host-suffix allowlist cannot tell one org's container from an attacker's,
   * so this claim is the only thing that authorizes a preview target.
   */
  previewOrigin: string;
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

/** Retained ≥ the token TTL so a jti cannot outlive its own guard row. */
const JTI_RETENTION_MS = 180_000;

/**
 * Consume a jti exactly once, across instances.
 *
 * The insert *is* the guard: this app runs as Netlify functions, so a
 * check-then-write — or a per-process Map — races between Lambdas and lets the
 * same token mint a second embed session.
 */
async function consumeJti(jti: string, now: number): Promise<boolean> {
  const db = getDb();
  await db
    .delete(schema.builderConnectConsumedTokens)
    .where(
      lt(
        schema.builderConnectConsumedTokens.expiresAt,
        new Date(now).toISOString(),
      ),
    );
  const inserted = await db
    .insert(schema.builderConnectConsumedTokens)
    .values({
      jti,
      expiresAt: new Date(now + JTI_RETENTION_MS).toISOString(),
    })
    .onConflictDoNothing()
    .returning({ jti: schema.builderConnectConsumedTokens.jti });
  return inserted.length > 0;
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
        // `exp` is only checked when present, so without this a token minted
        // with no expiry — or a far-future one — is valid forever. `maxTokenAge`
        // bounds it against `iat` as well, so the minted TTL is the real one.
        requiredClaims: ["exp", "iat"],
        maxTokenAge: BUILDER_CONNECT_MAX_TOKEN_AGE_SECONDS,
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
    previewOrigin: requireClaimOrigin(payload.previewOrigin),
    jti: typeof payload.jti === "string" && payload.jti ? payload.jti : null,
  };

  // A token with no `jti` has nothing to consume, so it would stay replayable
  // for its whole TTL — every replay mints another embed session.
  if (!claims.jti) {
    throw new BuilderConnectTokenError("token is missing a jti");
  }

  const consumed = await consumeJti(claims.jti, options.now?.() ?? Date.now());
  if (!consumed) {
    throw new BuilderConnectTokenError("token has already been used");
  }

  return claims;
}
