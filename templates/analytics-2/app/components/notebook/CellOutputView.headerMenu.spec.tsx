// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellOutputSchema } from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";

it("report B-RESULT-HEADER-MENU-ENTRY: opens from the name and by right-click, preserving sort and filter", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            output={cellOutputSchema.parse({
              type: "table",
              columns: [{ name: "region", type: "string" }],
              rows: [["B"], ["A"]],
              rowCount: 2,
              truncated: false,
            })}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const name = [...container.querySelectorAll("th span")].find(
      (el) => el.textContent === "region",
    );
    if (!name) throw new Error("Column name missing");
    act(() =>
      name.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, bubbles: true }),
      ),
    );
    const sort = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent === "Sort A → Z");
    expect(sort).toBeDefined();
    act(() => sort?.click());
    expect(
      [...container.querySelectorAll("tbody td")].map((el) => el.textContent),
    ).toEqual(["A", "B"]);
    const contextMenu = new MouseEvent("contextmenu", {
      button: 2,
      bubbles: true,
      cancelable: true,
    });
    act(() => name.dispatchEvent(contextMenu));
    expect(contextMenu.defaultPrevented).toBe(true);
    const filter = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent === "Filter...");
    expect(filter).toBeDefined();
    act(() => filter?.click());
    expect(
      container.querySelector('input[aria-label="Filter region"]'),
    ).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("report B-RESULT-ACTIVE-SORT: shows the active sort direction in the header and menu until cleared", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            output={cellOutputSchema.parse({
              type: "table",
              columns: [{ name: "region", type: "string" }],
              rows: [["B"], ["A"]],
              rowCount: 2,
              truncated: false,
            })}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const header = container.querySelector<HTMLButtonElement>(".nb-th-menu");
    if (!header) throw new Error("Column header missing");
    const open = () =>
      act(() =>
        header.dispatchEvent(
          new PointerEvent("pointerdown", { button: 0, bubbles: true }),
        ),
      );
    const item = (label: string) => {
      const found = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((el) => el.textContent === label);
      if (!found) throw new Error(`Missing menu item ${label}`);
      return found;
    };
    void open();
    act(() => item("Sort A → Z").click());
    expect(
      header.querySelector("svg.tabler-icon-sort-ascending"),
    ).not.toBeNull();
    void open();
    expect(
      item("Sort A → Z").querySelector("svg.tabler-icon-check"),
    ).not.toBeNull();
    expect(
      item("Sort Z → A").querySelector("svg.tabler-icon-check"),
    ).toBeNull();
    act(() => item("Sort Z → A").click());
    expect(
      header.querySelector("svg.tabler-icon-sort-descending"),
    ).not.toBeNull();
    void open();
    expect(
      item("Sort Z → A").querySelector("svg.tabler-icon-check"),
    ).not.toBeNull();
    act(() => item("Sort Z → A").click());
    expect(
      header.querySelector(
        "svg.tabler-icon-sort-descending, svg.tabler-icon-sort-ascending",
      ),
    ).toBeNull();
    void open();
    expect(
      item("Sort Z → A").querySelector("svg.tabler-icon-check"),
    ).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
