import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getDashboardForReview: vi.fn(),
  currentRequestUserIsOrgAdmin: vi.fn(),
  superOrgId: undefined as string | undefined,
  loadDashboardSeed: vi.fn(),
}));

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

vi.mock("@agent-native/core/server", () => ({
  currentRequestUserIsOrgAdmin: mocks.currentRequestUserIsOrgAdmin,
  buildDeepLink: vi.fn(
    ({
      app,
      view,
      params,
    }: {
      app: string;
      view: string;
      params?: { dashboardId?: string };
    }) => {
      const suffix = params?.dashboardId ? `/${params.dashboardId}` : "";
      return `/${app}/${view}${suffix}`;
    },
  ),
  getRequestOrgId: () => "org-a",
  getRequestUserEmail: () => "alice@example.com",
  getAppConfig: () => ({ observability: { superOrgId: mocks.superOrgId } }),
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  getDashboardForReview: mocks.getDashboardForReview,
}));

vi.mock("../server/lib/dashboard-seeds", () => ({
  loadDashboardSeed: mocks.loadDashboardSeed,
}));

import {
  FIRST_PARTY_BIGQUERY_WAU_SQL,
  LEGACY_NEW_VS_RECURRING_USERS_SQL,
  PREVIOUS_VIEW_FIRST_PARTY_BIGQUERY_WAU_SQL,
} from "../server/lib/canonical-first-party-dashboard-repair";
import { FIRST_PARTY_DASHBOARD_ID } from "../server/lib/first-party-metric-catalog";

const { default: getSqlDashboard } = await import("./get-sql-dashboard");

