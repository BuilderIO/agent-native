// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { chartSpecSchema } from "@/lib/model/contracts";

import { ReadOnlyChart } from "./ReadOnlyChart";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useT: () => (key: string) =>
    ({
      "funnel.completed": "Completed",
      "funnel.skipped": "Skipped",
      "funnel.movedOn": "Moved on without either",
      "funnel.left": "Left the app here",
      "funnel.optional": "Optional",
      "funnel.invalid": "Invalid funnel outcome counts",
    })[key] ?? key,
}));
const binding = {
  completedKey: "done",
  skippedKey: "skip",
  leftKey: "left",
  optionalKey: "optional",
};
const rawSpec = {
  mark: "funnel",
  xField: "stage",
  yField: "shown",
  seriesField: null,
  title: null,
  seriesLabels: { "1": "First" },
  funnelOutcomes: binding,
};
const dataframe = {
  name: "test",
  cellId: "test",
  columns: ["stage", "shown", "done", "skip", "left", "optional"].map(
    (name) => ({ name, type: name === "stage" ? "string" : "number" }),
  ),
  rows: [
    [1, 100, 50, 10, 20, true],
    [2, 0, 0, 0, 0, false],
  ],
};

describe("report A2-ASK84-FUNNEL-OUTCOMES", () => {
  it("preserves configured bindings in the persisted chart contract", () => {
    const saved = chartSpecSchema.parse(rawSpec);
    expect(
      chartSpecSchema.parse(JSON.parse(JSON.stringify(saved))),
    ).toMatchObject({ funnelOutcomes: binding });
    expect(
      chartSpecSchema.safeParse({
        ...rawSpec,
        funnelOutcomes: { ...binding, completedKey: "" },
      }).success,
    ).toBe(false);
  });
  it("renders outcomes, zero stages, optional and raw mark clicks", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const click = vi.fn();
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="test"
          dataframes={[dataframe]}
          spec={chartSpecSchema.parse(rawSpec)}
          onMarkClick={click}
        />,
      ),
    );
    expect(host.textContent).toContain("First");
    for (const value of [
      "Completed",
      "Skipped",
      "Moved on without either",
      "Left the app here",
      "Optional",
      "20.0%",
      "0.0%",
      "50",
      "10",
      "20",
    ])
      expect(host.textContent).toContain(value);
    const mark = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Completed: 50"]',
    );
    expect(mark).not.toBeNull();
    expect(
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .slice(0, 4)
        .map((button) => button.style.width),
    ).toEqual(["50%", "10%", "20%", "20%"]);
    act(() => mark?.click());
    expect(click).toHaveBeenCalledWith({ x: "1", series: "done" });
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
    act(() => root.unmount());
  });
  it.each([
    [100, 90, 10, 20],
    [100, -1, 0, 0],
    [100, null, 0, 0],
  ])("shows invalid outcome data", (shown, done, skip, left) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const invalid = {
      ...dataframe,
      rows: [["a", shown, done, skip, left, false]],
    };
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="test"
          dataframes={[invalid]}
          spec={chartSpecSchema.parse(rawSpec)}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid funnel outcome counts",
    );
    act(() => root.unmount());
  });
  it.each([true, false, 1, 0, "TRUE", "False", "1", "0"])(
    "accepts numeric strings and optional flag %s",
    (flag) => {
      const host = document.createElement("div");
      const root = createRoot(host);
      const values = {
        ...dataframe,
        rows: [["raw", " 100 ", "50", "10", "20", flag]],
      };
      const click = vi.fn();
      act(() =>
        root.render(
          <ReadOnlyChart
            dataframe="test"
            dataframes={[values]}
            spec={chartSpecSchema.parse(rawSpec)}
            onMarkClick={click}
          />,
        ),
      );
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.textContent?.includes("Optional")).toBe(
        [true, 1, "TRUE", "1"].includes(flag),
      );
      const mark = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Completed: 50"]',
      );
      expect(mark).not.toBeNull();
      act(() => mark?.click());
      expect(click).toHaveBeenCalledWith({ x: "raw", series: "done" });
      act(() => root.unmount());
    },
  );
  it.each([null, "", "yes", 2])(
    "rejects malformed optional flag %s",
    (flag) => {
      const host = document.createElement("div");
      const root = createRoot(host);
      const values = { ...dataframe, rows: [["raw", 100, 50, 10, 20, flag]] };
      act(() =>
        root.render(
          <ReadOnlyChart
            dataframe="test"
            dataframes={[values]}
            spec={chartSpecSchema.parse(rawSpec)}
          />,
        ),
      );
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      act(() => root.unmount());
    },
  );
  it("omits skipped legend when no skipped field is bound", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const { skippedKey: _, ...noSkip } = binding;
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="test"
          dataframes={[dataframe]}
          spec={chartSpecSchema.parse({ ...rawSpec, funnelOutcomes: noSkip })}
        />,
      ),
    );
    expect(
      host.querySelector(".nb-chart")?.lastElementChild?.textContent,
    ).not.toContain("Skipped");
    act(() => root.unmount());
  });
  it.each([
    { xField: "stage", yField: "stage" },
    { xField: "missing", yField: "shown" },
    { xField: "stage", yField: "missing" },
  ])("shows an error for invalid axis bindings %s", (axes) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="test"
          dataframes={[dataframe]}
          spec={chartSpecSchema.parse({ ...rawSpec, ...axes })}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    act(() => root.unmount());
  });
  it("retains legacy funnel rendering", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const { funnelOutcomes: _, ...legacy } = rawSpec;
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="test"
          dataframes={[dataframe]}
          spec={chartSpecSchema.parse(legacy)}
        />,
      ),
    );
    expect(host.querySelectorAll("[data-funnel-stage]")).toHaveLength(2);
    act(() => root.unmount());
  });
});
