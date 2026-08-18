import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  // One entry per `select` when a test needs the candidate query and the
  // out-of-scope probe to answer differently; otherwise every call sees `rows`.
  rowsByCall: [] as Record<string, unknown>[][],
  legacySettings: {} as Record<string, Record<string, unknown>>,
  projection: null as Record<string, unknown> | null,
  where: null as unknown,
  limit: null as number | null,
}));

vi.mock("@agent-native/core/db", () => ({ isPostgres: () => false }));
vi.mock("@agent-native/core/server", () => ({ recordChange: () => undefined }));
vi.mock("@agent-native/core/settings", () => ({
  getAllSettings: vi.fn(async () => state.legacySettings),
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
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
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
      return Promise.resolve(
        state.rowsByCall.length ? (state.rowsByCall.shift() ?? []) : state.rows,
      );
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
    state.rowsByCall = [];
    state.legacySettings = {};
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

    expect(state.limit).toBe(200);
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

  it("ranks exact multi-word names and includes both dashboard kinds", async () => {
    state.rows = [
      {
        id: "dashboard-generic",
        kind: "sql",
        name: "Leaderboard overview",
        description: "DevRel metrics",
        config: JSON.stringify({ source: "first-party" }),
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        visibility: "org",
        updatedAt: "2026-08-13T01:00:00.000Z",
      },
      {
        id: "devrel-leaderboard",
        kind: "explorer",
        name: "DevRel Leaderboard",
        description: null,
        config: JSON.stringify({ source: "bigquery" }),
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        visibility: "org",
        updatedAt: "2026-08-12T01:00:00.000Z",
      },
    ];

    const result = await searchDashboardReferences(
      { email: "alice@example.com", orgId: "org-1" },
      "devrel leaderboard",
      8,
    );

    expect(result.map((row) => row.id)).toEqual([
      "devrel-leaderboard",
      "dashboard-generic",
    ]);
    expect(result.map((row) => row.kind)).toEqual(["explorer", "sql"]);
    expect(result[0]?.matchedFields).toContain("name");
  });

  it("searches scoped legacy dashboard settings without returning duplicates", async () => {
    state.legacySettings = {
      "o:org-1:sql-dashboard-devrel-leaderboard": {
        name: "DevRel Leaderboard",
        description: "Legacy reference",
        updatedAt: "2026-08-13T02:00:00.000Z",
      },
      "u:alice@example.com:dashboard-private-devrel": {
        title: "Private DevRel leaderboard",
        description: "Personal reference",
      },
      "u:other@example.com:dashboard-hidden-devrel": {
        title: "Do not leak this dashboard",
      },
    };

    const result = await searchDashboardReferences(
      { email: "alice@example.com", orgId: "org-1" },
      "devrel leaderboard",
      8,
    );

    expect(result.map((row) => row.id)).toEqual([
      "devrel-leaderboard",
      "private-devrel",
    ]);
    expect(result[0]).toMatchObject({
      kind: "sql",
      visibility: "org",
      matchedFields: ["id", "name", "config"],
    });
    expect(result[1]).toMatchObject({
      kind: "explorer",
      visibility: "private",
    });
  });

  it("fails loudly when the only matches are org-scoped and the session has no org", async () => {
    state.rowsByCall = [
      [],
      [{ id: "devrel-leaderboard-v3", name: "DevRel Leaderboard v3" }],
    ];

    await expect(
      searchDashboardReferences(
        { email: "Steve@Builder.io", orgId: null },
        "devrel leaderboard v3",
        8,
      ),
    ).rejects.toThrow(/DevRel Leaderboard v3.*no active organization/s);
  });

  it("returns empty without probing when the session carries an org", async () => {
    state.rowsByCall = [
      [],
      [{ id: "should-not-be-read", name: "Unreachable" }],
    ];

    await expect(
      searchDashboardReferences(
        { email: "alice@example.com", orgId: "org-1" },
        "devrel leaderboard v3",
        8,
      ),
    ).resolves.toEqual([]);
    expect(state.rowsByCall).toHaveLength(1);
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
