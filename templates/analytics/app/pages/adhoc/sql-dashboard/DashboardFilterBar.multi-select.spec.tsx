// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

function render(initialEntry = "/dashboards/test") {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <DashboardFilterBar filters={filters} />
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

function optionCheckbox(label: string): HTMLButtonElement {
  const row = [...document.querySelectorAll("label")].find(
    (el) => el.textContent?.trim() === label,
  );
  const checkbox = row?.querySelector<HTMLButtonElement>('[role="checkbox"]');
  if (!checkbox) throw new Error(`checkbox for ${label} not rendered`);
  return checkbox;
}

describe("multi-select dashboard filter", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    search = "";
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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

  it("removes the param when the last option is unchecked", () => {
    render("/dashboards/test?f_plan=enterprise");
    act(() => trigger().click());
    act(() => optionCheckbox("Enterprise").click());

    expect(new URLSearchParams(search).has("f_plan")).toBe(false);
  });
});
