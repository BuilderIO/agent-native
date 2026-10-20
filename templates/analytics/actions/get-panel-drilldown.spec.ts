import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getFirstPartyDrilldown: vi.fn() }));
vi.mock("../server/lib/first-party-metric-catalog", () => ({
  getFirstPartyDrilldown: mocks.getFirstPartyDrilldown,
}));
const { default: getPanelDrilldown } = await import("./get-panel-drilldown");
const panel = {
  panelId: "custom",
  panelSource: "bigquery",
  panelSql: "SELECT day, COUNT(*) FROM events GROUP BY day",
};

describe("get-panel-drilldown", () => {
  beforeEach(() => mocks.getFirstPartyDrilldown.mockReset());

  it("uses a declared BigQuery record template without catalog SQL matching", async () => {
    const drilldown = {
      sql: "SELECT visitor FROM events WHERE day = '{{drillX}}' LIMIT 500",
    };
    await expect(
      getPanelDrilldown.run({ ...panel, drilldown }),
    ).resolves.toEqual({ drilldown });
    expect(mocks.getFirstPartyDrilldown).not.toHaveBeenCalled();
  });

  it("retains catalog lookup and an explicit aggregate-only result", async () => {
    const drilldown = { sql: "SELECT visitor FROM events LIMIT 500" };
    mocks.getFirstPartyDrilldown
      .mockReturnValueOnce(drilldown)
      .mockReturnValueOnce(null);
    await expect(
      getPanelDrilldown.run({ ...panel, panelSource: "first-party" }),
    ).resolves.toEqual({ drilldown });
    await expect(getPanelDrilldown.run(panel)).resolves.toEqual({
      drilldown: null,
    });
    expect(mocks.getFirstPartyDrilldown).toHaveBeenNthCalledWith(
      1,
      panel.panelId,
      "first-party",
      panel.panelSql,
    );
  });

  it.each([
    null,
    {},
    { sql: " " },
    { sql: "x".repeat(50_001) },
    { sql: "SELECT 1", extra: true },
  ])("rejects malformed declarations: %j", (drilldown) => {
    expect(
      getPanelDrilldown.schema.safeParse({ ...panel, drilldown }).success,
    ).toBe(false);
  });

  it("does not treat a declaration for a non-SQL source as aggregate-only", async () => {
    await expect(
      getPanelDrilldown.run({
        ...panel,
        panelSource: "prometheus",
        drilldown: { sql: "SELECT 1" },
      }),
    ).rejects.toThrow("requires a BigQuery or first-party panel");
  });
});
