/**
 * Tests for revoke-localhost-write-consent action.
 *
 * VE5 regression: `revoked` must be derived from the scoped grant's existence
 * (select-then-delete), NOT from the driver-specific `rowsAffected` field of
 * the delete result — several drivers do not report it, which made the action
 * return `revoked: false` even though the grant was deleted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));

type GrantRow = { id: string };

let mockGrant: GrantRow | null = null;
let deleteCalls = 0;

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockGrant ? [mockGrant] : []),
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        deleteCalls += 1;
        // Deliberately resolve to a result WITHOUT rowsAffected, mimicking
        // drivers that do not report affected rows.
        return Promise.resolve({});
      },
    }),
  }),
  schema: {
    designLocalhostWriteGrants: {
      id: "id",
      designId: "designId",
      connectionId: "connectionId",
      ownerEmail: "ownerEmail",
      orgId: "orgId",
    },
  },
}));

import action from "./revoke-localhost-write-consent.js";

beforeEach(() => {
  mockGrant = null;
  deleteCalls = 0;
});

describe("revoke-localhost-write-consent", () => {
  it("returns revoked=true when a scoped grant exists, even without rowsAffected (VE5 regression)", async () => {
    mockGrant = { id: "grant_1" };

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
    });

    expect(result.revoked).toBe(true);
    expect(deleteCalls).toBe(1);
  });

  it("returns revoked=false when no grant exists for the design + connection", async () => {
    mockGrant = null;

    const result = await action.run({
      designId: "design_1",
      connectionId: "conn_1",
    });

    expect(result.revoked).toBe(false);
  });

  it("echoes designId and connectionId in the response", async () => {
    mockGrant = { id: "grant_1" };

    const result = await action.run({
      designId: "design_9",
      connectionId: "conn_9",
    });

    expect(result.designId).toBe("design_9");
    expect(result.connectionId).toBe("conn_9");
  });
});
