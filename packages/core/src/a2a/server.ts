import {
  defineEventHandler,
  readBody,
  setResponseHeader,
  setResponseStatus,
  getMethod,
  getRequestHeader,
} from "h3";
import type { A2AConfig } from "./types.js";
import { generateAgentCard } from "./agent-card.js";
import { handleJsonRpcH3 } from "./handlers.js";

/**
 * Mount A2A protocol endpoints on an H3/Nitro app.
 *
 * - GET /.well-known/agent-card.json — public agent card (no auth)
 * - POST /_agent-native/a2a — JSON-RPC endpoint (with optional auth)
 */
export function mountA2A(
  nitroApp: any,
  config: A2AConfig,
  routePrefix = "/_agent-native",
): void {
  // Public agent card endpoint (no auth required)
  (nitroApp.h3App || nitroApp._h3).use(
    "/.well-known/agent-card.json",
    defineEventHandler((event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const req = event.node?.req;
      const protocol =
        getRequestHeader(event, "x-forwarded-proto") ||
        (req?.socket && "encrypted" in req.socket ? "https" : "http");
      const host = getRequestHeader(event, "host") ?? "localhost";
      const baseUrl = `${protocol}://${host}`;
      return generateAgentCard(config, baseUrl);
    }),
  );

  // JSON-RPC A2A endpoint (with optional auth)
  (nitroApp.h3App || nitroApp._h3).use(
    `${routePrefix}/a2a`,
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      // Auth check
      if (config.apiKeyEnv) {
        const expectedKey = process.env[config.apiKeyEnv];
        if (expectedKey) {
          const authHeader = getRequestHeader(event, "authorization");
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

      const body = await readBody(event);
      return handleJsonRpcH3(body, event, config);
    }),
  );
}
