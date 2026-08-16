import { verifyA2AToken } from "@agent-native/core/a2a";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import type {
  ActionRouteAuthAdapter,
  ActionRouteResolvedCaller,
} from "@agent-native/core/server";

export const WORKSPACE_APPS_ACTION_PATH =
  "/_agent-native/actions/list-workspace-apps";

function isWorkspaceAppsActionPath(event: any): boolean {
  const rawUrl =
    (typeof event?.path === "string" && event.path) ||
    (typeof event?.node?.req?.url === "string" && event.node.req.url) ||
    (typeof event?.req?.url === "string" && event.req.url) ||
    "/";
  const requestPath =
    String(rawUrl).split("?", 1)[0].replace(/\/+$/, "") || "/";
  const appBasePath = process.env.APP_BASE_PATH?.trim().replace(/\/+$/, "");
  return (
    requestPath === WORKSPACE_APPS_ACTION_PATH ||
    Boolean(
      appBasePath &&
      `${appBasePath}${WORKSPACE_APPS_ACTION_PATH}` === requestPath,
    )
  );
}

function readAuthorizationHeader(event: any): string | undefined {
  const headers = event?.node?.req?.headers ?? event?.req?.headers;
  if (typeof headers?.get === "function") {
    return headers.get("authorization") ?? undefined;
  }
  const value = headers?.authorization ?? headers?.Authorization;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The hosted workspace registry is a read-only action that accepts a caller
 * JWT from Dispatch. Keep this resolver path-scoped so the shared secret never
 * becomes a bearer credential for unrelated Dispatch actions.
 */
export const workspaceAppActionRouteAuth: ActionRouteAuthAdapter = {
  resolveCaller: async (event): Promise<ActionRouteResolvedCaller | null> => {
    if (!isWorkspaceAppsActionPath(event)) return null;

    const authorization = readAuthorizationHeader(event);
    if (!authorization) return null;
    if (!authorization.startsWith("Bearer ")) {
      throw new Error("Invalid workspace registry authorization");
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token) throw new Error("Invalid workspace registry authorization");

    const identity = await verifyA2AToken(token, event);
    if (!identity.email) {
      throw new Error("Invalid workspace registry authorization");
    }

    return {
      owner: identity.email,
      anonymous: false,
      orgId: await resolveOrgIdForEmail(identity.email),
    };
  },
};
