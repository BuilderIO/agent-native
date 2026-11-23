// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { DocumentProperty } from "@shared/api";
import { act, useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import { click, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({ session: null }),
}));

import {
  DatabaseActiveConstraintsBar,
  databaseFilterOptionChoices,
} from "./DatabaseView";
import { contentFilterFields, useContentFilterKitState } from "./filter-kit";
import type { DatabaseFilter, DatabaseFilterMode } from "./types";

const status: DocumentProperty = {
  definition: {
    id: "status",
    databaseId: "database",
    name: "Status",
    type: "select",
    visibility: "always_show",
    options: {
      options: [
        { id: "done", name: "Done", color: "green" },
        { id: "doing", name: "Doing", color: "blue" },
      ],
    },
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: null,
  editable: true,
};

const properties = [status];

function nameFilter(
  value: string,
  group: Partial<DatabaseFilter> = {},
): DatabaseFilter {
  return { key: "name", label: "Name", operator: "contains", value, ...group };
}

function renderBar(
  initialFilters: DatabaseFilter[],
  initialMode: DatabaseFilterMode = "and",
) {
  const latest = { filters: initialFilters, filterMode: initialMode };

  function Bar() {
    const [query, setQuery] = useState(latest);
    latest.filters = query.filters;
    latest.filterMode = query.filterMode;
    const fields = useMemo(
      () =>
        contentFilterFields(properties, {
          nameLabel: "Name",
          choices: (property) =>
            databaseFilterOptionChoices(property.definition.id, properties),
        }),
      [],
    );
    const kit = useContentFilterKitState({
      filters: query.filters,
      filterMode: query.filterMode,
      properties,
      fields,
      nameLabel: "Name",
      onChange: (filters, filterMode) => setQuery({ filters, filterMode }),
    });
    return (
      <DatabaseActiveConstraintsBar
        searchQuery=""
        sorts={[]}
        filters={query.filters}
        properties={properties}
        filterFields={fields}
        filterState={kit.state}
        constraintCount={query.filters.length}
        forceShow
        openSortIndex={null}
        hasPersonalQueryChanges={false}
        savePending={false}
        onSortOpenIndexChange={() => {}}
        onClearSearch={() => {}}
        onRemoveSort={() => {}}
        onSortsChange={() => {}}
        onFilterStateChange={kit.setState}
        onClearAll={() => {}}
        onResetPersonalChanges={() => {}}
        onSaveForEveryone={() => {}}
      />
    );
  }

  renderUi(
    <AgentNativeI18nProvider
      initialLocale="en-US"
      persistPreference={false}
      catalog={i18nCatalog}
    >
      <Bar />
    </AgentNativeI18nProvider>,
  );
  return latest;
}

function button(name: string) {
  const buttons = [...document.querySelectorAll<HTMLElement>("button")];
  const match = buttons.find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name ||
      candidate.textContent.trim() === name,
  );
  if (!match) {
    const names = buttons.map(
      (candidate) =>
        candidate.getAttribute("aria-label") ?? candidate.textContent.trim(),
    );
    throw new Error(`No button named ${name} among: ${names.join(" | ")}`);
  }
  return match;
}

// oracle-change(templates/content/app/components/editor/database/DatabaseView.filter-chips.ui.test.tsx): it tested Content's own filter chips, which the shared filter kit's chips replace
// oracle-change(templates/content/app/components/editor/database/DatabaseView.filter-groups.ui.test.tsx): it tested Content's advanced group editor, which the kit's groups replace
// oracle-change(templates/content/app/components/editor/database/DatabaseView.filter-operators.ui.test.tsx): it tested Content's own operator and date menus, which the kit's editors replace
// oracle-change(templates/content/app/components/editor/database/DatabaseView.filter-picker.ui.test.tsx): it tested Content's own add-filter picker, which the kit's add menu replaces
describe("the filter row on the shared filter kit", () => {
  it("names a saved option filter's option and removes it with its chip", async () => {
    const latest = renderBar([
      {
        key: "status",
        label: "Status",
        operator: "does_not_equal",
        value: "done",
      },
    ]);
    expect(button("Status: not Done")).toBeDefined();
    await click(button("Remove Status: not Done"));
    expect(latest.filters).toEqual([]);
  });

  it("shows a group, and a group inside it, as one chip", () => {
    renderBar([
      nameFilter("a", { filterGroupId: "advanced", filterGroupMode: "or" }),
      nameFilter("b", {
        filterGroupId: "inner",
        filterGroupMode: "and",
        parentFilterGroupId: "advanced",
        parentFilterGroupMode: "or",
      }),
      nameFilter("c", {
        filterGroupId: "inner",
        filterGroupMode: "and",
        parentFilterGroupId: "advanced",
        parentFilterGroupMode: "or",
      }),
    ]);
    expect(
      button(
        "(Name: contains “a” or (Name: contains “b” and Name: contains “c”))",
      ),
    ).toBeDefined();
  });

  it("switches the view between all and any from the joiner", async () => {
    const latest = renderBar([nameFilter("a"), nameFilter("b")]);
    const joiner = button("and");
    act(() => {
      joiner.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ].find((candidate) =>
      candidate.textContent.includes("One matching rule is enough"),
    );
    if (!item) throw new Error("No any-mode item");
    await click(item);
    expect(latest.filterMode).toBe("or");
    expect(latest.filters.map((filter) => filter.value)).toEqual(["a", "b"]);
  });
});
