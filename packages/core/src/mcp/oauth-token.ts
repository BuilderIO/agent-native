import { randomUUID } from "node:crypto";

import * as jose from "jose";

import { getAuthSecret } from "../server/better-auth-instance.js";
import {
  MCP_OAUTH_ACCESS_TOKEN_TTL,
  MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
} from "./oauth-store.js";

export { MCP_OAUTH_ACCESS_TOKEN_TTL, MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS };

export const MCP_OAUTH_SCOPES = ["mcp:read", "mcp:write", "mcp:apps"] as const;

export const MCP_OAUTH_DEFAULT_SCOPE = MCP_OAUTH_SCOPES.join(" ");

export interface McpOAuthAccessTokenClaims {
  sub: string;
  org_id?: string;
  org_domain?: string;
  scope: string;
  client_id: string;
  resource: string;
  jti?: string;
  typ: "agent-native-mcp-oauth";
}

/** Primary signing secret: A2A_SECRET when set, else the better-auth secret. */
function signingSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.A2A_SECRET?.trim() || getAuthSecret(),
  );
}

/**
 * All candidate verify secrets in priority order.
 * Mint always uses the primary; verify tries all to survive secret rotation
 * (e.g. A2A_SECRET being added or removed from a deploy without a redeploy).
 */
function verifySecrets(): Uint8Array[] {
  const enc = new TextEncoder();
  const a2a = process.env.A2A_SECRET?.trim();
  const auth = getAuthSecret();
  if (a2a && a2a !== auth) {
    return [enc.encode(a2a), enc.encode(auth)];
  }
  return [enc.encode(a2a || auth)];
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

export async function signMcpOAuthAccessToken(params: {
  ownerEmail: string;
  orgId?: string | null;
  orgDomain?: string | null;
  clientId: string;
  scope: string;
  resource: string;
  issuer: string;
  jti?: string;
  expiresIn?: string | number;
  /**
   * When `"full"`, embed a `catalog_scope: "full"` custom claim so this token
   * bypasses the compact/connector-catalog tier filter (active by default
   * whenever a `connectorCatalog` is declared). Used when the connect flow is
   * initiated with `--full-catalog`.
   */
  catalogScope?: "full";
}): Promise<string> {
  return new jose.SignJWT({
    typ: "agent-native-mcp-oauth",
    sub: params.ownerEmail,
    ...(params.orgId ? { org_id: params.orgId } : {}),
    ...(params.orgDomain ? { org_domain: params.orgDomain } : {}),
    scope: params.scope,
    client_id: params.clientId,
    resource: params.resource,
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

/**
 * Normalise a trailing slash so that audience comparisons are not sensitive to
 * whether the resource URL was written with or without a trailing slash.
 */
function normaliseResource(r: string): string {
  return r.replace(/\/+$/, "");
}

/**
 * Deduplicate an audience list after normalising trailing slashes.
 * Accepts a single string or an array; always returns a non-empty array or
 * `null` when the input was empty / undefined.
 */
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
  orgId?: string;
  orgDomain?: string;
  scopes: string[];
  clientId: string;
  jti?: string;
  /** Present when the token was minted with `--full-catalog`; bypasses the
   *  compact/connector-catalog tier filter (active by default whenever a
   *  `connectorCatalog` is declared) for this caller. */
  catalogScope?: "full";
} | null> {
  const audiences = buildAudienceList(resource);
  if (!audiences) return null;

  // Try each candidate secret in priority order.  We only fall through to the
  // next secret on a signature failure (JWSSignatureVerificationFailed /
  // JWSInvalid).  Expired or wrong-audience errors are definitive — no retry.
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
        // Signature failures → try next secret; all other errors → bail.
        if (
          code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
          code === "ERR_JWS_INVALID"
        ) {
          continue;
        }
        // Expired, wrong audience, or malformed → this audience+secret pair is
        // structurally incompatible; try the next audience.
        break;
      }
    }
  }

  if (!payload) return null;

  try {
    if (payload.typ !== "agent-native-mcp-oauth") return null;
    // The embedded `resource` claim must match one of the accepted audiences.
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
    return {
      userEmail: payload.sub,
      orgId: typeof payload.org_id === "string" ? payload.org_id : undefined,
      orgDomain:
        typeof payload.org_domain === "string" ? payload.org_domain : undefined,
      scopes,
      clientId: payload.client_id,
      jti: typeof payload.jti === "string" ? payload.jti : undefined,
      ...(payload.catalog_scope === "full" ? { catalogScope: "full" } : {}),
    };
  } catch {
    return null;
  }
}
