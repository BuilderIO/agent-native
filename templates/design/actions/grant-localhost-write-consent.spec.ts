
import { beforeEach, describe, expect, it, vi } from "vitest";


vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestAuthCapability: () => undefined,
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));

vi.mock("nanoid", () => ({ nanoid: () => "fixed_grant_id" }));


type ConnectionRow = {
  id: string;
  ownerEmail: string;
  rootPath: string | null;
  bridgeToken: string | null;
};

type GrantRow = { id: string };

let mockConnection: ConnectionRow | null = null;
let mockExistingGrant: GrantRow | null = null;
let insertedValues: Record<string, unknown> | null = null;
let updatedSet: Record<string, unknown> | null = null;

function makeSelectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: (projection?: unknown) => {
      if (projection !== undefined) {
        const rows = mockExistingGrant ? [mockExistingGrant] : [];
        return makeSelectChain(rows);
      }
      const rows = mockConnection ? [mockConnection] : [];
      return makeSelectChain(rows);
    },
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertedValues = vals;
        return Promise.resolve();
      },
    }),
    update: (_table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        updatedSet = vals;
        return {
          where: () => Promise.resolve(),
        };
      },
    }),
  }),
  schema: {
    designLocalhostConnections: { orgId: "connectionOrgId" },
    designLocalhostWriteGrants: { orgId: "grantOrgId" },
  },
}));

import action from "./grant-localhost-write-consent.js";

beforeEach(() => {
  mockConnection = null;
  mockExistingGrant = null;
  insertedValues = null;
  updatedSet = null;
});


describe("grant-localhost-write-consent", () => {
  it("is available to the capability-scoped visual-edit editor", () => {
    expect(action.capabilityScopes).toEqual(["visual-edit"]);
    expect(action.agentTool).toBe(false);
  });

  it("persists the connection bridgeToken without returning it to the browser", async () => {
    mockConnection = {
      id: "conn_1",
      ownerEmail: "user@example.com",
      rootPath: "/home/user/my-app",
      bridgeToken: "bridge_real_token_xyz",
    };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
    });

    expect(result).not.toHaveProperty("bridgeToken");
    expect(insertedValues?.bridgeToken).toBe("bridge_real_token_xyz");
  });

  it("throws a clear error when connection has no bridgeToken, with re-run instruction", async () => {
    mockConnection = {
      id: "conn_1",
      ownerEmail: "user@example.com",
      rootPath: "/home/user/my-app",
      bridgeToken: null,
    };

    await expect(
      action.run({ designId: "design_1", connectionId: "conn_1" }),
    ).rejects.toThrow(/no bridge token/);

    await expect(
      action.run({ designId: "design_1", connectionId: "conn_1" }),
    ).rejects.toThrow(/design connect/);
  });

  it("throws when connection row is not found", async () => {
    mockConnection = null;

    await expect(
      action.run({ designId: "design_1", connectionId: "conn_missing" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws when connection has no rootPath", async () => {
    mockConnection = {
      id: "conn_1",
      ownerEmail: "user@example.com",
      rootPath: null,
      bridgeToken: "bridge_real_token_xyz",
    };

    await expect(
      action.run({ designId: "design_1", connectionId: "conn_1" }),
    ).rejects.toThrow(/rootPath/);
  });

  it("inserts a new grant when none exists", async () => {
    mockConnection = {
      id: "conn_1",
      ownerEmail: "user@example.com",
      rootPath: "/home/user/my-app",
      bridgeToken: "bridge_token_abc",
    };
    mockExistingGrant = null;

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
    });

    expect(insertedValues).not.toBeNull();
    expect(insertedValues?.id).toBe("fixed_grant_id");
    expect(insertedValues?.designId).toBe("design_1");
    expect(insertedValues?.connectionId).toBe("conn_1");
    expect(insertedValues?.rootPath).toBe("/home/user/my-app");
    expect(insertedValues?.bridgeToken).toBe("bridge_token_abc");
    expect(result.grantId).toBe("fixed_grant_id");
    expect(updatedSet).toBeNull();
  });

  it("updates an existing grant when one already exists", async () => {
    mockConnection = {
      id: "conn_1",
      ownerEmail: "user@example.com",
      rootPath: "/home/user/my-app",
      bridgeToken: "bridge_token_refreshed",
    };
    mockExistingGrant = { id: "existing_grant_id" };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
    });

    expect(updatedSet).not.toBeNull();
    expect(updatedSet?.bridgeToken).toBe("bridge_token_refreshed");
    expect(insertedValues).toBeNull();
    expect(result.grantId).toBe("existing_grant_id");
  });

  it("returns only non-secret grant metadata", async () => {
    mockConnection = {
      id: "conn_1",
      ownerEmail: "user@example.com",
      rootPath: "/home/user/my-app",
      bridgeToken: "bridge_tok",
    };

    const before = Date.now();
    const result = await action.run({
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
