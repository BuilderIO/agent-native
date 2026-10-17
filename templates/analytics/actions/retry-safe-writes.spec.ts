import { describe, expect, it } from "vitest";

import composeDashboard from "./compose-dashboard";
import { DASHBOARD_MUTATION_EXAMPLES } from "./dashboard-mutation-api";
import mutateDashboard from "./mutate-dashboard";
import updateDashboard from "./update-dashboard";

// Mirrors how the agent loop reads `retrySafe`: a boolean applies to every
// call, a predicate is asked about the call's raw params.
function retrySafe(
  action: { retrySafe?: boolean | ((input: any) => boolean) },
  params: unknown,
): boolean {
  const flag = action.retrySafe;
  return typeof flag === "function" ? flag(params) === true : flag === true;
}

describe("update-dashboard retrySafe", () => {
  const dashboardId = "sales";

  it("allows whole-config and panel-order writes, which reach the same end state on replay", () => {
    expect(
      retrySafe(updateDashboard, {
        dashboardId,
        config: { name: "Sales", panels: [] },
      }),
    ).toBe(true);
    expect(
      retrySafe(updateDashboard, {
        dashboardId,
        panelOrder: ["mrr", "churn"],
      }),
    ).toBe(true);
  });

  it("refuses index-based ops, which a replay shifts", () => {
    expect(
      retrySafe(updateDashboard, {
        dashboardId,
        ops: [{ op: "insert", path: "/panels/0", value: { id: "mrr" } }],
      }),
    ).toBe(false);
    expect(
      retrySafe(updateDashboard, {
        dashboardId,
        ops: '[{"op":"remove","path":"/panels/0"}]',
      }),
    ).toBe(false);
  });
});

describe("mutate-dashboard retrySafe", () => {
  const dashboardId = "sales";

  it("is declared for every shape, since caller-supplied ids make a replay fail instead of duplicating", () => {
    expect(mutateDashboard.retrySafe).toBe(true);
    expect(
      retrySafe(mutateDashboard, {
        dashboardId,
        operations: [{ op: "insertPanel", panel: { id: "mrr" } }],
      }),
    ).toBe(true);
    expect(
      retrySafe(mutateDashboard, {
        dashboardId,
        operations: [{ op: "removePanels", panelIds: ["old-chart"] }],
      }),
    ).toBe(true);
    expect(
      retrySafe(mutateDashboard, {
        dashboardId,
        code: DASHBOARD_MUTATION_EXAMPLES[0],
      }),
    ).toBe(true);
  });
});

describe("compose-dashboard retrySafe", () => {
  const dashboardId = "first-party-overview";

  it("allows append, which skips panel ids already present on replay", () => {
    expect(retrySafe(composeDashboard, { dashboardId, metrics: ["dau"] })).toBe(
      true,
    );
  });

  it("refuses refreshExisting, which replaces matching panels without a fence", () => {
    expect(
      retrySafe(composeDashboard, {
        dashboardId,
        metrics: ["dau"],
        overwrite: false,
        refreshExisting: true,
      }),
    ).toBe(false);
  });

  it("refuses overwrite, which replaces the whole config without a fence", () => {
    expect(
      retrySafe(composeDashboard, {
        dashboardId,
        metrics: ["dau"],
        overwrite: true,
      }),
    ).toBe(false);
  });

  it.each(["overwrite", "refreshExisting"])(
    "refuses a stringified %s flag, which the schema coerces to true",
    (flag) => {
      expect(
        retrySafe(composeDashboard, {
          dashboardId,
          metrics: ["dau"],
          [flag]: "true",
        }),
      ).toBe(false);
    },
  );
});
