import * as jose from "jose";
import { getH3App } from "../server/framework-request-handler.js";
import {
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
  getMethod,
  getRequestHeader,
} from "h3";
import type { A2AConfig } from "./types.js";
import { generateAgentCard } from "./agent-card.js";
import { handleJsonRpcH3, processA2ATaskFromQueue } from "./handlers.js";
import { readBody } from "../server/h3-helpers.js";
import {
  extractBearerToken,
  verifyInternalToken,
} from "../integrations/internal-token.js";
import {
  hasConfiguredA2ASecret,
  isA2AProductionRuntime,
} from "./auth-policy.js";

/**
 * One-time warning when A2A is running unauthenticated in development. We
 * don't refuse the request (local templates need to work out of the box),
 * but we log a single noisy line so operators notice if they accidentally
 * deploy with no auth configured.
 */
let _warnedUnauthA2A = false;
function warnA2AUnauthOnce(): void {
  if (_warnedUnauthA2A) return;
  _warnedUnauthA2A = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[a2a] No A2A_SECRET or apiKeyEnv configured — A2A endpoint runs unauthenticated. " +
      "This is allowed in development but blocked in production. Set A2A_SECRET before deploying.",
  );
}

/**
 * Verify an inbound A2A JWT signed with the shared A2A_SECRET.
 * Returns the caller's email (from `sub` claim) if valid, null otherwise.
 */
interface A2ATokenPayload {
  email: string | null;
  orgDomain: string | null;
}

function addSecretCandidate(
  candidates: string[],
  secret: string | undefined,
): void {
  const trimmed = secret?.trim();
  if (!trimmed || candidates.includes(trimmed)) return;
  candidates.push(trimmed);
}

/**
 * Resolve the audience (`aud`) value to expect in an inbound JWT. We use the
 * receiver's app URL — it's the natural identifier of "who this token was
 * minted for". Falls back to undefined when no app URL is configured, in
 * which case the audience check is skipped (backward-compat with tokens
 * minted before the audience claim shipped).
 */
function expectedJwtAudience(event: any | undefined): string | undefined {
  const fromEnv =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL;
  if (fromEnv) return String(fromEnv);
  // Best-effort: derive from the inbound request host. This is forgeable
  // (Host-header attack), but only useful as a hint when env-derived URL
  // is unset; the rest of the JWT verification still uses the secret.
  try {
    const proto = getRequestHeader(event, "x-forwarded-proto") || "https";
    const host = getRequestHeader(event, "host");
    if (host) return `${proto}://${host}`;
  } catch {}
  return undefined;
}

async function verifyA2AToken(
  token: string,
  event: any | undefined,
): Promise<A2ATokenPayload> {
  // Step 1: Peek at JWT claims WITHOUT verification to get org_domain.
  // This is safe because we only use org_domain to look up the secret,
  // then verify the full JWT with that secret. If someone forges a JWT
  // with a fake org_domain, verification will fail because they don't
  // have the real secret.
  let orgDomainHint: string | undefined;
  let unverifiedPayload: jose.JWTPayload | undefined;
  try {
    unverifiedPayload = jose.decodeJwt(token);
    orgDomainHint = unverifiedPayload.org_domain as string | undefined;
  } catch {
    // Malformed token — fall through to global secret attempt
  }

  // Step 2: Build a small, ordered set of candidate secrets. Tokens minted by
  // current callers prefer the shared A2A_SECRET; older callers may still use
  // an org-level secret. Try both without logging or reflecting secret details.
  const candidateSecrets: string[] = [];
  addSecretCandidate(candidateSecrets, process.env.A2A_SECRET);
  if (orgDomainHint) {
    try {
      const { getA2ASecretByDomain } = await import("../org/context.js");
      const orgSecret = await getA2ASecretByDomain(orgDomainHint);
      addSecretCandidate(candidateSecrets, orgSecret);
    } catch {
      // DB not ready or column doesn't exist yet — fall through
    }
  }
  if (candidateSecrets.length === 0) return { email: null, orgDomain: null };

  // Step 3: Verify JWT with the candidate secrets.
  //
  // - `audience`: passed only when the token carries an `aud` claim
  //   (backward-compat: tokens minted by older `signA2AToken` versions
  //   don't include one).
  // - `issuer`: enforced when the token carries an `iss` claim. The
  //   sender's `signA2AToken` (`a2a/client.ts:42`) sets the issuer to its
  //   own app URL, so a verified token must self-identify a non-empty
  //   string issuer. We accept any string the token claims (we don't pin
  //   a specific expected issuer because dispatchers may legitimately
  //   mint tokens from many sender URLs — dev tunnels, multi-deploy
  //   setups). The pin is "issuer must match the value the token says
  //   it was minted from", which `jose.jwtVerify` validates exactly when
  //   `issuer` is supplied as a string. Backward-compat: when the token
  //   has no `iss`, we skip the check.
  try {
    const verifyOptions: jose.JWTVerifyOptions = {};
    if (unverifiedPayload && typeof unverifiedPayload.aud !== "undefined") {
      const aud = expectedJwtAudience(event);
      if (aud) verifyOptions.audience = aud;
    }
    if (
      unverifiedPayload &&
      typeof unverifiedPayload.iss === "string" &&
      unverifiedPayload.iss.length > 0
    ) {
      verifyOptions.issuer = unverifiedPayload.iss;
    }
    for (const secret of candidateSecrets) {
      try {
        const { payload } = await jose.jwtVerify(
          token,
          new TextEncoder().encode(secret),
          verifyOptions,
        );
        return {
          email: (payload.sub as string) ?? null,
          orgDomain: (payload.org_domain as string) ?? null,
        };
      } catch {
        // Try the next candidate without leaking which secret failed.
      }
    }
  } catch {
    // Keep malformed option construction indistinguishable from auth failure.
  }
  return { email: null, orgDomain: null };
}

