/**
 * `GET /_agent-native/org/apps` — Dispatch's authenticated ORG APP DIRECTORY.
 *
 * Dispatch is the workspace control plane / identity authority. Every
 * agent-native org app (mail, calendar, analytics, …) can ask Dispatch which
 * sibling apps belong to its org and what their A2A endpoint URLs are, so
 * cross-app auto-wiring needs zero manual per-app configuration.
 *
 * AUTH — reuses the EXISTING A2A peer auth path, no new scheme.
 * ------------------------------------------------------------
 * A verified organization principal can list org-visible apps. A verified
 * user assertion can additionally list that user's own private apps. Core
 * verifies the JWT and binds its audience to this request.
 *
 * APP-LIST SOURCE — Dispatch's existing connected-apps registry.
 * -------------------------------------------------------------
 * Dispatch already has a connected-apps concept: `discoverAgents()`
 * from `@agent-native/core/server/agent-discovery` (the same source
 * `list-connected-agents` and the `call-agent` delegation path use). It
 * returns the allow-listed first-party apps with their prod URLs PLUS any
 * org-tracked custom/remote agents and sibling workspace apps Dispatch
 * already tracks. Hidden first-party templates are already excluded from
 * `BUILTIN_AGENTS` (guard-template-list stays clean), so this endpoint adds
 * no second list and no new datastore — it is a thin, read-only directory
 * over what Dispatch already knows.
 *
 * Auth-guard reachability: `/_agent-native/*` is 401'd by the core auth
 * guard when there is no session. This route is authenticated by the A2A
 * JWT, not a cookie, so — exactly like the identity-sso plugin's authorize
 * route — Dispatch's primary auth plugin receives its exact `publicPath`
 * from `setupDispatch`. "Public path" only means "the guard does not pre-empt
 * with a 401"; the handler still performs
 * the full A2A JWT + same-org check itself (defense in depth). The path is
 * matched exactly, so no other `/_agent-native/org/*` route is affected.
 *
 * Read-only, cacheable, no secrets in the response, no mutation.
 */

import { verifyA2AToken } from "@agent-native/core/a2a";
import { getOrgDomain, resolveOrgByDomain } from "@agent-native/core/org";
import { getH3App, runWithRequestContext } from "@agent-native/core/server";
import { discoverOrgDirectoryAgents } from "@agent-native/core/server/agent-discovery";
import {
  orgAppsDirectoryCache,
  listOrganizationVisibleWorkspaceApps,
  listWorkspaceApps,
} from "@agent-native/dispatch/server";
import { defineEventHandler, getMethod, getRequestHeader } from "h3";
import type { H3Event } from "h3";

import {
  ORG_APPS_PATH,
  buildOrgAppsResponse,
  extractBearerToken,
  type DiscoveredAppLike,
} from "../lib/org-apps-directory.js";

const SELF_APP_ID = "dispatch";
const directoryCache = orgAppsDirectoryCache;

class DirectoryDiscoveryUnavailable extends Error {
  constructor(readonly reason: "remote-manifests" | "workspace-metadata") {
    super("Organization app directory discovery is unavailable.");
    this.name = "DirectoryDiscoveryUnavailable";
  }
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export const orgAppsHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const token = extractBearerToken(getRequestHeader(event, "authorization"));
    if (!token) {
      return jsonResponse(
        {
          error: "unauthorized",
          error_description:
            "Bearer A2A token required (same org A2A secret used for " +
            "/_agent-native/a2a).",
        },
        401,
      );
    }

    let verified: Awaited<ReturnType<typeof verifyA2AToken>>;
    try {
      verified = await verifyA2AToken(token, event);
    } catch {
      return jsonResponse({ error: "identity_verification_unavailable" }, 503, {
        "Cache-Control": "private, no-store",
      });
    }
    if (!verified) {
      return jsonResponse(
        {
          error: "unauthorized",
          error_description: "Invalid or expired A2A token.",
        },
        401,
      );
    }
    const isOrganizationPrincipal =
      verified.identityAssurance === "organization";
    const userEmail =
      !isOrganizationPrincipal && verified.email
        ? verified.email.trim().toLowerCase()
        : undefined;
    if (!isOrganizationPrincipal && !userEmail) {
      return jsonResponse(
        {
          error: "forbidden",
          error_description:
            "A verified user or organization identity is required.",
        },
        verified.orgDomain ? 403 : 401,
      );
    }
    if (!verified.orgDomain) {
      return jsonResponse(
        {
          error: "forbidden",
          error_description: "Caller must belong to an organization.",
        },
        403,
      );
    }

