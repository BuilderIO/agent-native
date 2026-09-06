import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const designSystemsTable = {
    id: "ds_id",
    title: "ds_title",
    ownerEmail: "ds_owner_email",
    orgId: "ds_org_id",
    isDefault: "ds_is_default",
    updatedAt: "ds_updated_at",
  };
  const designSystemSharesTable = { resourceId: "share_resource_id" };
  const state = {
    listRows: [] as Array<Record<string, unknown>>,
    defaultRows: [] as Array<{ id: string }>,
    userEmail: "alice@example.com" as string | null,
    resolvedAccess: new Map<string, { role: string } | null>(),
  };

  // The main list query chains `.orderBy(...)` after `.where(...)`;
  // resolveDefaultDesignSystemId chains `.limit(1)`. Both target the same
  // designSystems table, so the stub exposes both and each call site only
  // ever exercises the one it actually chains.
  const orderByFn = vi.fn(async () => state.listRows);
  const defaultLimitFn = vi.fn(async () => state.defaultRows);
  const whereFn = vi.fn(() => ({ orderBy: orderByFn, limit: defaultLimitFn }));
  const fromFn = vi.fn(() => ({ where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  const mockDb = { select: selectFn };

  const resolveAccess = vi.fn(async (_kind: string, id: string) =>
    state.resolvedAccess.get(id) === undefined
      ? { role: "viewer" }
      : state.resolvedAccess.get(id),
  );

  return {
    state,
    designSystemsTable,
    designSystemSharesTable,
    mockDb,
    resolveAccess,
  };
});

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.mockDb,
  schema: {
    designSystems: mocks.designSystemsTable,
    designSystemShares: mocks.designSystemSharesTable,
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.state.userEmail,
  getRequestOrgId: () => null,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ __accessFilter: true }),
  resolveAccess: (...args: [string, string]) => mocks.resolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ isNull: column }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

import action from "./list-design-systems";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.userEmail = "alice@example.com";
  mocks.state.listRows = [];
  mocks.state.defaultRows = [];
  mocks.state.resolvedAccess = new Map();
});

describe("list-design-systems — effective isDefault", () => {
  it("marks only the caller's effective default, not a shared row default owned by someone else", async () => {
    mocks.state.listRows = [
      {
        id: "ds-mine",
        title: "Mine",
        description: null,
        data: "{}",
        assets: null,
        customInstructions: "",
        isDefault: true,
        visibility: "private",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "ds-shared",
        title: "Shared",
        description: null,
        data: "{}",
        assets: null,
        customInstructions: "",
        isDefault: true,
        visibility: "public",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mocks.state.resolvedAccess.set("ds-mine", { role: "owner" });
    mocks.state.resolvedAccess.set("ds-shared", { role: "viewer" });
    // resolveDefaultDesignSystemId resolves to the caller's own isDefault row.
    mocks.state.defaultRows = [{ id: "ds-mine" }];

    const result = await action.run({});

    const byId = new Map(
      result.designSystems.map((ds) => [ds.id, ds.isDefault]),
    );
    expect(byId.get("ds-mine")).toBe(true);
    expect(byId.get("ds-shared")).toBe(false);
  });

  it("reports the same effective default in compact output", async () => {
    mocks.state.listRows = [
      {
        id: "ds-mine",
        title: "Mine",
        isDefault: true,
        visibility: "private",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mocks.state.resolvedAccess.set("ds-mine", { role: "owner" });
    mocks.state.defaultRows = [{ id: "ds-mine" }];

    const result = await action.run({ compact: "true" });

    expect(result.designSystems[0]).toMatchObject({
      id: "ds-mine",
      isDefault: true,
    });
  });
});
