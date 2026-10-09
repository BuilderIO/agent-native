// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      <MemoryRouter initialEntries={[initialEntry]}>
        <DashboardFilterBar filters={list} />
        <SearchProbe />
      </MemoryRouter>,
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
});
