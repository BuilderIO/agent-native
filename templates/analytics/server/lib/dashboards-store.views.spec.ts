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

vi.mock("@agent-native/core/db", () => ({
  isPostgres: () => false,
}));

vi.mock("@agent-native/core/server", () => ({
  recordChange: () => undefined,
}));

vi.mock("@agent-native/core/settings", () => ({
  getAllSettings: async () => ({}),
  getOrgSetting: async () => null,
  getUserSetting: async () => null,
  deleteOrgSetting: async () => false,
  deleteUserSetting: async () => false,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ kind: "access" }),
  assertAccess: async () => ({ role: "owner" }),
  resolveAccess: async () => ({ resource: dashboard, role: "owner" }),
  roleSatisfies: () => true,
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
          return rowsResult([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (row: ViewRow) => {
        if (table === dashboardViews) state.views.push({ ...row });
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

const { deleteDashboardView, saveDashboardView } =
  await import("./dashboards-store.js");

beforeEach(() => {
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
