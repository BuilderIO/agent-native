// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { pickSelect, selectLabels, selectTrigger } from "@/testing/select";

import { ChartConfigBody } from "./ChartConfigBody";

vi.mock("@agent-native/core/client/i18n", async () => {
  const { i18nMock } = await import("../../skins/reference/testing/i18n");
  return { ...i18nMock, useOptionalLocale: () => null };
});

type Props = Parameters<typeof ChartConfigBody>[0];
const rows =
  '[{"month":"January","value":10},{"month":"February","value":20},{"month":"March","value":15}]';
const initial: Props["spec"] = {
  mark: "bar",
  xField: "month",
  yField: "value",
  seriesField: null,
  title: "Monthly values",
};
function editable(dataframe = rows, starting = initial) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  let current = { ...starting };
  const render = () =>
    root.render(
      <ChartConfigBody
        dataframe={dataframe}
        spec={current}
        dataframes={[]}
        onChange={(next) => {
          if (next.chartSpec) current = { ...current, ...next.chartSpec };
          render();
        }}
      />,
    );
  act(render);
  return {
    el,
    select: (label: string) => selectTrigger(el, label),
    labels: (label: string) => selectLabels(el, label),
    pick: (label: string, value: string) =>
      pickSelect(el, label, value || "None"),
    current: () => current,
    close: () => {
      act(() => root.unmount());
      el.remove();
    },
  };
}
it.each([
  ["X-axis", ""],
  ["X-axis", "value"],
  ["Y-axis", ""],
  ["Y-axis", "month"],
])("keeps schema recoverable after %s selects %s", (axis, value) => {
  const ui = editable();
  ui.pick(axis, value);
  expect(axis === "X-axis" ? ui.current().xField : ui.current().yField).toBe(
    value || null,
  );
  for (const label of ["X-axis", "Y-axis"]) {
    expect(ui.select(label).disabled).toBe(false);
    expect(ui.labels(label)).toEqual(["None", "month", "value"]);
  }
  ui.pick("X-axis", "month");
  ui.pick("Y-axis", "value");
  expect(
    [...ui.el.querySelectorAll(".nb-chart-bar title")].map(
      (n) => n.textContent,
    ),
  ).toEqual(["January: 10", "February: 20", "March: 15"]);
  ui.close();
});
it("rejects an otherwise valid prototype-named string column", () => {
  const ui = editable('[{"__proto__":"January","score":10}]', {
    ...initial,
    xField: "__proto__",
    yField: "score",
  });
  expect(ui.el.querySelector(".nb-chart-svg")).toBeNull();
  expect(ui.select("X-axis").disabled).toBe(true);
  ui.close();
});

it("infers arbitrary field names independent of key order and recovers the axes", () => {
  const ui = editable('[{"amount":4,"group":"A"},{"group":"B","amount":8}]', {
    ...initial,
    xField: "group",
    yField: "amount",
  });
  expect(
    [...ui.el.querySelectorAll(".nb-chart-bar title")].map(
      (n) => n.textContent,
    ),
  ).toEqual(["A: 4", "B: 8"]);
  ui.pick("Y-axis", "group");
  expect(ui.select("X-axis").disabled).toBe(false);
  expect(ui.labels("Y-axis")).toEqual(["None", "group", "amount"]);
  ui.pick("Y-axis", "amount");
  expect(
    [...ui.el.querySelectorAll(".nb-chart-bar title")].map(
      (n) => n.textContent,
    ),
  ).toEqual(["A: 4", "B: 8"]);
  ui.close();
});
