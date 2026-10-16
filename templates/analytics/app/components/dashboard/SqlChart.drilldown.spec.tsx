// @vitest-environment happy-dom

import { act } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    ComposedChart: chart,
    Line: series("line"),
    LineChart: chart,
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
});
