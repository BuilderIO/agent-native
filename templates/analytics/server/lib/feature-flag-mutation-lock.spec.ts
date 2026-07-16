import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values,
  eq: (left: unknown, right: unknown) => [left, right],
  lte: (left: unknown, right: unknown) => [left, right],
}));

const { insertValues, deleteWhere, getDb } = vi.hoisted(() => {
  const insertValues = vi.fn();
  const deleteWhere = vi.fn(async () => undefined);
  const getDb = vi.fn(() => ({
    delete: () => ({ where: deleteWhere }),
    insert: () => ({ values: insertValues }),
  }));
  return { insertValues, deleteWhere, getDb };
});

vi.mock("../db/index.js", () => ({
  getDb,
  schema: {
    featureFlagMutationLocks: {
      lockKey: "lockKey",
      lockToken: "lockToken",
      createdAt: "createdAt",
    },
  },
}));

import { withFeatureFlagMutationLock } from "./feature-flag-mutation-lock.js";

const admin = {
  userEmail: "admin@example.com",
  orgId: "org-1",
  role: "admin" as const,
};
const target = {
  appId: "content",
  flagKey: "new-editor",
  operationId: "operation-1",
};

describe("feature flag mutation lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues.mockResolvedValue(undefined);
  });

  it("rejects a concurrent operation for the same durable lock key", async () => {
    let releaseFirst!: () => void;
    const firstOperation = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    insertValues
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("unique constraint"));

    const first = withFeatureFlagMutationLock(admin, target, async () => {
      await firstOperation;
      return "first";
    });
    await vi.waitFor(() => expect(insertValues).toHaveBeenCalledTimes(1));
    await expect(
      withFeatureFlagMutationLock(
        admin,
        { ...target, operationId: "operation-2" },
        async () => "second",
      ),
    ).rejects.toThrow("Another feature flag operation");
    releaseFirst();
    await expect(first).resolves.toBe("first");
  });

  it("releases the lock after a failed operation", async () => {
    await expect(
      withFeatureFlagMutationLock(admin, target, async () => {
        throw new Error("target failed");
      }),
    ).rejects.toThrow("target failed");
    expect(deleteWhere).toHaveBeenCalledTimes(2);
  });
});
