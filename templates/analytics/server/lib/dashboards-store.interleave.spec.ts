import { beforeEach, describe, expect, it, vi } from "vitest";

type DashboardRow = {
  id: string;
  kind: string;
  title: string;
  config: string;
  ownerEmail: string;
  orgId: string | null;
  visibility: string;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
};

function panel(id: string) {
  return {
    id,
    title: id,
    source: "first-party",
    chartType: "metric",
    width: 1,
    sql: "SELECT COUNT(*) AS value FROM analytics_events",
  };
}

function baseDashboard(): DashboardRow {
  return {
    id: "traffic",
    kind: "sql",
    title: "Traffic",
    config: JSON.stringify({ name: "Traffic", panels: [panel("a")] }),
    ownerEmail: "alice@example.com",
    orgId: null,
    visibility: "private",
    createdAt: "2026-07-09T00:00:00.000Z",
    createdBy: "alice@example.com" as string | null,
    updatedAt: "2026-07-09T00:00:00.000Z",
    updatedBy: null,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
  };
}

const state = vi.hoisted(() => ({
  dashboard: {
    id: "traffic",
    kind: "sql",
    title: "Traffic",
    config: JSON.stringify({ name: "Traffic", panels: [{ id: "a" }] }),
    ownerEmail: "alice@example.com",
    orgId: null as string | null,
    visibility: "private",
    createdAt: "2026-07-09T00:00:00.000Z",
    createdBy: "alice@example.com" as string | null,
    updatedAt: "2026-07-09T00:00:00.000Z",
    updatedBy: null as string | null,
    archivedAt: null as string | null,
    hiddenAt: null as string | null,
    hiddenBy: null as string | null,
  },
  analysis: {
    id: "analysis-1",
    name: "Conversion analysis",
    description: "",
    question: "Which channel converts best?",
    instructions: "Compare conversion rates.",
    dataSources: JSON.stringify(["analytics_events"]),
    resultMarkdown: "Email converts best.",
    resultData: null as string | null,
    author: "alice@example.com" as string | null,
    ownerEmail: "alice@example.com",
    orgId: null as string | null,
    visibility: "private",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    hiddenAt: null as string | null,
    hiddenBy: null as string | null,
  },
  revisions: [] as any[],
  analysisRevisions: [] as any[],
  otherDashboards: [] as DashboardRow[],
  loseNextCas: false,
  alwaysLoseCas: false,
  updateAttempts: 0,
  peerAfterNextUpdate: false,
  inTransaction: false,
  writes: [] as Array<{ table: string; inTransaction: boolean }>,
}));

function columnName(column: unknown): string | null {
  if (!column || typeof column !== "object") return null;
  return (column as { name?: string }).name ?? null;
}

function matchesRow(predicate: unknown, row: Record<string, unknown>): boolean {
  if (!predicate || typeof predicate !== "object") return true;
  const p = predicate as {
    kind?: string;
    column?: unknown;
    value?: unknown;
    conditions?: unknown[];
  };
  if (p.kind === "and") {
    return (p.conditions ?? []).every((condition) =>
      matchesRow(condition, row),
    );
  }
  if (p.kind === "eq") {
    const name = columnName(p.column);
    return name ? row[name] === p.value : true;
  }
  return true;
}

function rowsResult(rows: unknown[]) {
  const result: any = Promise.resolve(rows);
  result.orderBy = () => rowsResult(rows);
  result.limit = () => rowsResult(rows);
  return result;
}

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
  isNotNull: (column: unknown) => ({ kind: "isNotNull", column }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: [...strings],
    values,
  }),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestRunContext: () => undefined,
  recordChange: () => undefined,
}));

vi.mock("@agent-native/core/settings", () => ({
  listSettingsByPrefix: async () => [],
  getOrgSetting: async () => null,
  getUserSetting: async () => null,
  deleteOrgSetting: async () => undefined,
  deleteUserSetting: async () => undefined,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    accessFilter: () => ({ kind: "access" }),
    resolveAccess: async (_resourceType: string, id: string) =>
      id === state.dashboard.id
        ? {
            role: "editor",
            resource: { ...state.dashboard },
          }
        : id === state.analysis.id
          ? {
              role: "editor",
              resource: { ...state.analysis },
            }
          : null,
    assertAccess: async () => ({ role: "editor" }),
  };
});

