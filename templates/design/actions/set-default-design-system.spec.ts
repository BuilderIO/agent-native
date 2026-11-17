import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  userEmail: "designer@example.com" as string | undefined,
  target: { ownerEmail: "designer@example.com", orgId: "org_example" } as
    | { ownerEmail: string; orgId: string | null }
    | undefined,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => testState.userEmail,
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
            Promise.resolve(testState.target ? [testState.target] : []),
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

async function rejectionFrom(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected run to reject");
}

beforeEach(() => {
  testState.updates = [];
  testState.userEmail = "designer@example.com";
  testState.target = {
    ownerEmail: "designer@example.com",
    orgId: "org_example",
  };
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

  it("refuses a caller with no signed-in user as a typed 401 and writes nothing", async () => {
    testState.userEmail = undefined;

    const error = await rejectionFrom(() =>
      action.run({ id: "design-system-1", isDefault: true }),
    );

    expect(error).toMatchObject({
      errorCode: "unauthenticated",
      statusCode: 401,
      message: "Sign in to change the default design system.",
    });
    expect(testState.updates).toHaveLength(0);
  });

  it("refuses a design system that no longer exists as a typed 404 and writes nothing", async () => {
    testState.target = undefined;

    const error = await rejectionFrom(() =>
      action.run({ id: "design-system-gone", isDefault: true }),
    );

    expect(error).toMatchObject({
      errorCode: "design_system_not_found",
      statusCode: 404,
      message: "Design system not found.",
    });
    expect(testState.updates).toHaveLength(0);
  });

  it("refuses a design system owned by someone else as a typed 403 and writes nothing", async () => {
    testState.target = {
      ownerEmail: "someone@example.com",
      orgId: "org_example",
    };

    const error = await rejectionFrom(() =>
      action.run({ id: "design-system-1", isDefault: true }),
    );

    expect(error).toMatchObject({
      errorCode: "design_system_not_owner",
      statusCode: 403,
      message: "Only the owner can set a design system as default",
    });
    expect(testState.updates).toHaveLength(0);
  });

  it("refuses a design system from another organization as a typed 403", async () => {
    testState.target = { ownerEmail: "designer@example.com", orgId: null };

    const error = await rejectionFrom(() =>
      action.run({ id: "design-system-1", isDefault: true }),
    );

    expect(error).toMatchObject({
      errorCode: "design_system_not_owner",
      statusCode: 403,
    });
    expect(testState.updates).toHaveLength(0);
  });
});