    // ---- Same-org enforcement ------------------------------------------
    // The verified org_domain MUST resolve to a local org. This both
    // confirms the caller is the SAME org Dispatch serves and gives us the
    // org identity to scope the (read-only) discovery to.
    let localOrg: { orgId: string; orgName: string } | null = null;
    try {
      localOrg = await resolveOrgByDomain(verified.orgDomain);
    } catch {
      localOrg = null;
    }
    if (!localOrg) {
      return jsonResponse(
        {
          error: "forbidden",
          error_description:
            "Caller org does not match this Dispatch workspace.",
        },
        403,
      );
    }
    if (verified.orgId && verified.orgId !== localOrg.orgId) {
      return jsonResponse(
        {
          error: "forbidden",
          error_description:
            "Caller organization does not match this Dispatch workspace.",
        },
        403,
      );
    }

    const includeDirectoryApp =
      getRequestHeader(event, "x-agent-native-include-directory-app") === "1";
    const preferLocalUrls =
      process.env.AGENT_NATIVE_PREFER_LOCAL_APP_URLS === "1";
    const cacheKey = [
      localOrg.orgId,
      userEmail ? `user:${userEmail}` : "organization",
      includeDirectoryApp ? "include-self" : "exclude-self",
      preferLocalUrls ? "local" : "hosted",
    ].join("|");
    let apps: DiscoveredAppLike[];
    try {
      apps = await directoryCache.get(cacheKey, async () =>
        runWithRequestContext(
          {
            orgId: localOrg.orgId,
            ...(userEmail ? { userEmail } : {}),
          },
          async () => {
            const startedAt = Date.now();
            const visibleWorkspaceApps = isOrganizationPrincipal
              ? await listOrganizationVisibleWorkspaceApps()
              : await listWorkspaceApps({
                  includeAgentCards: false,
                  audience: "all",
                });
            const allowedWorkspaceAppIds = new Set(
              visibleWorkspaceApps
                .filter(
                  (app) =>
                    app.status === "ready" &&
                    (app.visibility === "org" ||
                      (app.visibility === "private" &&
                        !!userEmail &&
                        app.owner?.trim().toLowerCase() === userEmail)) &&
                    app.orgEnabled !== false &&
                    typeof app.url === "string" &&
                    app.url.trim().length > 0,
                )
                .map((app) => app.id),
            );
            const discovered = await discoverOrgDirectoryAgents(
              includeDirectoryApp ? undefined : SELF_APP_ID,
              { preferLocalUrls, allowedWorkspaceAppIds },
            );
            const durationMs = Date.now() - startedAt;
            if (discovered.status === "unavailable") {
              console.error("[org-apps-directory] discovery unavailable", {
                stage: discovered.reason,
                durationMs,
              });
              throw new DirectoryDiscoveryUnavailable(discovered.reason);
            }
            const safeAgents = discovered.agents.filter((agent) => {
              if (agent.source === "workspace") {
                return allowedWorkspaceAppIds.has(agent.id);
              }
              return (
                agent.source === "builtin" ||
                agent.source === "remote-agent" ||
                agent.source === "org-directory"
              );
            });
            console.info("[org-apps-directory] discovery complete", {
              durationMs,
              appCount: safeAgents.length,
            });
            return safeAgents.map((agent) => ({
              id: agent.id,
              name: agent.name,
              description: agent.description,
              whenToUse: agent.whenToUse,
              aliases: agent.aliases,
              url: agent.url,
              source: agent.source,
            }));
          },
        ),
      );
    } catch (error) {
      const reason =
        error instanceof DirectoryDiscoveryUnavailable
          ? error.reason
          : "unexpected";
      return jsonResponse({ error: "directory_unavailable", reason }, 503, {
        "Cache-Control": "private, no-store",
      });
    }

    let orgLabel = verified.orgDomain;
    try {
      const domain = await getOrgDomain(localOrg.orgId);
      if (domain && domain.trim()) orgLabel = domain.trim().toLowerCase();
      else orgLabel = localOrg.orgId;
    } catch {
      orgLabel = verified.orgDomain || localOrg.orgId;
    }

    const response = buildOrgAppsResponse({
      org: orgLabel,
      apps,
      selfId: includeDirectoryApp ? undefined : SELF_APP_ID,
    });
    const aliasesById = new Map(
      apps.map((app) => [
        app.id,
        (app as DiscoveredAppLike & { aliases?: string[] }).aliases,
      ]),
    );
    const body = {
      ...response,
      apps: response.apps.map((app) => {
        const aliases = aliasesById.get(app.id);
        return aliases?.length ? { ...app, aliases } : app;
      }),
    };

    return jsonResponse(body, 200, {
      "Cache-Control": "private, no-store",
    });
  },
);

export function _resetOrgAppsDirectoryCache(): void {
  directoryCache.clear();
}

export default async (nitroApp: any) => {
  getH3App(nitroApp).use(ORG_APPS_PATH, orgAppsHandler);
};
