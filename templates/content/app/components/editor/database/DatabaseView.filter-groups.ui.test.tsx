// @vitest-environment happy-dom

import type { ContentDatabaseView } from "@shared/api";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { click, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({ session: null }),
}));

import {
  DatabaseActiveConstraintsBar,
  databaseFilterGroupModeForNewRule,
  databaseViewWithFilterGroupMode,
  databaseViewWithFilterMode,
} from "./DatabaseView";
import type { DatabaseFilter } from "./types";

function nameFilter(
  value: string,
  group: Partial<DatabaseFilter> = {},
): DatabaseFilter {
  return { key: "name", label: "Name", operator: "contains", value, ...group };
}

const advanced = { filterGroupId: "advanced" };
const nested = {
  filterGroupId: "advanced-nested",
  parentFilterGroupId: "advanced",
};

function view(filters: DatabaseFilter[]): ContentDatabaseView {
  return {
    id: "table",
    name: "Table",
    type: "table",
    sorts: [],
    filters,
    filterMode: "and",
    columnWidths: {},
  };
}

// Renders the constraint row over a view the way the table does, so a mode
// change goes through the same view update the table saves.
function renderBar(initial: ContentDatabaseView, advancedFilterOpen = true) {
  const latest = { view: initial };
  const onFilterModeChange = vi.fn();
  const onFilterGroupModeChange = vi.fn();

  function Bar() {
    const [current, setCurrent] = useState(initial);
    latest.view = current;
    return (
      <DatabaseActiveConstraintsBar
        documentId="database-document"
        items={[]}
        searchQuery=""
        sorts={[]}
        filters={current.filters}
        filterMode={current.filterMode ?? "and"}
        properties={[]}
        constraintCount={current.filters.length}
        forceShow
        addFilterOpen={false}
        openSortIndex={null}
        openFilterIndex={null}
        advancedFilterOpen={advancedFilterOpen}
        hasPersonalQueryChanges={false}
        savePending={false}
        onAddFilterOpenChange={() => {}}
        onSortOpenIndexChange={() => {}}
        onFilterOpenIndexChange={() => {}}
        onAdvancedFilterOpenChange={() => {}}
        onClearSearch={() => {}}
        onRemoveSort={() => {}}
        onRemoveFilter={() => {}}
        onSortsChange={() => {}}
        onFiltersChange={() => {}}
        onFilterModeChange={(mode) => {
          onFilterModeChange(mode);
          setCurrent((value) => databaseViewWithFilterMode(value, mode));
        }}
        onFilterGroupModeChange={(groupId, mode) => {
          onFilterGroupModeChange(groupId, mode);
          setCurrent((value) =>
            databaseViewWithFilterGroupMode(value, groupId, mode),
          );
        }}
        onClearAll={() => {}}
        onResetPersonalChanges={() => {}}
        onSaveForEveryone={() => {}}
      />
    );
  }

  renderUi(<Bar />);
  return { latest, onFilterModeChange, onFilterGroupModeChange };
}

function buttons(text: string) {
  return [...document.querySelectorAll<HTMLElement>("button")].filter(
    (candidate) => candidate.textContent?.trim() === text,
  );
}

function textNodes(text: string) {
  return [...document.querySelectorAll<HTMLElement>("div")].filter(
    (candidate) =>
      candidate.children.length === 0 && candidate.textContent?.trim() === text,
  );
}

async function chooseMenuItem(text: string) {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((candidate) => candidate.textContent?.trim() === text);
  expect(item).toBeDefined();
  await click(item!);
}

describe("advanced filter groups", () => {
  it("sets a nested group's own mode without changing the view's mode", async () => {
    const { latest, onFilterModeChange, onFilterGroupModeChange } = renderBar(
      view([
        nameFilter("launch", advanced),
        nameFilter("draft", nested),
        nameFilter("final", nested),
      ]),
    );

    // The advanced filter's And before the group, then the group's own And.
    const [advancedAnd, groupAnd] = buttons("And");
    expect(advancedAnd).toBeDefined();
    expect(groupAnd).toBeDefined();
    await click(groupAnd!);
    await chooseMenuItem("Or");

    expect(onFilterGroupModeChange).toHaveBeenCalledWith(
      "advanced-nested",
      "or",
    );
    expect(onFilterModeChange).not.toHaveBeenCalled();
    expect(latest.view.filterMode).toBe("and");
    expect(latest.view.filters).toEqual([
      nameFilter("launch", { ...advanced, filterGroupMode: "and" }),
      nameFilter("draft", {
        ...nested,
        filterGroupMode: "or",
        parentFilterGroupMode: "and",
      }),
      nameFilter("final", {
        ...nested,
        filterGroupMode: "or",
        parentFilterGroupMode: "and",
      }),
    ]);
    expect(buttons("And")).toHaveLength(1);
    expect(buttons("Or")).toHaveLength(1);
  });

  it("offers All/Any for one chip beside the advanced filter and keeps the advanced filter's mode", async () => {
    const { latest } = renderBar(
      view([
        nameFilter("launch"),
        nameFilter("draft", advanced),
        nameFilter("final", advanced),
      ]),
      false,
    );

    const all = buttons("All");
    expect(all).toHaveLength(1);
    await click(all[0]!);
    await chooseMenuItem("Any");

    expect(latest.view.filterMode).toBe("or");
    expect(latest.view.filters.map((filter) => filter.filterGroupMode)).toEqual(
      [undefined, "and", "and"],
    );
  });

  it("hides All/Any when the advanced filter is the view's only member", () => {
    renderBar(
      view([nameFilter("draft", advanced), nameFilter("final", advanced)]),
      false,
    );

    expect(buttons("All")).toHaveLength(0);
  });

  it("labels a nested group in first position Where", () => {
    renderBar(
      view([
        nameFilter("draft", nested),
        nameFilter("final", nested),
        nameFilter("launch", {
          filterGroupId: "advanced-second",
          parentFilterGroupId: "advanced",
        }),
      ]),
    );

    // The first group and each group's first rule start with Where; only the
    // second group gets the advanced filter's And.
    expect(textNodes("Where")).toHaveLength(3);
    expect(buttons("And")).toHaveLength(2);
  });

  it("starts a new group with And and adds rules to an existing group in its mode", () => {
    const filters = [
      nameFilter("launch", { ...advanced, filterGroupMode: "or" }),
      nameFilter("draft", nested),
    ];

    // A view set to Any still gives a new group And.
    expect(databaseFilterGroupModeForNewRule([], "advanced", "or")).toBe("and");
    expect(
      databaseFilterGroupModeForNewRule(filters, "advanced-new", "or"),
    ).toBe("and");
    expect(databaseFilterGroupModeForNewRule(filters, "advanced", "and")).toBe(
      "or",
    );
    // A group without a stored mode keeps the view's mode it inherits.
    expect(
      databaseFilterGroupModeForNewRule(filters, "advanced-nested", "or"),
    ).toBe("or");
  });
});
