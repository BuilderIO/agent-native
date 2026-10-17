import { randomUUID } from "node:crypto";

import * as jose from "jose";

import { getAuthSecret } from "../server/better-auth-instance.js";
import { getMissingAuthSecretKey } from "../server/deploy-settings.js";
import {
  MCP_OAUTH_ACCESS_TOKEN_TTL,
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
} from "./oauth-store.js";

export { MCP_OAUTH_ACCESS_TOKEN_TTL, MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS };

export const MCP_OAUTH_SCOPES = [
  "mcp:read",
  "mcp:write",
  "mcp:apps",
  "offline_access",
] as const;

export const MCP_OAUTH_DEFAULT_SCOPE = MCP_OAUTH_SCOPES.join(" ");
export const MCP_OAUTH_TOKEN_TYPE = "agent-native-mcp-oauth";
const MCP_OAUTH_CREDENTIAL_VERSION = 2;
/**
 * Service credentials carry a version that verifiers predating service
 * identity assurance reject. Those verifiers admit any MCP OAuth token as a
 * verified user, so a service token they accepted could approve gated actions.
 * Never sign a service credential with `MCP_OAUTH_CREDENTIAL_VERSION`.
 */
const MCP_OAUTH_SERVICE_CREDENTIAL_VERSION = 3;

export interface McpOAuthAccessTokenClaims {
  sub: string;
  org_id?: string | null;
  org_domain?: string;
  scope: string;
  client_id: string;
  resource: string;
  grant_created_at_ms?: number;
  jti?: string;
  typ: typeof MCP_OAUTH_TOKEN_TYPE;
  credential_version:
    | typeof MCP_OAUTH_CREDENTIAL_VERSION
    | typeof MCP_OAUTH_SERVICE_CREDENTIAL_VERSION;
}

function signingSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.A2A_SECRET?.trim() || getAuthSecret(),
  );
}

function verifySecrets(): Uint8Array[] {
  const enc = new TextEncoder();
  const a2a = process.env.A2A_SECRET?.trim();
  // A deploy without an auth signing secret never issued a token signed with
  // one, so a presented bearer token simply fails to verify (401). Reading the
  // secret here would turn every MCP probe on such a deploy into a 500.
  const auth = getMissingAuthSecretKey() === null ? getAuthSecret() : "";
  return [...new Set([a2a, auth].filter((key): key is string => !!key))].map(
    (key) => enc.encode(key),
  );
}

export function normalizeOAuthScope(input: unknown): string | null {
  const requested =
    typeof input === "string"
      ? input
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const allowed = new Set<string>(MCP_OAUTH_SCOPES);
  if (requested.length === 0) return MCP_OAUTH_DEFAULT_SCOPE;
  const selected = requested.filter((scope) => allowed.has(scope));
  return selected.length ? [...new Set(selected)].join(" ") : null;
}

