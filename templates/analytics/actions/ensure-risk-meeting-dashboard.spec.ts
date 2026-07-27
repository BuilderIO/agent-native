import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const programsByAppOwnerName = new Map<string, any>();
  const programsById = new Map<string, any>();
  const dashboards = new Map<string, any>();
  let programSeq = 0;

  const keyFor = (
    email: string,
    orgId: string | null | undefined,
    dashboardId: string,
  ) => `${email}:${orgId ?? ""}:${dashboardId}`;
  const programKey = (appId: string, ownerEmail: string, name: string) =>
    `${appId}:${ownerEmail}:${name}`;

  return {
    programsByAppOwnerName,
    programsById,
    dashboards,
    keyFor,
    programKey,
    reset() {
      programsByAppOwnerName.clear();
      programsById.clear();
      dashboards.clear();
      programSeq = 0;
    },
    upsertDataProgram: vi.fn(async (input: any) => {
      const pKey = programKey(input.appId, input.ownerEmail, input.name);
      const existing = programsByAppOwnerName.get(pKey);
      const now = new Date().toISOString();
      if (existing) {
        const updated = {
          ...existing,
          title: input.title,
          description: input.description ?? existing.description,
          code: input.code,
          refreshMode: input.refreshMode ?? existing.refreshMode,
          refreshTtlMs: input.refreshTtlMs ?? existing.refreshTtlMs,
          background: Boolean(input.background),
          updatedAt: now,
        };
        programsByAppOwnerName.set(pKey, updated);
        programsById.set(updated.id, updated);
        return updated;
      }
      programSeq += 1;
      const id = `dp_${programSeq}`;
      const row = {
        id,
        appId: input.appId,
        name: input.name,
        title: input.title,
        description: input.description ?? "",
        code: input.code,
        refreshMode: input.refreshMode ?? "ttl",
        refreshTtlMs: input.refreshTtlMs ?? 300_000,
        background: Boolean(input.background),
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        ownerEmail: input.ownerEmail,
        orgId: input.orgId ?? null,
        visibility: "private",
      };
      programsByAppOwnerName.set(pKey, row);
      programsById.set(id, row);
      return row;
    }),
    getDashboard: vi.fn(
      async (
        dashboardId: string,
        ctx: { email: string; orgId: string | null },
      ) => dashboards.get(keyFor(ctx.email, ctx.orgId, dashboardId)) ?? null,
    ),
    upsertDashboard: vi.fn(
      async (
        dashboardId: string,
        kind: string,
        config: Record<string, unknown>,
        ctx: { email: string; orgId: string | null },
      ) => {
        const row = {
          id: dashboardId,
          kind,
          title: String((config as any).name ?? dashboardId),
          config,
          archivedAt: null,
          orgId: ctx.orgId,
          ownerEmail: ctx.email,
        };
        dashboards.set(keyFor(ctx.email, ctx.orgId, dashboardId), row);
        return row;
      },
    ),
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: vi.fn((def: unknown) => def),
  embedApp: vi.fn((value: unknown) => value),
}));

vi.mock("@agent-native/core/server", () => ({
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
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/data-programs", () => ({
  upsertDataProgram: mocks.upsertDataProgram,
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
}));

const { ensureRiskMeetingDashboard } =
  await import("./ensure-risk-meeting-dashboard");

const CTX = { email: "alice@example.com", orgId: null as string | null };

