// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellOutputSchema } from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  toastSuccess.mockClear();
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
async function openFilter(column: string) {
  const trigger = control<HTMLButtonElement>(
    `button[aria-label="Column actions for ${column}"]`,
  );
  act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  if (!document.querySelector('[role="menuitem"]')) act(() => trigger.click());
  const menuitem = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((element) => element.textContent === "Filter...");
  if (!menuitem) throw new Error("Filter menu action missing");
  act(() => menuitem.click());
  await vi.waitFor(() => {
    const controls = container.querySelectorAll<HTMLInputElement>(
      `input[aria-label="Filter ${column}"]`,
    );
    expect(document.activeElement).toBe(controls[controls.length - 1]);
  });
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

it("report B-RESULT-REOPEN-FILTER: focuses the existing filter without adding another", async () => {
  await openFilter("region");
  input("Filter region", "B");
  const first = control<HTMLInputElement>('input[aria-label="Filter region"]');
  act(() => first.blur());
  await openFilter("region");
  expect(
    container.querySelectorAll('input[aria-label="Filter region"]'),
  ).toHaveLength(1);
  expect(first.value).toBe("B");
  await vi.waitFor(() => expect(document.activeElement).toBe(first));
  expect(rows()).toEqual(["A, B", "B"]);
});

it("focuses the last same-column condition and preserves independent filters", async () => {
  await openFilter("region");
  input("Filter region", "B");
  await openFilter("amount");
  input("Filter amount", "7");
  click("Add filter");
  select("Filter operator region 3", "Text contains");
  const regionInputs = container.querySelectorAll<HTMLInputElement>(
    'input[aria-label="Filter region"]',
  );
  expect(regionInputs).toHaveLength(2);
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(regionInputs[1], "A");
    regionInputs[1]?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await openFilter("region");
  const after = container.querySelectorAll<HTMLInputElement>(
    'input[aria-label="Filter region"]',
  );
  expect(after).toHaveLength(2);
  expect([...after].map((element) => element.value)).toEqual(["B", "A"]);
  expect(
    control<HTMLInputElement>('input[aria-label="Filter amount"]').value,
  ).toBe("7");
  expect(
    control<HTMLElement>(
      '[role="combobox"][aria-label="Filter operator region 3"]',
    ).textContent,
  ).toBe("Text contains");
  await vi.waitFor(() => expect(document.activeElement).toBe(after[1]));
});

it("clears the old filter on schema replacement before creating a new one", async () => {
  await openFilter("region");
  input("Filter region", "B");
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView
          output={cellOutputSchema.parse({
            type: "table",
            columns: [{ name: "new_region", type: "string" }],
            rows: [["C"]],
            rowCount: 1,
            truncated: false,
          })}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  expect(
    container.querySelector('input[aria-label="Filter region"]'),
  ).toBeNull();
  await openFilter("new_region");
  expect(
    container.querySelectorAll('input[aria-label="Filter new_region"]'),
  ).toHaveLength(1);
});

it("report B-RESULT-COPY-TYPED-SORT-MENU: labels types, copies names, and keeps sorting and filtering", async () => {
  let resolveCopy: () => void = () => {
    throw new Error("Copy promise was not initialized");
  };
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveCopy = resolve;
      }),
  );
  vi.stubGlobal("navigator", { clipboard: { writeText } });
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
              { name: "  Region ", type: "string" },
              { name: "integer", type: "number" },
              { name: "enabled", type: "boolean" },
              { name: "day", type: "date" },
              { name: "moment", type: "datetime" },
              { name: "empty", type: "null" },
            ],
            rows: [
              ["B", 2, true, "2026-01-02", "2026-01-02", null],
              ["A", 1, false, "2026-01-01", "2026-01-01", null],
            ],
            rowCount: 2,
            truncated: false,
          })}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const open = async (name: string) => {
    const trigger = control<HTMLButtonElement>(
      `button[aria-label="Column actions for ${name}"]`,
    );
    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      const menu = document.querySelector('[role="menu"]');
      expect(menu).not.toBeNull();
      expect(menu?.contains(document.activeElement)).toBe(true);
    });
    return trigger;
  };
  const closed = async (trigger: HTMLButtonElement) => {
    await vi.waitFor(() => {
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  };
  const choose = async (label: string, trigger: HTMLButtonElement) => {
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent === label);
    expect(item).toBeDefined();
    await act(async () => item?.click());
    await closed(trigger);
  };
  for (const [name, asc, desc] of [
    ["  Region ", "Sort A → Z", "Sort Z → A"],
    ["integer", "Sort 1 → 9", "Sort 9 → 1"],
    ["enabled", "Sort False → True", "Sort True → False"],
    ["day", "Sort Old → New", "Sort New → Old"],
    ["moment", "Sort Old → New", "Sort New → Old"],
    ["empty", "Sort A → Z", "Sort Z → A"],
  ] as const) {
    const trigger = await open(name);
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(["Copy column name", asc, desc, "Filter..."]);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await closed(trigger);
  }
  let trigger = await open("  Region ");
  await choose("Copy column name", trigger);
  expect(writeText).toHaveBeenCalledWith("  Region ");
  expect(toastSuccess).not.toHaveBeenCalled();
  await act(async () => resolveCopy());
  expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard!");
  writeText.mockImplementationOnce(() => Promise.reject(new Error("denied")));
  trigger = await open("  Region ");
  await choose("Copy column name", trigger);
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "We were unable to copy your data to the clipboard.",
    ),
  );
  expect(toastSuccess).toHaveBeenCalledOnce();
  trigger = await open("  Region ");
  await choose("Sort A → Z", trigger);
  expect(rows()).toEqual(["A", "B"]);
  trigger = await open("  Region ");
  await choose("Sort A → Z", trigger);
  expect(rows()).toEqual(["B", "A"]);
  trigger = await open("  Region ");
  await choose("Sort Z → A", trigger);
  expect(rows()).toEqual(["B", "A"]);
  await openFilter("  Region ");
  input("Filter   Region ", "A");
  expect(rows()).toEqual(["A"]);
});
