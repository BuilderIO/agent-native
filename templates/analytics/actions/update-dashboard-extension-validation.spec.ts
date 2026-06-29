import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/analytics/adhoc"),
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: vi.fn(async () => undefined),
  hasCollabState: vi.fn(async () => false),
  seedFromText: vi.fn(async () => undefined),
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({ archivedAt: null })),
}));

vi.mock("../server/lib/bigquery", () => ({
  dryRunQuery: vi.fn(async () => null),
}));

const { validateDashboardConfig } = await import("./update-dashboard");

function extensionPanel(overrides: Record<string, unknown> = {}) {
  return {
    id: "ext-1",
    title: "Embedded Widget",
    chartType: "extension",
    width: 3,
    config: { extensionId: "extension-abc" },
    ...overrides,
  };
}

describe("validateDashboardConfig — extension panels", () => {
  it("accepts an extension panel without source/sql", () => {
    const error = validateDashboardConfig({
      name: "Has Extension",
      panels: [extensionPanel()],
    });
    expect(error).toBeNull();
  });

  it("rejects an extension panel missing config.extensionId", () => {
    const error = validateDashboardConfig({
      name: "Missing Extension Id",
      panels: [extensionPanel({ config: {} })],
    });
    expect(error).toMatch(/config\.extensionId is required/);
  });

  it("rejects an extension panel with an empty config.extensionId", () => {
    const error = validateDashboardConfig({
      name: "Empty Extension Id",
      panels: [extensionPanel({ config: { extensionId: "   " } })],
    });
    expect(error).toMatch(/config\.extensionId is required/);
  });

  it("still requires source/sql for non-extension panels", () => {
    const error = validateDashboardConfig({
      name: "Bad SQL Panel",
      panels: [{ id: "p1", title: "No source", chartType: "metric", width: 1 }],
    });
    expect(error).toMatch(/panel\[0\]\.(sql|source) is required/);
  });
});