describe("ensureRiskMeetingDashboard", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.upsertDataProgram.mockClear();
    mocks.getDashboard.mockClear();
    mocks.upsertDashboard.mockClear();
  });

  it("creates both data programs and a two-panel Risk Meeting dashboard on first run", async () => {
    const result = await ensureRiskMeetingDashboard(CTX);

    expect(result.dashboardId).toBe("risk-meeting");
    expect(result.created).toBe(true);
    expect(Object.keys(result.programIds).sort()).toEqual(
      ["risk-meeting-cohort", "risk-meeting-pylon-early-warning"].sort(),
    );

    // Two programs saved.
    expect(mocks.upsertDataProgram).toHaveBeenCalledTimes(2);
    const savedNames = mocks.upsertDataProgram.mock.calls.map(
      (call) => call[0].name,
    );
    expect(savedNames.sort()).toEqual(
      ["risk-meeting-cohort", "risk-meeting-pylon-early-warning"].sort(),
    );

    // Every saved program is scoped to the caller and the analytics app,
    // uses ttl refresh at the documented 15-minute interval, and is
    // foreground (non-background).
    for (const call of mocks.upsertDataProgram.mock.calls) {
      const input = call[0];
      expect(input.appId).toBe("analytics");
      expect(input.ownerEmail).toBe("alice@example.com");
      expect(input.orgId).toBeNull();
      expect(input.refreshMode).toBe("ttl");
      expect(input.refreshTtlMs).toBe(900_000);
      expect(input.background).toBe(false);
      expect(typeof input.code).toBe("string");
      expect(input.code.length).toBeGreaterThan(0);
      // The program source is stored code, not a vendor-specific action —
      // it must reference the generic sandbox globals, not any bespoke
      // hubspot-deals/pylon action wrapper.
      expect(input.code).toMatch(/providerFetchAll?\(/);
      expect(input.code).toMatch(/emit\(/);
    }

    // Dashboard saved once, with two panels bound to the two program ids
    // via the "program" source and a JSON-encoded { programId } descriptor.
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const [dashboardId, kind, config] = mocks.upsertDashboard.mock.calls[0] as [
      string,
      string,
      { panels: { source: string; chartType: string; sql: string }[] },
      { email: string; orgId: string | null },
    ];
    expect(dashboardId).toBe("risk-meeting");
    expect(kind).toBe("sql");
    expect(config.panels).toHaveLength(2);
    for (const panel of config.panels) {
      expect(panel.source).toBe("program");
      expect(panel.chartType).toBe("table");
      const descriptor = JSON.parse(panel.sql);
      expect(typeof descriptor.programId).toBe("string");
      expect(descriptor.programId.length).toBeGreaterThan(0);
    }
    const programIdsInPanels = config.panels.map(
      (panel) => JSON.parse(panel.sql).programId,
    );
    expect(new Set(programIdsInPanels).size).toBe(2);
    expect(programIdsInPanels).toContain(
      result.programIds["risk-meeting-cohort"],
    );
    expect(programIdsInPanels).toContain(
      result.programIds["risk-meeting-pylon-early-warning"],
    );
  });

  it("is idempotent: a second call updates the same programs and dashboard instead of duplicating them", async () => {
    const first = await ensureRiskMeetingDashboard(CTX);
    mocks.upsertDataProgram.mockClear();
    mocks.upsertDashboard.mockClear();

    const second = await ensureRiskMeetingDashboard(CTX);

    expect(second.created).toBe(false);
    expect(second.dashboardId).toBe(first.dashboardId);
    // Same program ids reused across the two runs (upsert-by-name, not
    // create-a-new-row-every-time).
    expect(second.programIds).toEqual(first.programIds);

    // Still only ever one row per program name / one dashboard row.
    expect(mocks.upsertDataProgram).toHaveBeenCalledTimes(2);
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.dashboards.size).toBe(1);
    expect(mocks.programsByAppOwnerName.size).toBe(2);
  });

  it("scopes programs and the dashboard to the caller's ownership (not a shared/global owner)", async () => {
    const bobCtx = { email: "bob@example.com", orgId: "org_42" };
    await ensureRiskMeetingDashboard(CTX);
    await ensureRiskMeetingDashboard(bobCtx);

    // Two independent owners produce two independent sets of program rows —
    // never cross-owner reuse.
    expect(mocks.programsByAppOwnerName.size).toBe(4);
    for (const call of mocks.upsertDataProgram.mock.calls) {
      const input = call[0];
      if (input.ownerEmail === "bob@example.com") {
        expect(input.orgId).toBe("org_42");
      }
    }
    expect(mocks.dashboards.size).toBe(2);
  });

  it("throws when there is no authenticated user", async () => {
    await expect(
      ensureRiskMeetingDashboard({ email: "", orgId: null }),
    ).rejects.toThrow(/no authenticated user/i);
    expect(mocks.upsertDataProgram).not.toHaveBeenCalled();
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });
});
