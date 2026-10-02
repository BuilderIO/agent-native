import { beforeEach, describe, expect, it, vi } from "vitest";

type ViewRow = {
  id: string;
  dashboardId: string;
  name: string;
  filters: string;
  createdBy: string | null;
  createdAt: string;
};

const state = vi.hoisted(() => ({
  accessCalls: [] as unknown[][],
  accessQueue: [] as unknown[],
  accessResult: null as unknown,
  analysisRow: null as Record<string, unknown> | null,
  dashboardRow: null as Record<string, unknown> | null,
  legacyAnalysis: null as Record<string, unknown> | null,
  legacyDashboard: null as Record<string, unknown> | null,
  orgLegacyAnalysis: null as Record<string, unknown> | null,
  orgLegacyDashboard: null as Record<string, unknown> | null,
  views: [] as ViewRow[],
}));

function column(name: string) {
  return { name };
}

function columnName(value: unknown): string | null {
  return value && typeof value === "object" && "name" in value
    ? String((value as { name: unknown }).name)
    : null;
}

function matches(predicate: unknown, row: Record<string, unknown>): boolean {
  if (!predicate || typeof predicate !== "object") return true;
  const condition = predicate as {
    kind?: string;
    column?: unknown;
    value?: unknown;
    conditions?: unknown[];
  };
  if (condition.kind === "and") {
    return (condition.conditions ?? []).every((item) => matches(item, row));
  }
  if (condition.kind === "eq") {
    const name = columnName(condition.column);
    return name ? row[name] === condition.value : true;
  }
  return true;
}

function rowsResult(rows: unknown[]) {
  const copies = rows.map((row) => ({ ...(row as Record<string, unknown>) }));
  const result = Promise.resolve(copies);
  (result as Promise<unknown[]> & { limit?: () => Promise<unknown[]> }).limit =
    async () => copies.slice(0, 1);
  return result;
}

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
const dashboardViews = {
  id: column("id"),
  dashboardId: column("dashboardId"),
  name: column("name"),
  filters: column("filters"),
  createdBy: column("createdBy"),
  createdAt: column("createdAt"),
};

const schema = {
  dashboards,
  dashboardViews,
  dashboardShares: {},
  dashboardRevisions: {
    id: column("id"),
    dashboardId: column("dashboardId"),
    createdAt: column("createdAt"),
  },
  analyses: {
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
  },
  analysisShares: {},
  analysisRevisions: {},
};

const dashboard = {
  id: "dashboard-a",
  kind: "sql",
  title: "Dashboard A",
  config: "{}",
  ownerEmail: "alice@example.com",
  orgId: null,
  visibility: "private",
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  updatedBy: null,
  archivedAt: null,
  hiddenAt: null,
  hiddenBy: null,
};

const ctx = { email: "alice@example.com", orgId: null };

vi.mock("@agent-native/core/server", () => ({
  recordChange: () => undefined,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (_orgId: string, key: string) =>
    key === "sql-dashboard-dashboard-a"
      ? state.orgLegacyDashboard
      : key === "adhoc-analysis-analysis-a"
        ? state.orgLegacyAnalysis
        : null,
  getUserSetting: async (_email: string, key: string) =>
    key === "sql-dashboard-dashboard-a"
      ? state.legacyDashboard
      : key === "adhoc-analysis-analysis-a"
        ? state.legacyAnalysis
        : null,
  deleteOrgSetting: async () => false,
  deleteUserSetting: async () => false,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ kind: "access" }),
  assertAccess: async () => ({ role: "owner" }),
  resolveAccess: async (...args: unknown[]) => {
    state.accessCalls.push(args);
    const access = (
      state.accessQueue.length ? state.accessQueue.shift() : state.accessResult
    ) as {
      resource: Record<string, unknown>;
      role: string;
    } | null;
    return access
      ? { ...access, resource: state.dashboardRow ?? access.resource }
      : null;
  },
  roleSatisfies: (role: string, minimum: string) => {
    const ranks: Record<string, number> = {
      viewer: 1,
      commenter: 2,
      editor: 3,
      admin: 4,
      owner: 5,
    };
    return (ranks[role] ?? -1) >= (ranks[minimum] ?? Infinity);
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  desc: (value: unknown) => ({ kind: "desc", value }),
  eq: (columnValue: unknown, value: unknown) => ({
    kind: "eq",
    column: columnValue,
    value,
  }),
  isNotNull: (value: unknown) => ({ kind: "isNotNull", column: value }),
  isNull: (value: unknown) => ({ kind: "isNull", column: value }),
  sql: () => ({ kind: "sql" }),
}));

