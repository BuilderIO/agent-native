import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type ConnectionRow = {
    id: string;
    ownerEmail: string;
    orgId: string | null;
    rootPath: string | null;
    bridgeToken: string | null;
  };
  type GrantRow = { id: string };

  const state = {
    events: [] as string[],
    inMutation: false,
    rejectInside: false,
    mockConnection: null as ConnectionRow | null,
    mockExistingGrant: null as GrantRow | null,
    insertedValues: null as Record<string, unknown> | null,
    updatedSet: null as Record<string, unknown> | null,
    authCapability: undefined as string | undefined,
  };

  const makeSelectChain = (rows: unknown[]) => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  });

  const database = {
    select: (projection?: unknown) => {
      if (projection !== undefined) {
        state.events.push("grant-read");
        return makeSelectChain(
          state.mockExistingGrant ? [state.mockExistingGrant] : [],
        );
      }
      state.events.push("connection-read");
      return makeSelectChain(
        state.mockConnection ? [state.mockConnection] : [],
      );
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.events.push(
          state.inMutation ? "insert-inside" : "insert-outside",
        );
        state.insertedValues = values;
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.events.push(
          state.inMutation ? "update-inside" : "update-outside",
        );
        state.updatedSet = values;
        return { where: () => Promise.resolve() };
      },
    }),
  };

  const assertAccess = vi.fn(async () => {
    state.events.push(state.inMutation ? "access-inside" : "access-outside");
    if (state.inMutation && state.rejectInside) {
      throw new Error("editor access revoked");
    }
  });
  const withDesignSourceMutationTransaction = vi.fn(
    async (
      _designId: string,
      callback: (transaction: typeof database) => Promise<unknown>,
    ) => {
      state.events.push("lock");
      state.inMutation = true;
      try {
        return await callback(database);
      } finally {
        state.inMutation = false;
      }
    },
  );
  const resolveLocalhostConnectionScope = vi.fn(async () => {
    state.events.push("resolve-scope");
    return { ownerEmail: "user@example.com", orgId: "org_1" };
  });

  return {
    getBrowserCookieSession: vi.fn(),
    assertAccess,
    database,
    resolveLocalhostConnectionScope,
    state,
    withDesignSourceMutationTransaction,
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/server", () => ({
  getBrowserCookieSession: mocks.getBrowserCookieSession,
  hasSameOriginBrowserEvidence: () => true,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestAuthCapability: () => mocks.state.authCapability,
  getRequestContext: () => ({ requestOrigin: "https://design.example.com" }),
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));

vi.mock("../server/db/index.js", () => ({
  schema: {
    designLocalhostConnections: {
      id: "connectionId",
      ownerEmail: "connectionOwnerEmail",
      orgId: "connectionOrgId",
    },
    designLocalhostWriteGrants: {
      id: "grantId",
      designId: "grantDesignId",
      connectionId: "grantConnectionId",
      ownerEmail: "grantOwnerEmail",
      orgId: "grantOrgId",
    },
  },
}));

vi.mock("../server/lib/localhost-connection.js", () => ({
  resolveLocalhostConnectionScope: mocks.resolveLocalhostConnectionScope,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (left: unknown, right: unknown) => ({ left, right }),
  isNull: (column: unknown) => ({ isNull: column }),
}));

vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
}));

vi.mock("nanoid", () => ({ nanoid: () => "fixed_grant_id" }));

import action from "./grant-localhost-write-consent.js";

function browserContext(): ActionRunContext {
  return {
    caller: "frontend",
    userEmail: "user@example.com",
    requestHeaders: new Headers({
      origin: "https://design.example.com",
      "sec-fetch-site": "same-origin",
      cookie: "better-auth.session_token=fixture-browser-session",
    }),
  };
}

function runAction(
  args: Parameters<typeof action.run>[0],
  context = browserContext(),
) {
  return action.run(args, context);
}

beforeEach(() => {
  mocks.state.events.length = 0;
  mocks.state.inMutation = false;
  mocks.state.rejectInside = false;
  mocks.state.mockConnection = null;
  mocks.state.mockExistingGrant = null;
  mocks.state.insertedValues = null;
  mocks.state.updatedSet = null;
  mocks.state.authCapability = undefined;
  mocks.getBrowserCookieSession.mockReset().mockResolvedValue({
    email: "user@example.com",
  });
  mocks.assertAccess.mockClear();
  mocks.resolveLocalhostConnectionScope.mockClear();
  mocks.withDesignSourceMutationTransaction.mockClear();
});

