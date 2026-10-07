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
});