vi.mock("../db/index.js", () => ({
  schema,
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          if (table === dashboardViews) {
            return rowsResult(
              state.views.filter((row) => matches(predicate, row)),
            );
          }
          if (table === dashboards) {
            return rowsResult(
              state.dashboardRow && matches(predicate, state.dashboardRow)
                ? [state.dashboardRow]
                : [],
            );
          }
          if (table === schema.analyses) {
            return rowsResult(
              state.analysisRow && matches(predicate, state.analysisRow)
                ? [state.analysisRow]
                : [],
            );
          }
          return rowsResult([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (table === dashboardViews) state.views.push({ ...row } as ViewRow);
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: async () => {
            if (table === dashboards && state.dashboardRow?.id !== row.id) {
              state.dashboardRow = { ...dashboard, ...row };
            }
            if (table === schema.analyses && state.analysisRow?.id !== row.id) {
              state.analysisRow = { ...row };
            }
          },
        });
      },
    }),
    update: (table: unknown) => ({
      set: (values: Partial<ViewRow>) => ({
        where: async (predicate: unknown) => {
          if (table !== dashboardViews) return;
          state.views = state.views.map((row) =>
            matches(predicate, row) ? { ...row, ...values } : row,
          );
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        if (table === dashboardViews) {
          state.views = state.views.filter((row) => !matches(predicate, row));
        }
      },
    }),
  }),
}));

const { deleteDashboardView, getDashboardForReview, saveDashboardView } =
  await import("./dashboards-store.js");

beforeEach(() => {
  state.accessCalls = [];
  state.accessQueue = [];
  state.accessResult = { resource: dashboard, role: "owner" };
  state.analysisRow = null;
  state.dashboardRow = null;
  state.legacyAnalysis = null;
  state.legacyDashboard = null;
  state.orgLegacyAnalysis = null;
  state.orgLegacyDashboard = null;
  state.views = [
    {
      id: "existing",
      dashboardId: "dashboard-a",
      name: "Existing",
      filters: "{}",
      createdBy: "alice@example.com",
      createdAt: "2026-07-13T00:00:00.000Z",
    },
    {
      id: "same-name",
      dashboardId: "dashboard-b",
      name: "Other dashboard view",
      filters: "{}",
      createdBy: "bob@example.com",
      createdAt: "2026-07-13T00:00:00.000Z",
    },
  ];
});

describe("dashboard views", () => {
  it("reads review dashboards only from the requested org without migrating legacy rows", async () => {
    state.dashboardRow = {
      ...dashboard,
      orgId: "org-a",
      visibility: "private",
      config: JSON.stringify({ name: "Review", panels: [] }),
    };
    state.legacyDashboard = { name: "Legacy", panels: [] };

    const result = await getDashboardForReview("dashboard-a", {
      kind: "organization",
      orgId: "org-a",
    });
    const otherOrgResult = await getDashboardForReview("dashboard-a", {
      kind: "organization",
      orgId: "org-b",
    });

    expect(result).toMatchObject({
      id: "dashboard-a",
      orgId: "org-a",
      role: "viewer",
      canEdit: false,
      canManage: false,
    });
    expect(otherOrgResult).toBeNull();
    expect(state.accessCalls).toEqual([
      [
        "dashboard",
        "dashboard-a",
        { userEmail: "alice@example.com", orgId: "org-a" },
      ],
    ]);
    expect(state.dashboardRow?.orgId).toBe("org-a");
  });

  it("checks parent access without loading the dashboard config", async () => {
    const { listDashboardViews } = await import("./dashboards-store.js");

    await listDashboardViews("dashboard-a", ctx);

    expect(state.accessCalls).toContainEqual([
      "dashboard",
      "dashboard-a",
      { userEmail: "alice@example.com", orgId: undefined },
      { skipResourceBody: true },
    ]);
  });

  it("keeps legacy dashboards visible while materializing parent access", async () => {
    state.accessResult = null;
    state.legacyDashboard = {
      name: "Legacy dashboard",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };

    const { listDashboardViews } = await import("./dashboards-store.js");
    const result = await listDashboardViews("dashboard-a", ctx);

    expect(result.map(({ id }) => id)).toEqual(["existing"]);
    expect(state.dashboardRow).toMatchObject({
      id: "dashboard-a",
      title: "Legacy dashboard",
      ownerEmail: "alice@example.com",
    });
  });

  it("inserts a new view when the client supplies a new id", async () => {
    const result = await saveDashboardView(
      "dashboard-a",
      { id: "new-view", name: "New view", filters: { f_status: "open" } },
      ctx,
    );

    expect(result).toMatchObject({
      id: "new-view",
      dashboardId: "dashboard-a",
      name: "New view",
      filters: { f_status: "open" },
    });
  });

  it("updates an existing view only within its dashboard", async () => {
    const updated = await saveDashboardView(
      "dashboard-a",
      { id: "existing", name: "Renamed", filters: {} },
      ctx,
    );
    expect(updated.id).toBe("existing");
    expect(updated.name).toBe("Renamed");

    const collision = await saveDashboardView(
      "dashboard-a",
      { id: "same-name", name: "New same-name", filters: {} },
      ctx,
    );
    expect(collision.id).not.toBe("same-name");
    expect(state.views.find((view) => view.id === "same-name")?.name).toBe(
      "Other dashboard view",
    );
  });

  it("does not delete a same-id view owned by another dashboard", async () => {
    await deleteDashboardView("dashboard-a", "same-name", ctx);

    expect(state.views.some((view) => view.id === "same-name")).toBe(true);
  });
});

