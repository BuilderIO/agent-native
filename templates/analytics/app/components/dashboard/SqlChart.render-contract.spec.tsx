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
  useFormatters: () => ({ formatNumber: String }),
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
  isExtensionApiPath: (pathname: string) =>
    pathname.startsWith("/_agent-native/extensions/") ||
    pathname.startsWith("/_agent-native/tools/"),
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

  it("renders safe Markdown links in callout messages", async () => {
    const target = panel({ chartType: "callout" });
    await act(async () => {
      root.render(
        <SqlChart
          panel={target}
          resultOverride={{
            rows: [
              {
                severity: "info",
                message:
                  "Read [the docs](https://example.com/guide), [unsafe](javascript:alert(1)), or [extension](/_agent-native/tools/ext/render).",
              },
            ],
          }}
        />,
      );
    });

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com/guide");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("unsafe");
    expect(container.textContent).toContain("extension");
  });

  it("renders extension API links as text in panel descriptions", async () => {
    const target = panel({
      chartType: "metric",
      config: {
        description: "Read [the extension](/_agent-native/tools/ext/r%65nder).",
      },
    });
    await act(async () => {
      root.render(
        <SqlChart panel={target} resultOverride={{ rows: [{ value: 42 }] }} />,
      );
    });

    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("the extension");
  });

  it("renders auth and action API links as text after URL normalization", async () => {
    const links = [
      ["relative auth", "/_agent-native/auth/sign-in"],
      ["relative actions", "/_agent-native/actions/run"],
      [
        "absolute same-origin actions",
        `${window.location.origin}/_agent-native/actions/run`,
      ],
      [
        "absolute same-origin auth",
        `${window.location.origin}/_agent-native/auth/sign-in`,
      ],
      ["encoded prefix and auth segment", "/%5Fagent-native/%61uth/sign-in"],
      ["double-encoded action segment", "/_agent-native/%2561ctions/run"],
      ["encoded route separator", "/_agent-native%2factions/run"],
      ["normalized auth path", "/docs/%2e%2e/_agent-native/auth/sign-in"],
    ] as const;
    const target = panel({
      chartType: "metric",
      config: {
        description: links
          .map(([label, href]) => `[${label}](${href})`)
          .join(", "),
      },
    });

    await act(async () => {
      root.render(
        <SqlChart panel={target} resultOverride={{ rows: [{ value: 42 }] }} />,
      );
    });

    expect(container.querySelectorAll("a")).toHaveLength(0);
    for (const [label] of links) expect(container.textContent).toContain(label);
  });

  it("renders safe Markdown links in metric descriptions", async () => {
    const target = panel({
      chartType: "metric",
      config: { description: "Read [the definition](/docs/metrics)." },
    });
    await act(async () => {
      root.render(
        <SqlChart panel={target} resultOverride={{ rows: [{ value: 42 }] }} />,
      );
    });

    expect(container.querySelector('a[href="/docs/metrics"]')).not.toBeNull();
    expect(container.textContent).toContain("42");
  });

  it("renders safe Markdown links in section descriptions", async () => {
    const target = panel({
      chartType: "section",
      config: { description: "Read [the guide](https://example.com/guide)." },
    });
    await act(async () => {
      root.render(<SqlChart panel={target} />);
    });

    expect(
      container.querySelector('a[href="https://example.com/guide"]'),
    ).not.toBeNull();
  });

  it.each(["metric", "section"] as const)(
    "keeps a %s panel rendered when its saved description is not a string",
    async (chartType) => {
      const target = panel({
        chartType,
        config: {
          description: { note: "This is not panel copy" },
        } as unknown as SqlPanel["config"],
      });

      const text = await renderText(target, [{ value: 42 }]);

      if (chartType === "metric") expect(text).toContain("42");
      else expect(container.querySelector(".px-1.py-2")).not.toBeNull();
      expect(text).not.toContain("This is not panel copy");
      expect(text).not.toContain("[object Object]");
    },
  );

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
  describe("funnelOutcomes", () => {
    const rows = [
      {
        step: "Your role",
        shown: 1927,
        completed: 1168,
        skipped: 520,
        left_here: 75,
        optional: true,
      },
      {
        step: "Choose setup",
        shown: 2543,
        completed: 1885,
        skipped: 0,
        left_here: 337,
        optional: false,
      },
    ];
    const steps = panel({
      chartType: "funnel",
      config: {
        xKey: "step",
        yKey: "shown",
        funnelOutcomes: {
          completedKey: "completed",
          skippedKey: "skipped",
          leftKey: "left_here",
          optionalKey: "optional",
        },
      },
    });

    function drawnSegments(stage: Element) {
      return [...stage.querySelectorAll("[data-funnel-segment]")].map(
        (segment) => [
          segment.getAttribute("data-funnel-segment"),
          (segment as HTMLElement).style.width.slice(0, 4),
        ],
      );
    }

    it("splits each stage and leads it with the share who left the app", async () => {
      const text = await renderText(steps, rows);

      expect(text).toContain("sqlDashboard.funnelLeftHere");
      const stages = [...container.querySelectorAll("[data-funnel-stage]")];
      expect(
        stages.map((stage) => stage.getAttribute("data-funnel-stage")),
      ).toEqual(["Your role", "Choose setup"]);
      expect(
        stages.map(
          (stage) =>
            stage.querySelector("[data-funnel-left-share]")?.textContent,
        ),
      ).toEqual(["3.9%", "13.3%"]);
      expect(stages[0].textContent).toContain("sqlDashboard.funnelOptional");
      expect(stages[1].textContent).not.toContain(
        "sqlDashboard.funnelOptional",
      );
      expect(drawnSegments(stages[0])).toEqual([
        ["completed", "60.6"],
        ["skipped", "26.9"],
        ["movedOn", "8.51"],
        ["left", "3.89"],
      ]);
      expect(drawnSegments(stages[1]).map(([segment]) => segment)).toEqual([
        "completed",
        "movedOn",
        "left",
      ]);
    });

    it("draws a funnel without the key exactly as before", async () => {
      const plain = panel({
        chartType: "funnel",
        config: { xKey: "step", yKey: "shown" },
      });
      const text = await renderText(plain, rows);

      expect(container.querySelector("[data-funnel-outcomes]")).toBeNull();
      expect(text).not.toContain("sqlDashboard.funnelLeftHere");
      expect(text).toContain("100.0%");
      expect(text).toContain("↑ 32.0%");
    });
  });
});
