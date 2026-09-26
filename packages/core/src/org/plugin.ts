import {
  defineEventHandler,
  setResponseStatus,
  getMethod,
  getRequestURL,
  type H3Event,
} from "h3";

import { runMigrations } from "../db/migrations.js";
import { registerFeatureFlags } from "../feature-flags/registry.js";
import {
  awaitBootstrap,
  getH3App,
  FRAMEWORK_PREFIX,
  markDefaultPluginProvided,
} from "../server/framework-request-handler.js";
import {
  listAppRolesHandler,
  setAppRoleHandler,
  getAppPermissionsHandler,
  setAppPermissionsHandler,
  resetAppPermissionHandler,
} from "./app-roles-handlers.js";
import {
  listSSOProvidersHandler,
  createSSOProviderHandler,
  verifySSOProviderHandler,
  deleteSSOProviderHandler,
  getSCIMHandler,
  createSCIMHandler,
  deleteSCIMHandler,
} from "./enterprise-auth-handlers.js";
import { CROSS_APP_ORG_FEDERATION_FLAG } from "./feature-flags.js";
import {
  getMyOrgHandler,
  createOrgHandler,
  updateOrgHandler,
  deleteOrgHandler,
  switchOrgHandler,
  listMembersHandler,
  removeMemberHandler,
  retryPendingFederatedRemovalHandler,
  changeMemberRoleHandler,
  listInvitationsHandler,
  createInvitationHandler,
  acceptInvitationHandler,
  joinByDomainHandler,
  setDomainHandler,
  setWorkspaceUrlHandler,
  setRequiredAuthProviderHandler,
  revealA2ASecretHandler,
  setA2ASecretHandler,
  syncA2ASecretHandler,
  receiveA2ASecretHandler,
  setWorkspaceAppDefaultVisibilityHandler,
  setOrgVisualIdentityHandler,
} from "./handlers.js";
import { ORG_MIGRATIONS } from "./migrations.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

const ORG_PREFIX = `${FRAMEWORK_PREFIX}/org`;

/**
 * Mounts the org REST routes under `/_agent-native/org/*` and runs the org
 * module's migrations.
 *
 * Routes:
 *   GET    /_agent-native/org/me                          — current user's active org + invites
 *   POST   /_agent-native/org                             — create organization
 *   PATCH  /_agent-native/org                             — rename organization (owner/admin)
 *   DELETE /_agent-native/org                             — delete organization (owner only)
 *   PUT    /_agent-native/org/switch                      — switch active org
 *   GET    /_agent-native/org/members                     — list members of active org
 *   DELETE /_agent-native/org/members/:email              — remove member (owner/admin only)
 *   POST   /_agent-native/org/federation-removal/retry  — retry the caller's pending self-cleanup
 *   GET    /_agent-native/org/app-roles?appId=X           — app role vocabulary + assignments
 *   PUT    /_agent-native/org/app-roles/:email            — assign/clear app role (owner/admin)
 *   GET    /_agent-native/org/app-permissions/:appId      — effective permission grants
 *   PUT    /_agent-native/org/app-permissions/:appId      — override permission grants
 *   DELETE /_agent-native/org/app-permissions/:appId      — reset permission grants
 *   GET    /_agent-native/org/invitations                 — list pending invites
 *   POST   /_agent-native/org/invitations                 — invite by email
 *   POST   /_agent-native/org/invitations/:id/accept      — accept an invitation
 *   POST   /_agent-native/org/join-by-domain              — join org via email domain match
 *   PUT    /_agent-native/org/domain                      — set/clear allowed email domain (owner/admin)
 *   PUT    /_agent-native/org/workspace-url               — set/clear the org's workspace origin (owner/admin)
 *   PUT    /_agent-native/org/auth-provider               — require/clear Google sign-in (owner/admin)
 *   PUT    /_agent-native/org/visual-identity              — set/clear workspace icon (owner/admin)
 *   GET    /_agent-native/org/a2a-secret                  — reveal A2A secret on demand (owner/admin)
 *   PUT    /_agent-native/org/a2a-secret                  — regenerate or set A2A secret (owner/admin)
 *   POST   /_agent-native/org/a2a-secret/sync             — push secret to all connected apps (owner/admin)
 *   POST   /_agent-native/org/a2a-secret/receive          — accept a peer's secret push (JWT-auth, no session)
 */
