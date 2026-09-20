import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const designSystemsTable = {
    id: "ds_id",
    title: "ds_title",
    description: "ds_description",
    data: "ds_data",
    isDefault: "ds_is_default",
    visibility: "ds_visibility",
    ownerEmail: "ds_owner_email",
    orgId: "ds_org_id",
    createdAt: "ds_created_at",
    updatedAt: "ds_updated_at",
  };
  const designSystemSharesTable = {
    principalType: "share_principal_type",
    principalId: "share_principal_id",
    resourceId: "share_resource_id",
    role: "share_role",
  };
  const state = {
    listRows: [] as Array<Record<string, unknown>>,
    shareRows: [] as Array<{ resourceId: string; role: string }>,
    defaultRows: [] as Array<{ id: string }>,
    userEmail: "alice@example.com" as string | null,
    orgId: null as string | null,
  };
  // Both the main list query and resolveDefaultDesignSystemId's query select
  // from the same designSystems table, distinguished only by which method
  // they chain after `.where(...)` — orderBy for the list, limit for the
  // single-row default lookup — so this stub exposes both.
  const orderByFn = vi.fn(async () => state.listRows);
  const defaultLimitFn = vi.fn(async () => state.defaultRows);
  const whereDesignSystemsFn = vi.fn(() => ({
    orderBy: orderByFn,
    limit: defaultLimitFn,
  }));
  const whereSharesFn = vi.fn(async () => state.shareRows);
  const fromFn = vi.fn((table: unknown) =>
    table === designSystemSharesTable
      ? { where: () => whereSharesFn() }
      : { where: () => whereDesignSystemsFn() },
  );
  const selectFn = vi.fn(() => ({ from: fromFn }));
  return {
    state,
    designSystemsTable,
    designSystemSharesTable,
    mockDb: { select: selectFn },
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
  getRequestOrgId: () => mocks.state.orgId,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ __accessFilter: true }),
  ROLE_RANK: { viewer: 1, commenter: 2, editor: 3, admin: 4, owner: 5 },
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    inArray: [column, values],
  }),
  isNull: (column: unknown) => ({ isNull: column }),
  or: (...values: unknown[]) => ({ or: values }),
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

import action from "./list-design-systems";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.userEmail = "alice@example.com";
  mocks.state.orgId = null;
  mocks.state.shareRows = [];
  mocks.state.defaultRows = [];
  mocks.state.listRows = [];
});

describe("list-design-systems — effective isDefault", () => {
  it("marks only the caller's effective default, not a shared row default owned by someone else", async () => {
    mocks.state.listRows = [
      {
        id: "ds-mine",
        title: "Mine",
        description: null,
        data: "{}",
        isDefault: true,
        visibility: "private",
        ownerEmail: "alice@example.com",
        orgId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "ds-shared",
        title: "Shared",
        description: null,
        data: "{}",
        isDefault: true,
        visibility: "public",
        ownerEmail: "bob@example.com",
        orgId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
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
        ownerEmail: "alice@example.com",
        orgId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mocks.state.defaultRows = [{ id: "ds-mine" }];

    const result = await action.run({ compact: "true" });

    expect(result.designSystems[0]).toMatchObject({
      id: "ds-mine",
      isDefault: true,
    });
  });
});
