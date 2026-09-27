import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  rowsByCall: [] as Record<string, unknown>[][],
  legacySettings: {} as Record<string, Record<string, unknown>>,
  projection: null as Record<string, unknown> | null,
  where: null as unknown,
  limit: null as number | null,
}));

vi.mock("@agent-native/core/server", () => ({ recordChange: () => undefined }));
vi.mock("@agent-native/core/settings", () => ({
  listSettingsByPrefix: vi.fn(async (prefix: string) =>
    Object.entries(state.legacySettings)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value })),
  ),
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
    resultMarkdown: column("resultMarkdown"),
    resultData: column("resultData"),
  };
  const query = {
    orderBy: () => query,
    limit: (value: number) => {
      state.limit = value;
      const candidates = state.rowsByCall.length
        ? (state.rowsByCall.shift() ?? [])
        : state.rows;
      const where = state.where as {
        kind?: string;
        target?: { name?: string };
        value?: unknown;
        conditions?: Array<{
          kind?: string;
          target?: { name?: string };
          value?: unknown;
        }>;
      } | null;
      const equals =
        where?.kind === "eq"
          ? [where]
          : where?.kind === "and" &&
              where.conditions?.every((condition) => condition.kind === "eq")
            ? where.conditions
            : undefined;
      return Promise.resolve(
        equals
          ? candidates.filter((row) =>
              equals.every(
                (condition) =>
                  row[condition.target?.name ?? ""] === condition.value,
              ),
            )
          : candidates,
      );
    },
  };
  const db = {
    select: (projection?: Record<string, unknown>) => {
      state.projection = projection ?? null;
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

const {
  getAnalysisForReview,
  getDashboardForReview,
  getPublicDashboardMetadata,
  searchDashboardReferences,
} = await import("./dashboards-store.js");

describe("getPublicDashboardMetadata", () => {
  beforeEach(() => {
    state.rows = [];
    state.rowsByCall = [];
    state.legacySettings = {};
    state.projection = null;
    state.where = null;
    state.limit = null;
  });

  it("guards metadata extraction when dashboard config is malformed", async () => {
    state.rows = [
      {
        title: "Public dashboard",
        description: null,
        panelTitlesJson: "[]",
      },
    ];

    await expect(getPublicDashboardMetadata("dashboard-1")).resolves.toEqual({
      title: "Public dashboard",
      description: null,
      panelTitles: [],
    });
    expect(state.where).toEqual(
      expect.objectContaining({
        kind: "and",
        conditions: expect.arrayContaining([
          { kind: "isNull", target: { name: "archivedAt" } },
        ]),
      }),
    );

    const projection = JSON.stringify(state.projection);
    expect(projection.match(/is json/g)).toHaveLength(2);
    expect(projection).toContain("else '{}'::jsonb");
  });
});

describe("Human Review artifact read scopes", () => {
  beforeEach(() => {
    state.rows = [];
    state.rowsByCall = [];
    state.legacySettings = {};
    state.projection = null;
    state.where = null;
    state.limit = null;
  });

  it("limits ordinary dashboard and analysis reads to their organization", async () => {
    state.rows = [
      {
        id: "dashboard-1",
        kind: "sql",
        title: "Customer dashboard",
        config: "{}",
        ownerEmail: "customer@example.com",
        orgId: "org-customer",
        visibility: "private",
        updatedAt: "2026-09-01T00:00:00.000Z",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const dashboard = await getDashboardForReview("dashboard-1", {
      kind: "organization",
      orgId: "org-customer",
    });
    expect(dashboard?.orgId).toBe("org-customer");
    expect(state.where).toEqual({
      kind: "and",
      conditions: [
        { kind: "eq", target: { name: "id" }, value: "dashboard-1" },
        {
          kind: "eq",
          target: { name: "orgId" },
          value: "org-customer",
        },
      ],
    });
    state.rows = [
      {
        id: "dashboard-1",
        kind: "sql",
        title: "Other customer dashboard",
        config: "{}",
        ownerEmail: "other@example.com",
        orgId: "org-other",
        visibility: "private",
        updatedAt: "2026-09-01T00:00:00.000Z",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    await expect(
      getDashboardForReview("dashboard-1", {
        kind: "organization",
        orgId: "org-customer",
      }),
    ).resolves.toBeNull();

    state.rows = [
      {
        id: "analysis-1",
        name: "Customer analysis",
        description: "",
        question: "",
        instructions: "",
        dataSources: "[]",
        resultMarkdown: "Result",
        resultData: null,
        ownerEmail: "customer@example.com",
        orgId: "org-customer",
        visibility: "private",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const analysis = await getAnalysisForReview("analysis-1", {
      kind: "organization",
      orgId: "org-customer",
    });
    expect(analysis?.orgId).toBe("org-customer");
    expect(state.where).toEqual({
      kind: "and",
      conditions: [
        { kind: "eq", target: { name: "id" }, value: "analysis-1" },
        {
          kind: "eq",
          target: { name: "orgId" },
          value: "org-customer",
        },
      ],
    });
    state.rows = [
      {
        id: "analysis-1",
        name: "Other customer analysis",
        description: "",
        question: "",
        instructions: "",
        dataSources: "[]",
        resultMarkdown: "Private result",
        resultData: null,
        ownerEmail: "other@example.com",
        orgId: "org-other",
        visibility: "private",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    await expect(
      getAnalysisForReview("analysis-1", {
        kind: "organization",
        orgId: "org-customer",
      }),
    ).resolves.toBeNull();
  });

  it("uses ID-only artifact reads for the scope authorized as the super organization", async () => {
    state.rows = [
      {
        id: "dashboard-1",
        kind: "sql",
        title: "Customer dashboard",
        config: "{}",
        ownerEmail: "customer@example.com",
        orgId: "org-customer",
        visibility: "private",
        updatedAt: "2026-09-01T00:00:00.000Z",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const dashboard = await getDashboardForReview("dashboard-1", {
      kind: "super-organization",
    });
    expect(state.where).toEqual({
      kind: "eq",
      target: { name: "id" },
      value: "dashboard-1",
    });
    expect(dashboard?.orgId).toBe("org-customer");

    state.rows = [
      {
        id: "analysis-1",
        name: "Customer analysis",
        description: "",
        question: "",
        instructions: "",
        dataSources: "[]",
        resultMarkdown: "Result",
        resultData: null,
        ownerEmail: "customer@example.com",
        orgId: "org-customer",
        visibility: "private",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ];

    const result = await getAnalysisForReview("analysis-1", {
      kind: "super-organization",
    });

    expect(state.where).toEqual({
      kind: "eq",
      target: { name: "id" },
      value: "analysis-1",
    });
    expect(result?.orgId).toBe("org-customer");
  });
});

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

  it("keeps malformed configs from aborting reference search", async () => {
    state.rows = [
      {
        id: "revenue-dashboard",
        kind: "sql",
        name: "Revenue",
        config: "{not-json",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
        visibility: "org",
        updatedAt: "2026-08-13T01:00:00.000Z",
      },
    ];

    const result = await searchDashboardReferences(
      { email: "alice@example.com", orgId: "org-1" },
      "revenue",
      8,
    );

    expect(result).toMatchObject([
      {
        id: "revenue-dashboard",
        name: "Revenue",
        description: null,
      },
    ]);
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