export function createOrgPlugin(): NitroPluginDef {
  const migrate = runMigrations(ORG_MIGRATIONS, { table: "_org_migrations" });

  return async (nitroApp: any) => {
    registerFeatureFlags([CROSS_APP_ORG_FEDERATION_FLAG]);
    markDefaultPluginProvided(nitroApp, "org");
    await awaitBootstrap(nitroApp);
    await migrate(nitroApp);

    const app = getH3App(nitroApp);

    app.use(
      `${ORG_PREFIX}/me`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return getMyOrgHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/app-roles`,
      defineEventHandler(async (event: H3Event) => {
        const tail = getRequestURL(event).pathname || "/";
        const method = getMethod(event);
        if (tail === "" || tail === "/") {
          if (method !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return listAppRolesHandler(event);
        }
        if (method !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return setAppRoleHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/app-permissions`,
      defineEventHandler(async (event: H3Event) => {
        const tail = getRequestURL(event).pathname || "/";
        const method = getMethod(event);
        if (!/^\/[^/]+\/?$/.test(tail)) {
          setResponseStatus(event, 404);
          return { error: "Not found" };
        }
        if (method === "GET") return getAppPermissionsHandler(event);
        if (method === "PUT") return setAppPermissionsHandler(event);
        if (method === "DELETE") return resetAppPermissionHandler(event);
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }),
    );

    app.use(
      `${ORG_PREFIX}/sso/providers`,
      defineEventHandler(async (event: H3Event) => {
        const tail = getRequestURL(event).pathname || "/";
        const method = getMethod(event);
        if (tail === "" || tail === "/") {
          if (method === "GET") return listSSOProvidersHandler(event);
          if (method === "POST") return createSSOProviderHandler(event);
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        if (/^\/[^/]+\/verify\/?$/.test(tail)) {
          if (method !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return verifySSOProviderHandler(event);
        }
        if (/^\/[^/]+\/?$/.test(tail)) {
          if (method !== "DELETE") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return deleteSSOProviderHandler(event);
        }
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }),
    );

    app.use(
      `${ORG_PREFIX}/scim`,
      defineEventHandler(async (event: H3Event) => {
        const tail = getRequestURL(event).pathname || "/";
        const method = getMethod(event);
        if (tail === "" || tail === "/") {
          if (method === "GET") return getSCIMHandler(event);
          if (method === "POST") return createSCIMHandler(event);
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        if (/^\/[^/]+\/?$/.test(tail)) {
          if (method !== "DELETE") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return deleteSCIMHandler(event);
        }
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }),
    );

    app.use(
      `${ORG_PREFIX}/members`,
      defineEventHandler(async (event: H3Event) => {
        const tail = getRequestURL(event).pathname || "/";
        const method = getMethod(event);
        if (tail === "" || tail === "/") {
          if (method !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return listMembersHandler(event);
        }
        if (/^\/[^/]+\/role\/?$/.test(tail)) {
          if (method !== "PUT") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return changeMemberRoleHandler(event);
        }
        if (method !== "DELETE") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return removeMemberHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/federation-removal/retry`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return retryPendingFederatedRemovalHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/workspace-app-default-visibility`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return setWorkspaceAppDefaultVisibilityHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/invitations`,
      defineEventHandler(async (event: H3Event) => {
        const tail = getRequestURL(event).pathname || "/";
        const method = getMethod(event);
        if (tail === "" || tail === "/") {
          if (method === "GET") return listInvitationsHandler(event);
          if (method === "POST") return createInvitationHandler(event);
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        if (/^\/[^/]+\/accept\/?$/.test(tail)) {
          if (method !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return acceptInvitationHandler(event);
        }
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }),
    );

    app.use(
      `${ORG_PREFIX}/join-by-domain`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return joinByDomainHandler(event);
      }),
    );

    // POST /a2a-secret/sync — must mount BEFORE /a2a-secret since h3
    // matches by prefix. Pushes the org's A2A secret to every connected app.
    app.use(
      `${ORG_PREFIX}/a2a-secret/sync`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return syncA2ASecretHandler(event);
      }),
    );

    // POST /a2a-secret/receive — must mount BEFORE /a2a-secret. Accepts a
    // peer's secret push; auth is JWT-based (see auth guard exemption).
    app.use(
      `${ORG_PREFIX}/a2a-secret/receive`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return receiveA2ASecretHandler(event);
      }),
    );

    // PUT /a2a-secret — must mount AFTER /a2a-secret/sync and /receive.
    // Dispatches by tail to keep PUT semantics on the parent path while
    // letting POST /a2a-secret return 405 (rather than silently routing
    // to the more-specific handlers above).
    app.use(
      `${ORG_PREFIX}/a2a-secret`,
      defineEventHandler(async (event: H3Event) => {
        const tail = getRequestURL(event).pathname || "/";
        if (
          tail === "/sync" ||
          tail === "/sync/" ||
          tail === "/receive" ||
          tail === "/receive/"
        ) {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        if (getMethod(event) === "GET") return revealA2ASecretHandler(event);
        if (getMethod(event) !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return setA2ASecretHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/domain`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return setDomainHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/workspace-url`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return setWorkspaceUrlHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/visual-identity`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return setOrgVisualIdentityHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/auth-provider`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return setRequiredAuthProviderHandler(event);
      }),
    );

    app.use(
      `${ORG_PREFIX}/switch`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return switchOrgHandler(event);
      }),
    );

    app.use(
      ORG_PREFIX,
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        if (method === "POST") return createOrgHandler(event);
        if (method === "PATCH") return updateOrgHandler(event);
        if (method === "DELETE") return deleteOrgHandler(event);
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }),
    );
  };
}

export const defaultOrgPlugin: NitroPluginDef = createOrgPlugin();