describe("get-sql-dashboard seed fallback", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.getDashboardForReview.mockReset();
    mocks.currentRequestUserIsOrgAdmin.mockReset();
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(false);
    mocks.superOrgId = undefined;
    mocks.loadDashboardSeed.mockReset();
  });

  it("returns a seed when no SQL dashboard row exists", async () => {
    mocks.getDashboard.mockResolvedValue(null);
    mocks.loadDashboardSeed.mockReturnValue({
      name: "Seed",
      panels: [{ id: "seed-panel" }],
    });

    const result = (await getSqlDashboard.run({ id: "seeded" })) as {
      panels: Array<{ id: string; index: number }>;
      layout: {
        panelOrder: string[];
        firstPanelIds: string[];
        groups: Array<{
          rows: Array<{
            rowNumber: number;
            rowIndex: number;
            panelIds: string[];
          }>;
        }>;
      };
      ownerEmail: string | null;
      visibility: string;
    };

    expect(result.panels.map((panel) => panel.id)).toEqual(["seed-panel"]);
    expect(result.panels[0].index).toBe(0);
    expect(result.layout.panelOrder).toEqual(["seed-panel"]);
    expect(result.layout.firstPanelIds).toEqual(["seed-panel"]);
    expect(result.layout.groups[0].rows).toEqual([
      { rowNumber: 1, rowIndex: 0, panelIds: ["seed-panel"] },
    ]);
    expect(result.ownerEmail).toBeNull();
    expect(result.visibility).toBe("org");
  });

  it("returns a saved empty dashboard instead of rehydrating its seed", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        name: "Blank",
        panels: [],
        createdBy: "spoof@example.com",
      },
      ownerEmail: "alice@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      canEdit: true,
      canManage: true,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: "2026-06-24T00:00:00.000Z",
      createdBy: "alice@example.com",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    mocks.loadDashboardSeed.mockReturnValue({
      name: "Seed",
      panels: [{ id: "seed-panel" }],
    });

    const result = (await getSqlDashboard.run({ id: "seeded" })) as {
      panels: Array<{ id: string }>;
      layout: { panelOrder: string[] };
      name: string;
      ownerEmail: string | null;
      createdBy: string | null;
    };

    expect(result.name).toBe("Blank");
    expect(result.panels).toEqual([]);
    expect(result.layout.panelOrder).toEqual([]);
    expect(result.ownerEmail).toBe("alice@example.com");
    expect(result.createdBy).toBe("alice@example.com");
  });

  it("repairs legacy SQL when reading the persisted first-party dashboard", async () => {
    mocks.getDashboard.mockResolvedValue({
      id: FIRST_PARTY_DASHBOARD_ID,
      kind: "sql",
      config: {
        name: "Agent-Native Templates (First-party)",
        panels: [
          {
            id: "new-vs-recurring-users",
            source: "first-party",
            sql: LEGACY_NEW_VS_RECURRING_USERS_SQL,
          },
        ],
      },
      ownerEmail: "alice@example.com",
      orgId: null,
      visibility: "org",
      role: "owner",
      canEdit: true,
      canManage: true,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });

    const result = (await getSqlDashboard.run({
      id: FIRST_PARTY_DASHBOARD_ID,
      includeConfig: true,
    })) as { panels: Array<{ sql?: string }> };

    expect(result.panels[0]?.sql).not.toBe(LEGACY_NEW_VS_RECURRING_USERS_SQL);
    expect(result.panels[0]?.sql).toContain("<> 'www'");
  });

  it.each([
    ["agent-native-templates-first-party-bigquery-v2", false, true],
    ["agent-native-templates-first-party-bigquery-v3", false, true],
    ["agent-native-templates-first-party-bigquery-v3", true, false],
    ["agent-native-templates-first-party-bigquery-v2-private", false, false],
  ] as const)(
    "reads %s WAU with custom=%s and repair=%s",
    async (id, custom, shouldRepair) => {
      const sql = custom
        ? `${PREVIOUS_VIEW_FIRST_PARTY_BIGQUERY_WAU_SQL}\nLIMIT 10`
        : PREVIOUS_VIEW_FIRST_PARTY_BIGQUERY_WAU_SQL;
      mocks.getDashboard.mockResolvedValue({
        id,
        kind: "sql",
        config: {
          panels: [
            {
              id: "wau-over-time",
              source: "bigquery",
              sql,
            },
          ],
        },
        ownerEmail: "alice@example.com",
        orgId: null,
        visibility: "org",
        role: "owner",
        canEdit: true,
        canManage: true,
      });

      const result = (await getSqlDashboard.run({
        id,
        includeConfig: true,
      })) as {
        panels: Array<{ sql?: string }>;
      };

      expect(result.panels[0]?.sql).toBe(
        shouldRepair ? FIRST_PARTY_BIGQUERY_WAU_SQL : sql,
      );
      expect(mocks.getDashboard).toHaveBeenCalledWith(id, {
        email: "alice@example.com",
        orgId: "org-a",
      });
    },
  );

  it("omits full panel SQL by default and returns it when includeConfig is true", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: {
        name: "Weekly",
        panels: [
          {
            id: "events",
            title: "Events",
            source: "first-party",
            chartType: "line",
            width: 2,
            sql: "SELECT COUNT(*) AS value FROM analytics_events",
          },
        ],
      },
      ownerEmail: "alice@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      canEdit: true,
      canManage: true,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });

    const compact = (await getSqlDashboard.run({ id: "weekly" })) as {
      panels: Array<{ id: string; sql?: string }>;
    };
    const full = (await getSqlDashboard.run({
      id: "weekly",
      includeConfig: true,
    })) as {
      panels: Array<{ id: string; sql?: string }>;
    };

    expect(compact.panels).toEqual([
      {
        index: 0,
        id: "events",
        title: "Events",
        chartType: "line",
        source: "first-party",
        width: 2,
        sqlChars: "SELECT COUNT(*) AS value FROM analytics_events".length,
        sqlHash: expect.stringMatching(/^[0-9a-f]{12}$/),
      },
    ]);
    expect(compact.panels[0].sql).toBeUndefined();
    expect(full.panels[0].sql).toMatch(/analytics_events/);
  });

  it("allows an org admin to read a same-org SQL dashboard for Human Review", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
    mocks.getDashboardForReview.mockResolvedValue({
      id: "review-dashboard",
      kind: "sql",
      config: { name: "Review", panels: [] },
      ownerEmail: "owner@example.com",
      orgId: "org-a",
      visibility: "private",
      role: "viewer",
      canEdit: false,
      canManage: false,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: "2026-06-24T00:00:00.000Z",
      createdBy: "owner@example.com",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });

    await getSqlDashboard.run({ id: "review-dashboard", reviewPreview: true });

    expect(mocks.currentRequestUserIsOrgAdmin).toHaveBeenCalledWith("org-a");
    expect(mocks.getDashboardForReview).toHaveBeenCalledWith(
      "review-dashboard",
      { kind: "organization", orgId: "org-a" },
    );
    expect(mocks.getDashboard).not.toHaveBeenCalled();
    expect(mocks.loadDashboardSeed).not.toHaveBeenCalled();
  });

  it("rejects non-admin Human Review dashboard previews before reading", async () => {
    await expect(
      getSqlDashboard.run({ id: "review-dashboard", reviewPreview: true }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mocks.getDashboardForReview).not.toHaveBeenCalled();
    expect(mocks.getDashboard).not.toHaveBeenCalled();
  });

  it("hides dashboards outside the current org without falling back to seeds", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
    mocks.getDashboardForReview.mockResolvedValue(null);

    await expect(
      getSqlDashboard.run({ id: "other-org", reviewPreview: true }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mocks.loadDashboardSeed).not.toHaveBeenCalled();
  });

  it("allows only a configured super-org admin to request cross-org previews", async () => {
    mocks.superOrgId = "org-a";
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);
    mocks.getDashboardForReview.mockResolvedValue({
      id: "customer-dashboard",
      kind: "sql",
      config: { name: "Customer", panels: [] },
      ownerEmail: "customer@example.com",
      orgId: "org-b",
      visibility: "private",
      role: "viewer",
      canEdit: false,
      canManage: false,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: "2026-06-24T00:00:00.000Z",
      createdBy: "customer@example.com",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });

    await getSqlDashboard.run({
      id: "customer-dashboard",
      reviewPreview: true,
      reviewOrgId: "org-b",
    });

    expect(mocks.getDashboardForReview).toHaveBeenCalledWith(
      "customer-dashboard",
      { kind: "super-organization", orgId: "org-b" },
    );
  });
});

