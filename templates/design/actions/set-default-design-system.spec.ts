import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  failNextDefaultSet: 0,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "designer@example.com",
  getRequestOrgId: () => "org_example",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    and: (...values: unknown[]) => ({ and: values }),
    asc: (value: unknown) => ({ asc: value }),
    eq: (...values: unknown[]) => ({ eq: values }),
    isNull: (value: unknown) => ({ isNull: value }),
    ne: (...values: unknown[]) => ({ ne: values }),
  };
});

function makeMockTx(): {
  update: () => unknown;
  transaction: (
    callback: (tx: unknown) => Promise<unknown>,
  ) => Promise<unknown>;
} {
  return {
    update: () => ({
      set: (fields: Record<string, unknown>) => ({
        where: () => {
          if (testState.failNextDefaultSet > 0 && fields.isDefault === true) {
            testState.failNextDefaultSet -= 1;
            const err = new Error(
              'duplicate key value violates unique constraint "design_systems_one_default_per_scope_idx"',
            );
            (err as { code?: string }).code = "23505";
            return Promise.reject(err);
          }
          testState.updates.push(fields);
          return Promise.resolve();
        },
      }),
    }),
    // Nested tx.transaction() is a real Drizzle savepoint feature (see
    // design-system-defaults.ts): a failure inside it rolls back only the
    // writes made since it opened. Model that by checkpointing the shared
    // sink and truncating back to it on failure, so the retry test's failed
    // first attempt doesn't leave its clear() behind.
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const checkpoint = testState.updates.length;
      try {
        return await callback(makeMockTx());
      } catch (err) {
        testState.updates.length = checkpoint;
        throw err;
      }
    },
  };
}

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { ownerEmail: "designer@example.com", orgId: "org_example" },
            ]),
        }),
      }),
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(makeMockTx()),
  }),
  schema: {
    designSystems: {
      id: "designSystems.id",
      isDefault: "designSystems.isDefault",
      createdAt: "designSystems.createdAt",
      ownerEmail: "designSystems.ownerEmail",
      orgId: "designSystems.orgId",
    },
  },
}));

import action from "./set-default-design-system.js";

beforeEach(() => {
  testState.updates = [];
  testState.failNextDefaultSet = 0;
});

describe("set-default-design-system", () => {
  it("can unset the current default", async () => {
    await action.run({ id: "design-system-1", isDefault: false });

    expect(testState.updates).toHaveLength(1);
    expect(testState.updates[0]).toMatchObject({ isDefault: false });
  });

  it("clears the scoped default before setting another system", async () => {
    await action.run({ id: "design-system-2", isDefault: true });

    expect(testState.updates).toHaveLength(2);
    expect(testState.updates[0]).toMatchObject({ isDefault: false });
    expect(testState.updates[1]).toMatchObject({ isDefault: true });
  });

  it("retries the clear-then-set pair when a concurrent claim wins the first attempt", async () => {
    // The first attempt's set collides with a concurrent claim that committed
    // between this call's clear and its set — the exact race a plain
    // clear-then-update pair (no lock, no index) cannot see on its own.
    testState.failNextDefaultSet = 1;

    await action.run({ id: "design-system-2", isDefault: true });

    // First attempt: clear (no-op state) then a set that fails and rolls
    // back the whole savepoint, so neither write is recorded. Second
    // attempt: clear then a successful set — exactly one committed pair.
    expect(testState.updates).toHaveLength(2);
    expect(testState.updates[0]).toMatchObject({ isDefault: false });
    expect(testState.updates[1]).toMatchObject({ isDefault: true });
  });
});
