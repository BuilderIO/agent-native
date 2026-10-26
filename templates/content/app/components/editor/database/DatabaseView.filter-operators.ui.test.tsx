// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  byLabel,
  click,
  focus,
  queryByLabel,
  renderUi,
  typeInto,
} from "@/test-utils/render-ui";
// Registers Arabic, whose counts have the most plural forms.
import "@/i18n/ar-SA";

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

function advancedRule(rule: DatabaseFilter): DatabaseFilter {
  return { ...rule, filterGroupId: "advanced" };
}

// Renders the constraint row the way the table does, with one chip's editor
// or the advanced filter open, and keeps every filter change.
function renderBar(
  initial: DatabaseFilter[],
  openIndex: number | null = null,
  advancedOpen = false,
) {
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
        advancedFilterOpen={advancedOpen}
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

// The icon-only menu button at the end of the advanced filter rule that holds
// the control.
function ruleActionsButton(control: HTMLElement) {
  for (let node = control.parentElement; node; node = node.parentElement) {
    const actions = [
      ...node.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]'),
    ].find((candidate) => !candidate.textContent?.trim());
    if (actions) return actions;
  }
  throw new Error("No rule actions button");
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
      filter("due", "Due", "is_within", "past_2_weeks"),
      filter("due", "Due", "is_within", "next_1_year"),
      filter("due", "Due", "is_within", "this_month"),
      filter("due", "Due", "is_within", "this_day"),
      filter("due", "Due", "does_not_equal", "2026-10-22"),
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
      "Due: Past 2 weeks",
      "Due: Next 1 year",
      "Due: This month",
      "Due: Today",
      "Due: is not 2026-10-22",
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

  it("offers a new date rule Notion's nine operators, without is not", async () => {
    renderBar([filter("due", "Due", "equals")], 0);
    await click(button("is"));
    expect(menuItems()).toEqual([
      "Is",
      "Before",
      "After",
      "On or before",
      "On or after",
      "Between",
      "Is within",
      "Is empty",
      "Is not empty",
    ]);
  });

  it("leaves is not out of an advanced date rule's menu", async () => {
    renderBar([advancedRule(filter("due", "Due", "equals"))], null, true);
    await click(button("is"));
    expect(menuItems()).toContain("Is within");
    expect(menuItems()).not.toContain("Is not");
  });

  it("keeps is not for a date rule that already uses it", async () => {
    const latest = renderBar(
      [filter("due", "Due", "does_not_equal", "2026-10-22")],
      0,
    );
    button("Due: is not 2026-10-22");
    await click(button("is not"));
    expect(menuItems()).toEqual([
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
    ]);
    // Once the rule moves to another operator, the menu no longer offers it.
    await chooseMenuItem("Before");
    expect(latest.filters[0]?.operator).toBe("before");
    await click(button("before"));
    expect(menuItems()).not.toContain("Is not");
  });

  it("keeps is not for an advanced date rule that already uses it", async () => {
    renderBar(
      [advancedRule(filter("due", "Due", "does_not_equal", "2026-10-22"))],
      null,
      true,
    );
    await click(button("is not"));
    expect(menuItems()).toContain("Is not");
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
  it("closes the operator menu once an operator is picked", async () => {
    const latest = renderBar([filter("name", "Name", "contains", "draft")], 0);

    await click(button("contains"));
    await chooseMenuItem("Does not contain");
    expect(latest.filters[0]?.operator).toBe("does_not_contain");
    // The value field the operator applies to is next, so nothing covers it.
    expect(menuItems()).not.toContain("Contains");
    expect(document.querySelector("input")?.value).toBe("draft");
  });

  it("picks a relative day, then starts is within at the past 7 days", async () => {
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
      value: "past_7_days",
    });
    button("Due: Past 7 days");

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

  it("keeps a relative day as a range's start when switching to between", async () => {
    const latest = renderBar(
      [filter("due", "Due", "on_or_before", "tomorrow")],
      0,
    );

    await click(button("on or before"));
    await chooseMenuItem("Between");
    expect(latest.filters[0]).toMatchObject({
      operator: "between",
      value: "tomorrow",
    });
    button("Tomorrow");
    expect(byLabel<HTMLInputElement>("End Due filter date").value).toBe("");

    await click(button("Exact date"));
    await chooseMenuItem("Today");
    expect(latest.filters[0]?.value).toBe(
      JSON.stringify(["tomorrow", "today"]),
    );
  });

  it("shows each range end's relative day or time", async () => {
    const latest = renderBar(
      [
        filter(
          "due",
          "Due",
          "between",
          JSON.stringify(["yesterday", "2026-10-22T09:00"]),
        ),
      ],
      0,
    );

    button("Yesterday");
    const end = byLabel<HTMLInputElement>("End Due filter date");
    expect(end.type).toBe("text");
    expect(end.value).toBe("2026-10-22T09:00");

    await click(button("Yesterday"));
    await chooseMenuItem("Today");
    expect(latest.filters[0]?.value).toBe(
      JSON.stringify(["today", "2026-10-22T09:00"]),
    );
  });

  it("passes a typed time on only once it reads as a date", async () => {
    const range = (end: string) => JSON.stringify(["yesterday", end]);
    const latest = renderBar(
      [filter("due", "Due", "between", range("2026-10-22T09:00"))],
      0,
    );
    const end = byLabel<HTMLInputElement>("End Due filter date");
    await focus(end);

    await typeInto(end, "2026-10-22T09:3");
    expect(end.value).toBe("2026-10-22T09:3");
    expect(end.getAttribute("aria-invalid")).toBe("true");
    expect(latest.filters[0]?.value).toBe(range("2026-10-22T09:00"));

    await typeInto(end, "2026-10-22T09:30");
    expect(latest.filters[0]?.value).toBe(range("2026-10-22T09:30"));

    // Leaving the field drops an unfinished edit.
    await typeInto(end, "2026-10-22T1");
    await focus(button("Yesterday"));
    expect(end.value).toBe("2026-10-22T09:30");
    expect(latest.filters[0]?.value).toBe(range("2026-10-22T09:30"));
  });

  it("edits a timed value as text after an earlier rule is removed", async () => {
    const latest = renderBar(
      [
        advancedRule(filter("due", "Due", "on_or_after", "2026-10-01")),
        advancedRule(filter("due", "Due", "on_or_before", "2026-10-22T09:00")),
      ],
      null,
      true,
    );
    const dueFields = () => [
      ...document.querySelectorAll<HTMLInputElement>('input[aria-label="Due"]'),
    ];
    expect(dueFields().map((field) => field.type)).toEqual(["date", "text"]);

    await click(ruleActionsButton(dueFields()[0]!));
    await chooseMenuItem("Remove");
    expect(latest.filters).toEqual([
      advancedRule(filter("due", "Due", "on_or_before", "2026-10-22T09:00")),
    ]);
    // The timed rule moves up into the removed rule's field, time and all.
    const [field] = dueFields();
    expect(field?.type).toBe("text");
    expect(field?.value).toBe("2026-10-22T09:00");
  });

  it("keeps a timed value's field as text until it's left", async () => {
    const latest = renderBar(
      [filter("due", "Due", "on_or_before", "2026-10-22T09:00")],
      0,
    );
    const field = byLabel<HTMLInputElement>("Due");
    expect(field.type).toBe("text");
    await focus(field);

    // Taking the time out doesn't switch it to a date input mid-edit.
    await typeInto(field, "2026-10-21");
    expect(latest.filters[0]?.value).toBe("2026-10-21");
    expect(field.type).toBe("text");

    await focus(button("Exact date"));
    expect(byLabel<HTMLInputElement>("Due").type).toBe("date");
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

  it("drops an unfinished date when a relative day is chosen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // A menu that opens without taking focus leaves the field focused, so
    // nothing blurs it before the choice.
    const focusElement = HTMLElement.prototype.focus;
    const keepFocus = vi
      .spyOn(HTMLElement.prototype, "focus")
      .mockImplementation(function (this: HTMLElement, options) {
        if (!this.closest('[role="menu"]')) focusElement.call(this, options);
      });
    try {
      vi.setSystemTime(new Date(2026, 9, 22, 9));
      const latest = renderBar(
        [filter("due", "Due", "on_or_before", "2026-10-22T09:00")],
        0,
      );
      const field = byLabel<HTMLInputElement>("Due");
      await focus(field);
      await typeInto(field, "2026-10-21T1");
      expect(latest.filters[0]?.value).toBe("2026-10-22T09:00");

      // Coming back to Exact date shows the day Today meant, not the
      // unfinished text.
      await click(button("Exact date"));
      await chooseMenuItem("Today");
      expect(latest.filters[0]?.value).toBe("today");
      await click(button("Today"));
      await chooseMenuItem("Exact date");
      expect(latest.filters[0]?.value).toBe("2026-10-22");
      const exact = byLabel<HTMLInputElement>("Due");
      expect(exact.value).toBe("2026-10-22");
      expect(exact.type).toBe("date");
    } finally {
      keepFocus.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("is within ranges", () => {
  const count = () => byLabel<HTMLInputElement>("Due filter range count");

  it("picks past, this, or next and a unit in the filter chip", async () => {
    const latest = renderBar(
      [filter("due", "Due", "is_within", "past_7_days")],
      0,
    );
    expect(count().value).toBe("7");
    button("days");

    await click(button("Past"));
    expect(menuItems()).toEqual(["Past", "This", "Next"]);
    await chooseMenuItem("Next");
    expect(latest.filters[0]?.value).toBe("next_7_days");

    await focus(count());
    await typeInto(count(), "2");
    expect(latest.filters[0]?.value).toBe("next_2_days");

    await click(button("days"));
    expect(menuItems()).toEqual(["days", "weeks", "months", "years"]);
    await chooseMenuItem("weeks");
    expect(latest.filters[0]?.value).toBe("next_2_weeks");
    button("Due: Next 2 weeks");

    // This has no count, and keeps the unit.
    await click(button("Next"));
    await chooseMenuItem("This");
    expect(latest.filters[0]?.value).toBe("this_week");
    expect(queryByLabel("Due filter range count")).toBeNull();
    button("Due: This week");

    await click(button("week"));
    expect(menuItems()).toEqual(["day", "week", "month", "year"]);
    await chooseMenuItem("month");
    expect(latest.filters[0]?.value).toBe("this_month");
    button("Due: This month");

    // Leaving This keeps the unit and counts one of it.
    await click(button("This"));
    await chooseMenuItem("Past");
    expect(latest.filters[0]?.value).toBe("past_1_month");
    expect(count().value).toBe("1");
    button("month");
    button("Due: Past 1 month");
  });

  it("picks past, this, or next and a unit in the advanced filter", async () => {
    const latest = renderBar(
      [advancedRule(filter("due", "Due", "is_within", "next_30_days"))],
      null,
      true,
    );
    expect(count().value).toBe("30");

    await click(button("Next"));
    await chooseMenuItem("Past");
    expect(latest.filters[0]?.value).toBe("past_30_days");

    await focus(count());
    await typeInto(count(), "3");
    expect(latest.filters[0]?.value).toBe("past_3_days");

    await click(button("days"));
    await chooseMenuItem("months");
    expect(latest.filters[0]?.value).toBe("past_3_months");

    await click(button("Past"));
    await chooseMenuItem("This");
    expect(latest.filters[0]?.value).toBe("this_month");
    expect(queryByLabel("Due filter range count")).toBeNull();

    await click(button("This"));
    await chooseMenuItem("Next");
    expect(latest.filters[0]?.value).toBe("next_1_month");
    expect(count().value).toBe("1");
  });

  it("passes a typed count on only from 1 to 999", async () => {
    const latest = renderBar(
      [filter("due", "Due", "is_within", "past_2_weeks")],
      0,
    );
    await focus(count());

    for (const typed of ["0", "1000", "1.5", ""]) {
      await typeInto(count(), typed);
      expect(count().getAttribute("aria-invalid"), typed).toBe("true");
      expect(latest.filters[0]?.value).toBe("past_2_weeks");
    }

    await typeInto(count(), "1");
    expect(count().getAttribute("aria-invalid")).toBe("false");
    expect(latest.filters[0]?.value).toBe("past_1_week");
    // The unit reads in the number the count takes.
    button("week");

    await typeInto(count(), "999");
    expect(latest.filters[0]?.value).toBe("past_999_weeks");

    // Leaving the field drops an unfinished edit.
    await typeInto(count(), "1000");
    await focus(button("Past"));
    expect(count().value).toBe("999");
    expect(latest.filters[0]?.value).toBe("past_999_weeks");

    // So does choosing from a menu, whether or not the field lost focus.
    await focus(count());
    await typeInto(count(), "1000");
    await click(button("weeks"));
    await chooseMenuItem("days");
    expect(latest.filters[0]?.value).toBe("past_999_days");
    expect(count().value).toBe("999");
  });

  it("words the unit in the form the locale uses for the count", async () => {
    const lang = document.documentElement.lang;
    document.documentElement.lang = "ar-SA";
    try {
      renderBar([filter("due", "Due", "is_within", "past_2_weeks")], 0);
      // Arabic has its own forms for 2, for 3 to 10, and for 11 to 99.
      button("أسبوعين");
      await focus(count());
      await typeInto(count(), "5");
      button("أسابيع");
      await typeInto(count(), "11");
      button("أسبوعًا");
      await typeInto(count(), "1");
      button("أسبوع");
    } finally {
      document.documentElement.lang = lang;
    }
  });

  it("shows an empty range as the past 7 days, greyed, until one is chosen", async () => {
    const latest = renderBar([filter("due", "Due", "is_within")], 0);
    const greyed = () =>
      button("Past")
        .querySelector("span")
        ?.classList.contains("text-muted-foreground");
    expect(greyed()).toBe(true);
    expect(count().value).toBe("");
    expect(count().placeholder).toBe("7");

    await click(button("Past"));
    await chooseMenuItem("Past");
    expect(latest.filters[0]?.value).toBe("past_7_days");
    expect(greyed()).toBe(false);
    button("Due: Past 7 days");
  });
});
