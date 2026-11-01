import { Bar, BarChart } from "recharts";
import { describe, expect, it, vi } from "vitest";

import {
  GenericChartRenderer,
  type GenericChartBarMarkClick,
  type GenericChartDatum,
} from "./GenericChartPanel.js";

type TestElement = {
  type: unknown;
  props: Record<string, unknown>;
};

type MouseModifiers = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

type BarClickHandler = (
  data: { payload: GenericChartDatum },
  rowIndex: number,
  event: MouseModifiers,
) => void;

function asElement(value: unknown): TestElement | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("props" in value)
  ) {
    return null;
  }
  return value as TestElement;
}

function childrenOf(element: TestElement): TestElement[] {
  const children = element.props.children;
  const values = Array.isArray(children) ? children.flat(Infinity) : [children];
  return values.flatMap((child) => {
    const element = asElement(child);
    return element ? [element] : [];
  });
}

function renderStackedBars(
  rows: GenericChartDatum[],
  onBarMarkClick?: (click: GenericChartBarMarkClick) => void,
) {
  const canvas = asElement(
    GenericChartRenderer({
      rows,
      config: {
        chartType: "stacked-bar",
        xKey: "category",
        yKeys: ["north", "south"],
        onBarMarkClick,
      },
    }),
  );
  const chart = asElement(canvas?.props.children);
  expect(chart?.type).toBe(BarChart);
  return childrenOf(chart!).filter((child) => child.type === Bar);
}

function clickBar(
  bar: TestElement,
  row: GenericChartDatum,
  rowIndex: number,
  modifiers: MouseModifiers,
) {
  const onClick = bar.props.onClick as BarClickHandler | undefined;
  expect(onClick).toEqual(expect.any(Function));
  onClick!({ payload: row }, rowIndex, modifiers);
}

describe("GenericChartRenderer bar mark clicks", () => {
  it("reports stacked mark rows, series keys, row indexes, and modifiers", () => {
    const rows: GenericChartDatum[] = [
      { category: "alpha", north: 4, south: 0 },
      { category: "beta", north: 0, south: 3 },
    ];
    const originalRows = structuredClone(rows);
    const onBarMarkClick = vi.fn<(click: GenericChartBarMarkClick) => void>();
    const bars = renderStackedBars(rows, onBarMarkClick);

    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.props.stackId)).toEqual(["stack", "stack"]);

    clickBar(bars[0]!, rows[0]!, 0, {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    clickBar(bars[1]!, rows[1]!, 1, {
      altKey: true,
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
    });

    expect(onBarMarkClick).toHaveBeenNthCalledWith(1, {
      dataKey: "north",
      row: rows[0],
      rowIndex: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    expect(onBarMarkClick).toHaveBeenNthCalledWith(2, {
      dataKey: "south",
      row: rows[1],
      rowIndex: 1,
      altKey: true,
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
    });
    expect(rows).toEqual(originalRows);
    expect(onBarMarkClick.mock.calls[0]?.[0].row).toBe(rows[0]);
  });

  it("keeps bar marks non-interactive when no callback is supplied", () => {
    const bars = renderStackedBars([{ category: "alpha", north: 4, south: 0 }]);

    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.props.onClick)).toEqual([
      undefined,
      undefined,
    ]);
  });
});
