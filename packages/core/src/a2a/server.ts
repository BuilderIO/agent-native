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
import { handleJsonRpcH3 } from "./handlers.js";
import { readBody } from "../server/h3-helpers.js";

/**
 * Verify an inbound A2A JWT signed with the shared A2A_SECRET.
 * Returns the caller's email (from `sub` claim) if valid, null otherwise.
 */
interface A2ATokenPayload {
  email: string | null;
  orgDomain: string | null;
}

async function verifyA2AToken(authHeader: string): Promise<A2ATokenPayload> {
  const token = authHeader.replace("Bearer ", "");

  // Step 1: Peek at JWT claims WITHOUT verification to get org_domain.
  // This is safe because we only use org_domain to look up the secret,
  // then verify the full JWT with that secret. If someone forges a JWT
  // with a fake org_domain, verification will fail because they don't
  // have the real secret.
  let orgDomainHint: string | undefined;
  try {
    const unverified = jose.decodeJwt(token);
    orgDomainHint = unverified.org_domain as string | undefined;
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

  // Step 4: Verify JWT with the resolved secret
  try {
    const { payload } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret),
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

  // JSON-RPC A2A endpoint (with optional auth)
  getH3App(nitroApp).use(
    `${routePrefix}/a2a`,
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

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
