// @vitest-environment happy-dom

import { planPanelRender } from "@shared/panel-render-contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/sql-query", () => ({
  useSqlQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
}));

import { SqlChart } from "./SqlChart";

const BANNER = "Ignored missing result columns:";

function panel(overrides: Partial<SqlPanel>): SqlPanel {
  return {
    id: "p",
    title: "P",
    sql: "SELECT 1",
    source: "first-party",
    chartType: "table",
    width: 1,
    ...overrides,
  };
}

describe("SqlChart render contract parity", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderText(
    target: SqlPanel,
    rows: Record<string, unknown>[],
  ): Promise<string> {
    await act(async () => {
      root.render(<SqlChart panel={target} resultOverride={{ rows }} />);
    });
    return container.textContent ?? "";
  }

  it("shows No data exactly when the plan is empty, with no banner", async () => {
    const stalePivot = panel({
      chartType: "line",
      config: {
        pivot: { xKey: "week", seriesKey: "app", valueKey: "sharing_actions" },
      },
    });
    const wideRows = [
      { week: "2026-09-01", app_a: 3, viral_coefficient: 0.3 },
      { week: "2026-09-08", app_a: 5, viral_coefficient: 0.4 },
    ];

    const plan = planPanelRender(wideRows, stalePivot);
    expect(plan.empty).toBe(true);
    const text = await renderText(stalePivot, wideRows);
    expect(text).toContain("common.noData");
    expect(text).not.toContain(BANNER);

    const healthy = panel({
      chartType: "table",
      config: { pivot: undefined },
    });
    expect(planPanelRender(wideRows, healthy).empty).toBe(false);
    expect(await renderText(healthy, wideRows)).not.toContain("common.noData");
  });

  it("lists exactly the plan's missing keys in the banner", async () => {
    const target = panel({
      config: { columns: [{ key: "path" }, { key: "ghost", linkKey: "gone" }] },
    });
    const rows = [{ path: "/a", views: 3 }];

    const plan = planPanelRender(rows, target);
    expect(plan.missingKeys).toEqual(["ghost", "gone"]);
    expect(await renderText(target, rows)).toContain(
      `${BANNER} ${plan.missingKeys.join(", ")}`,
    );
  });

  it("shows no banner for a healthy panel", async () => {
    const target = panel({ config: { columns: [{ key: "path" }] } });
    const rows = [{ path: "/a", views: 3 }];

    expect(planPanelRender(rows, target).missingKeys).toEqual([]);
    expect(await renderText(target, rows)).not.toContain(BANNER);
  });

  it("shows No data for a funnel exactly when the plan says the funnel is empty", async () => {
    const funnel = panel({
      chartType: "funnel",
      config: { xKey: "stage", yKey: "users" },
    });
    const numericLabels = [
      { stage: 1, users: 100 },
      { stage: 2, users: 50 },
    ];
    const healthy = [
      { stage: "visit", users: 100 },
      { stage: "signup", users: 40 },
    ];

    expect(planPanelRender(numericLabels, funnel).empty).toBe(true);
    expect(await renderText(funnel, numericLabels)).toContain("common.noData");

    expect(planPanelRender(healthy, funnel).empty).toBe(false);
    const text = await renderText(funnel, healthy);
    expect(text).not.toContain("common.noData");
    expect(text).toContain("visit");
    expect(text).toContain("signup");
  });

  it("shows No data for a heatmap exactly when the plan finds no value column", async () => {
    const heatmap = panel({ chartType: "heatmap" });
    const oneColumn = [{ cohort: "w1" }, { cohort: "w2" }];
    const withValues = [
      { cohort: "w1", segment: "a", retained: 0.5 },
      { cohort: "w2", segment: "a", retained: 0.4 },
    ];

    expect(planPanelRender(oneColumn, heatmap).empty).toBe(true);
    expect(await renderText(heatmap, oneColumn)).toContain("common.noData");

    expect(planPanelRender(withValues, heatmap).empty).toBe(false);
    const text = await renderText(heatmap, withValues);
    expect(text).not.toContain("common.noData");
    expect(text).toContain("0.5");
  });

  it.each([
    [
      "funnel",
      panel({ chartType: "funnel", config: { xKey: "stgae", yKey: "users" } }),
      [
        { stage: 1, users: 100 },
        { stage: 2, users: 50 },
      ],
    ],
    [
      "heatmap",
      panel({ chartType: "heatmap", config: { xKey: "cohrt" } }),
      [{ cohort: "w1" }, { cohort: "w2" }],
    ],
  ])(
    "explains a %s that has rows but draws nothing",
    async (_, target, rows) => {
      const plan = planPanelRender(rows, target);
      expect(plan.empty).toBe(true);
      expect(plan.rows.length).toBeGreaterThan(0);
      expect(plan.missingKeys.length).toBeGreaterThan(0);

      const text = await renderText(target, rows);
      expect(text).toContain("common.noData");
      expect(text).toContain(`${BANNER} ${plan.missingKeys.join(", ")}`);
    },
  );

  it("still renders a chart whose key lists hold a string instead of crashing", async () => {
    const rows = [
      { week: "2026-09-01", signups: 3, rate: 0.3 },
      { week: "2026-09-08", signups: 5, rate: 0.4 },
    ];
    const lineWithStringKeys = panel({
      chartType: "line",
      config: { rightYKeys: "rate", yKeys: "signups" } as never,
    });
    const comboWithStringBarKeys = panel({
      chartType: "combo",
      config: { yKeys: ["signups"], barKeys: "signups" } as never,
    });

    expect(await renderText(lineWithStringKeys, rows)).not.toContain(
      "common.noData",
    );
    expect(await renderText(comboWithStringBarKeys, rows)).not.toContain(
      "common.noData",
    );
  });
});
