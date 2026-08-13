import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  projection: null as Record<string, unknown> | null,
  where: null as unknown,
  limit: null as number | null,
}));

vi.mock("@agent-native/core/db", () => ({ isPostgres: () => false }));
vi.mock("@agent-native/core/server", () => ({ recordChange: () => undefined }));
vi.mock("@agent-native/core/settings", () => ({
  getAllSettings: vi.fn(async () => ({})),
  getOrgSetting: vi.fn(),
  getUserSetting: vi.fn(),
  deleteOrgSetting: vi.fn(),
  deleteUserSetting: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access" })),
  assertAccess: vi.fn(),
  resolveAccess: vi.fn(),
  roleSatisfies: vi.fn(() => false),
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  desc: (value: unknown) => ({ kind: "desc", value }),
  eq: (target: unknown, value: unknown) => ({ kind: "eq", target, value }),
  inArray: vi.fn(),
  isNotNull: (target: unknown) => ({ kind: "isNotNull", target }),
  isNull: (target: unknown) => ({ kind: "isNull", target }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: [...strings],
    values,
  }),
}));

vi.mock("../db/index.js", () => {
  const column = (name: string) => ({ name });
  const dashboards = {
    id: column("id"),
    kind: column("kind"),
    title: column("title"),
    config: column("config"),
    ownerEmail: column("ownerEmail"),
    orgId: column("orgId"),
    visibility: column("visibility"),
    updatedAt: column("updatedAt"),
    archivedAt: column("archivedAt"),
    hiddenAt: column("hiddenAt"),
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
  const query = {
    orderBy: () => query,
    limit: (value: number) => {
      state.limit = value;
      return Promise.resolve(state.rows);
    },
  };
  const db = {
    select: (projection: Record<string, unknown>) => {
      state.projection = projection;
      return {
        from: () => ({
          where: (where: unknown) => {
            state.where = where;
            return query;
          },
        }),
      };
    },
  };
  return {
    schema: {
      dashboards,
      analyses,
      dashboardShares: {},
      dashboardRevisions: {},
      dashboardViews: {},
      dashboardNameLocks: {},
      analysisShares: {},
      analysisRevisions: {},
    },
    getDb: () => db,
  };
});

const { searchDashboardReferences } = await import("./dashboards-store.js");

describe("searchDashboardReferences", () => {
  beforeEach(() => {
    state.rows = [];
    state.projection = null;
    state.where = null;
    state.limit = null;
  });

  it("uses an access-scoped, bounded wildcard query and returns replication references", async () => {
    state.rows = [
      {
        id: "revenue_%_dashboard",
        kind: "sql",
        name: "Revenue dashboard",
        description: "Closed-won revenue",
        config: JSON.stringify({
          title: "revenue_%",
          panels: [{ source: "hubspot" }],
        }),
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        visibility: "org",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
    ];

    const result = await searchDashboardReferences(
      { email: "alice@example.com", orgId: "org-1" },
      "revenue_%",
      99,
    );

    expect(state.limit).toBe(24);
    expect(state.projection).toHaveProperty("config");
    expect(JSON.stringify(state.where)).toContain("ESCAPE");
    expect(JSON.stringify(state.where)).toContain("%revenue\\\\_\\\\%%");
    expect(result).toEqual([
      {
        id: "revenue_%_dashboard",
        kind: "sql",
        name: "Revenue dashboard",
        description: "Closed-won revenue",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        visibility: "org",
        updatedAt: "2026-08-13T00:00:00.000Z",
        matchedFields: ["id", "config"],
      },
    ]);
  });

  it("does not issue a broad query for blank search input", async () => {
    await expect(
      searchDashboardReferences(
        { email: "alice@example.com", orgId: null },
        "   ",
      ),
    ).resolves.toEqual([]);
    expect(state.limit).toBeNull();
  });
});
