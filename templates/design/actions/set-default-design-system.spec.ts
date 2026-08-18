import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
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
    eq: (...values: unknown[]) => ({ eq: values }),
    isNull: (value: unknown) => ({ isNull: value }),
  };
});

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
    transaction: async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        update: () => ({
          set: (fields: Record<string, unknown>) => {
            testState.updates.push(fields);
            return { where: () => Promise.resolve() };
          },
        }),
      }),
  }),
  schema: {
    designSystems: {
      id: "designSystems.id",
      ownerEmail: "designSystems.ownerEmail",
      orgId: "designSystems.orgId",
    },
  },
}));

import action from "./set-default-design-system.js";

beforeEach(() => {
  testState.updates = [];
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
});