/**
 * Mount A2A protocol endpoints on an H3/Nitro app.
 *
 * - GET /.well-known/agent-card.json — public agent card (no auth)
 * - POST /_agent-native/a2a — JSON-RPC endpoint (with optional auth)
 *
 * When A2A_SECRET is set, inbound Bearer tokens are verified as JWTs
 * and the caller's email is extracted from the `sub` claim. This provides
 * cryptographic identity verification for cross-app A2A calls.
 */
export function mountA2A(
  nitroApp: any,
  config: A2AConfig,
  routePrefix = "/_agent-native",
): void {
  // Public agent card endpoint (no auth required).
  //
  // SECURITY: per-user / per-org MCP tools are filtered out of the public
  // skills list. Their merged-key prefix (`mcp__user_<emailhash>_…` or
  // `mcp__org_<orgid>_…`) discloses (a) which users have integrations
  // attached, and (b) what those integrations are — fingerprinting the
  // tenant. Template- and framework-defined skills stay; only the dynamic
  // per-tenant MCP entries are dropped. See finding #7 in
  // /tmp/security-audit/12-mcp-a2a-agent.md.
  getH3App(nitroApp).use(
    "/.well-known/agent-card.json",
    defineEventHandler((event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const protocol =
        getRequestHeader(event, "x-forwarded-proto") ||
        (event.url?.protocol?.replace(":", "") ?? "http");
      const host = getRequestHeader(event, "host") ?? "localhost";
      const baseUrl = `${protocol}://${host}`;

      // Filter out per-user/per-org MCP tools to avoid tenant disclosure.
      // Note: stdio MCP tools loaded from a file-based mcp.config.json are
      // process-wide and don't carry a per-user/per-org prefix, so they
      // remain visible. That's intentional — they're an operator-controlled
      // capability list.
      const filteredSkills = (config.skills ?? []).filter((skill) => {
        const id =
          (skill as { id?: string; name?: string }).id ??
          (skill as { name?: string }).name ??
          "";
        if (typeof id !== "string") return true;
        return !id.startsWith("mcp__user_") && !id.startsWith("mcp__org_");
      });

      return generateAgentCard(
        { ...config, skills: filteredSkills },
        baseUrl,
        `${routePrefix}/a2a`,
      );
    }),
  );

  // Async-mode processor route. MUST be mounted BEFORE the `/a2a` catch-all
  // below, since h3's `.use()` matches by prefix and `/a2a` would otherwise
  // swallow `/a2a/_process-task` and return a JSON-RPC "Invalid token" error
  // (the JSON-RPC handler doesn't know about taskId-only bodies).
  //
  // When `message/send` is called with `async: true`, the JSON-RPC handler
  // enqueues the task and self-fires a POST to this route on the same
  // deployment so the actual handler runs in a fresh function execution (its
  // own full timeout). Authenticated with an HMAC token bound to the task id
  // (5-minute lifetime, signed with A2A_SECRET — same scheme as the
  // integration webhook queue).
  getH3App(nitroApp).use(
    `${routePrefix}/a2a/_process-task`,
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const body = (await readBody(event)) as { taskId?: unknown } | null;
      const taskId = body && typeof body.taskId === "string" ? body.taskId : "";
      if (!taskId) {
        setResponseStatus(event, 400);
        return { error: "taskId required" };
      }

      // When A2A_SECRET is set, require a valid HMAC token bound to this
      // taskId. In production, we REQUIRE A2A_SECRET to be set so unsigned
      // dispatches are never accepted (an attacker who fishes a taskId out
      // of logs / a share link could otherwise force-replay it). In
      // development, a missing secret is permitted so local templates work
      // out of the box, but we log a one-time warning so operators notice.
      if (hasConfiguredA2ASecret()) {
        const auth = getRequestHeader(event, "authorization");
        const tok = extractBearerToken(auth);
        if (!verifyInternalToken(taskId, tok)) {
          setResponseStatus(event, 401);
          return { error: "Invalid or expired processor token" };
        }
      } else if (isA2AProductionRuntime()) {
        setResponseStatus(event, 503);
        return {
          error:
            "A2A processor not configured — set A2A_SECRET on this deployment to enable async A2A.",
        };
      } else {
        warnA2AUnauthOnce();
      }

      try {
        await processA2ATaskFromQueue(taskId, config, event);
        return { ok: true };
      } catch (err: any) {
        console.error("[a2a] process-task failed:", err);
        setResponseStatus(event, 500);
        return { error: err?.message ?? "process-task failed" };
      }
    }),
  );

  // JSON-RPC A2A endpoint (with optional auth)
  getH3App(nitroApp).use(
    `${routePrefix}/a2a`,
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      // h3 prefix-matches mounts, so a request to `/a2a/_process-task`
      // reaches this handler too. The dedicated mount above runs first and
      // takes the request, but if that returns `undefined` (or h3 ever
      // changes ordering semantics) defensively bail here. event.path is
      // stripped to the remainder after the mount prefix.
      const sub = (event.path || "/").split("?")[0].replace(/^\//, "");
      if (sub.startsWith("_process-task")) return;

      const authHeader = getRequestHeader(event, "authorization");
      const bearerToken = extractBearerToken(authHeader);
      let verifiedCallerEmail: string | null = null;
      let verifiedOrgDomain: string | null = null;
      let legacyApiKeyAuthenticated = false;
      let bearerTokenRejectedByJwt = false;

      // SECURITY: when neither A2A_SECRET nor an apiKeyEnv is configured,
      // there's no way to authenticate the caller. Default to "auth required"
      // in production — return 503 with a clear message instead of running
      // the agent loop unauthenticated. In development, log a one-time
      // warning but allow so local templates work out of the box.
      const hasA2ASecret = hasConfiguredA2ASecret();
      const hasApiKey = !!(config.apiKeyEnv && process.env[config.apiKeyEnv]);

      // Try JWT verification first (org-level or global A2A_SECRET-based identity)
      if (bearerToken) {
        const tokenPayload = await verifyA2AToken(bearerToken, event);
        verifiedCallerEmail = tokenPayload.email;
        verifiedOrgDomain = tokenPayload.orgDomain;
        bearerTokenRejectedByJwt = !verifiedCallerEmail;
      }

      // Fall back to legacy API key check (exact string match)
      if (!verifiedCallerEmail && config.apiKeyEnv) {
        const expectedKey = process.env[config.apiKeyEnv];
        if (expectedKey) {
          if (!bearerToken) {
            setResponseStatus(event, 401);
            return {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32001, message: "Authentication required" },
            };
          }
          if (bearerToken !== expectedKey) {
            setResponseStatus(event, 401);
            return {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32001, message: "Invalid API key" },
            };
          }
          legacyApiKeyAuthenticated = true;
        }
      }

      if (!verifiedCallerEmail && !legacyApiKeyAuthenticated) {
        // Any supplied bearer token that failed JWT verification is an auth
        // failure after the legacy exact-match apiKeyEnv path has had a
        // chance to succeed. Do not let bad tokens fall through to tasks/get
        // and get reported as lookup misses.
        if (bearerTokenRejectedByJwt) {
          setResponseStatus(event, 401);
          return {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32001,
              message: "Invalid or expired A2A token",
            },
          };
        }

        if (!hasA2ASecret && !hasApiKey) {
          if (isA2AProductionRuntime()) {
            setResponseStatus(event, 503);
            return {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32001,
                message:
                  "A2A authentication not configured. Set A2A_SECRET (preferred) or configure apiKeyEnv to accept inbound A2A traffic.",
              },
            };
          }
          warnA2AUnauthOnce();
        } else if (isA2AProductionRuntime()) {
          setResponseStatus(event, 401);
          return {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32001,
              message: "Authentication required",
            },
          };
        }
      }

      // Store verified caller identity on the event context so the handler
      // can set request context from a trusted source instead of metadata
      if (verifiedCallerEmail) {
        event.context.__a2aVerifiedEmail = verifiedCallerEmail;
      }
      if (verifiedOrgDomain) {
        event.context.__a2aOrgDomain = verifiedOrgDomain;
      }

      const body = await readBody(event);
      return handleJsonRpcH3(body, event, config);
    }),
  );
}
