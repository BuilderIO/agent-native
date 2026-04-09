/**
 * Auto-mount actions as HTTP endpoints under /_agent-native/actions/:name.
 *
 * Actions are exposed as POST by default. Use `http: { method: "GET" }` in
 * defineAction to expose as GET. Use `http: false` to mark as agent-only.
 */
import { getH3App } from "./framework-request-handler.js";
import { defineEventHandler, setResponseStatus, getMethod, getQuery } from "h3";
import type { ActionEntry } from "../agent/production-agent.js";
import { readBody } from "../server/h3-helpers.js";

const ROUTE_PREFIX = "/_agent-native/actions";

export interface MountActionRoutesOptions {
  /** Resolve owner email from the H3 event (for data scoping). */
  getOwnerFromEvent?: (event: any) => string | Promise<string>;
  /** Resolve org ID from the H3 event (for org scoping). */
  resolveOrgId?: (event: any) => string | null | Promise<string | null>;
}

/**
 * Mount discovered actions as HTTP endpoints.
 *
 * Only actions from `autoDiscoverActions` (template actions) are mounted.
 * Built-in actions (resource-*, chat-*, shell, etc.) are NOT passed here.
 */
export function mountActionRoutes(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options?: MountActionRoutesOptions,
) {
  const mounted: string[] = [];

  for (const [name, entry] of Object.entries(actions)) {
    // Skip agent-only actions
    if (entry.http === false) continue;

    const method = entry.http?.method ?? "POST";
    const path = entry.http?.path ?? name;
    const routePath = `${ROUTE_PREFIX}/${path}`;

    getH3App(nitroApp).use(
      routePath,
      defineEventHandler(async (event) => {
        const reqMethod = getMethod(event);

        // Allow the declared method
        if (reqMethod !== method) {
          setResponseStatus(event, 405);
          return { error: `Method not allowed. Use ${method}.` };
        }

        // Set auth context (same pattern as agent-chat-plugin)
        if (options?.getOwnerFromEvent) {
          const owner = await options.getOwnerFromEvent(event);
          process.env.AGENT_USER_EMAIL = owner;
        }
        if (options?.resolveOrgId) {
          const orgId = await options.resolveOrgId(event);
          if (orgId) {
            process.env.AGENT_ORG_ID = orgId;
          } else {
            delete process.env.AGENT_ORG_ID;
          }
        }

        // Parse params based on method. On web-standard runtimes (Netlify
        // Functions, CF Workers), event.req IS the web Request — use .json()
        // directly. H3's readBody fails on those runtimes because it expects
        // a Node.js stream on event.node.req.
        let params: Record<string, any>;
        try {
          if (method === "GET") {
            // H3 v2: prefer web Request URL, fallback to getQuery
            const webReq = (event as any).req;
            if (webReq?.url) {
              const url = new URL(webReq.url);
              params = Object.fromEntries(url.searchParams);
            } else {
              params = getQuery(event) as Record<string, any>;
            }
          } else {
            const webReq = (event as any).req;
            if (webReq && typeof webReq.json === "function") {
              // H3 v2: event.req is the web Request — use .json() directly
              params = (await webReq.json().catch(() => null)) ?? {};
            } else {
              // Fallback: H3's readBody (Node.js dev)
              params = (await readBody(event)) ?? {};
            }
          }
        } catch {
          params = {};
        }

        // Run the action
        try {
          const result = await entry.run(params);

          // If the action returned a string, try to parse as JSON for a clean response
          if (typeof result === "string") {
            try {
              return JSON.parse(result);
            } catch {
              return result;
            }
          }

          return result;
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          // Return 400 for validation errors, 500 for everything else
          setResponseStatus(
            event,
            msg.startsWith("Invalid action parameters:") ? 400 : 500,
          );
          return { error: msg };
        }
      }),
    );

    mounted.push(`${method} ${routePath}`);
  }

  if (mounted.length > 0 && process.env.DEBUG)
    console.log(
      `[action-routes] Mounted ${mounted.length} action route(s): ${mounted.join(", ")}`,
    );
}
