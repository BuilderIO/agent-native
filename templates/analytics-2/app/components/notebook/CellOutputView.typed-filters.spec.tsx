// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellOutputSchema } from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView
          output={cellOutputSchema.parse({
            type: "table",
            columns: [
              { name: "region", type: "string" },
              { name: "amount", type: "number" },
              { name: "day", type: "date" },
              { name: "enabled", type: "boolean" },
            ],
            rows: [
              ["A, B", 7, "2026-01-01", true],
              ["B", 10, "2026-01-02", false],
              ["C", 42, "2026-01-03", true],
              [null, null, null, null],
            ],
            rowCount: 4,
            truncated: false,
          })}
        />
      </AgentNativeI18nProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function control<T extends Element>(selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}
function click(label: string) {
  act(() =>
    control<HTMLButtonElement>(`button[aria-label="${label}"]`).click(),
  );
}
function openFilter(column: string) {
  act(() =>
    control<HTMLButtonElement>(
      `button[aria-label="Column actions for ${column}"]`,
    ).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  const menuitem = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((element) => element.textContent === "Filter...");
  if (!menuitem) throw new Error("Filter menu action missing");
  act(() => menuitem.click());
}
function openSelect(label: string) {
  const trigger = control<HTMLElement>(
    `[role="combobox"][aria-label="${label}"]`,
  );
  act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}
function select(label: string, text: string) {
  openSelect(label);
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent === text);
  if (!option) throw new Error(`Missing option: ${text}`);
  act(() =>
    option.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}
function options(label: string) {
  openSelect(label);
  const labels = [...document.querySelectorAll('[role="option"]')].map(
    (item) => item.textContent,
  );
  act(() =>
    document
      .querySelector('[role="listbox"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  return labels;
}
function input(label: string, value: string) {
  act(() => {
    const element = control<HTMLInputElement>(`input[aria-label="${label}"]`);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const rows = () =>
  [...container.querySelectorAll("tbody tr td:first-of-type")].map(
    (element) => element.textContent,
  );

it("applies inclusive numeric comparisons, combines a boolean filter, and removes either filter", () => {
  openFilter("amount");
  const numericLabels = options("Filter operator amount 1");
  expect(numericLabels).toContain("Greater than or equal to");
  expect(numericLabels).toContain("Less than or equal to");
  input("Filter amount", "10");
  expect(rows()).toEqual(["C"]);
  select("Filter operator amount 1", "Greater than or equal to");
  expect(rows()).toEqual(["B", "C"]);
  select("Filter operator amount 1", "Less than or equal to");
  expect(rows()).toEqual(["A, B", "B"]);
  click("Add filter");
  select("Filter column 2", "enabled");
  expect(rows()).toEqual(["A, B"]);
  click("Remove filter amount 1");
  expect(rows()).toEqual(["A, B", "C"]);
  select("Filter operator enabled 1", "Is false");
  expect(rows()).toEqual(["B"]);
  click("Remove filter enabled 1");
  expect(rows()).toHaveLength(4);
});

it("preserves comma-containing list values and offers negative text and inclusive date range predicates", () => {
  openFilter("region");
  const labels = options("Filter operator region 1");
  expect(labels).toContain("Is one of");
  expect(labels).toContain("Text does not contain");
  expect(labels).not.toContain("starts with");
  select("Filter operator region 1", "Is one of");
  click("Filter values region");
  const choice = [...document.querySelectorAll("label")]
    .find((item) => item.textContent === "A, B")
    ?.querySelector<HTMLButtonElement>('[role="checkbox"]');
  if (!choice) throw new Error("Missing exact comma-containing value");
  act(() => choice.click());
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(rows()).toEqual(["A, B"]);
  select("Filter operator region 1", "Text does not contain");
  input("Filter region", "B");
  expect(rows()).toEqual(["C"]);
  select("Filter column 1", "day");
  const dateLabels = options("Filter operator day 1");
  expect(dateLabels).toContain("Is on or after");
  expect(dateLabels).toContain("Is between");
  input("Filter day", "2026-01-02");
  expect(rows()).toEqual(["B", "C"]);
  select("Filter operator day 1", "Is between");
  input("Filter end day", "2026-01-03");
  expect(rows()).toEqual(["B", "C"]);
  input("Filter day", "2026-01-03");
  expect(rows()).toEqual(["C"]);
});