export function scopeList(scope: string | undefined): string[] {
  return (scope ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasMcpOAuthScope(
  scopes: string[] | undefined,
  scope: (typeof MCP_OAUTH_SCOPES)[number],
): boolean {
  if (!scopes) return true;
  return scopes.includes(scope);
}

export function parseMcpOAuthOrgIdClaim(
  payload: Record<string, unknown>,
): { orgId: string | null | undefined } | null {
  if (!Object.prototype.hasOwnProperty.call(payload, "org_id")) {
    return { orgId: undefined };
  }
  if (payload.org_id === null) return { orgId: null };
  return typeof payload.org_id === "string" && payload.org_id
    ? { orgId: payload.org_id }
    : null;
}

export async function signMcpOAuthAccessToken(params: {
  ownerEmail: string;
  orgId?: string | null;
  orgDomain?: string | null;
  clientId: string;
  scope: string;
  resource: string;
  issuer: string;
  /** Immutable server-recorded creation time of the OAuth grant, in ms. */
  grantCreatedAtMs?: number | null;
  jti?: string;
  expiresIn?: string | number;
  catalogScope?: "full";
  /** An org service identity, not a person. */
  service?: true;
}): Promise<string> {
  if (
    params.grantCreatedAtMs !== undefined &&
    params.grantCreatedAtMs !== null &&
    (!Number.isSafeInteger(params.grantCreatedAtMs) ||
      params.grantCreatedAtMs < 0)
  ) {
    throw new Error(
      "OAuth grant creation time must be a non-negative integer.",
    );
  }
  return new jose.SignJWT({
    typ: MCP_OAUTH_TOKEN_TYPE,
    credential_version: params.service
      ? MCP_OAUTH_SERVICE_CREDENTIAL_VERSION
      : MCP_OAUTH_CREDENTIAL_VERSION,
    sub: params.ownerEmail,
    ...(params.orgId !== undefined ? { org_id: params.orgId } : {}),
    ...(params.orgDomain ? { org_domain: params.orgDomain } : {}),
    scope: params.scope,
    client_id: params.clientId,
    resource: params.resource,
    ...(typeof params.grantCreatedAtMs === "number"
      ? { grant_created_at_ms: params.grantCreatedAtMs }
      : {}),
    ...(params.catalogScope === "full" ? { catalog_scope: "full" } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(params.issuer)
    .setAudience(params.resource)
    .setJti(params.jti ?? randomUUID())
    .setIssuedAt()
    .setExpirationTime(params.expiresIn ?? MCP_OAUTH_ACCESS_TOKEN_TTL)
    .sign(signingSecret());
}

function normaliseResource(r: string): string {
  return r.replace(/\/+$/, "");
}

function buildAudienceList(
  resource: string | string[] | undefined,
): string[] | null {
  if (!resource) return null;
  const raw = Array.isArray(resource) ? resource : [resource];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const n = normaliseResource(r);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.length ? out : null;
}

export async function verifyMcpOAuthAccessToken(
  token: string,
  resource: string | string[] | undefined,
): Promise<{
  userEmail: string;
  orgId?: string | null;
  orgDomain?: string;
  scopes: string[];
  clientId: string;
  jti?: string;
  /** Immutable OAuth grant creation time, in milliseconds. */
  grantCreatedAtMs?: number;
  catalogScope?: "full";
  /** `iat`, in seconds. */
  issuedAt?: number;
} | null> {
  const audiences = buildAudienceList(resource);
  if (!audiences) return null;

  const secrets = verifySecrets();
  let payload: jose.JWTPayload | null = null;

  outer: for (const audience of audiences) {
    for (const secret of secrets) {
      try {
        const result = await jose.jwtVerify(token, secret, { audience });
        payload = result.payload;
        break outer;
      } catch (err: any) {
        const code: string = err?.code ?? "";
        if (
          code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
          code === "ERR_JWS_INVALID"
        ) {
          continue;
        }
        break;
      }
    }
  }

  if (!payload) return null;

  try {
    if (payload.typ !== MCP_OAUTH_TOKEN_TYPE) return null;
    if (
      payload.credential_version !== MCP_OAUTH_CREDENTIAL_VERSION &&
      payload.credential_version !== MCP_OAUTH_SERVICE_CREDENTIAL_VERSION
    )
      return null;
    if (typeof payload.resource !== "string") return null;
    const embeddedResource = normaliseResource(payload.resource);
    if (!audiences.includes(embeddedResource)) return null;
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.client_id !== "string" || !payload.client_id) {
      return null;
    }
    const scope = typeof payload.scope === "string" ? payload.scope : "";
    const scopes = scopeList(scope);
    if (!scopes.some((s) => MCP_OAUTH_SCOPES.includes(s as any))) {
      return null;
    }
    const orgIdClaim = parseMcpOAuthOrgIdClaim(payload);
    if (!orgIdClaim) return null;
    const grantCreatedAtMs = payload.grant_created_at_ms;
    if (
      grantCreatedAtMs !== undefined &&
      (typeof grantCreatedAtMs !== "number" ||
        !Number.isSafeInteger(grantCreatedAtMs) ||
        grantCreatedAtMs < 0)
    ) {
      return null;
    }
    return {
      userEmail: payload.sub,
      orgId: orgIdClaim.orgId,
      orgDomain:
        typeof payload.org_domain === "string" ? payload.org_domain : undefined,
      scopes,
      clientId: payload.client_id,
      jti: typeof payload.jti === "string" ? payload.jti : undefined,
      ...(typeof grantCreatedAtMs === "number" ? { grantCreatedAtMs } : {}),
      ...(payload.catalog_scope === "full" ? { catalogScope: "full" } : {}),
      ...(typeof payload.iat === "number" ? { issuedAt: payload.iat } : {}),
    };
  } catch {
    return null;
  }
}
