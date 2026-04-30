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

/**
 * Verify an inbound A2A JWT signed with the shared A2A_SECRET.
 * Returns the caller's email (from `sub` claim) if valid, null otherwise.
 */
interface A2ATokenPayload {
  email: string | null;
  orgDomain: string | null;
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
  authHeader: string,
  event: any | undefined,
): Promise<A2ATokenPayload> {
  const token = authHeader.replace("Bearer ", "");

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

  // Step 2: Look up the org's A2A secret by domain
  let secret: string | undefined;
  if (orgDomainHint) {
    try {
      const { getA2ASecretByDomain } = await import("../org/context.js");
      const orgSecret = await getA2ASecretByDomain(orgDomainHint);
      if (orgSecret) secret = orgSecret;
    } catch {
      // DB not ready or column doesn't exist yet — fall through
    }
  }

  // Step 3: Fall back to global A2A_SECRET
  if (!secret) secret = process.env.A2A_SECRET;
  if (!secret) return { email: null, orgDomain: null };

  // Step 4: Verify JWT with the resolved secret. Pass `audience` only when
  // the token actually carries an `aud` claim (backward-compat: tokens
  // minted by older `signA2AToken` versions don't include one). The
  // issuer is always present per `signA2AToken` at client.ts:42 — but
  // we don't enforce it because operators may legitimately mint tokens
  // from arbitrary issuer URLs (e.g. dev tunnels, behind reverse proxies).
  try {
    const verifyOptions: jose.JWTVerifyOptions = {};
    if (
      unverifiedPayload &&
      typeof unverifiedPayload.aud !== "undefined"
    ) {
      const aud = expectedJwtAudience(event);
      if (aud) verifyOptions.audience = aud;
    }
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
    return { email: null, orgDomain: null };
  }
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
  // Public agent card endpoint (no auth required)
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
      return generateAgentCard(config, baseUrl);
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
      // taskId. Without a secret, accept unsigned dispatches — the task
      // store claim is atomic and the body only carries an opaque task id,
      // so an unsigned dispatch is bounded in damage to re-running already-
      // queued work that the original sender already approved.
      if (process.env.A2A_SECRET) {
        const auth = getRequestHeader(event, "authorization");
        const tok = extractBearerToken(auth);
        if (!verifyInternalToken(taskId, tok)) {
          setResponseStatus(event, 401);
          return { error: "Invalid or expired processor token" };
        }
      }

      try {
        await processA2ATaskFromQueue(taskId, config);
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
      let verifiedCallerEmail: string | null = null;
      let verifiedOrgDomain: string | null = null;

      // Try JWT verification first (org-level or global A2A_SECRET-based identity)
      if (authHeader?.startsWith("Bearer ")) {
        const tokenPayload = await verifyA2AToken(authHeader);
        verifiedCallerEmail = tokenPayload.email;
        verifiedOrgDomain = tokenPayload.orgDomain;
        // If a secret exists (org-level or global) and token fails verification, reject
        if (!verifiedCallerEmail && process.env.A2A_SECRET) {
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
      }

      // Fall back to legacy API key check (exact string match)
      if (!verifiedCallerEmail && config.apiKeyEnv) {
        const expectedKey = process.env[config.apiKeyEnv];
        if (expectedKey) {
          if (!authHeader || !authHeader.startsWith("Bearer ")) {
            setResponseStatus(event, 401);
            return {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32001, message: "Authentication required" },
            };
          }
          const token = authHeader.slice(7);
          if (token !== expectedKey) {
            setResponseStatus(event, 401);
            return {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32001, message: "Invalid API key" },
            };
          }
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