vi.mock("../db/index.js", () => {
  const schema = {
    dashboards: {
      id: { name: "id" },
      kind: { name: "kind" },
      title: { name: "title" },
      config: { name: "config" },
      ownerEmail: { name: "ownerEmail" },
      orgId: { name: "orgId" },
      visibility: { name: "visibility" },
      createdAt: { name: "createdAt" },
      createdBy: { name: "createdBy" },
      updatedAt: { name: "updatedAt" },
      updatedBy: { name: "updatedBy" },
      archivedAt: { name: "archivedAt" },
      hiddenAt: { name: "hiddenAt" },
      hiddenBy: { name: "hiddenBy" },
    },
    dashboardNameLocks: {
      nameKey: { name: "nameKey" },
      createdAt: { name: "createdAt" },
    },
    dashboardShares: {},
    dashboardRevisions: {
      id: { name: "id" },
      dashboardId: { name: "dashboardId" },
      kind: { name: "kind" },
      title: { name: "title" },
      config: { name: "config" },
      createdAt: { name: "createdAt" },
      createdBy: { name: "createdBy" },
      chatContext: { name: "chatContext" },
      changeSummary: { name: "changeSummary" },
    },
    analysisRevisions: {
      id: { name: "id" },
      analysisId: { name: "analysisId" },
      name: { name: "name" },
      description: { name: "description" },
      question: { name: "question" },
      instructions: { name: "instructions" },
      dataSources: { name: "dataSources" },
      resultMarkdown: { name: "resultMarkdown" },
      resultData: { name: "resultData" },
      createdAt: { name: "createdAt" },
      createdBy: { name: "createdBy" },
      chatContext: { name: "chatContext" },
    },
    // Not exercised by these tests, but `dashboards-store.ts` builds a
    // module-scope column-projection constant (`analysisListColumns`) from
    // `schema.analyses` at import time, so it must exist to avoid a crash
    // on import.
    analyses: {
      id: { name: "id" },
      name: { name: "name" },
      description: { name: "description" },
      question: { name: "question" },
      instructions: { name: "instructions" },
      dataSources: { name: "dataSources" },
      author: { name: "author" },
      ownerEmail: { name: "ownerEmail" },
      orgId: { name: "orgId" },
      visibility: { name: "visibility" },
      createdAt: { name: "createdAt" },
      updatedAt: { name: "updatedAt" },
      hiddenAt: { name: "hiddenAt" },
      hiddenBy: { name: "hiddenBy" },
    },
  };

  const db = {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          if (table === schema.dashboardRevisions) {
            return rowsResult(
              state.revisions.filter((r) => matchesRow(predicate, r)),
            );
          }
          if (table === schema.analysisRevisions) {
            return rowsResult(
              state.analysisRevisions.filter((r) => matchesRow(predicate, r)),
            );
          }
          if (table === schema.analyses) {
            return rowsResult(
              [state.analysis]
                .filter((row) => matchesRow(predicate, row))
                .map((row) => ({ ...row })),
            );
          }
          return rowsResult(
            [state.dashboard, ...state.otherDashboards]
              .filter((row) => matchesRow(predicate, row))
              .map((row) => ({ ...row, name: row.title })),
          );
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: any) => {
        let insertedDashboard: DashboardRow | undefined;
        if (table === schema.dashboards) {
          const timestamp = "2026-07-09T00:00:00.000Z";
          const dashboard: DashboardRow = {
            archivedAt: null,
            createdAt: timestamp,
            createdBy: row.createdBy ?? null,
            hiddenAt: null,
            hiddenBy: null,
            updatedAt: timestamp,
            ...row,
          };
          insertedDashboard = dashboard;
          state.otherDashboards.push(dashboard);
        }
        if (table === schema.dashboardRevisions) {
          state.revisions.push({ ...row });
          state.writes.push({
            table: "dashboardRevisions",
            inTransaction: state.inTransaction,
          });
        }
        if (table === schema.analysisRevisions) {
          state.analysisRevisions.push({ ...row });
        }
        const p: any = Promise.resolve(undefined);
        p.onConflictDoNothing = async () => undefined;
        p.returning = async () =>
          insertedDashboard ? [{ ...insertedDashboard }] : [];
        return p;
      },
    }),
    execute: async () => undefined,
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        if (table === schema.dashboardRevisions) {
          state.revisions = state.revisions.filter(
            (r) => !matchesRow(predicate, r),
          );
        }
        if (table === schema.analysisRevisions) {
          state.analysisRevisions = state.analysisRevisions.filter(
            (r) => !matchesRow(predicate, r),
          );
        }
        return undefined;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: unknown) => {
          let returnedDashboard: DashboardRow | undefined;
          const operation = (async () => {
            if (table === schema.analyses) {
              if (!matchesRow(predicate, state.analysis)) {
                return { rowsAffected: 0 };
              }
              state.analysis = { ...state.analysis, ...values };
              return { rowsAffected: 1 };
            }
            if (table === schema.dashboardRevisions) {
              state.revisions = state.revisions.map((row) =>
                matchesRow(predicate, row) ? { ...row, ...values } : row,
              );
              return { rowsAffected: 1 };
            }
            if (table !== schema.dashboards) return { rowsAffected: 0 };
            state.updateAttempts += 1;
            state.writes.push({
              table: "dashboards",
              inTransaction: state.inTransaction,
            });
            if (state.alwaysLoseCas) {
              state.dashboard = {
                ...state.dashboard,
                updatedAt: `2026-07-09T00:00:00.${String(state.updateAttempts).padStart(3, "0")}Z`,
              };
              return { rowsAffected: 0 };
            }
            if (state.loseNextCas) {
              state.loseNextCas = false;
              const concurrentConfig = JSON.parse(state.dashboard.config);
              state.dashboard = {
                ...state.dashboard,
                config: JSON.stringify({
                  ...concurrentConfig,
                  panels: [
                    ...(concurrentConfig.panels ?? []),
                    panel("writer-a"),
                  ],
                }),
                updatedAt: "2026-07-09T00:00:00.001Z",
                updatedBy: "bob@example.com",
              };
              return { rowsAffected: 0 };
            }
            if (!matchesRow(predicate, state.dashboard)) {
              return { rowsAffected: 0 };
            }
            state.dashboard = { ...state.dashboard, ...values } as DashboardRow;
            returnedDashboard = { ...state.dashboard };
            if (state.peerAfterNextUpdate) {
              state.peerAfterNextUpdate = false;
              const writtenConfig = JSON.parse(state.dashboard.config);
              state.dashboard = {
                ...state.dashboard,
                config: JSON.stringify({
                  ...writtenConfig,
                  panels: [
                    ...(writtenConfig.panels ?? []),
                    panel("writer-after"),
                  ],
                }),
                updatedAt: "2026-07-09T00:00:00.002Z",
                updatedBy: "bob@example.com",
              };
            }
            return { rowsAffected: 1 };
          })();
          const result: any = operation;
          result.returning = async () => {
            await operation;
            return returnedDashboard ? [{ ...returnedDashboard }] : [];
          };
          return result;
        },
      }),
    }),
    transaction: async (callback: (transactionDb: any) => unknown) => {
      state.inTransaction = true;
      try {
        return await callback(db);
      } finally {
        state.inTransaction = false;
      }
    },
  };

  return { schema, getDb: () => db };
});

