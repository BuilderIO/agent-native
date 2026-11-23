// @vitest-environment jsdom
// A cell whose kind is Chart must render a chart, not the table it was built
// from. These tests pin that contract at the output renderer, which is where the
// divergence lived: the chart branch rendered `nb-table` for every row.
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const embeddedSpecs: Array<Record<string, unknown>> = [];

vi.mock("vega-embed", () => ({
  default: vi.fn(async (host: HTMLElement, spec: Record<string, unknown>) => {
    embeddedSpecs.push(spec);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("role", "img");
    host.appendChild(svg);
    return {
      view: { addSignalListener: vi.fn() },
      finalize: vi.fn(),
    };
  }),
}));

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    formatCellValue: (value: unknown) => (value == null ? "" : String(value)),
  };
});

import enUS from "@/i18n/en-US";
import type { CellOutput } from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";

const chart = (
  rows: Array<Array<string | number | null>>,
  columns = ["order_date_month", "sum_order_total"],
): Extract<CellOutput, { type: "chart" }> => ({ type: "chart", columns, rows });

async function mountChart(output: Extract<CellOutput, { type: "chart" }>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView output={output} />
      </AgentNativeI18nProvider>,
    );
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("a chart cell renders a chart", () => {
  beforeEach(() => {
    embeddedSpecs.length = 0;
  });

  it("draws one bar per row via Vega-Lite and no table", async () => {
    const { container, unmount } = await mountChart(
      chart([
        ["2025-11", 214938],
        ["2025-10", 188489],
        ["2025-12", 190985],
      ]),
    );
    try {
      expect(container.querySelector(".nb-vega-chart")).not.toBeNull();
      expect(
        container
          .querySelector(".nb-vega-chart")
          ?.getAttribute("data-chart-mark-type"),
      ).toBe("bar");
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.querySelector(".nb-table")).toBeNull();
      expect(embeddedSpecs).toHaveLength(1);
      const host = container.querySelector<HTMLElement>(".nb-vega-chart")!;
      expect(host.style.color).toBe("");
      const spec = embeddedSpecs[0] as {
        data?: { values?: Array<{ x: string; value: number }> };
        encoding?: { color?: { scale?: { range?: string[] } } };
      };
      expect(spec.data?.values?.map((d) => d.value)).toEqual([
        214938, 188489, 190985,
      ]);
      for (const color of spec.encoding?.color?.scale?.range ?? []) {
        expect(color).toBeTruthy();
        expect(color).not.toContain("var(");
      }
    } finally {
      await unmount();
    }
  });

  it("passes exact proportional numeric values to the bar spec", async () => {
    const { unmount } = await mountChart(
      chart([
        ["a", 100],
        ["b", 50],
      ]),
    );
    try {
      expect(embeddedSpecs).toHaveLength(1);
      const spec = embeddedSpecs[0] as {
        data?: { values?: Array<{ x: string; value: number }> };
      };
      const values = spec.data?.values?.map((d) => d.value) ?? [];
      expect(values).toEqual([100, 50]);
      expect(values[0]! / values[1]!).toBeCloseTo(2, 1);
    } finally {
      await unmount();
    }
  });

  it("says what came back when there is nothing numeric to plot", () => {
    const html = renderToStaticMarkup(
      <CellOutputView output={chart([["a", "n/a"]], ["label", "note"])} />,
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain("nb-table");
    expect(html).toContain("label");
  });

  it("leaves a plain table output a table", () => {
    const html = renderToStaticMarkup(
      <CellOutputView
        output={{
          type: "table",
          columns: [
            { name: "a", type: "number" },
            { name: "b", type: "number" },
          ],
          rows: [[1, 2]],
          rowCount: 1,
          truncated: false,
        }}
      />,
    );
    expect(html).toContain("<table");
    expect(html).not.toContain('role="img"');
  });
});
