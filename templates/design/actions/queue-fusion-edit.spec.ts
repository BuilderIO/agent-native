import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    events: [] as string[],
    inMutation: false,
    rejectInside: false,
    insertedValues: null as Record<string, unknown> | null,
  };
  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.events.push(state.inMutation ? "insert" : "insert-outside");
        state.insertedValues = values;
        return Promise.resolve();
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
      callback: (transaction: typeof tx) => Promise<unknown>,
    ) => {
      state.events.push("lock");
      state.inMutation = true;
      try {
        return await callback(tx);
      } finally {
        state.inMutation = false;
      }
    },
  );
  const isFullAppBuildingEnabled = vi.fn(async () => {
    state.events.push("feature-check");
    return true;
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ value: 1 }]),
      }),
    }),
  };

  return {
    assertAccess,
    db,
    isFullAppBuildingEnabled,
    state,
    withDesignSourceMutationTransaction,
  };
});

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org_1",
  getRequestUserEmail: () => "user@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  count: () => "count",
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("nanoid", () => ({ nanoid: () => "fusion-edit-1" }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    designFusionEdits: {
      id: "id",
      designId: "designId",
      ownerEmail: "ownerEmail",
      status: "status",
      createdAt: "createdAt",
    },
  },
}));

vi.mock("../server/lib/full-app-lab.js", () => ({
  isFullAppBuildingEnabled: mocks.isFullAppBuildingEnabled,
}));

vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
}));

import action from "./queue-fusion-edit.js";

beforeEach(() => {
  mocks.state.events.length = 0;
  mocks.state.inMutation = false;
  mocks.state.rejectInside = false;
  mocks.state.insertedValues = null;
  mocks.assertAccess.mockClear();
  mocks.isFullAppBuildingEnabled.mockClear();
  mocks.isFullAppBuildingEnabled.mockResolvedValue(true);
  mocks.withDesignSourceMutationTransaction.mockClear();
});

describe("queue-fusion-edit", () => {
  it("inserts the pending edit under the source lock after rechecking access", async () => {
    const result = await action.run(
      {
        designId: "design_1",
        instruction: "Make the header sticky",
        target: { selector: "header" },
      } as never,
      { userEmail: "user@example.com", orgId: "org_1" } as never,
    );

    expect(result).toEqual({ editId: "fusion-edit-1", pendingCount: 1 });
    expect(mocks.state.insertedValues).toMatchObject({
      id: "fusion-edit-1",
      designId: "design_1",
      status: "pending",
      target: JSON.stringify({ selector: "header" }),
    });
    expect(mocks.state.events).toEqual([
      "access-outside",
      "lock",
      "access-inside",
      "insert",
    ]);
    expect(
      mocks.isFullAppBuildingEnabled.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.withDesignSourceMutationTransaction.mock.invocationCallOrder[0]!,
    );
  });

  it("does not insert when editor access fails inside the lock", async () => {
    mocks.state.rejectInside = true;

    await expect(
      action.run(
        {
          designId: "design_1",
          instruction: "Make the header sticky",
        } as never,
        { userEmail: "user@example.com", orgId: "org_1" } as never,
      ),
    ).rejects.toThrow("editor access revoked");

    expect(mocks.state.events).toEqual([
      "access-outside",
      "lock",
      "access-inside",
    ]);
    expect(mocks.state.insertedValues).toBeNull();
  });

  it("does not acquire the mutation lock when full app building is disabled", async () => {
    mocks.isFullAppBuildingEnabled.mockResolvedValueOnce(false);

    await expect(
      action.run(
        {
          designId: "design_1",
          instruction: "Make the header sticky",
        } as never,
        { userEmail: "user@example.com", orgId: "org_1" } as never,
      ),
    ).rejects.toThrow("Full app building is not enabled");

    expect(mocks.state.events).toEqual([]);
    expect(mocks.isFullAppBuildingEnabled).toHaveBeenCalledOnce();
    expect(mocks.withDesignSourceMutationTransaction).not.toHaveBeenCalled();
  });
});
