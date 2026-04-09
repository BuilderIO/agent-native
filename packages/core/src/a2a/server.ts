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
async function verifyA2AToken(authHeader: string): Promise<string | null> {
  const secret = process.env.A2A_SECRET;
  if (!secret) return null;

  try {
    const token = authHeader.replace("Bearer ", "");
    const { payload } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    return (payload.sub as string) ?? null;
  } catch {
    return null;
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

      // Try JWT verification first (A2A_SECRET-based identity)
      if (authHeader?.startsWith("Bearer ") && process.env.A2A_SECRET) {
        verifiedCallerEmail = await verifyA2AToken(authHeader);
        // If A2A_SECRET is set and token fails verification, reject the request
        if (!verifiedCallerEmail) {
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

      // Store verified caller email on the event context so the handler
      // can set AGENT_USER_EMAIL from a trusted source instead of metadata
      if (verifiedCallerEmail) {
        event.context.__a2aVerifiedEmail = verifiedCallerEmail;
      }

      const body = await readBody(event);
      return handleJsonRpcH3(body, event, config);
    }),
  );
}
