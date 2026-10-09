// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "../../../i18n";
import { DashboardFilterBar } from "./DashboardFilterBar";
import type { DashboardFilter } from "./types";

const filters: DashboardFilter[] = [
  {
    id: "plan",
    label: "Plan",
    type: "multi-select",
    options: [
      { value: "free", label: "Free" },
      { value: "self_serve", label: "Self-Serve" },
      { value: "enterprise", label: "Enterprise" },
    ],
  },
];

let container: HTMLDivElement;
let root: Root;
let search = "";

function SearchProbe() {
  const location = useLocation();
  search = location.search;
  return null;
}

function render(
  initialEntry = "/dashboards/test",
  list: DashboardFilter[] = filters,
) {
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <MemoryRouter initialEntries={[initialEntry]}>
          <DashboardFilterBar filters={list} />
          <SearchProbe />
        </MemoryRouter>
      </AgentNativeI18nProvider>,
    );
  });
}

function trigger(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="dialog"]',
  );
  if (!button) throw new Error("multi-select trigger not rendered");
  return button;
}

// The popover renders into a portal, and the filter bar has its own "Clear all" button, so lookups stay inside the open dialog.
function popover(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error("multi-select popover not open");
  return dialog;
}

function optionLabel(text: string): HTMLLabelElement {
  const label = [...popover().querySelectorAll("label")].find(
    (el) => el.textContent?.trim() === text,
  );
  if (!label) throw new Error(`option ${text} not rendered`);
  return label;
}

function optionCheckbox(text: string): HTMLButtonElement {
  const checkbox = document.getElementById(optionLabel(text).htmlFor);
  if (!(checkbox instanceof HTMLButtonElement)) {
    throw new Error(`checkbox for ${text} not rendered`);
  }
  return checkbox;
}

function popoverButton(text: string): HTMLButtonElement {
  const button = [...popover().querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button ${text} not rendered`);
  return button;
}

function onlyButton(value: string): HTMLButtonElement {
  const option = optionLabel(value).parentElement;
  const button = [
    ...(option?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((element) => element.textContent?.trim() === "Only");
  if (!button) throw new Error(`Only button for ${value} not rendered`);
  expect(button.getAttribute("aria-label")).toBe(`Only ${value}`);
  return button;
}

function searchInput(): HTMLInputElement {
  const input = popover().querySelector<HTMLInputElement>(
    'input[role="searchbox"]',
  );
  if (!input) throw new Error("multi-select search input not rendered");
  return input;
}

function setSearchQuery(value: string) {
  const input = searchInput();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  act(() => input.dispatchEvent(new Event("input", { bubbles: true })));
}

describe("multi-select dashboard filter", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    search = "";
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("writes the comma-joined selection to the URL and labels the trigger", () => {
    render();
    expect(trigger().textContent).toContain("All");

    act(() => trigger().click());
    act(() => optionCheckbox("Free").click());
    act(() => optionCheckbox("Self-Serve").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe("free,self_serve");
    expect(trigger().textContent).toContain("Free, Self-Serve");
  });

  it("names the trigger after its filter label and current value", () => {
    render();
    const ids = trigger().getAttribute("aria-labelledby")?.split(" ") ?? [];
    const names = ids.map((id) => document.getElementById(id)?.textContent);

    expect(names[0]).toBe("Plan");
    expect(names[1]).toContain("All");
  });

  it("toggles an option when its label text is clicked", () => {
    render();
    act(() => trigger().click());
    act(() => optionLabel("Enterprise").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe("enterprise");
  });

  it("keeps an empty selection empty instead of restoring the default", () => {
    const withDefault: DashboardFilter[] = [
      { ...filters[0], default: "enterprise" },
    ];
    render("/dashboards/test", withDefault);
    expect(trigger().textContent).toContain("Enterprise");

    act(() => trigger().click());
    act(() => optionCheckbox("Enterprise").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe("__empty__");
    expect(trigger().textContent).toContain("All");
  });

  it("labels URL values that match no option instead of showing All", () => {
    render("/dashboards/test?f_plan=legacy,free");
    expect(trigger().textContent).toContain("legacy, Free");
  });

  it("clears the whole selection from the popover", () => {
    render("/dashboards/test?f_plan=free,self_serve");
    act(() => trigger().click());
    act(() => popoverButton("Clear all").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe("__empty__");
  });

  it("selects all configured options and summarizes them as All", () => {
    render();
    act(() => trigger().click());
    act(() => popoverButton("Select all").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe(
      "free,self_serve,enterprise",
    );
    expect(trigger().textContent).toContain("All");
    expect(optionCheckbox("Free").getAttribute("aria-checked")).toBe("true");
    expect(optionCheckbox("Enterprise").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("deduplicates options with the same value before rendering and selecting all", () => {
    const duplicateOptions: DashboardFilter[] = [
      {
        ...filters[0],
        options: [
          ...filters[0].options!,
          { value: "free", label: "Free duplicate" },
        ],
      },
    ];
    render("/dashboards/test", duplicateOptions);
    act(() => trigger().click());

    expect(() => optionLabel("Free duplicate")).toThrow(
      "option Free duplicate not rendered",
    );
    act(() => popoverButton("Select all").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe(
      "free,self_serve,enterprise",
    );
    expect(trigger().textContent).toContain("All");
  });

  it("keeps unknown URL values when selecting all search matches", () => {
    render("/dashboards/test?f_plan=legacy,self_serve");
    act(() => trigger().click());
    setSearchQuery("free");
    act(() => popoverButton("Select all").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe(
      "legacy,self_serve,free",
    );
    expect(trigger().textContent).toContain("legacy, Self-Serve, Free");
  });

  it("keeps unknown URL values when toggling configured options", () => {
    render("/dashboards/test?f_plan=legacy,self_serve");
    act(() => trigger().click());
    act(() => optionCheckbox("Free").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe(
      "legacy,self_serve,free",
    );
    act(() => optionCheckbox("Self-Serve").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe("legacy,free");
  });

  it("limits the selection to one option from its Only action", () => {
    render("/dashboards/test?f_plan=free,self_serve");
    act(() => trigger().click());
    act(() => onlyButton("Enterprise").click());

    expect(new URLSearchParams(search).get("f_plan")).toBe("enterprise");
    expect(optionCheckbox("Free").getAttribute("aria-checked")).toBe("false");
    expect(optionCheckbox("Enterprise").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("searches option labels and reports when there are no matches", () => {
    render();
    act(() => trigger().click());
    const status = popover().querySelector('[role="status"]');
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.closest("ul")).toBeNull();

    setSearchQuery("self");

    expect(optionLabel("Self-Serve")).toBeTruthy();
    expect(() => optionLabel("Free")).toThrow("option Free not rendered");
    expect(popover().querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe("");

    setSearchQuery("not a value");
    expect(popover().textContent).toContain("No values found");
    expect(popover().querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe("No values found");
    expect(popoverButton("Select all").disabled).toBe(true);
    act(() => popoverButton("Select all").click());
    expect(new URLSearchParams(search).has("f_plan")).toBe(false);
  });
});
