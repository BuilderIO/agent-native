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
 * The caller is another org app, authenticated by the org A2A secret as a
 * Bearer JWT — exactly like A2A peers authenticate to `/_agent-native/a2a`.
 * Verification reuses the SAME recipe as core's A2A receiver
 * (`packages/core/src/a2a/server.ts` `verifyA2AToken`) and
 * `receiveA2ASecretHandler` (`packages/core/src/org/handlers.ts`): peek the
 * unverified `org_domain`, build the ordered candidate-secret set
 * (the org's per-domain `a2a_secret` via `getA2ASecretByDomain` from
 * `@agent-native/core/org`), verify the HS256
 * signature, then require the verified org_domain to resolve to a LOCAL org
 * (`resolveOrgByDomain`). Cross-org / unauthenticated callers are rejected.
 * The crypto/secret-resolution helpers are imported from `@agent-native/core`
 * — no crypto is reimplemented (HS256 verify uses Node's built-in `crypto`,
 * the same operation jose performs).
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

import {
  getA2ASecretByDomain,
  getOrgDomain,
  resolveOrgByDomain,
} from "@agent-native/core/org";
import { getH3App, runWithRequestContext } from "@agent-native/core/server";
import { discoverOrgDirectoryAgents } from "@agent-native/core/server/agent-discovery";
import { defineEventHandler, getMethod, getRequestHeader } from "h3";
import type { H3Event } from "h3";

import {
  ORG_APPS_PATH,
  buildOrgAppsResponse,
  createOrgDirectorySuccessCache,
  extractBearerToken,
  verifyA2ABearerToken,
  type DiscoveredAppLike,
} from "../lib/org-apps-directory.js";

const SELF_APP_ID = "dispatch";
const directoryCache = createOrgDirectorySuccessCache<DiscoveredAppLike[]>();

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

    // ---- A2A peer auth (reuses core's A2A verification recipe) ----------
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

    const verified = await verifyA2ABearerToken({
      token,
      resolveOrgSecretByDomain: (domain) => getA2ASecretByDomain(domain),
    });
    if (!verified) {
      return jsonResponse(
        {
          error: "unauthorized",
          error_description: "Invalid or expired A2A token.",
        },
        401,
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
      // Either the domain is unknown here, or it belongs to a different org
      // than this Dispatch serves — do not disclose anything cross-org.
      return jsonResponse(
        {
          error: "forbidden",
          error_description:
            "Caller org does not match this Dispatch workspace.",
        },
        403,
      );
    }

    // ---- Build the directory from Dispatch's existing registry ---------
    // Scope discovery to the verified caller's org/user so org-tracked
    // custom/remote agents resolve correctly (discoverAgents reads request
    // context). No DB writes; this is strictly read-only.
    const includeDirectoryApp =
      getRequestHeader(event, "x-agent-native-include-directory-app") === "1";
    const preferLocalUrls =
      process.env.AGENT_NATIVE_PREFER_LOCAL_APP_URLS === "1";
    const cacheKey = [
      localOrg.orgId,
      includeDirectoryApp ? "include-self" : "exclude-self",
      preferLocalUrls ? "local" : "hosted",
    ].join("|");
    let apps: DiscoveredAppLike[];
    try {
      apps = await directoryCache.get(cacheKey, async () =>
        runWithRequestContext(
          { userEmail: verified.email, orgId: localOrg.orgId },
          async () => {
            const startedAt = Date.now();
            const discovered = await discoverOrgDirectoryAgents(
              includeDirectoryApp ? undefined : SELF_APP_ID,
              { preferLocalUrls },
            );
            const durationMs = Date.now() - startedAt;
            if (discovered.status === "unavailable") {
              console.error("[org-apps-directory] discovery unavailable", {
                stage: discovered.reason,
                durationMs,
              });
              throw new DirectoryDiscoveryUnavailable(discovered.reason);
            }
            console.info("[org-apps-directory] discovery complete", {
              durationMs,
              appCount: discovered.agents.length,
            });
            return discovered.agents.map((agent) => ({
              id: agent.id,
              name: agent.name,
              description: agent.description,
              url: agent.url,
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

    const body = buildOrgAppsResponse({
      org: orgLabel,
      apps,
      selfId: includeDirectoryApp ? undefined : SELF_APP_ID,
    });

    // Short, cacheable, read-only. Private (per-org) so shared caches must
    // not store it; a small max-age lets the caller poll cheaply.
    return jsonResponse(body, 200, {
      "Cache-Control": "private, max-age=60",
    });
  },
);

export function _resetOrgAppsDirectoryCache(): void {
  directoryCache.clear();
}

/**
 * Dispatch org-app-directory plugin. The primary Dispatch auth plugin owns
 * the exact public-path registration so this handler can perform its own JWT
 * and same-org checks without racing a second auth initializer.
 */
export default async (nitroApp: any) => {
  getH3App(nitroApp).use(ORG_APPS_PATH, orgAppsHandler);
};
