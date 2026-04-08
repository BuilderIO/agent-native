/**
 * Auto-mount actions as HTTP endpoints under /_agent-native/actions/:name.
 *
 * Actions are exposed as POST by default. Use `http: { method: "GET" }` in
 * defineAction to expose as GET. Use `http: false` to mark as agent-only.
 */
import { getH3App } from "./framework-request-handler.js";
import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  getMethod,
  getQuery,
} from "h3";
import type { ActionEntry } from "../agent/production-agent.js";

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

        // Parse params based on method
        let params: Record<string, any>;
        try {
          if (method === "GET") {
            params = getQuery(event) as Record<string, any>;
          } else {
            params = (await readBody(event)) ?? {};
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
          setResponseStatus(event, 500);
          return {
            error: err?.message ?? String(err),
          };
        }
      }),
    );

    mounted.push(`${method} ${routePath}`);
  }

  if (mounted.length > 0) {
    console.log(
      `[action-routes] Mounted ${mounted.length} action route(s): ${mounted.join(", ")}`,
    );
  }
}
