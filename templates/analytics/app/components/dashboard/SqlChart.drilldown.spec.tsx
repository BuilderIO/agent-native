// @vitest-environment happy-dom

import { act } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const formatters = vi.hoisted(() => ({
  formatDate: () => "localized date",
  formatList: (values: string[]) => values.join(" + "),
  formatNumber: (value: number) => `localized:${value}`,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useFormatters: () => formatters,
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

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement("div", null, children);
  const empty = () => null;
  const chart = ({
    children,
    ...props
  }: {
    children?: ReactNode;
    onClick?: any;
  }) => React.createElement("div", { onClick: props.onClick }, children);
  const series =
    (kind: string) =>
    ({
      dataKey,
      onClick,
    }: {
      dataKey: string;
      onClick?: (
        data: unknown,
        index: number,
        event: ReactMouseEvent<HTMLButtonElement>,
      ) => void;
    }) =>
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": `${kind}-${dataKey}`,
          onClick: (event: ReactMouseEvent<HTMLButtonElement>) =>
            onClick?.(undefined, 0, event),
        },
        dataKey,
      );

  return {
    ...actual,
    Area: series("area"),
    AreaChart: chart,
    Bar: series("bar"),
    CartesianGrid: empty,
    Cell: empty,
    ComposedChart: chart,
    Line: series("line"),
    LineChart: chart,
    Legend: empty,
    Pie: empty,
    PieChart: chart,
    ResponsiveContainer: passthrough,
    Tooltip: empty,
    XAxis: empty,
    YAxis: empty,
  };
});

import type { SqlPanel } from "@/pages/adhoc/sql-dashboard/types";

import { SqlChart, type ChartDatum } from "./SqlChart";

function panel(
  chartType: "area" | "line" | "combo",
  barKeys: string[] = [],
): SqlPanel {
  return {
    id: "signups-over-time",
    title: "Signups over time",
    sql: "SELECT day, template, count FROM signups",
    source: "first-party",
    chartType,
    width: 1,
    config: {
      pivot: { xKey: "day", seriesKey: "template", valueKey: "count" },
      stacked: true,
      barKeys,
    },
  };
}

function outcomeFunnelPanel(): SqlPanel {
  return {
    id: "activation-funnel",
    title: "Activation funnel",
    sql: "SELECT stage, shown, completed, left_here FROM funnel",
    source: "first-party",
    chartType: "funnel",
    width: 1,
    config: {
      xKey: "stage",
      yKey: "shown",
      funnelOutcomes: {
        completedKey: "completed",
        leftKey: "left_here",
      },
    },
  };
}

function funnelPanel(): SqlPanel {
  return {
    id: "activation-funnel",
    title: "Activation funnel",
    sql: "SELECT stage, shown FROM funnel",
    source: "first-party",
    chartType: "funnel",
    width: 1,
    config: { xKey: "stage", yKey: "shown" },
  };
}

function piePanel(): SqlPanel {
  return {
    id: "signups-by-template",
    title: "Signups by template",
    sql: "SELECT template, count FROM signups",
    source: "first-party",
    chartType: "pie",
    width: 1,
    config: { xKey: "template", yKey: "count" },
  };
}

