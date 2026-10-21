// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { describe, expect, it, vi } from "vitest";

import { byLabel, click, renderUi, typeInto } from "@/test-utils/render-ui";

import { DatabaseAddFilterButton, FilterMenu } from "./DatabaseView";
import type { DatabaseFilter } from "./types";

function property(
  id: string,
  name: string,
  type: DocumentProperty["definition"]["type"],
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name,
      type,
      visibility: "always_show",
      options: {},
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value: null,
    editable: true,
  };
}

const properties = [
  property("status", "Status", "status"),
  property("rank", "Rank", "number"),
];

// Every property, and the page name, already carries a filter.
const filters: DatabaseFilter[] = [
  { key: "status", label: "Status", operator: "does_not_equal", value: "done" },
  { key: "rank", label: "Rank", operator: "is_not_empty", value: "" },
  { key: "name", label: "Name", operator: "contains", value: "launch" },
];

function menuItem(text: string) {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent?.trim() === text,
    ) ?? null
  );
}

const pickers = [
  {
    name: "+ Filter",
    render: (
      onAddFilter: (key: string, label: string) => void,
      onAddAdvancedFilter: (key: string, label: string) => void,
    ) => (
      <DatabaseAddFilterButton
        open
        filters={filters}
        properties={properties}
        onOpenChange={() => {}}
        onAddFilter={onAddFilter}
        onAddAdvancedFilter={onAddAdvancedFilter}
      />
    ),
  },
  {
    name: "toolbar Filter",
    render: (
      onAddFilter: (key: string, label: string) => void,
      onAddAdvancedFilter: (key: string, label: string) => void,
    ) => (
      <FilterMenu
        open
        inlineOpen={false}
        filters={filters}
        properties={properties}
        onOpenChange={() => {}}
        onAddFilter={onAddFilter}
        onAddAdvancedFilter={onAddAdvancedFilter}
      />
    ),
  },
];

describe.each(pickers)("$name property picker", ({ render }) => {
  it("offers a property that already has a filter", async () => {
    const onAddFilter = vi.fn();
    renderUi(render(onAddFilter, vi.fn()));

    await typeInto(byLabel<HTMLInputElement>("Filter by..."), "rank");

    expect(document.body.textContent).not.toContain("No properties found");
    const rank = menuItem("Rank");
    expect(rank).not.toBeNull();
    await click(rank!);
    expect(onAddFilter).toHaveBeenCalledWith("rank", "Rank");
  });

  it("keeps the advanced filter enabled once every property is filtered", async () => {
    const onAddAdvancedFilter = vi.fn();
    renderUi(render(vi.fn(), onAddAdvancedFilter));

    const advanced = menuItem("Add advanced filter");
    expect(advanced?.getAttribute("aria-disabled")).not.toBe("true");
    await click(advanced!);
    expect(onAddAdvancedFilter).toHaveBeenCalledWith("status", "Status");
  });
});