describe("grant-localhost-write-consent", () => {
  const connection = (
    overrides: Partial<{
      rootPath: string | null;
      bridgeToken: string | null;
    }> = {},
  ) => ({
    id: "conn_1",
    ownerEmail: "user@example.com",
    orgId: "org_1",
    rootPath: "/home/user/my-app",
    bridgeToken: "bridge_token_abc",
    ...overrides,
  });

  it.each([
    "capability-only",
    "capability identity with a browser cookie",
    "bearer-only",
    "MCP card",
    "different browser user",
  ])("refuses localhost consent from %s", async (credential) => {
    mocks.state.mockConnection = connection();
    const context = browserContext();
    if (credential.startsWith("capability")) {
      mocks.state.authCapability = "capability:visual-edit:design:design_1";
    }
    if (credential === "MCP card") {
      context.caller = "mcp-widget";
      mocks.state.authCapability = "capability:mcp-directory-widget:fixture";
    }
    if (credential === "capability-only" || credential === "MCP card") {
      context.userEmail = undefined;
    }
    if (credential === "different browser user") {
      mocks.getBrowserCookieSession.mockResolvedValue({
        email: "other@example.com",
      });
    } else if (credential !== "capability identity with a browser cookie") {
      mocks.getBrowserCookieSession.mockResolvedValue(null);
      context.requestHeaders?.delete("cookie");
      context.requestHeaders?.set("authorization", "Bearer fixture-token");
    }

    await expect(
      runAction({ designId: "design_1", connectionId: "conn_1" }, context),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "browser_session_required",
      statusCode: 401,
    });
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.state.insertedValues).toBeNull();
    expect(mocks.state.updatedSet).toBeNull();
  });

  it("persists the connection bridge token without returning it", async () => {
    mocks.state.mockConnection = connection();

    const result = await runAction({
      designId: "design_1",
      connectionId: "conn_1",
    });

    expect(result).not.toHaveProperty("bridgeToken");
    expect(mocks.state.insertedValues?.bridgeToken).toBe("bridge_token_abc");
    expect(mocks.state.events).toEqual([
      "access-outside",
      "resolve-scope",
      "lock",
      "access-inside",
      "connection-read",
      "grant-read",
      "insert-inside",
    ]);
  });

  it("rechecks editor access under the source lock before writing", async () => {
    mocks.state.mockConnection = connection();
    mocks.state.rejectInside = true;

    await expect(
      runAction({ designId: "design_1", connectionId: "conn_1" }),
    ).rejects.toThrow("editor access revoked");

    expect(mocks.state.events).toEqual([
      "access-outside",
      "resolve-scope",
      "lock",
      "access-inside",
    ]);
    expect(mocks.state.insertedValues).toBeNull();
    expect(mocks.state.updatedSet).toBeNull();
  });

  it.each([
    [
      "no bridge token",
      { bridgeToken: null },
      /no bridge token/,
      "bridge-token-missing",
      424,
    ],
    [
      "no root path",
      { rootPath: null },
      /rootPath/,
      "connection-root-path-missing",
      412,
    ],
  ])(
    "returns a typed error when the connection has %s",
    async (_label, patch, message, errorCode, statusCode) => {
      mocks.state.mockConnection = connection(patch);

      await expect(
        runAction({ designId: "design_1", connectionId: "conn_1" }),
      ).rejects.toMatchObject({
        actionContractError: true,
        errorCode,
        statusCode,
        message: expect.stringMatching(message),
      });
      expect(mocks.state.insertedValues).toBeNull();
      expect(mocks.state.updatedSet).toBeNull();
    },
  );

  it("returns a typed error when the connection row is not found", async () => {
    await expect(
      runAction({ designId: "design_1", connectionId: "conn_missing" }),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "connection-not-found",
      statusCode: 404,
      message: expect.stringMatching(/not found/),
    });
  });

  it("updates an existing grant while holding the source lock", async () => {
    mocks.state.mockConnection = connection({
      bridgeToken: "bridge_token_refreshed",
    });
    mocks.state.mockExistingGrant = { id: "existing_grant_id" };

    const result = await runAction({
      designId: "design_1",
      connectionId: "conn_1",
    });

    expect(mocks.state.updatedSet).toMatchObject({
      bridgeToken: "bridge_token_refreshed",
    });
    expect(mocks.state.events[mocks.state.events.length - 1]).toBe(
      "update-inside",
    );
    expect(mocks.state.insertedValues).toBeNull();
    expect(result.grantId).toBe("existing_grant_id");
  });

  it("returns only non-secret grant metadata", async () => {
    mocks.state.mockConnection = connection();

    const before = Date.now();
    const result = await runAction({
      designId: "design_1",
      connectionId: "conn_1",
    });
    const after = Date.now();

    expect(result.rootPath).toBe("/home/user/my-app");
    expect(result).not.toHaveProperty("bridgeToken");
    const grantedUntilMs = new Date(result.grantedUntil).getTime();
    const eightHoursMs = 8 * 60 * 60 * 1000;
    expect(grantedUntilMs).toBeGreaterThanOrEqual(before + eightHoursMs);
    expect(grantedUntilMs).toBeLessThanOrEqual(after + eightHoursMs);
  });
});
