import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  loadBuiltinDashboard: vi.fn(),
}));

vi.mock("./dashboards-store.js", () => ({ getDashboard: mocks.getDashboard }));
vi.mock("./builtin-dashboards.js", () => ({
  loadBuiltinDashboard: mocks.loadBuiltinDashboard,
}));

const { openDashboard } = await import("./open-dashboard");

const reader = { email: "reader@example.test", orgId: "org-1" };
const DEMO = { id: "builtin-demo-node-exporter", title: "Demo", config: {} };

describe("openDashboard", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset().mockResolvedValue(null);
    mocks.loadBuiltinDashboard.mockReset().mockResolvedValue(null);
  });

  it("opens a saved dashboard, even at a built-in's old id", async () => {
    const saved = { id: "demo-node-exporter-0a1b2c3d", hiddenBy: null };
    mocks.getDashboard.mockResolvedValue(saved);
    mocks.loadBuiltinDashboard.mockResolvedValue(DEMO);

    expect(await openDashboard("demo-node-exporter-0a1b2c3d", reader)).toEqual({
      saved,
    });
  });

  it("opens the built-in for a copy the deploy pass hid", async () => {
    mocks.getDashboard.mockResolvedValue({
      id: "demo-node-exporter-0a1b2c3d",
      hiddenBy: "analytics:builtin-dashboards",
    });
    mocks.loadBuiltinDashboard.mockResolvedValue(DEMO);

    expect(await openDashboard("demo-node-exporter-0a1b2c3d", reader)).toEqual({
      builtin: DEMO,
    });
    expect(mocks.loadBuiltinDashboard).toHaveBeenCalledWith(
      "builtin-demo-node-exporter",
      reader,
    );
  });

  it("opens a built-in that has no row", async () => {
    mocks.loadBuiltinDashboard.mockResolvedValue(DEMO);
    expect(await openDashboard("builtin-demo-node-exporter", reader)).toEqual({
      builtin: DEMO,
    });
  });

  it("opens nothing for an unknown id or a built-in the org hasn't installed", async () => {
    expect(await openDashboard("someone-elses", reader)).toBeNull();
    expect(mocks.loadBuiltinDashboard).not.toHaveBeenCalled();
    expect(await openDashboard("builtin-customer-roi-v2", reader)).toBeNull();
  });
});
