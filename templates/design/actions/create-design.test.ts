import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const designSystemsTable = {
    id: "ds_id",
    title: "ds_title",
    ownerEmail: "ds_owner_email",
    orgId: "ds_org_id",
    isDefault: "ds_is_default",
  };
  const designSystemSharesTable = { resourceId: "share_resource_id" };
  const designsTable = { id: "design_id" };
  const state = {
    defaultRows: [] as Array<{ id: string }>,
    titleRows: [] as Array<{ id: string }>,
    userEmail: "owner@example.com" as string | null,
    orgId: null as string | null,
    insertedRow: undefined as Record<string, unknown> | undefined,
  };

  const defaultLimitFn = vi.fn(async () => state.defaultRows);
  const titleWhereFn = vi.fn(async () => state.titleRows);
  // resolveDefaultDesignSystemId chains `.limit(1)` after `.where(...)`;
  // resolveDesignSystemIdByTitle awaits `.where(...)` directly. Both query
  // the same designSystems table, so the stub exposes both shapes and each
  // call site only ever exercises the one it actually chains.
  const whereDesignSystemsFn = vi.fn(() => ({ limit: defaultLimitFn }));
  const fromFn = vi.fn((table: unknown) => ({
    where: (condition: unknown) => {
      const clauses = (condition as { and?: unknown[] } | undefined)?.and;
      const isTitleQuery =
        table === designSystemsTable &&
        Array.isArray(clauses) &&
        (clauses[0] as { __accessFilter?: boolean } | undefined)
          ?.__accessFilter === true;
      return isTitleQuery ? titleWhereFn() : whereDesignSystemsFn();
    },
  }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  const valuesFn = vi.fn(async (row: Record<string, unknown>) => {
    state.insertedRow = row;
  });
  const insertFn = vi.fn(() => ({ values: valuesFn }));
  const mockDb = { select: selectFn, insert: insertFn };

  const assertAccess = vi.fn();
  const getDesignSystemRun = vi.fn(async ({ id }: { id: string }) => ({
    id,
    title: "Acme",
    agentContext: "Use --brand-accent: #123456.",
  }));

  return {
    state,
    designSystemsTable,
    designSystemSharesTable,
    designsTable,
    mockDb,
    assertAccess,
    getDesignSystemRun,
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.mockDb,
  schema: {
    designs: mocks.designsTable,
    designSystems: mocks.designSystemsTable,
    designSystemShares: mocks.designSystemSharesTable,
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.state.userEmail,
  getRequestOrgId: () => mocks.state.orgId,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  accessFilter: () => ({ __accessFilter: true }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ isNull: column }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("./get-design-system.js", () => ({
  default: {
    run: (...args: [{ id: string }]) => mocks.getDesignSystemRun(...args),
  },
}));

import action from "./create-design";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.defaultRows = [];
  mocks.state.titleRows = [];
  mocks.state.userEmail = "owner@example.com";
  mocks.state.orgId = null;
  mocks.state.insertedRow = undefined;
});

describe("create-design — designSystemId defaults", () => {
  it("links the caller's own default design system, not another user's default row", async () => {
    mocks.state.defaultRows = [{ id: "ds-mine" }];

    const result = await action.run({ title: "T" });

    expect(mocks.state.insertedRow?.designSystemId).toBe("ds-mine");
    expect(result.designSystemId).toBe("ds-mine");
  });

  it("links nothing when the caller has no default", async () => {
    mocks.state.defaultRows = [];

    const result = await action.run({ title: "T" });

    expect(mocks.state.insertedRow?.designSystemId).toBeNull();
    expect(result.designSystemId).toBeNull();
    expect(result.designSystem).toBeNull();
  });

  it("still asserts viewer access when an explicit designSystemId is given", async () => {
    mocks.state.defaultRows = [{ id: "ds-default" }];

    const result = await action.run({
      title: "T",
      designSystemId: "ds-explicit",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design-system",
      "ds-explicit",
      "viewer",
    );
    expect(mocks.state.insertedRow?.designSystemId).toBe("ds-explicit");
    expect(result.designSystemId).toBe("ds-explicit");
    expect(result.designSystem).toMatchObject({
      status: "available",
      id: "ds-explicit",
      agentContext: "Use --brand-accent: #123456.",
    });
    expect(mocks.getDesignSystemRun).toHaveBeenCalledWith(
      expect.objectContaining({ compact: "false" }),
    );
  });

  it("resolves designSystem by exact title when no id is given", async () => {
    mocks.state.titleRows = [{ id: "ds-acme" }];
    mocks.state.defaultRows = [{ id: "ds-default" }];

    const result = await action.run({ title: "T", designSystem: "acme" });

    expect(result.designSystemId).toBe("ds-acme");
  });

  it("fails with design_system_not_found for an unknown designSystem title", async () => {
    mocks.state.titleRows = [];

    await expect(
      action.run({ title: "T", designSystem: "Nonexistent" }),
    ).rejects.toMatchObject({
      errorCode: "design_system_not_found",
      statusCode: 404,
    });
    expect(mocks.state.insertedRow).toBeUndefined();
  });

  it("fails with design_system_ambiguous when two rows share a title", async () => {
    mocks.state.titleRows = [{ id: "ds-a" }, { id: "ds-b" }];

    await expect(
      action.run({ title: "T", designSystem: "Acme" }),
    ).rejects.toMatchObject({
      errorCode: "design_system_ambiguous",
      statusCode: 409,
    });
    expect(mocks.state.insertedRow).toBeUndefined();
  });
});
