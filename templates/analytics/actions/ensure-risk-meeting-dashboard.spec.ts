import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const programsByAppOwnerName = new Map<string, any>();
  const programsById = new Map<string, any>();
  const settings = new Map<string, Record<string, unknown>>();
  let programSeq = 0;

  const mutate =
    (scope: string) =>
    async (
      id: string,
      key: string,
      update: (current: Record<string, unknown> | null) => any,
    ) => {
      const next = await update(settings.get(`${scope}:${id}:${key}`) ?? null);
      settings.set(`${scope}:${id}:${key}`, next);
      return next;
    };
  const programKey = (appId: string, ownerEmail: string, name: string) =>
    `${appId}:${ownerEmail}:${name}`;

  return {
    programsByAppOwnerName,
    programsById,
    settings,
    programKey,
    reset() {
      programsByAppOwnerName.clear();
      programsById.clear();
      settings.clear();
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
    getUserSetting: vi.fn(
      async (email: string, key: string) =>
        settings.get(`u:${email}:${key}`) ?? null,
    ),
    getOrgSetting: vi.fn(
      async (orgId: string, key: string) =>
        settings.get(`o:${orgId}:${key}`) ?? null,
    ),
    mutateUserSetting: vi.fn(mutate("u")),
    mutateOrgSetting: vi.fn(mutate("o")),
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

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  getOrgSetting: mocks.getOrgSetting,
  mutateUserSetting: mocks.mutateUserSetting,
  mutateOrgSetting: mocks.mutateOrgSetting,
  putUserSetting: vi.fn(),
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: vi.fn(async () => null),
}));

const { ensureRiskMeetingDashboard } =
  await import("./ensure-risk-meeting-dashboard");
const { loadBuiltinDashboard } =
  await import("../server/lib/builtin-dashboards");

const CTX = { email: "alice@example.com", orgId: null as string | null };

describe("ensureRiskMeetingDashboard", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.upsertDataProgram.mockClear();
  });

  it("creates both data programs and installs the two-panel built-in on first run", async () => {
    const result = await ensureRiskMeetingDashboard(CTX);

    expect(result.dashboardId).toBe("builtin-risk-meeting");
    expect(result.created).toBe(true);
    expect(Object.keys(result.programIds).sort()).toEqual(
      ["risk-meeting-cohort", "risk-meeting-pylon-early-warning"].sort(),
    );

    expect(mocks.upsertDataProgram).toHaveBeenCalledTimes(2);
    const savedNames = mocks.upsertDataProgram.mock.calls.map(
      (call) => call[0].name,
    );
    expect(savedNames.sort()).toEqual(
      ["risk-meeting-cohort", "risk-meeting-pylon-early-warning"].sort(),
    );

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
      expect(input.code).toMatch(/providerFetchAll?\(/);
      expect(input.code).toMatch(/emit\(/);
    }

    const builtin = await loadBuiltinDashboard("builtin-risk-meeting", CTX);
    const config = builtin!.config as {
      panels: { source: string; chartType: string; sql: string }[];
    };
    expect(builtin!.title).toBe("Risk Meeting");
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

  it("is idempotent: a second call updates the same programs and install instead of duplicating them", async () => {
    const first = await ensureRiskMeetingDashboard(CTX);
    mocks.upsertDataProgram.mockClear();

    const second = await ensureRiskMeetingDashboard(CTX);

    expect(second.created).toBe(false);
    expect(second.dashboardId).toBe(first.dashboardId);
    expect(second.programIds).toEqual(first.programIds);

    expect(mocks.upsertDataProgram).toHaveBeenCalledTimes(2);
    expect(mocks.settings.size).toBe(1);
    expect(mocks.programsByAppOwnerName.size).toBe(2);
  });

  it("installs for the caller personally, since it runs programs they own", async () => {
    const bobCtx = { email: "bob@example.com", orgId: "org_42" };
    await ensureRiskMeetingDashboard(CTX);
    await ensureRiskMeetingDashboard(bobCtx);

    expect(mocks.programsByAppOwnerName.size).toBe(4);
    for (const call of mocks.upsertDataProgram.mock.calls) {
      const input = call[0];
      if (input.ownerEmail === "bob@example.com") {
        expect(input.orgId).toBe("org_42");
      }
    }
    expect([...mocks.settings.keys()].sort()).toEqual([
      "u:alice@example.com:analytics-builtin-dashboards",
      "u:bob@example.com:analytics-builtin-dashboards",
    ]);
    expect(
      await loadBuiltinDashboard("builtin-risk-meeting", {
        email: "carol@example.com",
        orgId: "org_42",
      }),
    ).toBeNull();
  });

  it("throws when there is no authenticated user", async () => {
    await expect(
      ensureRiskMeetingDashboard({ email: "", orgId: null }),
    ).rejects.toThrow(/no authenticated user/i);
    expect(mocks.upsertDataProgram).not.toHaveBeenCalled();
    expect(mocks.settings.size).toBe(0);
  });
});
