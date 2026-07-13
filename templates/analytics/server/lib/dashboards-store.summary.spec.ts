import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  projection: null as Record<string, unknown> | null,
  where: null as unknown,
  rows: [] as Record<string, unknown>[],
  settings: {} as Record<string, Record<string, unknown>>,
  insert: vi.fn(),
  accessFilter: vi.fn(),
}));

function column(name: string) {
  return { name };
}

vi.mock("@agent-native/core/db", () => ({
  isPostgres: () => false,
}));

vi.mock("@agent-native/core/server", () => ({
  recordChange: () => undefined,
}));

vi.mock("@agent-native/core/settings", () => ({
  getAllSettings: async () => state.settings,
  getOrgSetting: async () => null,
  getUserSetting: async () => null,
  deleteOrgSetting: async () => false,
  deleteUserSetting: async () => false,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: state.accessFilter,
  assertAccess: vi.fn(),
  resolveAccess: vi.fn(),
  roleSatisfies: vi.fn(() => false),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  desc: (value: unknown) => ({ kind: "desc", value }),
  eq: (target: unknown, value: unknown) => ({ kind: "eq", target, value }),
  isNotNull: (target: unknown) => ({ kind: "isNotNull", target }),
  isNull: (target: unknown) => ({ kind: "isNull", target }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: [...strings],
    values,
  }),
}));

vi.mock("../db/index.js", () => {
  const dashboards = {
    id: column("id"),
    kind: column("kind"),
    title: column("title"),
    config: column("config"),
    ownerEmail: column("ownerEmail"),
    orgId: column("orgId"),
    visibility: column("visibility"),
    createdAt: column("createdAt"),
    updatedAt: column("updatedAt"),
    updatedBy: column("updatedBy"),
    archivedAt: column("archivedAt"),
    hiddenAt: column("hiddenAt"),
    hiddenBy: column("hiddenBy"),
  };
  const analyses = {
    id: column("id"),
    name: column("name"),
    description: column("description"),
    question: column("question"),
    instructions: column("instructions"),
    dataSources: column("dataSources"),
    author: column("author"),
    ownerEmail: column("ownerEmail"),
    orgId: column("orgId"),
    visibility: column("visibility"),
    createdAt: column("createdAt"),
    updatedAt: column("updatedAt"),
    hiddenAt: column("hiddenAt"),
    hiddenBy: column("hiddenBy"),
  };
  const schema = {
    dashboards,
    dashboardShares: {},
    dashboardRevisions: {},
    dashboardViews: {},
    analyses,
    analysisShares: {},
    analysisRevisions: {},
  };
  const db = {
    select: (projection: Record<string, unknown>) => {
      state.projection = projection;
      return {
        from: () => ({
          where: (where: unknown) => {
            state.where = where;
            return Promise.resolve(state.rows);
          },
        }),
      };
    },
    insert: state.insert,
  };
  return { schema, getDb: () => db };
});

const { listDashboardSummaries } = await import("./dashboards-store.js");

const ctx = { email: "alice@example.com", orgId: "org-1" };

beforeEach(() => {
  state.projection = null;
  state.where = null;
  state.rows = [];
  state.settings = {};
  state.insert.mockReset();
  state.accessFilter.mockReset();
  state.accessFilter.mockReturnValue({ kind: "access" });
});

describe("listDashboardSummaries", () => {
  it("projects metadata without the full config and maps name and parentId", async () => {
    state.rows = [
      {
        id: "child",
        kind: "sql",
        name: "Child dashboard",
        parentId: "parent",
        ownerEmail: ctx.email,
        orgId: undefined,
        visibility: "private",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        archivedAt: undefined,
        hiddenAt: undefined,
        hiddenBy: undefined,
      },
    ];

    const result = await listDashboardSummaries(ctx, { kind: "sql" });

    expect(state.projection).not.toHaveProperty("config");
    expect(state.projection?.name).toEqual({ name: "title" });
    expect(state.projection?.parentId).toMatchObject({ kind: "sql" });
    expect(result[0]).toMatchObject({
      id: "child",
      name: "Child dashboard",
      parentId: "parent",
      orgId: null,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
    });
  });

  it("surfaces scoped legacy summaries without migrating them during a list", async () => {
    state.rows = [
      {
        id: "already-sql",
        kind: "sql",
        name: "Already SQL",
        parentId: null,
        ownerEmail: ctx.email,
        orgId: null,
        visibility: "private",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        archivedAt: null,
        hiddenAt: null,
        hiddenBy: null,
      },
    ];
    state.settings = {
      "u:alice@example.com:sql-dashboard-legacy-user": {
        name: "Legacy user dashboard",
        parentId: "already-sql",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
      "o:org-1:sql-dashboard-legacy-org": {
        title: "Legacy org dashboard",
      },
      "u:alice@example.com:dashboard-explorer": {
        name: "Wrong kind",
      },
      "u:bob@example.com:sql-dashboard-private": {
        name: "Wrong user",
      },
      "u:alice@example.com:sql-dashboard-already-sql": {
        name: "Duplicate legacy row",
      },
    };

    const result = await listDashboardSummaries(ctx, { kind: "sql" });

    expect(result.map((row) => row.id)).toEqual([
      "already-sql",
      "legacy-user",
      "legacy-org",
    ]);
    expect(result[1]).toMatchObject({
      name: "Legacy user dashboard",
      parentId: "already-sql",
      visibility: "private",
    });
    expect(result[2]).toMatchObject({
      name: "Legacy org dashboard",
      orgId: "org-1",
      visibility: "org",
    });
    expect(state.insert).not.toHaveBeenCalled();
  });

  it("applies access, kind, active, and visible filters to the SQL query", async () => {
    await listDashboardSummaries(ctx, { kind: "explorer" });

    expect(state.accessFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: { name: "id" } }),
      expect.anything(),
      { userEmail: ctx.email, orgId: ctx.orgId },
    );
    expect(state.where).toMatchObject({
      kind: "and",
      conditions: [
        { kind: "access" },
        { kind: "eq", value: "explorer" },
        { kind: "isNull", target: { name: "archivedAt" } },
        { kind: "isNull", target: { name: "hiddenAt" } },
      ],
    });
  });
});
