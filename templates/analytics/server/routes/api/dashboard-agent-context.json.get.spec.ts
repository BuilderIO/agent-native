import { beforeEach, describe, expect, it, vi } from "vitest";

const resultQueue = vi.hoisted(() => ({ current: [] as unknown[][] }));
const limit = vi.hoisted(() =>
  vi.fn(async () => resultQueue.current.shift() ?? []),
);
const where = vi.hoisted(() => vi.fn(() => ({ limit })));
const from = vi.hoisted(() => vi.fn(() => ({ where })));
const select = vi.hoisted(() => vi.fn(() => ({ from })));
const mockVerifyScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn((_token: unknown, _options: unknown) => ({ ok: false })),
);
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockLoadDashboardSeed = vi.hoisted(() => vi.fn());
const mockBuildDashboardAgentContext = vi.hoisted(() =>
  vi.fn((dashboard: any, _options: unknown) => ({
    resourceType: "analytics-dashboard",
    id: dashboard.id,
    visibility: dashboard.visibility,
  })),
);
const mockBuildDashboardSeedAgentContext = vi.hoisted(() =>
  vi.fn((id: string, seed: Record<string, unknown>, _options: unknown) => ({
    resourceType: "analytics-dashboard",
    id,
    seedName: seed.name,
  })),
);

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  verifyScopedAgentAccessToken: (token: unknown, options: unknown) =>
    mockVerifyScopedAgentAccessToken(token, options),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: any) => event.query ?? {},
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../db/index.js", () => ({
  getDb: () => ({ select }),
  schema: {
    dashboards: {
      id: "dashboard_id_col",
    },
  },
}));

vi.mock("../../lib/agent-readable-resource-context.js", () => ({
  buildDashboardAgentContext: (dashboard: unknown, options: unknown) =>
    mockBuildDashboardAgentContext(dashboard, options),
  buildDashboardSeedAgentContext: (
    id: string,
    seed: Record<string, unknown>,
    options: unknown,
  ) => mockBuildDashboardSeedAgentContext(id, seed, options),
}));

vi.mock("../../lib/dashboard-seeds.js", () => ({
  loadDashboardSeed: (...args: unknown[]) => mockLoadDashboardSeed(...args),
}));

import handler from "./dashboard-agent-context.json.get";

function dashboardRow(visibility: "public" | "private" | "org") {
  return {
    id: "dashboard-1",
    kind: "sql",
    title: "Revenue",
    config: JSON.stringify({ name: "Revenue" }),
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-03T03:04:05.000Z",
  };
}

describe("dashboard agent context route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue.current = [];
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
    mockLoadDashboardSeed.mockReturnValue({ name: "Seed dashboard" });
  });

  it("serves public dashboard rows without an agent token", async () => {
    resultQueue.current = [[dashboardRow("public")]];

    const result = await (handler as any)({
      query: { id: "dashboard-1" },
    });

    expect(mockBuildDashboardAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dashboard-1",
        visibility: "public",
      }),
      { includeConfig: true },
    );
    expect(mockSetResponseStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      403,
    );
    expect(result).toEqual({
      resourceType: "analytics-dashboard",
      id: "dashboard-1",
      visibility: "public",
    });
  });

  it("requires scoped agent access before serving seeded dashboard context", async () => {
    resultQueue.current = [[]];

    const result = await (handler as any)({
      query: { id: "node-exporter-full" },
    });

    expect(mockLoadDashboardSeed).toHaveBeenCalledWith("node-exporter-full");
    expect(mockBuildDashboardSeedAgentContext).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(result).toEqual({
      error: "Invalid or expired agent access token",
    });
  });

  it("serves seeded dashboard context when the scoped agent token verifies", async () => {
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    resultQueue.current = [[]];

    const result = await (handler as any)({
      query: { id: "node-exporter-full", agent_access: "tok+1" },
    });

    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith("tok+1", {
      resourceKind: "analytics:dashboard",
      resourceId: "node-exporter-full",
    });
    expect(mockBuildDashboardSeedAgentContext).toHaveBeenCalledWith(
      "node-exporter-full",
      { name: "Seed dashboard" },
      { includeConfig: true },
    );
    expect(result).toEqual({
      resourceType: "analytics-dashboard",
      id: "node-exporter-full",
      seedName: "Seed dashboard",
    });
  });
});