describe("get-sql-dashboard agent reads", () => {
  const agent = { caller: "tool" } as never;
  const frontend = { caller: "frontend" } as never;

  function savedDashboard(panels: Array<Record<string, unknown>>) {
    return {
      id: "weekly",
      kind: "sql",
      config: { name: "Weekly", panels, createdBy: "spoof@example.com" },
      ownerEmail: "alice@example.com",
      orgId: "org-a",
      visibility: "private",
      role: "owner",
      canEdit: true,
      canManage: true,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: "2026-06-24T00:00:00.000Z",
      createdBy: "alice@example.com",
      updatedAt: "2026-06-25T00:00:00.000Z",
      updatedBy: "alice@example.com",
    };
  }

  function sqlPanel(id: string, sqlChars = 80, config?: unknown) {
    return {
      id,
      title: id,
      source: "bigquery",
      chartType: "line",
      width: 1,
      sql: `SELECT '${id}' ${"x".repeat(sqlChars)}`,
      ...(config ? { config } : {}),
    };
  }

  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.loadDashboardSeed.mockReset();
  });

  it("names the result columns each chart is bound to without returning SQL", async () => {
    mocks.getDashboard.mockResolvedValue(
      savedDashboard([
        sqlPanel("trend", 80, {
          xKey: "week",
          yKeys: ["value", "value_4wk_avg"],
          rightYKeys: ["value_4wk_avg"],
          barKeys: ["value"],
          pivot: { xKey: "week", seriesKey: "kind", valueKey: "value" },
          columns: [{ key: "a" }, { key: "b", linkKey: "c" }],
          color: "#ff0000",
        }),
      ]),
    );

    const result = (await getSqlDashboard.run({ id: "weekly" }, agent)) as {
      panels: Array<Record<string, unknown>>;
    };

    expect(result.panels[0]).toMatchObject({
      bindings: {
        xKey: "week",
        yKeys: ["value", "value_4wk_avg"],
        rightYKeys: ["value_4wk_avg"],
        barKeys: ["value"],
        pivot: { xKey: "week", seriesKey: "kind", valueKey: "value" },
        columns: ["a", "b"],
      },
      configKeys: expect.arrayContaining(["color", "xKey", "pivot"]),
    });
    expect(result.panels[0]).not.toHaveProperty("sql");
    expect(result.panels[0].sqlChars).toBe(
      (sqlPanel("trend", 80).sql as string).length,
    );
  });

  it("returns full SQL and config for only the requested panels", async () => {
    mocks.getDashboard.mockResolvedValue(
      savedDashboard([
        sqlPanel("p1"),
        sqlPanel("p2", 80, { xKey: "week" }),
        sqlPanel("p3"),
      ]),
    );

    const result = (await getSqlDashboard.run(
      { id: "weekly", panelIds: ["p2", "nope"] },
      agent,
    )) as {
      panels: Array<{ id: string }>;
      panelDetails: Array<{ id: string; sql: string; config: unknown }>;
      missingPanelIds?: string[];
    };

    expect(result.panels.map((panel) => panel.id)).toEqual(["p1", "p2", "p3"]);
    expect(result.panelDetails.map((panel) => panel.id)).toEqual(["p2"]);
    expect(result.panelDetails[0].config).toEqual({ xKey: "week" });
    expect(result.missingPanelIds).toEqual(["nope"]);
    const text = JSON.stringify(result);
    expect(text).toContain("SELECT 'p2'");
    expect(text).not.toContain("SELECT 'p1'");
    expect(text).not.toContain("SELECT 'p3'");
  });

  it("tells an agent which panels were left out when the full config is too large", async () => {
    const panels = Array.from({ length: 10 }, (_, index) =>
      sqlPanel(`p${index}`, 2_000),
    );
    mocks.getDashboard.mockResolvedValue(savedDashboard(panels));

    const result = (await getSqlDashboard.run(
      { id: "weekly", includeConfig: true },
      agent,
    )) as {
      truncated?: boolean;
      omittedPanelIds?: string[];
      hint?: string;
      panels: Array<Record<string, unknown>>;
    };

    expect(result.truncated).toBe(true);
    expect(result.omittedPanelIds).toEqual(panels.map((panel) => panel.id));
    expect(result.hint).toContain("panelIds");
    expect(result.panels.every((panel) => !("sql" in panel))).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(12_000);
  });

  it("returns the whole config to the UI however large it is", async () => {
    const panels = Array.from({ length: 10 }, (_, index) =>
      sqlPanel(`p${index}`, 2_000),
    );
    mocks.getDashboard.mockResolvedValue(savedDashboard(panels));

    const result = (await getSqlDashboard.run(
      { id: "weekly", includeConfig: true },
      frontend,
    )) as { truncated?: boolean; panels: Array<{ sql?: string }> };

    expect(result.truncated).toBeUndefined();
    expect(result.panels.every((panel) => typeof panel.sql === "string")).toBe(
      true,
    );
  });

  it("returns a small full config to an agent untruncated", async () => {
    mocks.getDashboard.mockResolvedValue(
      savedDashboard([sqlPanel("p1"), sqlPanel("p2")]),
    );

    const result = (await getSqlDashboard.run(
      { id: "weekly", includeConfig: true },
      agent,
    )) as { truncated?: boolean; panels: Array<{ sql?: string }> };

    expect(result.truncated).toBeUndefined();
    expect(result.panels.map((panel) => typeof panel.sql)).toEqual([
      "string",
      "string",
    ]);
  });

  it("drops owner, org, and audit fields from the agent projection only", async () => {
    mocks.getDashboard.mockResolvedValue(savedDashboard([sqlPanel("p1")]));

    const forAgent = (await getSqlDashboard.run(
      { id: "weekly", includeConfig: true },
      agent,
    )) as Record<string, unknown>;
    const forUi = (await getSqlDashboard.run(
      { id: "weekly" },
      frontend,
    )) as Record<string, unknown>;

    for (const key of [
      "ownerEmail",
      "orgId",
      "createdAt",
      "createdBy",
      "hiddenAt",
      "hiddenBy",
      "updatedBy",
    ]) {
      expect(forAgent).not.toHaveProperty(key);
    }
    expect(forAgent.revision).toBe("2026-06-25T00:00:00.000Z");
    expect(forAgent.updatedAt).toBe("2026-06-25T00:00:00.000Z");
    expect(forAgent.role).toBe("owner");
    expect(forUi.ownerEmail).toBe("alice@example.com");
    expect(forUi.createdBy).toBe("alice@example.com");
  });
});
