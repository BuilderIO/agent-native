import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  projection: null as Record<string, unknown> | null,
  where: null as unknown,
  rows: [] as Record<string, unknown>[],
  orgSettings: {} as Record<string, Record<string, unknown>>,
  userSettings: {} as Record<string, Record<string, unknown>>,
  getAllSettings: vi.fn(async () => {
    throw new Error("catalog helper must not scan all settings");
  }),
  getOrgSetting: vi.fn(async (_orgId: string, key: string) => {
    return state.orgSettings[key] ?? null;
  }),
  getUserSetting: vi.fn(async (_email: string, key: string) => {
    return state.userSettings[key] ?? null;
  }),
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
  getAllSettings: state.getAllSettings,
  getOrgSetting: state.getOrgSetting,
  getUserSetting: state.getUserSetting,
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
  inArray: (target: unknown, values: unknown[]) => ({
    kind: "inArray",
    target,
    values,
  }),
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

const { loadDashboardCatalogDashboards } =
  await import("./dashboards-store.js");

const ctx = { email: "alice@example.com", orgId: "org-1" };

beforeEach(() => {
  state.projection = null;
  state.where = null;
  state.rows = [];
  state.orgSettings = {};
  state.userSettings = {};
  state.getAllSettings.mockClear();
  state.getOrgSetting.mockClear();
  state.getUserSetting.mockClear();
  state.insert.mockReset();
  state.accessFilter.mockReset();
  state.accessFilter.mockReturnValue({ kind: "access" });
});

describe("loadDashboardCatalogDashboards", () => {
  it("hydrates only explicit ids and keeps the settings scan bounded", async () => {
    state.rows = [
      {
        id: "saved",
        kind: "sql",
        title: "Saved dashboard",
        description: "Saved dashboard description",
        config: JSON.stringify({
          name: "Saved dashboard",
          description: "Saved dashboard description",
          panels: [],
        }),
      },
    ];
    state.orgSettings["sql-dashboard-legacy-org"] = {
      title: "Legacy org dashboard",
      description: "Org catalog description",
      panels: [],
    };
    state.userSettings["sql-dashboard-legacy-user"] = {
      name: "Legacy user dashboard",
      description: "User catalog description",
      panels: [],
    };

    const result = await loadDashboardCatalogDashboards(ctx, [
      "saved",
      "legacy-user",
      "legacy-org",
      "missing",
    ]);

    expect(state.projection).not.toHaveProperty("ownerEmail");
    expect(state.projection).not.toHaveProperty("orgId");
    expect(state.projection).not.toHaveProperty("visibility");
    expect(state.projection).toHaveProperty("id");
    expect(state.projection).toHaveProperty("title");
    expect(state.projection).toHaveProperty("description");
    expect(state.projection).toHaveProperty("config");
    expect(state.getAllSettings).not.toHaveBeenCalled();
    expect(state.getOrgSetting.mock.calls.map((call) => call[1])).toContain(
      "sql-dashboard-legacy-org",
    );
    expect(state.getUserSetting.mock.calls.map((call) => call[1])).toContain(
      "sql-dashboard-legacy-user",
    );
    expect(result).toEqual([
      {
        id: "saved",
        kind: "sql",
        title: "Saved dashboard",
        description: "Saved dashboard description",
        config: {
          name: "Saved dashboard",
          description: "Saved dashboard description",
          panels: [],
        },
      },
      {
        id: "legacy-user",
        kind: "sql",
        title: "Legacy user dashboard",
        description: "User catalog description",
        config: {
          name: "Legacy user dashboard",
          description: "User catalog description",
          panels: [],
        },
      },
      {
        id: "legacy-org",
        kind: "sql",
        title: "Legacy org dashboard",
        description: "Org catalog description",
        config: {
          title: "Legacy org dashboard",
          description: "Org catalog description",
          panels: [],
        },
      },
    ]);
  });
});