const {
  getDashboard,
  upsertDashboard,
  upsertDashboardOutcome,
  upsertDashboardWithRetry,
  upsertDashboardWithRetryOutcome,
  upsertAnalysis,
  createDashboardRevisionSnapshot,
  createAnalysisRevisionSnapshot,
  persistDashboardVisibilityChange,
  unarchiveDashboard,
  DashboardConflictError,
  DASHBOARD_SAVE_MAX_ATTEMPTS,
  listDashboardRevisionMetadata,
  parseRevisionChatContextMetadata,
  restoreDashboardRevision,
} = await import("./dashboards-store.js");

const ctx = { email: "alice@example.com", orgId: null };

function readPanelIds(): string[] {
  const config = JSON.parse(state.dashboard.config) as {
    panels: Array<{ id: string }>;
  };
  return config.panels.map((p) => p.id);
}

beforeEach(() => {
  state.dashboard = baseDashboard();
  state.analysis = {
    ...state.analysis,
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
  state.revisions = [];
  state.analysisRevisions = [];
  state.otherDashboards = [];
  state.loseNextCas = false;
  state.alwaysLoseCas = false;
  state.updateAttempts = 0;
  state.peerAfterNextUpdate = false;
  state.inTransaction = false;
  state.writes = [];
});

describe("dashboards-store concurrency", () => {
  it("skips an identical dashboard save without updating or creating history", async () => {
    const saved = await upsertDashboard(
      "traffic",
      "sql",
      { name: "Traffic", panels: [panel("a")] },
      ctx,
      state.dashboard.updatedAt,
    );

    expect(saved.updatedAt).toBe("2026-07-09T00:00:00.000Z");
    expect(state.updateAttempts).toBe(0);
    expect(state.revisions).toEqual([]);
  });

  it("advances fenced write tokens when two saves share a millisecond", async () => {
    const expectedUpdatedAt = state.dashboard.updatedAt;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(expectedUpdatedAt));

    try {
      const first = await upsertDashboard(
        "traffic",
        "sql",
        { name: "Traffic", panels: [panel("a"), panel("writer-one")] },
        ctx,
        expectedUpdatedAt,
      );

      expect(first.updatedAt).toBe("2026-07-09T00:00:00.001Z");
      await expect(
        upsertDashboard(
          "traffic",
          "sql",
          { name: "Traffic", panels: [panel("a"), panel("writer-two")] },
          ctx,
          expectedUpdatedAt,
        ),
      ).rejects.toBeInstanceOf(DashboardConflictError);
      expect(readPanelIds()).toEqual(["a", "writer-one"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces an unchanged dashboard autosave with the latest revision", async () => {
    state.revisions = [
      {
        id: "dashboard-revision-1",
        dashboardId: "traffic",
        kind: "sql",
        title: "Traffic",
        config: state.dashboard.config,
        createdAt: "2026-07-09T00:01:00.000Z",
        createdBy: "alice@example.com",
        chatContext: null,
      },
    ];

    await expect(createDashboardRevisionSnapshot("traffic", ctx)).resolves.toBe(
      "dashboard-revision-1",
    );
    expect(state.revisions).toHaveLength(1);
  });

  it("skips an identical analysis save without updating or creating history", async () => {
    const saved = await upsertAnalysis(
      "analysis-1",
      {
        name: state.analysis.name,
        description: state.analysis.description,
        question: state.analysis.question,
        instructions: state.analysis.instructions,
        dataSources: JSON.parse(state.analysis.dataSources),
        resultMarkdown: state.analysis.resultMarkdown,
        resultData: null,
      },
      ctx,
      state.analysis.updatedAt,
    );

    expect(saved.updatedAt).toBe("2026-07-09T00:00:00.000Z");
    expect(state.analysisRevisions).toEqual([]);
  });

  it("repairs malformed analysis JSON instead of trusting normalized fallbacks", async () => {
    state.analysis.dataSources = "{malformed";
    state.analysis.resultData = "{malformed";

    await upsertAnalysis(
      "analysis-1",
      { dataSources: [], resultData: null },
      ctx,
      state.analysis.updatedAt,
    );

    expect(state.analysis.dataSources).toBe("[]");
    expect(state.analysis.resultData).toBeNull();
  });

  it("coalesces an unchanged analysis autosave with the latest revision", async () => {
    state.analysisRevisions = [
      {
        id: "analysis-revision-1",
        analysisId: "analysis-1",
        name: state.analysis.name,
        description: state.analysis.description,
        question: state.analysis.question,
        instructions: state.analysis.instructions,
        dataSources: state.analysis.dataSources,
        resultMarkdown: state.analysis.resultMarkdown,
        resultData: null,
        createdAt: "2026-07-09T00:01:00.000Z",
        createdBy: "alice@example.com",
        chatContext: null,
      },
    ];

    await expect(
      createAnalysisRevisionSnapshot("analysis-1", ctx),
    ).resolves.toBe("analysis-1");
    expect(state.analysisRevisions).toHaveLength(1);
  });

  it("rejects a new dashboard name already used by a visible dashboard", async () => {
    state.otherDashboards = [
      {
        ...baseDashboard(),
        id: "revenue",
        title: "Revenue",
        config: JSON.stringify({ name: "Revenue", panels: [] }),
        ownerEmail: "bob@example.com",
        visibility: "org",
      },
    ];

    await expect(
      upsertDashboard(
        "new-revenue",
        "sql",
        { name: " revenue ", panels: [] },
        { email: "alice@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow(
      'Dashboard name "revenue" is already used by visible dashboard "Revenue"',
    );
    expect(state.updateAttempts).toBe(0);
  });

  it("rejects restoring an archived dashboard into a visible name collision", async () => {
    state.dashboard = {
      ...baseDashboard(),
      archivedAt: "2026-07-09T00:01:00.000Z",
    };
    state.otherDashboards = [
      {
        ...baseDashboard(),
        id: "traffic-copy",
        ownerEmail: "bob@example.com",
      },
    ];

    await expect(
      unarchiveDashboard("traffic", {
        email: "alice@example.com",
        orgId: null,
      }),
    ).rejects.toThrow(
      'Dashboard name "Traffic" is already used by visible dashboard "Traffic"',
    );
  });

  it("rejects promoting a private duplicate to a visible dashboard", async () => {
    state.otherDashboards = [
      {
        ...baseDashboard(),
        id: "traffic-copy",
        ownerEmail: "bob@example.com",
        visibility: "private",
      },
    ];

    await expect(
      persistDashboardVisibilityChange(
        { id: "traffic", title: "Traffic", orgId: "org-1" },
        "org",
        { visibility: "org", orgId: "org-1" },
        { email: "alice@example.com", orgId: "org-1" },
      ),
    ).rejects.toThrow(
      'Dashboard name "Traffic" is already used by visible dashboard "Traffic"',
    );
    expect(state.dashboard.visibility).toBe("private");
  });

  it("keeps an existing duplicate editable so it can be renamed away", async () => {
    state.otherDashboards = [
      {
        ...baseDashboard(),
        id: "traffic-copy",
        ownerEmail: "bob@example.com",
      },
    ];

    await expect(
      upsertDashboard(
        "traffic",
        "sql",
        { name: "Traffic", panels: [panel("a"), panel("b")] },
        ctx,
      ),
    ).resolves.toBeDefined();
    expect(readPanelIds()).toEqual(["a", "b"]);
  });

  it("fences the write and rejects a stale expectedUpdatedAt", async () => {
    const existing = await getDashboard("traffic", ctx);
    expect(existing).not.toBeNull();

    await upsertDashboard(
      "traffic",
      "sql",
      { name: "Traffic", panels: [panel("a"), panel("b")] },
      ctx,
      existing!.updatedAt,
    );
    expect(readPanelIds()).toEqual(["a", "b"]);

    await expect(
      upsertDashboard(
        "traffic",
        "sql",
        { name: "Traffic", panels: [panel("a"), panel("c")] },
        ctx,
        existing!.updatedAt,
      ),
    ).rejects.toBeInstanceOf(DashboardConflictError);
    expect(readPanelIds()).toEqual(["a", "b"]);
  });

  it("reports the revision a save left, holding the dashboard from before it and what the save changed", async () => {
    const outcome = await upsertDashboardOutcome(
      "traffic",
      "sql",
      { name: "Traffic", panels: [panel("a"), panel("b")] },
      ctx,
      state.dashboard.updatedAt,
    );

    const revision = state.revisions.find(
      (row) => row.id === outcome.revisionId,
    );
    expect(JSON.parse(revision.config).panels.map((p: any) => p.id)).toEqual([
      "a",
    ]);
    expect(outcome.changeSummary).toEqual({
      changes: [{ kind: "panel-added", title: "b" }],
      omitted: 0,
    });
    expect(JSON.parse(revision.changeSummary)).toEqual(outcome.changeSummary);

    const unchanged = await upsertDashboardOutcome(
      "traffic",
      "sql",
      { name: "Traffic", panels: [panel("a"), panel("b")] },
      ctx,
      outcome.dashboard.updatedAt,
    );
    expect(unchanged.didWrite).toBe(false);
    expect(unchanged.revisionId).toBeUndefined();
    expect(unchanged.changeSummary).toBeUndefined();
  });

  it("preserves legacy last-write-wins when expectedUpdatedAt is omitted", async () => {
    const existing = await getDashboard("traffic", ctx);
    state.dashboard = {
      ...state.dashboard,
      updatedAt: "2099-01-01T00:00:00.000Z",
    };

    const saved = await upsertDashboard(
      "traffic",
      "sql",
      { name: "Traffic", panels: [panel("a"), panel("legacy")] },
      ctx,
      // no expectedUpdatedAt — existing callers (legacy migration, revision
      // restore) keep unconditional overwrite behavior.
    );
    expect(saved.updatedAt).toBe("2099-01-01T00:00:00.001Z");
    expect(existing).not.toBeNull();
    expect(readPanelIds()).toEqual(["a", "legacy"]);
  });

  it("retries an unfenced last-write-wins save against the latest version", async () => {
    state.loseNextCas = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T00:00:00.000Z"));

    try {
      const saved = await upsertDashboard(
        "traffic",
        "sql",
        { name: "Traffic", panels: [panel("a"), panel("legacy")] },
        ctx,
      );

      expect(saved.updatedAt).toBe("2026-07-09T00:00:00.002Z");
      expect(state.dashboard.updatedAt).toBe(saved.updatedAt);
      expect(readPanelIds()).toEqual(["a", "legacy"]);
      expect(state.updateAttempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the original creator unchanged when another user edits the dashboard", async () => {
    await upsertDashboard(
      "traffic",
      "sql",
      { name: "Traffic", panels: [panel("a"), panel("editor")] },
      { email: "bob@example.com", orgId: null },
    );

    expect(state.dashboard.createdBy).toBe("alice@example.com");
    expect(state.dashboard.updatedBy).toBe("bob@example.com");
  });

  it("records the authenticated user as creator on dashboard creation", async () => {
    const saved = await upsertDashboard(
      "new-dashboard",
      "sql",
      { name: "New dashboard", panels: [] },
      { email: "bob@example.com", orgId: null },
    );

    expect(saved.createdBy).toBe("bob@example.com");
    expect(state.otherDashboards[0]?.createdBy).toBe("bob@example.com");
  });

  it("reports a peer's convergent write as a conflict retry with no local write", async () => {
    let mutateCalls = 0;
    const outcome = await upsertDashboardWithRetryOutcome(
      "traffic",
      ctx,
      (existing) => {
        mutateCalls += 1;
        const config = existing.config as {
          name: string;
          panels: Array<Record<string, unknown>>;
        };
        const body = {
          ...config,
          panels: config.panels.map((item) =>
            item.id === "a" ? { ...item, title: "writer-a" } : item,
          ),
        };
        if (mutateCalls === 1) {
          state.dashboard = {
            ...state.dashboard,
            config: JSON.stringify(body),
            updatedAt: "2026-07-09T00:00:00.001Z",
            updatedBy: "bob@example.com",
          };
        }
        return { kind: "sql" as const, body };
      },
    );

    expect(mutateCalls).toBe(2);
    expect(outcome.didWrite).toBe(false);
    expect(outcome.dashboard.updatedBy).toBe("bob@example.com");
    expect(
      (outcome.dashboard.config as { panels: Array<{ title: string }> })
        .panels[0].title,
    ).toBe("writer-a");
    expect(readPanelIds()).toEqual(["a"]);
    expect(state.updateAttempts).toBe(0);
    expect(state.revisions).toEqual([]);
  });

  it("returns this write's config when a peer updates immediately afterward", async () => {
    state.peerAfterNextUpdate = true;
    const ownConfig = {
      name: "Traffic",
      panels: [panel("a"), panel("writer-this")],
    };

    const outcome = await upsertDashboardWithRetryOutcome(
      "traffic",
      ctx,
      () => ({ kind: "sql", body: ownConfig }),
    );

    expect(outcome.didWrite).toBe(true);
    expect(
      (
        outcome.dashboard.config as { panels: Array<{ id: string }> }
      ).panels.map(({ id }) => id),
    ).toEqual(["a", "writer-this"]);
    expect(readPanelIds()).toEqual(["a", "writer-this", "writer-after"]);
    expect(state.dashboard.updatedBy).toBe("bob@example.com");
  });

  it("upsertDashboardWithRetry re-reads and re-applies the mutation after losing the race, landing both writers' panels", async () => {
    state.loseNextCas = true;

    const saved = await upsertDashboardWithRetry("traffic", ctx, (existing) => {
      const config = existing.config as { name: string; panels: unknown[] };
      return {
        kind: "sql" as const,
        body: {
          ...config,
          panels: [...config.panels, panel("writer-b")],
        },
      };
    });

    const ids = (saved.config as { panels: Array<{ id: string }> }).panels.map(
      (p) => p.id,
    );
    expect(ids).toEqual(["a", "writer-a", "writer-b"]);
    expect(readPanelIds()).toEqual(["a", "writer-a", "writer-b"]);
    expect(state.updateAttempts).toBe(2);
  });

  it("gives up with a clear error after repeated conflicts instead of looping forever", async () => {
    state.alwaysLoseCas = true;

    await expect(
      upsertDashboardWithRetry("traffic", ctx, (existing) => {
        const config = existing.config as { name: string; panels: unknown[] };
        return {
          kind: "sql" as const,
          body: { ...config, panels: [...config.panels, panel("never-lands")] },
        };
      }),
    ).rejects.toThrow(/Could not save dashboard "traffic"/);

    expect(state.updateAttempts).toBe(DASHBOARD_SAVE_MAX_ATTEMPTS);
    expect(readPanelIds()).toEqual(["a"]);
  });
});

describe("revision chat metadata", () => {
  it("keeps dashboard history readable when optional legacy context is corrupt", async () => {
    state.revisions = [
      {
        id: "broken",
        dashboardId: "traffic",
        kind: "sql",
        title: "Broken context",
        createdAt: "2026-07-09T00:02:00.000Z",
        createdBy: null,
        chatContext: "not-json",
      },
      {
        id: "without-context",
        dashboardId: "traffic",
        kind: "sql",
        title: "No context",
        createdAt: "2026-07-09T00:01:00.000Z",
        createdBy: null,
        chatContext: null,
      },
    ];

    await expect(
      listDashboardRevisionMetadata("traffic", ctx),
    ).resolves.toMatchObject([
      { id: "broken", chatContext: null, chatContextStatus: "unreadable" },
      { id: "without-context", chatContext: null, chatContextStatus: "absent" },
    ]);
  });

  it("distinguishes absent, valid, and unreadable change summaries", async () => {
    state.revisions = [
      {
        id: "summarized",
        dashboardId: "traffic",
        kind: "sql",
        title: "Traffic",
        createdAt: "2026-07-09T00:03:00.000Z",
        createdBy: null,
        chatContext: null,
        changeSummary: JSON.stringify({
          changes: [{ kind: "panel-added", title: "DAU" }],
          omitted: 2,
        }),
      },
      {
        id: "corrupt",
        dashboardId: "traffic",
        kind: "sql",
        title: "Traffic",
        createdAt: "2026-07-09T00:02:00.000Z",
        createdBy: null,
        chatContext: null,
        changeSummary: "not-json",
      },
      {
        id: "legacy",
        dashboardId: "traffic",
        kind: "sql",
        title: "Traffic",
        createdAt: "2026-07-09T00:01:00.000Z",
        createdBy: null,
        chatContext: null,
      },
    ];

    const [summarized, corrupt, legacy] = await listDashboardRevisionMetadata(
      "traffic",
      ctx,
    );
    expect(summarized).toMatchObject({
      changesStatus: "valid",
      changes: [{ kind: "panel-added", title: "DAU" }],
      omittedChanges: 2,
    });
    expect(corrupt.changesStatus).toBe("unreadable");
    expect(corrupt).not.toHaveProperty("changes");
    expect(legacy.changesStatus).toBe("absent");
    expect(legacy).not.toHaveProperty("changes");
  });

  it("distinguishes absent, valid, and unreadable legacy context", () => {
    expect(parseRevisionChatContextMetadata(null)).toEqual({
      chatContext: null,
      chatContextStatus: "absent",
    });
    expect(parseRevisionChatContextMetadata('{"runId":"run-1"}')).toEqual({
      chatContext: { runId: "run-1" },
      chatContextStatus: "valid",
    });
    expect(parseRevisionChatContextMetadata("not-json")).toEqual({
      chatContext: null,
      chatContextStatus: "unreadable",
    });
  });
});

describe("revision change summaries", () => {
  function signupsTable(templateWidth: number) {
    return {
      name: "Traffic",
      panels: [
        {
          ...panel("signups"),
          title: "Signups by Template",
          chartType: "table",
          config: {
            columns: [{ key: "template", width: templateWidth }, { key: "n" }],
          },
        },
      ],
    };
  }

  it("records what a save changed on the revision it leaves behind", async () => {
    state.dashboard.config = JSON.stringify(signupsTable(120));

    await upsertDashboard(
      "traffic",
      "sql",
      signupsTable(220),
      ctx,
      state.dashboard.updatedAt,
    );

    expect(state.revisions).toHaveLength(1);
    expect(JSON.parse(state.revisions[0].config)).toEqual(signupsTable(120));
    await expect(
      listDashboardRevisionMetadata("traffic", ctx),
    ).resolves.toMatchObject([
      {
        createdBy: "alice@example.com",
        changesStatus: "valid",
        changes: [
          {
            kind: "column-resized",
            title: "Signups by Template",
            columns: 1,
            direction: "wider",
          },
        ],
        omittedChanges: 0,
      },
    ]);
  });

  it("keeps a save's change, author, and time when the state it replaces was already snapshotted", async () => {
    state.dashboard.config = JSON.stringify(signupsTable(120));
    await createDashboardRevisionSnapshot("traffic", ctx);
    const snapshotAt = state.revisions[0].createdAt;

    await upsertDashboard(
      "traffic",
      "sql",
      signupsTable(220),
      { email: "bob@example.com", orgId: null },
      state.dashboard.updatedAt,
    );

    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0].createdAt > snapshotAt).toBe(true);
    await expect(
      listDashboardRevisionMetadata("traffic", ctx),
    ).resolves.toMatchObject([
      {
        createdBy: "bob@example.com",
        changesStatus: "valid",
        changes: [{ kind: "column-resized", direction: "wider" }],
      },
    ]);
  });

  it("commits a save and the history entry it leaves together", async () => {
    state.dashboard.config = JSON.stringify(signupsTable(120));

    await upsertDashboard(
      "traffic",
      "sql",
      signupsTable(220),
      ctx,
      state.dashboard.updatedAt,
    );

    expect(state.writes).toEqual([
      { table: "dashboards", inTransaction: true },
      { table: "dashboardRevisions", inTransaction: true },
    ]);
  });

  it("describes a retried save against the version it actually replaced", async () => {
    state.dashboard.config = JSON.stringify(signupsTable(120));
    state.loseNextCas = true;

    await upsertDashboardWithRetry("traffic", ctx, (existing) => {
      const config = existing.config as ReturnType<typeof signupsTable>;
      return {
        kind: "sql" as const,
        body: {
          ...config,
          panels: config.panels.map((p) =>
            p.id === "signups" ? signupsTable(220).panels[0] : p,
          ),
        },
      };
    });

    expect(readPanelIds()).toEqual(["signups", "writer-a"]);
    expect(state.revisions).toHaveLength(1);
    await expect(
      listDashboardRevisionMetadata("traffic", ctx),
    ).resolves.toMatchObject([
      {
        changesStatus: "valid",
        changes: [{ kind: "column-resized", direction: "wider" }],
        omittedChanges: 0,
      },
    ]);
  });

  it("marks a restore and names what it put back", async () => {
    state.dashboard.config = JSON.stringify({
      name: "Traffic",
      panels: [panel("a"), panel("b")],
    });
    state.revisions = [
      {
        id: "before-b",
        dashboardId: "traffic",
        kind: "sql",
        title: "Traffic",
        config: JSON.stringify({ name: "Traffic", panels: [panel("a")] }),
        createdAt: "2026-07-09T00:01:00.000Z",
        createdBy: "alice@example.com",
        chatContext: null,
      },
    ];

    const restored = await restoreDashboardRevision("traffic", "before-b", ctx);

    const snapshot = state.revisions.find(
      (row) => row.id === restored?.snapshotRevisionId,
    );
    expect(JSON.parse(snapshot.changeSummary)).toEqual({
      changes: [
        { kind: "version-restored" },
        { kind: "panel-removed", title: "b" },
      ],
      omitted: 0,
    });
  });

  it("describes a restore against the version it actually replaced", async () => {
    state.dashboard.config = JSON.stringify({
      name: "Traffic",
      panels: [panel("a"), panel("b")],
    });
    state.revisions = [
      {
        id: "before-b",
        dashboardId: "traffic",
        kind: "sql",
        title: "Traffic",
        config: JSON.stringify({ name: "Traffic", panels: [panel("a")] }),
        createdAt: "2026-07-09T00:01:00.000Z",
        createdBy: "alice@example.com",
        chatContext: null,
      },
    ];
    // A peer adds a panel between the restore's read and its write.
    state.loseNextCas = true;

    const restored = await restoreDashboardRevision("traffic", "before-b", ctx);

    const snapshot = state.revisions.find(
      (row) => row.id === restored?.snapshotRevisionId,
    );
    expect(JSON.parse(snapshot.config).panels.map((p: any) => p.id)).toEqual([
      "a",
      "b",
      "writer-a",
    ]);
    expect(JSON.parse(snapshot.changeSummary).changes).toEqual([
      { kind: "version-restored" },
      { kind: "panel-removed", title: "b" },
      { kind: "panel-removed", title: "writer-a" },
    ]);
    expect(readPanelIds()).toEqual(["a"]);
  });

  it("moves the version forward on a restore even when the clock hasn't", async () => {
    const replaced = "2099-01-01T00:00:00.000Z";
    state.dashboard.updatedAt = replaced;
    state.revisions = [
      {
        id: "before-b",
        dashboardId: "traffic",
        kind: "sql",
        title: "Traffic",
        config: JSON.stringify({ name: "Traffic", panels: [] }),
        createdAt: "2026-07-09T00:01:00.000Z",
        createdBy: "alice@example.com",
        chatContext: null,
      },
    ];

    await restoreDashboardRevision("traffic", "before-b", ctx, replaced);

    expect(state.dashboard.updatedAt > replaced).toBe(true);
  });

  it("keeps a reused snapshot's link to the agent turn that produced it", async () => {
    state.dashboard.config = JSON.stringify(signupsTable(120));
    await createDashboardRevisionSnapshot("traffic", ctx, {
      threadId: "thread-1",
      turnId: "turn-1",
    });

    await upsertDashboard(
      "traffic",
      "sql",
      signupsTable(220),
      { email: "bob@example.com", orgId: null },
      state.dashboard.updatedAt,
    );

    await expect(
      listDashboardRevisionMetadata("traffic", ctx),
    ).resolves.toMatchObject([
      {
        createdBy: "bob@example.com",
        chatContext: { threadId: "thread-1", turnId: "turn-1" },
      },
    ]);
  });

  it("records no change for a snapshot taken outside a save", async () => {
    await createDashboardRevisionSnapshot("traffic", ctx);

    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0].changeSummary).toBeUndefined();
    await expect(
      listDashboardRevisionMetadata("traffic", ctx),
    ).resolves.toMatchObject([{ changesStatus: "absent" }]);
  });
});
