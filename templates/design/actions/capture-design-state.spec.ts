import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    inMutation: false,
    events: [] as string[],
    insertedValues: null as Record<string, unknown> | null,
    table: undefined as unknown,
  };
  const query = {
    from: vi.fn((table: unknown) => {
      state.table = table;
      return query;
    }),
    where: vi.fn(() => query),
    limit: vi.fn(async () => {
      state.events.push("read-design");
      return [{ data: "{}" }];
    }),
  };
  const insertQuery = {
    values: vi.fn(async (values: Record<string, unknown>) => {
      state.insertedValues = values;
      state.events.push("insert");
    }),
  };
  const tx = { insert: vi.fn(() => insertQuery) };
  type Transaction = typeof tx;
  const assertAccess = vi.fn(async () => {
    state.events.push(state.inMutation ? "access-inside" : "access-outside");
    return { role: "editor", resource: {} };
  });
  const withDesignSourceMutationTransaction = vi.fn(
    async (
      _designId: string,
      callback: (transaction: Transaction) => Promise<unknown>,
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

  return {
    assertAccess,
    insertQuery,
    query,
    state,
    tx,
    withDesignSourceMutationTransaction,
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
  getRequestOrgId: () => "org_1",
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("nanoid", () => ({ nanoid: () => "test_id_123" }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: vi.fn(() => mocks.query) }),
  schema: {
    designState: { id: "designState.id" },
    designs: { data: "designs.data", id: "designs.id" },
  },
}));

vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction:
    mocks.withDesignSourceMutationTransaction,
}));

import action from "./capture-design-state.js";

describe("capture-design-state mutation ordering", () => {
  beforeEach(() => {
    mocks.state.inMutation = false;
    mocks.state.events.length = 0;
    mocks.state.insertedValues = null;
    mocks.state.table = undefined;
    mocks.assertAccess.mockClear();
    mocks.query.from.mockClear();
    mocks.query.where.mockClear();
    mocks.query.limit.mockClear();
    mocks.insertQuery.values.mockClear();
    mocks.tx.insert.mockClear();
    mocks.withDesignSourceMutationTransaction.mockClear();
  });

  it("rechecks editor access inside the source mutation lock before insertion", async () => {
    await action.run({
      designId: "design_1",
      name: "Captured state",
      breakpoint: "auto",
      captureData: { route: "/checkout" },
    });

    expect(mocks.withDesignSourceMutationTransaction).toHaveBeenCalledWith(
      "design_1",
      expect.any(Function),
    );
    expect(mocks.state.events).toEqual([
      "access-outside",
      "read-design",
      "lock",
      "access-inside",
      "insert",
    ]);
    expect(mocks.state.insertedValues).toMatchObject({
      id: "test_id_123",
      designId: "design_1",
      kind: "capture",
      ownerEmail: "user@example.com",
      orgId: "org_1",
    });
  });
});