describe("SqlChart drilldown clicks", () => {
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

  it.each([
    { chartType: "area", seriesKind: "area", barKeys: [] },
    { chartType: "line", seriesKind: "line", barKeys: [] },
    { chartType: "combo", seriesKind: "line", barKeys: [] },
    { chartType: "combo", seriesKind: "bar", barKeys: ["mail"] },
  ] as const)(
    "passes the clicked $seriesKind pivot series for $chartType charts",
    async ({ chartType, seriesKind, barKeys }) => {
      const onDatumClick = vi.fn<(datum: ChartDatum) => void>();

      await act(async () => {
        root.render(
          <SqlChart
            panel={panel(chartType, [...barKeys])}
            onDatumClick={onDatumClick}
            resultOverride={{
              rows: [
                { day: "2026-10-15", template: "clips", count: 3 },
                { day: "2026-10-15", template: "mail", count: 2 },
              ],
            }}
          />,
        );
      });

      const clickedArea = container.querySelector<HTMLButtonElement>(
        `[data-testid="${seriesKind}-mail"]`,
      );
      expect(clickedArea).not.toBeNull();

      await act(async () => clickedArea!.click());

      expect(onDatumClick).toHaveBeenCalledTimes(1);
      expect(onDatumClick).toHaveBeenCalledWith({
        x: "2026-10-15",
        series: "mail",
        value: 2,
      });
    },
  );

  it("offers keyboard-operable controls for pivot chart points", async () => {
    const onDatumClick = vi.fn<(datum: ChartDatum) => void>();

    await act(async () => {
      root.render(
        <SqlChart
          panel={panel("area")}
          onDatumClick={onDatumClick}
          resultOverride={{
            rows: [
              { day: "2026-10-15", template: "clips", count: 3 },
              { day: "2026-10-15", template: "mail", count: 2 },
            ],
          }}
        />,
      );
    });

    const disclosure = container.querySelector<HTMLDetailsElement>("details");
    const summary = disclosure?.querySelector<HTMLElement>("summary");
    expect(summary?.textContent).toBe("sqlDashboard.drilldownChartPoints");

    expect(disclosure?.querySelector("button")).toBeNull();
    await act(async () => {
      disclosure!.open = true;
      disclosure!.dispatchEvent(new Event("toggle"));
    });

    const mailPoint = disclosure?.querySelector<HTMLButtonElement>(
      'button[aria-label*="mail"]',
    );
    expect(mailPoint?.type).toBe("button");
    expect(mailPoint).not.toBeNull();

    await act(async () => mailPoint!.click());

    expect(onDatumClick).toHaveBeenCalledWith({
      x: "2026-10-15",
      series: "mail",
      value: 2,
    });
  });

  it("paginates keyboard point controls and includes their values", async () => {
    const onDatumClick = vi.fn<(datum: ChartDatum) => void>();
    const chartPanel = panel("area");
    const resultOverride = {
      rows: Array.from({ length: 101 }, (_, index) => [
        { day: `day-${index}`, template: "clips", count: index },
        {
          day: `day-${index}`,
          template: "mail",
          count: index + 100,
        },
      ]).flat(),
    };

    await act(async () => {
      root.render(
        <SqlChart
          panel={chartPanel}
          onDatumClick={onDatumClick}
          resultOverride={resultOverride}
        />,
      );
    });

    const disclosure = container.querySelector<HTMLDetailsElement>("details");
    await act(async () => {
      disclosure!.open = true;
      disclosure!.dispatchEvent(new Event("toggle"));
    });

    const pointButtons = () =>
      Array.from(disclosure!.querySelectorAll<HTMLButtonElement>("ul button"));
    expect(pointButtons()).toHaveLength(100);
    expect(pointButtons()[0].textContent).toContain("day-0");
    expect(pointButtons()[0].textContent).toContain("0");

    const nextPageButton = () =>
      disclosure!.querySelector<HTMLButtonElement>(
        'button[aria-label="sqlDashboard.drilldownNextPage"]',
      )!;
    nextPageButton().focus();
    await act(async () => {
      nextPageButton().click();
    });
    expect(pointButtons()).toHaveLength(100);
    expect(pointButtons()[0].textContent).toContain("day-50");

    await act(async () => {
      root.render(
        <SqlChart
          panel={chartPanel}
          onDatumClick={onDatumClick}
          resultOverride={resultOverride}
        />,
      );
    });
    expect(pointButtons()[0].textContent).toContain("day-50");

    nextPageButton().focus();
    await act(async () => {
      nextPageButton().click();
    });
    expect(pointButtons()).toHaveLength(2);
    expect(nextPageButton().getAttribute("aria-disabled")).toBe("true");
    expect(nextPageButton().disabled).toBe(false);
    expect(document.activeElement).toBe(nextPageButton());
    await act(async () => nextPageButton().click());
    expect(pointButtons()).toHaveLength(2);
    expect(container.textContent).toContain(
      'sqlDashboard.drilldownPageRange {"start":"localized:201","end":"localized:202","total":"localized:202"}',
    );
  });

  it("lists every visible metric for a non-pivot point with localized labels", async () => {
    const onDatumClick = vi.fn<(datum: ChartDatum) => void>();
    const panelWithoutPivot = {
      ...panel("line"),
      config: { xKey: "day", yKeys: ["signups", "views"] },
    };

    await act(async () => {
      root.render(
        <SqlChart
          panel={panelWithoutPivot}
          onDatumClick={onDatumClick}
          resultOverride={{
            rows: [{ day: "2026-10-15", signups: 3, views: 1500 }],
          }}
        />,
      );
    });

    const disclosure = container.querySelector<HTMLDetailsElement>("details");
    await act(async () => {
      disclosure!.open = true;
      disclosure!.dispatchEvent(new Event("toggle"));
    });

    const point = disclosure?.querySelector<HTMLButtonElement>("ul button");
    expect(point?.textContent).toContain("localized date");
    expect(point?.textContent).toContain("signups: 3");
    expect(point?.textContent).toContain("views: 1,500");

    await act(async () => point!.click());

    expect(onDatumClick).toHaveBeenCalledWith({
      x: "2026-10-15",
      value: undefined,
    });
  });

  it("offers keyboard-operable controls for pie chart slices", async () => {
    const onDatumClick = vi.fn<(datum: ChartDatum) => void>();

    await act(async () => {
      root.render(
        <SqlChart
          panel={piePanel()}
          onDatumClick={onDatumClick}
          resultOverride={{
            rows: [{ template: "clips", count: 3 }],
          }}
        />,
      );
    });

    const disclosure = container.querySelector<HTMLDetailsElement>("details");
    expect(disclosure?.querySelector("button")).toBeNull();

    await act(async () => {
      disclosure!.open = true;
      disclosure!.dispatchEvent(new Event("toggle"));
    });

    const point = disclosure?.querySelector<HTMLButtonElement>(
      'button[aria-label*="clips"]',
    );
    expect(point?.type).toBe("button");
    expect(point).not.toBeNull();

    await act(async () => point!.click());

    expect(onDatumClick).toHaveBeenCalledWith({ x: "clips", value: 3 });
  });

  it("passes outcome funnel stage clicks and keyboard activation to drilldown", async () => {
    const onDatumClick = vi.fn<(datum: ChartDatum) => void>();

    await act(async () => {
      root.render(
        <SqlChart
          panel={outcomeFunnelPanel()}
          onDatumClick={onDatumClick}
          resultOverride={{
            rows: [
              { stage: "visit", shown: 100, completed: 70, left_here: 10 },
              { stage: "signup", shown: 40, completed: 30, left_here: 5 },
            ],
          }}
        />,
      );
    });

    const visitStage = container.querySelector<HTMLElement>(
      '[data-funnel-stage="visit"]',
    );
    expect(visitStage).not.toBeNull();
    expect(visitStage?.getAttribute("role")).toBe("button");

    await act(async () => visitStage!.click());
    await act(async () => {
      visitStage!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onDatumClick).toHaveBeenCalledTimes(2);
    expect(onDatumClick).toHaveBeenNthCalledWith(1, {
      x: "visit",
      value: 100,
    });
    expect(onDatumClick).toHaveBeenNthCalledWith(2, {
      x: "visit",
      value: 100,
    });
  });

  it("exposes interactive plain funnel stages outside image semantics", async () => {
    const onDatumClick = vi.fn<(datum: ChartDatum) => void>();

    await act(async () => {
      root.render(
        <SqlChart
          panel={funnelPanel()}
          onDatumClick={onDatumClick}
          resultOverride={{
            rows: [{ stage: "visit", shown: 100 }],
          }}
        />,
      );
    });

    const chart = container.querySelector<HTMLElement>(
      '[data-dashboard-funnel="true"]',
    );
    const visitStage = container.querySelector<HTMLElement>(
      '[data-dashboard-funnel="true"] [role="button"]',
    );
    expect(chart?.getAttribute("role")).toBe("group");
    expect(visitStage).not.toBeNull();
    expect(chart?.contains(visitStage)).toBe(true);

    await act(async () => {
      visitStage!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onDatumClick).toHaveBeenCalledWith({ x: "visit", value: 100 });
  });
});
