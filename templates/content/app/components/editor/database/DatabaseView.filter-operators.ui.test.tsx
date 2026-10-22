// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { byLabel, click, renderUi } from "@/test-utils/render-ui";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({ session: null }),
}));

import { DatabaseActiveConstraintsBar } from "./DatabaseView";
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
  property("due", "Due", "date"),
  property("rank", "Rank", "number"),
  property("summary", "Summary", "text"),
];

function filter(
  key: string,
  label: string,
  operator: DatabaseFilter["operator"],
  value = "",
): DatabaseFilter {
  return { key, label, operator, value };
}

// Renders the constraint row the way the table does, with one chip's editor
// open, and keeps every filter change.
function renderBar(initial: DatabaseFilter[], openIndex: number | null = null) {
  const latest = { filters: initial };

  function Bar() {
    const [filters, setFilters] = useState(initial);
    const [openFilterIndex, setOpenFilterIndex] = useState(openIndex);
    latest.filters = filters;
    return (
      <DatabaseActiveConstraintsBar
        documentId="database-document"
        items={[]}
        searchQuery=""
        sorts={[]}
        filters={filters}
        filterMode="and"
        properties={properties}
        constraintCount={filters.length}
        forceShow
        addFilterOpen={false}
        openSortIndex={null}
        openFilterIndex={openFilterIndex}
        advancedFilterOpen={false}
        hasPersonalQueryChanges={false}
        savePending={false}
        onAddFilterOpenChange={() => {}}
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

function menuItems() {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
    (item) => item.textContent?.trim(),
  );
}

async function chooseMenuItem(text: string) {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((candidate) => candidate.textContent?.trim() === text);
  expect(item, `menu item "${text}"`).toBeDefined();
  await click(item!);
}

describe("filter chips", () => {
  it("reads the new text and date operators as phrases", () => {
    renderBar([
      filter("name", "Name", "does_not_contain", "draft"),
      filter("name", "Name", "starts_with", "Launch"),
      filter("summary", "Summary", "ends_with", "notes"),
      filter("due", "Due", "on_or_before", "today"),
      filter("due", "Due", "on_or_after", "2026-10-22"),
      filter("due", "Due", "equals", "tomorrow"),
      filter("due", "Due", "is_within", "next_7_days"),
      filter("due", "Due", "between", JSON.stringify(["yesterday", "today"])),
    ]);

    for (const chip of [
      "Name: does not contain draft",
      "Name: starts with Launch",
      "Summary: ends with notes",
      "Due: on or before today",
      "Due: on or after 2026-10-22",
      "Due: is tomorrow",
      "Due: Next 7 days",
      "Due: yesterday to today",
    ]) {
      button(chip);
    }
  });
});

describe("filter operator menus", () => {
  it("offers text operators for text and the date operators for dates", async () => {
    renderBar([filter("name", "Name", "contains", "launch")], 0);
    await click(button("contains"));
    expect(menuItems()).toEqual(
      expect.arrayContaining([
        "Contains",
        "Does not contain",
        "Is",
        "Is not",
        "Starts with",
        "Ends with",
        "Is empty",
        "Is not empty",
      ]),
    );
    expect(menuItems()).not.toContain("On or before");
    expect(menuItems()).not.toContain("Is within");
  });

  it("offers on or before, on or after, and is within for a date", async () => {
    renderBar([filter("due", "Due", "before", "2026-10-22")], 0);
    await click(button("before"));
    const items = menuItems();
    for (const label of [
      "Is",
      "Is not",
      "Before",
      "After",
      "On or before",
      "On or after",
      "Between",
      "Is within",
      "Is empty",
      "Is not empty",
    ]) {
      expect(items).toContain(label);
    }
    expect(items).not.toContain("Starts with");
    expect(items).not.toContain("Does not contain");
  });

  it("keeps the new operators away from numbers", async () => {
    renderBar([filter("rank", "Rank", "equals", "3")], 0);
    await click(button("is"));
    const items = menuItems();
    expect(items).toContain("Greater than or equal to");
    for (const label of [
      "Does not contain",
      "Starts with",
      "Ends with",
      "On or before",
      "On or after",
      "Is within",
    ]) {
      expect(items).not.toContain(label);
    }
  });
});

describe("date filter values", () => {
  it("picks a relative day and clears the value when switching to is within", async () => {
    const latest = renderBar(
      [filter("due", "Due", "on_or_before", "2026-10-22")],
      0,
    );
    expect(byLabel<HTMLInputElement>("Due").value).toBe("2026-10-22");

    await click(button("Exact date"));
    await chooseMenuItem("Today");
    expect(latest.filters[0]).toMatchObject({
      operator: "on_or_before",
      value: "today",
    });
    button("Due: on or before today");

    await click(button("on or before"));
    await chooseMenuItem("Is within");
    expect(latest.filters[0]).toMatchObject({
      operator: "is_within",
      value: "",
    });

    await click(button("Choose dates"));
    await chooseMenuItem("Next 30 days");
    expect(latest.filters[0]).toMatchObject({
      operator: "is_within",
      value: "next_30_days",
    });
    button("Due: Next 30 days");

    await click(button("is within"));
    await chooseMenuItem("On or after");
    expect(latest.filters[0]).toMatchObject({
      operator: "on_or_after",
      value: "",
    });
  });

  it("keeps a range's start when switching from between to one date", async () => {
    const latest = renderBar(
      [
        filter(
          "due",
          "Due",
          "between",
          JSON.stringify(["2026-10-01", "2026-10-31"]),
        ),
      ],
      0,
    );

    await click(button("between"));
    await chooseMenuItem("On or before");
    expect(latest.filters[0]).toMatchObject({
      operator: "on_or_before",
      value: "2026-10-01",
    });
    button("Due: on or before 2026-10-01");
  });

  it("turns a relative day into its date when switching to between", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 22, 9));
      const latest = renderBar(
        [filter("due", "Due", "on_or_before", "tomorrow")],
        0,
      );

      await click(button("on or before"));
      await chooseMenuItem("Between");
      expect(latest.filters[0]).toMatchObject({
        operator: "between",
        value: "2026-10-23",
      });
      expect(byLabel<HTMLInputElement>("Start Due filter date").value).toBe(
        "2026-10-23",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a relative day into the exact day it means today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 22, 9));
      const latest = renderBar([filter("due", "Due", "equals", "tomorrow")], 0);

      await click(button("Tomorrow"));
      await chooseMenuItem("Exact date");
      expect(latest.filters[0]?.value).toBe("2026-10-23");
      expect(byLabel<HTMLInputElement>("Due").value).toBe("2026-10-23");
    } finally {
      vi.useRealTimers();
    }
  });
});
