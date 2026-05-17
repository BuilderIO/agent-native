/**
 * Org App Directory — pure logic for `GET /_agent-native/org/apps`.
 *
 * Dispatch is the workspace control plane / identity authority. This module
 * lets a SIBLING org app (mail, calendar, …) ask Dispatch "which agent-native
 * apps belong to my org and what are their A2A endpoint URLs?" so cross-app
 * auto-wiring needs zero manual setup on each app.
 *
 * The HTTP wiring (session/route mounting, request reading) lives in
 * `server/plugins/org-apps-directory.ts`. This file stays pure so it is
 * trivially unit-testable with no Nitro / DB dependencies.
 *
 * SECURITY MODEL — reuses the EXISTING A2A peer auth, not a new scheme.
 * ---------------------------------------------------------------------
 * The caller is another org app authenticating with the org A2A secret,
 * EXACTLY like A2A peers do. The recipe here is the same one the core A2A
 * receiver uses:
 *
 *   - `packages/core/src/a2a/server.ts` `verifyA2AToken()` — peek the
 *     UNVERIFIED `org_domain` claim, build an ordered candidate-secret set
 *     (`process.env.A2A_SECRET` first, then the org's per-domain
 *     `a2a_secret`), then verify the JWT signature with those secrets.
 *   - `packages/core/src/org/handlers.ts` `receiveA2ASecretHandler` — the
 *     same "peek org_domain, look up our local org's a2a_secret by domain,
 *     verify the bearer JWT signed with that secret" trust check.
 *
 * Tokens are produced by core's `signA2AToken` (`a2a/client.ts`): a standard
 * **HS256** JWT (`alg: "HS256"`, HMAC-SHA256 over the UTF-8 secret bytes)
 * with `sub` (caller email), `org_domain`, `iss`, `iat`, `exp`. We verify
 * that exact shape with Node's built-in `crypto.createHmac` — the SAME
 * cryptographic operation jose performs for HS256. We do NOT invent an auth
 * scheme or a cipher; we reuse the A2A peer model and core's org/secret
 * resolution helpers (`getA2ASecretByDomain`, `resolveOrgByDomain` from
 * `@agent-native/core/org`). `jose` is not a direct dependency of this
 * template (pnpm strict resolution), so a built-in-`crypto` HS256 verify is
 * the dependency-safe way to honor "do not reimplement crypto, reuse the A2A
 * verifier path".
 *
 * Same-org enforcement: the verified token's `org_domain` must resolve to a
 * local org (`resolveOrgByDomain`). A token with no `org_domain`, an unknown
 * domain, or a bad signature is rejected. There is no cross-org disclosure:
 * the only secrets that can sign an accepted token are the deployment's
 * global `A2A_SECRET` (shared first-party fabric) or the specific org's
 * `a2a_secret`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The exact directory route. Registered as a publicPath so the core auth
 * guard does not 401 the peer call before our own JWT check runs (same
 * pattern as the identity-sso plugin's authorize route). */
export const ORG_APPS_PATH = "/_agent-native/org/apps";

/** A2A tokens are signed HS256 by core's `signA2AToken`. */
const A2A_JWT_ALG = "HS256";

export interface VerifiedA2APayload {
  /** Caller email (JWT `sub`). */
  email: string;
  /** Org domain the caller asserted (JWT `org_domain`), lower-cased. */
  orgDomain: string;
}

function base64UrlDecodeToBuffer(input: string): Buffer | null {
  if (typeof input !== "string" || input.length === 0) return null;
  // Reject anything outside the base64url alphabet up front.
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  try {
    return Buffer.from(
      input.replace(/-/g, "+").replace(/_/g, "/") + pad,
      "base64",
    );
  } catch {
    return null;
  }
}

function base64UrlDecodeToString(input: string): string | null {
  const buf = base64UrlDecodeToBuffer(input);
  return buf ? buf.toString("utf8") : null;
}

interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

/**
 * Split + base64url-decode a compact JWS WITHOUT verifying the signature.
 * Mirrors `jose.decodeJwt` usage in the core A2A receiver: used only to read
 * the UNVERIFIED `org_domain` so we know which org secret to verify against.
 * Trust is established by `verifyA2ABearerToken` below.
 */
