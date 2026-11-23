// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async () => {
  const { i18nMock } = await import("../../skins/reference/testing/i18n");
  return { ...i18nMock, useOptionalLocale: () => null };
});

import { ChartConfigBody } from "./ChartConfigBody";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const dataframes = [
  {
    name: "orders",
    cellId: "c1",
    columns: [
      { name: "region", type: "string" },
      { name: "order_total", type: "number" },
    ],
    rows: [
      ["north", 10],
      ["south", 30],
    ],
  },
];

const spec = {
  version: 2 as const,
  mark: "bar" as const,
  xField: "region",
  yField: "order_total",
  seriesField: null,
  title: null,
};

function mount(overrides: Partial<Parameters<typeof ChartConfigBody>[0]> = {}) {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    dataframe: "orders",
    spec,
    dataframes,
    onChange,
    ...overrides,
  };
  const render = (next: Partial<typeof props> = {}) =>
    act(() => root.render(<ChartConfigBody {...props} {...next} />));
  render();
  return { container, onChange, render };
}

function titleInput(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Chart title"]',
  );
  if (!input) throw new Error("Missing chart title input");
  return input;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

it("saves the chart title once when the field is left, not on each keystroke", () => {
  const { container, onChange } = mount();
  const input = titleInput(container);
  type(input, "R");
  type(input, "Re");
  type(input, "Revenue");
  expect(onChange).not.toHaveBeenCalled();
  expect(input.value).toBe("Revenue");
  blur(input);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({ chartSpec: { title: "Revenue" } });
});

it("keeps typed text when the config is disabled mid-typing by a save", () => {
  const { container, render } = mount();
  type(titleInput(container), "Quarterly revenue");
  render({ disabled: true });
  expect(titleInput(container).value).toBe("Quarterly revenue");
  render({ disabled: false });
  expect(titleInput(container).value).toBe("Quarterly revenue");
});

it("saves on Enter and saves an emptied title as no title", () => {
  const { container, onChange } = mount({
    spec: { ...spec, title: "Old title" },
  });
  const input = titleInput(container);
  act(() => input.focus());
  type(input, "   ");
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onChange).toHaveBeenCalledWith({ chartSpec: { title: null } });
});

it("does not save an unchanged title", () => {
  const { container, onChange } = mount({
    spec: { ...spec, title: "Same" },
  });
  const input = titleInput(container);
  type(input, "Changed");
  type(input, "Same");
  blur(input);
  expect(onChange).not.toHaveBeenCalled();
});

it("shows the saved title again after a save lands", () => {
  const { container, render } = mount();
  type(titleInput(container), "Draft");
  blur(titleInput(container));
  render({ spec: { ...spec, title: "Draft" } });
  expect(titleInput(container).value).toBe("Draft");
  render({ spec: { ...spec, title: "Changed elsewhere" } });
  expect(titleInput(container).value).toBe("Changed elsewhere");
});

function typeToggle(container: HTMLElement) {
  const toggle = container.querySelector<HTMLButtonElement>(
    "button.nb-chart-type-toggle",
  );
  if (!toggle) throw new Error("Missing chart type toggle");
  return toggle;
}

it("closes the chart type picker on Escape and returns focus to its button", () => {
  const { container } = mount();
  act(() => typeToggle(container).click());
  expect(typeToggle(container).getAttribute("aria-expanded")).toBe("true");
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(typeToggle(container).getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector(".nb-chart-types")).toBeNull();
  expect(document.activeElement).toBe(typeToggle(container));
});

it("closes the chart type picker on a press outside but not inside it", () => {
  const { container } = mount();
  act(() => typeToggle(container).click());
  const panel = container.querySelector<HTMLElement>(".nb-chart-types");
  act(() => {
    panel?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  expect(container.querySelector(".nb-chart-types")).not.toBeNull();
  act(() => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(container.querySelector(".nb-chart-types")).toBeNull();
});

function legendToggle(container: HTMLElement) {
  return [
    ...container.querySelectorAll<HTMLLabelElement>(
      "label.nb-input-settings-checkbox",
    ),
  ]
    .find((label) => label.textContent?.includes("Show legend"))
    ?.querySelector("input");
}

it.each(["pie", "heatmap"] as const)(
  "lets a %s chart hide its legend, which starts shown",
  (mark) => {
    const { container, onChange } = mount({ spec: { ...spec, mark } });
    const toggle = legendToggle(container);
    expect(toggle).toBeTruthy();
    expect(toggle?.checked).toBe(true);
    act(() => toggle?.click());
    expect(onChange).toHaveBeenCalledWith({ chartSpec: { legend: false } });
  },
);

it("lets a scatter chart hide its legend", () => {
  const { container, onChange } = mount({
    spec: { ...spec, mark: "scatter", legend: true },
  });
  const toggle = legendToggle(container);
  expect(toggle?.checked).toBe(true);
  act(() => toggle?.click());
  expect(onChange).toHaveBeenCalledWith({ chartSpec: { legend: false } });
});

it("shows a hidden pie legend as unchecked", () => {
  const { container } = mount({
    spec: { ...spec, mark: "pie", legend: false },
  });
  expect(legendToggle(container)?.checked).toBe(false);
});
