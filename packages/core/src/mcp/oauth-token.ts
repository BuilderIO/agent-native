import * as jose from "jose";
import { randomUUID } from "node:crypto";
import { getAuthSecret } from "../server/better-auth-instance.js";
import { MCP_OAUTH_ACCESS_TOKEN_TTL } from "./oauth-store.js";

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

function signingSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.A2A_SECRET?.trim() || getAuthSecret(),
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
   * When `"full"`, embed a `catalog_scope: "full"` custom claim so that on
   * hosted multi-tenant deployments (AGENT_NATIVE_CONNECTOR_CATALOG=1) this
   * token bypasses the connector-catalog tier filter. Used when the connect
   * flow is initiated with `--full-catalog`.
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

export async function verifyMcpOAuthAccessToken(
  token: string,
  resource: string | undefined,
): Promise<{
  userEmail: string;
  orgId?: string;
  orgDomain?: string;
  scopes: string[];
  clientId: string;
  jti?: string;
  /** Present when the token was minted with `--full-catalog`; bypasses the
   *  connector-catalog tier filter on hosted multi-tenant deployments. */
  catalogScope?: "full";
} | null> {
  if (!resource) return null;
  try {
    const { payload } = await jose.jwtVerify(token, signingSecret(), {
      audience: resource,
    });
    if (payload.typ !== "agent-native-mcp-oauth") return null;
    if (payload.resource !== resource) return null;
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
