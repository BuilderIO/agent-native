// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { click, press, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({ session: null }),
}));

import { DatabaseActiveConstraintsBar } from "./DatabaseView";
import type { DatabaseFilter, DatabaseFilterMode } from "./types";

function property(
  id: string,
  name: string,
  type: DocumentProperty["definition"]["type"],
  options: string[] = [],
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name,
      type,
      visibility: "always_show",
      options: options.length
        ? {
            options: options.map((option) => ({
              id: option,
              name: option,
              color: "gray",
            })),
          }
        : {},
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value: null,
    editable: true,
  };
}

const properties = [
  property("status", "Status", "status", ["active", "done", "dropped"]),
  property("due", "Due", "date"),
];

function chip(
  key: string,
  label: string,
  operator: DatabaseFilter["operator"],
  value = "",
): DatabaseFilter {
  return { key, label, operator, value };
}

// The constraint row as the table renders it, keeping every filter change and
// which menu is open.
function renderBar(
  initial: DatabaseFilter[],
  {
    filterMode = "and",
    openIndex = null,
  }: { filterMode?: DatabaseFilterMode; openIndex?: number | null } = {},
) {
  const latest = { filters: initial, openFilterIndex: openIndex };

  function Bar() {
    const [filters, setFilters] = useState(initial);
    const [openFilterIndex, setOpenFilterIndex] = useState(openIndex);
    const [addFilterOpen, setAddFilterOpen] = useState(false);
    latest.filters = filters;
    latest.openFilterIndex = openFilterIndex;
    return (
      <DatabaseActiveConstraintsBar
        documentId="database-document"
        items={[]}
        searchQuery=""
        sorts={[]}
        filters={filters}
        filterMode={filterMode}
        properties={properties}
        constraintCount={filters.length}
        forceShow
        addFilterOpen={addFilterOpen}
        openSortIndex={null}
        openFilterIndex={openFilterIndex}
        advancedFilterOpen={false}
        hasPersonalQueryChanges={false}
        savePending={false}
        onAddFilterOpenChange={setAddFilterOpen}
        onSortOpenIndexChange={() => {}}
        onFilterOpenIndexChange={setOpenFilterIndex}
        onAdvancedFilterOpenChange={() => {}}
        onClearSearch={() => {}}
        onRemoveSort={() => {}}
        onRemoveFilter={() => {}}
        onSortsChange={() => {}}
        onFiltersChange={setFilters}
        onFilterModeChange={() => {}}
        onFilterGroupModeChange={() => {}}
        onClearAll={() => {}}
        onResetPersonalChanges={() => {}}
        onSaveForEveryone={() => {}}
      />
    );
  }

  renderUi(<Bar />);
  return latest;
}

function button(text: string) {
  const match = [...document.querySelectorAll<HTMLElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(match, `button "${text}"`).toBeDefined();
  return match!;
}

function menuItem(text: string) {
  const match = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((candidate) => candidate.textContent?.trim() === text);
  expect(match, `menu item "${text}"`).toBeDefined();
  return match!;
}

describe("filter chips on one option property", () => {
  it("opens the Status chip from + Filter, so a second status joins it", async () => {
    const latest = renderBar([
      chip("status", "Status", "does_not_equal", "done"),
    ]);

    await click(button("Filter"));
    await click(menuItem("Status"));

    expect(latest.filters).toHaveLength(1);
    expect(latest.openFilterIndex).toBe(0);

    await click(menuItem("dropped"));

    expect(latest.filters).toEqual([
      chip(
        "status",
        "Status",
        "does_not_equal",
        JSON.stringify(["done", "dropped"]),
      ),
    ]);
    expect(button("Status: is not done, dropped")).toBeDefined();
  });

  it("still adds a second date chip, for a range", async () => {
    const latest = renderBar([chip("due", "Due", "after", "2026-01-01")]);

    await click(button("Filter"));
    await click(menuItem("Due"));

    expect(latest.filters).toHaveLength(2);
    expect(latest.openFilterIndex).toBe(1);
  });

  it("folds a second is not chip into the first when it closes", async () => {
    const latest = renderBar(
      [
        chip("status", "Status", "does_not_equal", "done"),
        chip("due", "Due", "after", "2026-01-01"),
        chip("status", "Status", "does_not_equal", "dropped"),
      ],
      { openIndex: 2 },
    );

    await press(document.activeElement ?? document.body, "Escape");

    expect(latest.openFilterIndex).toBeNull();
    expect(latest.filters).toEqual([
      chip(
        "status",
        "Status",
        "does_not_equal",
        JSON.stringify(["done", "dropped"]),
      ),
      chip("due", "Due", "after", "2026-01-01"),
    ]);
  });

  it("keeps two is not chips apart under Any, where they mean something else", async () => {
    const initial = [
      chip("status", "Status", "does_not_equal", "done"),
      chip("status", "Status", "does_not_equal", "dropped"),
    ];
    const latest = renderBar(initial, { filterMode: "or", openIndex: 1 });

    await press(document.activeElement ?? document.body, "Escape");

    expect(latest.openFilterIndex).toBeNull();
    expect(latest.filters).toEqual(initial);
  });
});