export function decodeJwtUnverified(token: string): DecodedJwt | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const headerJson = base64UrlDecodeToString(h);
  const payloadJson = base64UrlDecodeToString(p);
  const signature = base64UrlDecodeToBuffer(s);
  if (!headerJson || !payloadJson || !signature) return null;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(headerJson);
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (
    !header ||
    typeof header !== "object" ||
    !payload ||
    typeof payload !== "object"
  ) {
    return null;
  }
  return { header, payload, signingInput: `${h}.${p}`, signature };
}

/** Read the bearer token from an Authorization header value. */
export function extractBearerToken(
  authHeader: string | null | undefined,
): string | null {
  if (typeof authHeader !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const tok = m?.[1]?.trim();
  return tok && tok.length > 0 ? tok : null;
}

/**
 * Verify a candidate HS256 JWT against one secret. Returns the payload on a
 * valid signature + unexpired token, else null. This is exactly the
 * verification jose performs for HS256 (HMAC-SHA256 over
 * `base64url(header).base64url(payload)`, constant-time signature compare,
 * `exp` enforcement) — implemented with Node built-ins so this template does
 * not need a third-party JWT dependency.
 */
function verifyWithSecret(
  decoded: DecodedJwt,
  secret: string,
  nowSeconds: number,
): Record<string, unknown> | null {
  if (decoded.header.alg !== A2A_JWT_ALG) return null;
  const expected = createHmac("sha256", new TextEncoder().encode(secret))
    .update(decoded.signingInput)
    .digest();
  if (expected.length !== decoded.signature.length) return null;
  if (!timingSafeEqual(expected, decoded.signature)) return null;

  // Enforce `exp` (and `nbf` when present) like jose's jwtVerify default.
  const exp = decoded.payload.exp;
  if (typeof exp === "number" && nowSeconds >= exp) return null;
  const nbf = decoded.payload.nbf;
  if (typeof nbf === "number" && nowSeconds < nbf) return null;
  return decoded.payload;
}

/**
 * Verify an inbound A2A bearer token the same way the core A2A receiver does:
 *
 *   1. Decode (unverified) to read the asserted `org_domain`.
 *   2. Build the ordered candidate-secret set: the deployment's global
 *      `A2A_SECRET` first (current callers prefer it), then the specific
 *      org's `a2a_secret` resolved by domain (legacy / org-scoped callers).
 *   3. Verify the signature with each candidate; the first that validates
 *      wins. A token that validates under NO candidate is rejected.
 *
 * `resolveOrgSecretByDomain` is injected so this stays pure/testable; the
 * plugin wires it to `getA2ASecretByDomain` from `@agent-native/core/org`.
 *
 * Returns the verified `{ email, orgDomain }` or null. `null` => 401.
 */
export async function verifyA2ABearerToken(input: {
  token: string;
  globalSecret: string | undefined;
  resolveOrgSecretByDomain: (domain: string) => Promise<string | null>;
  nowSeconds?: number;
}): Promise<VerifiedA2APayload | null> {
  const decoded = decodeJwtUnverified(input.token);
  if (!decoded) return null;

  const assertedDomainRaw = decoded.payload.org_domain;
  const assertedDomain =
    typeof assertedDomainRaw === "string" && assertedDomainRaw.trim()
      ? assertedDomainRaw.trim().toLowerCase()
      : undefined;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  const candidates: string[] = [];
  const pushCandidate = (s: string | null | undefined) => {
    const t = s?.trim();
    if (t && !candidates.includes(t)) candidates.push(t);
  };
  pushCandidate(input.globalSecret);
  if (assertedDomain) {
    try {
      pushCandidate(await input.resolveOrgSecretByDomain(assertedDomain));
    } catch {
      // DB not ready / column missing — fall through to whatever we have.
    }
  }
  if (candidates.length === 0) return null;

  for (const secret of candidates) {
    const payload = verifyWithSecret(decoded, secret, now);
    if (payload) {
      // The org directory is a general A2A-peer endpoint. Reject tokens
      // minted for a different single purpose — SSO identity assertions
      // (`scope: "identity"`) or MCP-connect personal tokens
      // (`scope: "mcp-connect"`) — so a leaked or replayed privileged token
      // cannot enumerate the org's apps. General A2A peer tokens carry no
      // `scope` claim and are still accepted.
      const scope =
        typeof (payload as { scope?: unknown }).scope === "string"
          ? ((payload as { scope: string }).scope as string)
          : "";
      if (scope === "identity" || scope === "mcp-connect") return null;
      const sub = payload.sub;
      const email =
        typeof sub === "string" && sub.trim() ? sub.trim() : undefined;
      if (!email) return null;
      // The verified token MUST carry an org_domain — the directory is
      // strictly org-scoped, and the same-org check needs it. A token with
      // no org_domain (e.g. a personal/no-org caller) cannot be tied to an
      // org and is rejected.
      if (!assertedDomain) return null;
      return { email, orgDomain: assertedDomain };
    }
  }
  return null;
}

export interface OrgAppDirectoryEntry {
  /** Stable app id (e.g. "mail", "calendar"). */
  id: string;
  /** Human-readable app name. */
  name: string;
  /** App base URL. */
  url: string;
  /** A2A JSON-RPC endpoint for the app. */
  a2aUrl: string;
  /** Optional one-line capability/description hint. */
  capabilities?: string;
}

export interface OrgAppDirectoryResponse {
  /** The org this directory is scoped to (domain when known, else org id). */
  org: string;
  apps: OrgAppDirectoryEntry[];
}

/** The documented agent-native A2A JSON-RPC path. */
const A2A_ENDPOINT_PATH = "/_agent-native/a2a";

/**
 * Build the A2A endpoint URL for an app base URL. New agent-native apps
 * expose `/_agent-native/a2a` (see the a2a-protocol skill + core
 * `mountA2A`); the A2A client also probes `/a2a` for legacy peers, but the
 * canonical endpoint we advertise is `/_agent-native/a2a`.
 */
export function toA2aUrl(appUrl: string): string {
  const trimmed = appUrl.replace(/\/+$/, "");
  return `${trimmed}${A2A_ENDPOINT_PATH}`;
}

export interface DiscoveredAppLike {
  id: string;
  name: string;
  description?: string;
  url: string;
}

/**
 * Shape the discovered-agent list into the directory response. The input is
 * Dispatch's EXISTING connected-apps registry — `discoverAgents("dispatch")`
 * from `@agent-native/core/server/agent-discovery`, the same source
 * `list-connected-agents` and the `call-agent` delegation path use. It is
 * already allow-list-respecting (hidden first-party templates are excluded
 * from `BUILTIN_AGENTS` unless `defaultAgent`), so no second filter is
 * needed here; we only drop entries without a usable absolute http(s) URL
 * and Dispatch itself (a caller does not need to discover the directory it
 * just called).
 */
export function buildOrgAppsResponse(input: {
  org: string;
  apps: DiscoveredAppLike[];
  selfId?: string;
}): OrgAppDirectoryResponse {
  const seen = new Set<string>();
  const apps: OrgAppDirectoryEntry[] = [];
  for (const app of input.apps) {
    if (!app || typeof app.id !== "string" || !app.id.trim()) continue;
    if (input.selfId && app.id === input.selfId) continue;
    const url = typeof app.url === "string" ? app.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(app.id)) continue;
    seen.add(app.id);
    const entry: OrgAppDirectoryEntry = {
      id: app.id,
      name: typeof app.name === "string" && app.name.trim() ? app.name : app.id,
      url: url.replace(/\/+$/, ""),
      a2aUrl: toA2aUrl(url),
    };
    const cap =
      typeof app.description === "string" && app.description.trim()
        ? app.description.trim()
        : undefined;
    if (cap) entry.capabilities = cap;
    apps.push(entry);
  }
  apps.sort((a, b) => a.id.localeCompare(b.id));
  return { org: input.org, apps };
}
