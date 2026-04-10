import {
  defineEventHandler,
  setResponseStatus,
  getMethod,
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
  switchOrgHandler,
  listMembersHandler,
  removeMemberHandler,
  listInvitationsHandler,
  createInvitationHandler,
  acceptInvitationHandler,
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
 *   PUT    /_agent-native/org/switch                      — switch active org
 *   GET    /_agent-native/org/members                     — list members of active org
 *   DELETE /_agent-native/org/members/:email              — remove member (owner/admin only)
 *   GET    /_agent-native/org/invitations                 — list pending invites
 *   POST   /_agent-native/org/invitations                 — invite by email
 *   POST   /_agent-native/org/invitations/:id/accept      — accept an invitation
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

    // GET /members + DELETE /members/:email
    app.use(
      `${ORG_PREFIX}/members`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return listMembersHandler(event);
      }),
    );
    app.use(
      `${ORG_PREFIX}/members/:email`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "DELETE") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return removeMemberHandler(event);
      }),
    );

    // GET + POST /invitations
    app.use(
      `${ORG_PREFIX}/invitations`,
      defineEventHandler(async (event: H3Event) => {
        const m = getMethod(event);
        if (m === "GET") return listInvitationsHandler(event);
        if (m === "POST") return createInvitationHandler(event);
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }),
    );
    // POST /invitations/:id/accept
    app.use(
      `${ORG_PREFIX}/invitations/:id/accept`,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return acceptInvitationHandler(event);
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

    // POST / (create) — mounted last so the more specific routes match first
    app.use(
      ORG_PREFIX,
      defineEventHandler(async (event: H3Event) => {
        if (getMethod(event) !== "POST") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return createOrgHandler(event);
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
