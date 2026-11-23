// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ReadOnlyChart } from "./ReadOnlyChart";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useT: () => (key: string) => key,
}));

describe("A2-DATAFRAME-DECIMAL-CHARTS", () => {
  it("renders decimal result strings as bars without mutating the result", () => {
    const rows = Object.freeze([
      Object.freeze(["A", "0.1"]),
      Object.freeze(["B", "1.25"]),
    ]);
    const dataframe = Object.freeze({
      name: "result",
      cellId: "sql",
      columns: Object.freeze([
        Object.freeze({ name: "category", type: "string" }),
        Object.freeze({ name: "amount", type: "number" }),
      ]),
      rows,
    });
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="result"
          dataframes={[dataframe]}
          spec={{
            mark: "bar",
            xField: "category",
            yField: "amount",
            seriesField: null,
            title: null,
          }}
        />,
      ),
    );
    const bars = [
      ...host.querySelectorAll<SVGRectElement>("svg .nb-chart-bar"),
    ];
    expect(bars).toHaveLength(2);
    // Heights are proportional to 0.1 and 1.25 on one shared scale.
    expect(
      Number(bars[0]?.getAttribute("height")) /
        Number(bars[1]?.getAttribute("height")),
    ).toBeCloseTo(0.1 / 1.25, 1);
    expect(Number(bars[0]?.getAttribute("height"))).toBeGreaterThan(0);
    expect(Number(bars[1]?.getAttribute("height"))).toBeGreaterThan(
      Number(bars[0]?.getAttribute("height")),
    );
    expect(host.querySelector("table")).toBeNull();
    expect(dataframe.rows).toEqual([
      ["A", "0.1"],
      ["B", "1.25"],
    ]);
    expect(dataframe.columns[1]).toEqual({ name: "amount", type: "number" });
    act(() => root.unmount());
  });

  it("uses the table fallback when numeric-typed values are invalid", () => {
    const dataframe = {
      name: "invalid",
      cellId: "sql",
      columns: [
        { name: "category", type: "string" },
        { name: "amount", type: "number" },
      ],
      rows: [
        ["001", ""],
        ["002", "Infinity"],
        ["003", "1e999"],
        ["004", true],
        ["005", null],
      ],
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="invalid"
          dataframes={[dataframe]}
          spec={{
            mark: "bar",
            xField: "category",
            yField: "amount",
            seriesField: null,
            title: null,
          }}
        />,
      ),
    );
    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(host.textContent).toContain("Infinity");
    expect(host.textContent).toContain("001");
    act(() => root.unmount());
  });
});
