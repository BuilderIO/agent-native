// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SidebarSection, type SectionRow } from "./primitives";

const rows = (count: number): SectionRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `row-${index + 1}`,
    title: `Recent ${index + 1}`,
    href: `/project/row-${index + 1}/latest`,
    icon: null,
  }));

describe("sidebar Recents collapse", () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = (count: number, collapsedCount?: number) =>
    act(() => {
      root.render(
        <MemoryRouter>
          <SidebarSection
            title="RECENTS"
            rows={rows(count)}
            {...(collapsedCount === undefined ? {} : { collapsedCount })}
          />
        </MemoryRouter>,
      );
    });
  const labels = () =>
    [...host.querySelectorAll("a.ws-section-row")].map((row) =>
      row.textContent.trim(),
    );
  const toggle = () =>
    [...host.querySelectorAll("button")].find((button) =>
      ["More", "Less"].includes(button.textContent.trim()),
    );

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows five rows and a More row, then every row and Less", () => {
    render(9, 5);
    expect(labels()).toEqual([
      "Recent 1",
      "Recent 2",
      "Recent 3",
      "Recent 4",
      "Recent 5",
    ]);
    expect(toggle()?.textContent.trim()).toBe("More");
    act(() => toggle()?.click());
    expect(labels()).toHaveLength(9);
    expect(toggle()?.textContent.trim()).toBe("Less");
    act(() => toggle()?.click());
    expect(labels()).toHaveLength(5);
  });

  it("draws no toggle when the rows already fit", () => {
    render(5, 5);
    expect(labels()).toHaveLength(5);
    expect(toggle()).toBeUndefined();
  });

  it("leaves sections without a collapse limit untouched", () => {
    render(9);
    expect(labels()).toHaveLength(9);
    expect(toggle()).toBeUndefined();
  });
});
