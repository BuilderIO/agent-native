import { verifyA2AToken } from "@agent-native/core/a2a";
import {
  isOrgMember,
  resolveOrgByDomain,
  resolveOrgIdForEmail,
} from "@agent-native/core/org";
import type {
  ActionRouteAuthAdapter,
  ActionRouteResolvedCaller,
} from "@agent-native/core/server";

export const WORKSPACE_APPS_ACTION_PATH =
  "/_agent-native/actions/list-workspace-apps";

function isWorkspaceAppsActionPath(event: any): boolean {
  const rawUrl =
    (typeof event?.context?._mountedPathname === "string" &&
      event.context._mountedPathname) ||
    (typeof event?.path === "string" && event.path) ||
    (typeof event?.url?.pathname === "string" && event.url.pathname) ||
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

    const orgDomain = identity.orgDomain?.trim().toLowerCase();
    const claimedOrgId = identity.orgId?.trim();
    let orgId: string | null;
    if (claimedOrgId) {
      // A signed org_id is authoritative when the sender had an org-scoped
      // request but could not resolve a domain. If both claims exist, reject
      // a mismatch rather than allowing either claim to widen scope.
      if (orgDomain) {
        const org = await resolveOrgByDomain(orgDomain);
        if (org && org.orgId !== claimedOrgId) {
          throw new Error("Invalid workspace registry authorization");
        }
      }
      if (!(await isOrgMember(claimedOrgId, identity.email))) {
        throw new Error("Invalid workspace registry authorization");
      }
      orgId = claimedOrgId;
    } else if (orgDomain) {
      // A verified domain claim identifies the caller's intended org. Resolve
      // it locally instead of falling back to the receiver's active-org or
      // first-membership selection, which can be wrong for multi-org users.
      const org = await resolveOrgByDomain(orgDomain);
      if (!org || !(await isOrgMember(org.orgId, identity.email))) {
        throw new Error("Invalid workspace registry authorization");
      }
      orgId = org.orgId;
    } else {
      // Preserve compatibility with legacy tokens that predate org_domain.
      orgId = await resolveOrgIdForEmail(identity.email);
    }

    return {
      owner: identity.email,
      anonymous: false,
      orgId,
    };
  },
};
