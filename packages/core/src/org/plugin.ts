import {
  defineEventHandler,
  setResponseStatus,
  getMethod,
  getRequestURL,
  type H3Event,
} from "h3";
import {
  awaitBootstrap,
  getH3App,
  FRAMEWORK_PREFIX,
} from "../server/framework-request-handler.js";
import { runMigrations } from "../db/migrations.js";
import { ORG_MIGRATIONS } from "./migrations.js";
import {
  getMyOrgHandler,
  createOrgHandler,
  updateOrgHandler,
  switchOrgHandler,
  listMembersHandler,
  removeMemberHandler,
  listInvitationsHandler,
  createInvitationHandler,
  acceptInvitationHandler,
  joinByDomainHandler,
  setDomainHandler,
  setA2ASecretHandler,
} from "./handlers.js";

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
 *   PUT    /_agent-native/org/switch                      — switch active org
 *   GET    /_agent-native/org/members                     — list members of active org
 *   DELETE /_agent-native/org/members/:email              — remove member (owner/admin only)
 *   GET    /_agent-native/org/invitations                 — list pending invites
 *   POST   /_agent-native/org/invitations                 — invite by email
 *   POST   /_agent-native/org/invitations/:id/accept      — accept an invitation
 *   POST   /_agent-native/org/join-by-domain              — join org via email domain match
 *   PUT    /_agent-native/org/domain                      — set/clear allowed email domain (owner/admin)
 *   PUT    /_agent-native/org/a2a-secret                  — regenerate or set A2A secret (owner/admin)
 */
export function createOrgPlugin(): NitroPluginDef {
  const migrate = runMigrations(ORG_MIGRATIONS, { table: "_org_migrations" });

  return async (nitroApp: any) => {
    await awaitBootstrap(nitroApp);
    await migrate(nitroApp);

    const app = getH3App(nitroApp);

    // GET /me
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

    // /members and /members/:email — dispatch by path-tail + method in a
    // single handler so H3's prefix-based `app.use` doesn't route a DELETE
    // for /members/alice@example.com to the GET-only /members handler.
    //
    // NOTE: the framework request handler (packages/core/src/server/
    // framework-request-handler.ts) strips the mount prefix from
    // event.url.pathname before calling the handler, so inside here
    // `url.pathname` is ALREADY the tail relative to this mount point.
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
        // Tail is /:email
        if (method !== "DELETE") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return removeMemberHandler(event);
      }),
    );

    // /invitations and /invitations/:id/accept — same pattern.
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
        // Tail is /:id/accept
        if (/^\/[^\/]+\/accept\/?$/.test(tail)) {
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

    // POST /join-by-domain
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

    // PUT /a2a-secret
    app.use(
      `${ORG_PREFIX}/a2a-secret`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "PUT") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return setA2ASecretHandler(event);
      }),
    );

    // PUT /domain
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

    // PUT /switch
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

    // POST / (create) + PATCH / (rename) — mounted last so the more specific routes match first
    app.use(
      ORG_PREFIX,
      defineEventHandler(async (event: H3Event) => {
        const method = getMethod(event);
        if (method === "POST") return createOrgHandler(event);
        if (method === "PATCH") return updateOrgHandler(event);
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }),
    );
  };
}

/**
 * Default org plugin — mount with no configuration needed.
 *
 * Auto-mounted by the framework when a template doesn't ship `server/plugins/org.ts`.
 * To override, create your own plugin file using `createOrgPlugin()` or a
 * completely custom implementation.
 */
export const defaultOrgPlugin: NitroPluginDef = createOrgPlugin();