describe("legacy migration", () => {
  const otherOrgDashboard = {
    ...dashboard,
    title: "Other org dashboard",
    ownerEmail: "bob@example.com",
    orgId: "org-b",
    visibility: "org",
  };

  beforeEach(() => {
    state.accessResult = null;
    state.legacyDashboard = { name: "Legacy dashboard", panels: [] };
    state.legacyAnalysis = { name: "Legacy analysis" };
  });

  it("returns the caller's migrated legacy dashboard", async () => {
    const { getDashboard } = await import("./dashboards-store.js");

    const result = await getDashboard("dashboard-a", ctx);

    expect(result).toMatchObject({
      id: "dashboard-a",
      ownerEmail: "alice@example.com",
    });
  });

  it("does not return another owner's dashboard that shares a legacy id", async () => {
    state.dashboardRow = otherOrgDashboard;
    const { getDashboard, listDashboardViews } =
      await import("./dashboards-store.js");

    expect(await getDashboard("dashboard-a", ctx)).toBeNull();
    expect(await listDashboardViews("dashboard-a", ctx)).toEqual([]);
    expect(state.dashboardRow).toBe(otherOrgDashboard);
  });

  it("does not return another owner's analysis that shares a legacy id", async () => {
    const otherOrgAnalysis = {
      id: "analysis-a",
      name: "Other org analysis",
      ownerEmail: "bob@example.com",
      orgId: "org-b",
      visibility: "org",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    state.analysisRow = otherOrgAnalysis;
    const { getAnalysis } = await import("./dashboards-store.js");

    expect(await getAnalysis("analysis-a", ctx)).toBeNull();
    expect(state.analysisRow).toBe(otherOrgAnalysis);
  });

  it("reads an org dashboard another member migrated first with the caller's own role", async () => {
    const orgCtx = { email: "alice@example.com", orgId: "org-a" };
    const migratedByCarol = {
      ...dashboard,
      ownerEmail: "carol@example.com",
      orgId: "org-a",
      visibility: "org",
    };
    state.orgLegacyDashboard = { name: "Legacy org dashboard", panels: [] };
    state.dashboardRow = migratedByCarol;
    const viewer = { resource: migratedByCarol, role: "viewer" };
    state.accessQueue = [null, viewer, null, viewer];
    const { getDashboard, listDashboardViews } =
      await import("./dashboards-store.js");

    expect(await getDashboard("dashboard-a", orgCtx)).toMatchObject({
      ownerEmail: "carol@example.com",
      role: "viewer",
      canEdit: false,
    });
    expect(await listDashboardViews("dashboard-a", orgCtx)).not.toEqual([]);
    expect(state.dashboardRow).toBe(migratedByCarol);
  });

  it("reads an org analysis another member migrated first with the caller's own role", async () => {
    const orgCtx = { email: "alice@example.com", orgId: "org-a" };
    const migratedByCarol = {
      id: "analysis-a",
      name: "Legacy org analysis",
      ownerEmail: "carol@example.com",
      orgId: "org-a",
      visibility: "org",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    state.orgLegacyAnalysis = { name: "Legacy org analysis" };
    state.analysisRow = migratedByCarol;
    state.accessQueue = [null, { resource: migratedByCarol, role: "viewer" }];
    const { getAnalysis } = await import("./dashboards-store.js");

    expect(await getAnalysis("analysis-a", orgCtx)).toMatchObject({
      ownerEmail: "carol@example.com",
      role: "viewer",
    });
    expect(state.analysisRow).toBe(migratedByCarol);
  });

  it("returns the caller's migrated legacy analysis", async () => {
    const { getAnalysis } = await import("./dashboards-store.js");

    const result = await getAnalysis("analysis-a", ctx);

    expect(result).toMatchObject({
      id: "analysis-a",
      name: "Legacy analysis",
      ownerEmail: "alice@example.com",
    });
  });
});
