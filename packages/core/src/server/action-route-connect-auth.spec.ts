import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";

const ACTION_ROUTE_CONNECT_AUTH_TIMEOUT_MS = 15_000;

/**
 * End-to-end auth check for the local-first `/visual-plan` publish flow.
 *
 * `agent-native connect` mints an MCP-audience OAuth access token and the local
 * Plans server POSTs it (as `Authorization: Bearer`) to the HOSTED action route
 * `/_agent-native/actions/import-visual-plan-source`. This test drives the REAL
 * `mountActionRoutes` handler wired to the REAL `getSession`-based owner/org
 * resolver (the exact `resolveOwnerContext` shape `agent-chat-plugin` mounts),
 * and asserts the connect token authenticates the action call and scopes it to
 * the token's owner/org — the integration the unit test in `auth.spec.ts`
 * proves at the `getSession` layer.
 */

// Real h3 is used (no module mock) so getMethod/getHeader/setResponse* behave
// exactly as in production. Only the nitro->h3 adapter is stubbed to identity.
vi.mock("./framework-request-handler.js", () => ({
  getH3App: (app: any) => app,
}));
vi.mock("./action-change.js", () => ({
  notifyActionChange: vi.fn(),
}));

function makePostEvent(opts: {
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): any {
  const url = `http://localhost${opts.path}`;
  const headers = new Headers({ host: "localhost", ...(opts.headers ?? {}) });
  return {
    req: {
      method: "POST",
      url,
      headers,
      json: async () => opts.body ?? {},
    },
    url: new URL(url),
    res: { headers: new Headers(), status: 200 },
    headers,
    context: {},
    path: opts.path,
  };
}

/**
 * Mirror `agent-chat-plugin.resolveOwnerContext`: resolve the owner + org from
 * the request session, throwing a 401 when there is no session and no
 * anonymous-owner fallback. Both `getOwnerFromEvent` and `resolveOrgId` funnel
 * through the same framework `getSession`.
 */
async function buildOwnerResolver() {
  const { getSession } = await import("./auth.js");
  const getOwnerFromEvent = async (event: any): Promise<string> => {
    const session = await getSession(event);
    if (session?.email) return session.email;
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  };
  const resolveOrgId = async (event: any): Promise<string | null> => {
    const session = await getSession(event);
    return session?.orgId ?? null;
  };
  return { getOwnerFromEvent, resolveOrgId };
}

function mockEmptyDb() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => ({ execute }),
    isPostgres: () => false,
    isLocalDatabase: () => true,
    intType: () => "INTEGER",
    retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
  }));
}

async function mintConnectToken(opts: {
  ownerEmail: string;
  orgId: string;
  orgDomain: string;
  resource: string;
  issuer: string;
}) {
  const { signMcpOAuthAccessToken, MCP_OAUTH_DEFAULT_SCOPE } =
    await import("../mcp/oauth-token.js");
  const { MCP_CONNECT_OAUTH_CLIENT_ID } =
    await import("../mcp/connect-store.js");
  return signMcpOAuthAccessToken({
    ownerEmail: opts.ownerEmail,
    orgId: opts.orgId,
    orgDomain: opts.orgDomain,
    clientId: MCP_CONNECT_OAUTH_CLIENT_ID,
    scope: MCP_OAUTH_DEFAULT_SCOPE,
    resource: opts.resource,
    issuer: opts.issuer,
    jti: "jti-action-route-e2e",
    expiresIn: "30d",
  });
}

describe("action route honors connect-minted MCP OAuth tokens", () => {
  afterEach(() => {
    vi.doUnmock("../db/client.js");
    vi.doUnmock("./better-auth-instance.js");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it(
    "authenticates a Bearer connect token and scopes the action to its owner",
    async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-action-route-e2e");
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      delete process.env.A2A_SECRET;

      mockEmptyDb();
      vi.doMock("./better-auth-instance.js", async (importOriginal) => ({
        ...(await importOriginal<object>()),
        getBetterAuthSync: () => null,
      }));

      const { mountActionRoutes } = await import("./action-routes.js");
      const { getRequestUserEmail, getRequestOrgId } =
        await import("./request-context.js");
      const { getOwnerFromEvent, resolveOrgId } = await buildOwnerResolver();

      const seen: { userEmail?: string; orgId?: string } = {};
      const actions: Record<string, ActionEntry> = {
        "import-visual-plan-source": {
          run: vi.fn(async () => {
            seen.userEmail = getRequestUserEmail();
            seen.orgId = getRequestOrgId();
            return { planId: "plan_123", url: "/plans/plan_123" };
          }),
        } as any,
      };

      const mounted: Array<{ path: string; handler: any }> = [];
      const nitroApp = {
        use: (path: string, handler: any) => mounted.push({ path, handler }),
      };
      mountActionRoutes(nitroApp, actions, {
        getOwnerFromEvent,
        resolveOrgId,
      });

      const token = await mintConnectToken({
        ownerEmail: "owner@plans.test",
        orgId: "org-123",
        orgDomain: "plans.test",
        resource: "http://localhost/_agent-native/mcp",
        issuer: "http://localhost",
      });

      const event = makePostEvent({
        path: "/_agent-native/actions/import-visual-plan-source",
        headers: { authorization: `Bearer ${token}` },
        body: { title: "My plan", mdx: { "plan.mdx": "# Plan" } },
      });

      const result = await mounted[0].handler(event);

      expect(result).toEqual({ planId: "plan_123", url: "/plans/plan_123" });
      expect(
        actions["import-visual-plan-source"].run as any,
      ).toHaveBeenCalled();
      // The plan is created as the token's owner/org — identical scoping to MCP.
      expect(seen).toEqual({
        userEmail: "owner@plans.test",
        orgId: "org-123",
      });
    },
    ACTION_ROUTE_CONNECT_AUTH_TIMEOUT_MS,
  );

  it("rejects an unauthenticated action call with a 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-action-route-e2e");
    delete process.env.ACCESS_TOKEN;
    delete process.env.ACCESS_TOKENS;
    delete process.env.A2A_SECRET;

    mockEmptyDb();
    vi.doMock("./better-auth-instance.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      getBetterAuthSync: () => null,
    }));

    const { mountActionRoutes } = await import("./action-routes.js");
    const { getOwnerFromEvent, resolveOrgId } = await buildOwnerResolver();

    const run = vi.fn(async () => ({ planId: "should-not-run" }));
    const actions: Record<string, ActionEntry> = {
      "import-visual-plan-source": { run } as any,
    };
    const mounted: Array<{ path: string; handler: any }> = [];
    const nitroApp = {
      use: (path: string, handler: any) => mounted.push({ path, handler }),
    };
    mountActionRoutes(nitroApp, actions, { getOwnerFromEvent, resolveOrgId });

    const event = makePostEvent({
      path: "/_agent-native/actions/import-visual-plan-source",
      body: { title: "My plan" },
    });

    await expect(mounted[0].handler(event)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
