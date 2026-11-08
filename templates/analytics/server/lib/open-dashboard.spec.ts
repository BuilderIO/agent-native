import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  loadBuiltinDashboard: vi.fn(),
  builtinDashboardVisibility: vi.fn(),
}));

vi.mock("./dashboards-store.js", () => ({ getDashboard: mocks.getDashboard }));
vi.mock("./builtin-dashboards.js", () => ({
  loadBuiltinDashboard: mocks.loadBuiltinDashboard,
  builtinDashboardVisibility: mocks.builtinDashboardVisibility,
}));

const { openDashboard, openedDashboardVisibility } =
  await import("./open-dashboard");

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

describe("openedDashboardVisibility", () => {
  const saved = (visibility: string, orgId: string | null) =>
    ({ saved: { id: "growth", visibility, orgId } }) as never;

  it("reads a saved dashboard's sharing in its own organization", async () => {
    expect(await openedDashboardVisibility(saved("org", "org-1"), reader)).toBe(
      "org",
    );
    expect(
      await openedDashboardVisibility(saved("public", "org-2"), reader),
    ).toBe("public");
  });

  it("reads another organization's dashboard as private, since its sharing reaches nobody here", async () => {
    expect(await openedDashboardVisibility(saved("org", "org-2"), reader)).toBe(
      "private",
    );
    expect(await openedDashboardVisibility(saved("org", null), reader)).toBe(
      "private",
    );
  });

  it("asks a built-in how it was installed for the reader's organization", async () => {
    mocks.builtinDashboardVisibility.mockResolvedValue("org");
    expect(
      await openedDashboardVisibility({ builtin: DEMO } as never, reader),
    ).toBe("org");
    expect(mocks.builtinDashboardVisibility).toHaveBeenCalledWith(
      DEMO.id,
      reader,
    );
  });
});
