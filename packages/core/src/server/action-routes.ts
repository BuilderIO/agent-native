/**
 * Auto-mount actions as HTTP endpoints under /_agent-native/actions/:name.
 *
 * Actions are exposed as POST by default. Use `http: { method: "GET" }` in
 * defineAction to expose as GET. Use `http: false` to mark as agent-only.
 */
import { getH3App } from "./framework-request-handler.js";
import {
  defineEventHandler,
  setResponseStatus,
  getMethod,
  getQuery,
  getHeader,
} from "h3";
import type { ActionEntry } from "../agent/production-agent.js";
import { readBody } from "../server/h3-helpers.js";
import { runWithRequestContext } from "./request-context.js";
import { recordChange } from "./poll.js";

const ROUTE_PREFIX = "/_agent-native/actions";

/**
 * Read the caller's IANA timezone from the `x-user-timezone` header. The core
 * client sends this on every action request so server-side "today" fallbacks
 * can honor the user's local day.
 */
function readTimezoneHeader(event: any): string | undefined {
  try {
    const raw = getHeader(event, "x-user-timezone");
    if (!raw || typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 && trimmed.length < 64 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

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

        // Resolve auth context for per-request scoping
        const userEmail = options?.getOwnerFromEvent
          ? await options.getOwnerFromEvent(event)
          : undefined;
        const orgId = options?.resolveOrgId
          ? ((await options.resolveOrgId(event)) ?? undefined)
          : undefined;
        const timezone = readTimezoneHeader(event);

        // Also set process.env for backwards compat with scripts that
        // read it directly (CLI invocations, legacy code paths).
        if (userEmail) process.env.AGENT_USER_EMAIL = userEmail;
        if (orgId) {
          process.env.AGENT_ORG_ID = orgId;
        } else {
          delete process.env.AGENT_ORG_ID;
        }
        if (timezone) process.env.AGENT_USER_TIMEZONE = timezone;

        return runWithRequestContext(
          { userEmail, orgId, timezone },
          async () => {
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

            // Auto-refresh the UI after a successful mutating action. GET
            // actions and actions explicitly flagged readOnly are skipped.
            // Other tabs' useDbSync will see source:"action" and invalidate
            // their action queries. The calling tab already refetches via
            // useActionMutation's onSuccess, so this is mainly cross-tab
            // sync (and parity with the agent's tool-call path).
            // Explicit entry.readOnly (true OR false) wins over the method
            // heuristic. defineAction already auto-infers GET → readOnly=true,
            // so for actions registered through that path entry.readOnly is
            // always set and the fallback just guards legacy wrap paths.
            const isReadOnly =
              typeof entry.readOnly === "boolean"
                ? entry.readOnly
                : method === "GET";
            if (!isReadOnly) {
              try {
                recordChange({
                  source: "action",
                  type: "change",
                  key: name,
                });
              } catch {
                // ignore
              }
            }

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
        }); // end runWithRequestContext
      }),
    );

    mounted.push(`${method} ${routePath}`);
  }

  if (mounted.length > 0 && process.env.DEBUG)
    console.log(
      `[action-routes] Mounted ${mounted.length} action route(s): ${mounted.join(", ")}`,
    );
}
