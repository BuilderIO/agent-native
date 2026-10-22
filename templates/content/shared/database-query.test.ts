import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ContentDatabaseFilter,
  ContentDatabaseItem,
  DocumentProperty,
} from "./api";
import {
  applyContentDatabaseTableQuery,
  contentDatabaseFilterGroupMode,
  contentDatabaseFilterIsRelative,
  contentDatabaseFilterOperatorsForType,
  contentDatabaseFilterToday,
  contentDatabaseFilterTree,
  contentDatabaseTableQueryUsesProperties,
  materializeContentDatabaseFilterGroupModes,
  withContentDatabaseFilterGroupMode,
} from "./database-query";

function item(id: string, title: string, date: string): ContentDatabaseItem {
  return {
    id: `item-${id}`,
    databaseId: "database-1",
    position: 0,
    document: {
      id,
      parentId: "database-page",
      title,
      content: "",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    properties: [
      {
        ...dateProperty,
        value: { start: date, includeTime: false },
      },
    ],
  };
}

const dateProperty = {
  definition: {
    id: "date",
    databaseId: "database-1",
    name: "Date",
    type: "date",
    visibility: "always_show",
    options: {},
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: null,
  editable: true,
} satisfies DocumentProperty;

describe("content database table query", () => {
  it("applies search, filters, and Date sorting before a caller pages rows", () => {
    const result = applyContentDatabaseTableQuery(
      [
        item("one", "Alpha launch", "2026-01-01"),
        item("two", "Alpha follow-up", "2026-03-01"),
        item("three", "Beta launch", "2026-02-01"),
      ],
      [dateProperty],
      {
        search: "alpha",
        filters: [
          {
            key: "date",
            label: "Date",
            operator: "after",
            value: "2026-01-15",
          },
        ],
        sorts: [{ key: "date", label: "Date", direction: "desc" }],
        filterMode: "and",
      },
    );

    expect(result.map((row) => row.document.id)).toEqual(["two"]);
  });

  it("matches a one-day between range whose start and end are the same", () => {
    const result = applyContentDatabaseTableQuery(
      [
        item("one", "Launch", "2026-02-01"),
        item("two", "Follow-up", "2026-02-02"),
      ],
      [dateProperty],
      {
        search: "",
        filters: [
          {
            key: "date",
            label: "Date",
            operator: "between",
            value: JSON.stringify(["2026-02-01", "2026-02-01"]),
          },
        ],
        sorts: [],
        filterMode: "and",
      },
    );

    expect(result.map((row) => row.document.id)).toEqual(["one"]);
  });

  it("requires complete client data only when a query can read federated properties", () => {
    const base = {
      search: "",
      filters: [],
      sorts: [{ key: "date", label: "Date", direction: "desc" as const }],
      filterMode: "and" as const,
    };
    expect(
      contentDatabaseTableQueryUsesProperties(base, new Set(["date"])),
    ).toBe(true);
    expect(
      contentDatabaseTableQueryUsesProperties(base, new Set(["author"])),
    ).toBe(false);
    expect(
      contentDatabaseTableQueryUsesProperties(
        { ...base, search: "Alice", sorts: [] },
        new Set(["author"]),
      ),
    ).toBe(true);
  });
});

const rankProperty = {
  definition: {
    ...dateProperty.definition,
    id: "rank",
    name: "Rank",
    type: "number",
  },
  value: null,
  editable: true,
} satisfies DocumentProperty;

function rankedItem(
  id: string,
  rank: DocumentProperty["value"],
): ContentDatabaseItem {
  const row = item(id, id, "2026-01-01");
  return { ...row, properties: [{ ...rankProperty, value: rank }] };
}

const rankedItems = [
  rankedItem("unranked", null),
  rankedItem("blank", ""),
  rankedItem("words", "not a number"),
  rankedItem("rank-4", 4),
  rankedItem("rank-5", 5),
  rankedItem("rank-12", "12"),
  rankedItem("rank-25", 25),
  rankedItem("rank-30", 30),
];

function rankFilter(
  operator: ContentDatabaseFilter["operator"],
  value = "",
): ContentDatabaseFilter {
  return { key: "rank", label: "Rank", operator, value };
}

function matchingIds(
  filters: ContentDatabaseFilter[],
  filterMode: "and" | "or" = "and",
) {
  return applyContentDatabaseTableQuery(rankedItems, [rankProperty], {
    search: "",
    filters,
    sorts: [],
    filterMode,
  }).map((row) => row.document.id);
}

describe("content database number filters", () => {
  it("combines two filters on the same property", () => {
    expect(
      matchingIds([rankFilter("is_not_empty"), rankFilter("less_than", "25")]),
    ).toEqual(["rank-4", "rank-5", "rank-12"]);
    expect(
      matchingIds([
        rankFilter("greater_than_or_equal", "5"),
        rankFilter("less_than_or_equal", "25"),
      ]),
    ).toEqual(["rank-5", "rank-12", "rank-25"]);
    expect(
      matchingIds(
        [rankFilter("less_than", "5"), rankFilter("greater_than", "25")],
        "or",
      ),
    ).toEqual(["rank-4", "rank-30"]);
  });

  it("includes the boundary for ≥ and ≤ but not for > and <", () => {
    expect(matchingIds([rankFilter("greater_than_or_equal", "25")])).toEqual([
      "rank-25",
      "rank-30",
    ]);
    expect(matchingIds([rankFilter("greater_than", "25")])).toEqual([
      "rank-30",
    ]);
    expect(matchingIds([rankFilter("less_than_or_equal", "5")])).toEqual([
      "rank-4",
      "rank-5",
    ]);
    expect(matchingIds([rankFilter("less_than", "5")])).toEqual(["rank-4"]);
  });

  it("never matches empty or non-numeric values with a comparison", () => {
    for (const operator of [
      "greater_than",
      "less_than",
      "greater_than_or_equal",
      "less_than_or_equal",
    ] as const) {
      const ids = matchingIds([rankFilter(operator, "0")]);
      expect(ids).not.toContain("unranked");
      expect(ids).not.toContain("blank");
      expect(ids).not.toContain("words");
    }
    expect(matchingIds([rankFilter("greater_than_or_equal", "abc")])).toEqual(
      [],
    );
  });

  it("offers ≥ and ≤ to number properties in menu order", () => {
    expect(contentDatabaseFilterOperatorsForType("number")).toEqual([
      "equals",
      "does_not_equal",
      "greater_than",
      "less_than",
      "greater_than_or_equal",
      "less_than_or_equal",
      "is_empty",
      "is_not_empty",
    ]);
    expect(contentDatabaseFilterOperatorsForType("text")).not.toContain(
      "greater_than_or_equal",
    );
  });
});

function advancedRule(
  operator: ContentDatabaseFilter["operator"],
  value = "",
  mode?: "and" | "or",
): ContentDatabaseFilter {
  return {
    ...rankFilter(operator, value),
    filterGroupId: "advanced",
    ...(mode ? { filterGroupMode: mode } : {}),
  };
}

function nestedRule(
  groupId: string,
  operator: ContentDatabaseFilter["operator"],
  value = "",
  modes: { group?: "and" | "or"; parent?: "and" | "or" } = {},
): ContentDatabaseFilter {
  return {
    ...rankFilter(operator, value),
    filterGroupId: groupId,
    parentFilterGroupId: "advanced",
    ...(modes.group ? { filterGroupMode: modes.group } : {}),
    ...(modes.parent ? { parentFilterGroupMode: modes.parent } : {}),
  };
}

// How views combined rules before groups had their own modes: every root rule
// and every nested group under the view's one mode.
function flatMatchingIds(
  filters: ContentDatabaseFilter[],
  filterMode: "and" | "or",
) {
  const matchesBy = new Map(
    filters.map((filter) => [
      filter,
      new Set(matchingIds([rankFilter(filter.operator, filter.value)])),
    ]),
  );
  const combine = (matches: boolean[]) =>
    matches.length === 0 ||
    (filterMode === "or" ? matches.some(Boolean) : matches.every(Boolean));
  const nested = new Map<string, ContentDatabaseFilter[]>();
  for (const filter of filters) {
    if (!filter.parentFilterGroupId || !filter.filterGroupId) continue;
    nested.set(filter.filterGroupId, [
      ...(nested.get(filter.filterGroupId) ?? []),
      filter,
    ]);
  }
  return rankedItems
    .map((row) => row.document.id)
    .filter((id) =>
      combine([
        ...filters
          .filter((filter) => !filter.parentFilterGroupId)
          .map((filter) => matchesBy.get(filter)!.has(id)),
        ...[...nested.values()].map((group) =>
          combine(group.map((filter) => matchesBy.get(filter)!.has(id))),
        ),
      ]),
    );
}

describe("content database filter groups", () => {
  it("combines groups without stored modes exactly as before", () => {
    const views: ContentDatabaseFilter[][] = [
      [rankFilter("is_not_empty"), advancedRule("less_than", "25")],
      [
        rankFilter("greater_than", "4"),
        advancedRule("less_than", "12"),
        nestedRule("advanced-a", "equals", "25"),
        nestedRule("advanced-a", "greater_than_or_equal", "30"),
      ],
      [
        nestedRule("advanced-a", "less_than", "5"),
        nestedRule("advanced-b", "greater_than", "25"),
        { ...rankFilter("equals", "12"), parentFilterGroupId: "advanced" },
      ],
    ];
    for (const filters of views) {
      for (const filterMode of ["and", "or"] as const) {
        expect(matchingIds(filters, filterMode)).toEqual(
          flatMatchingIds(filters, filterMode),
        );
      }
    }
  });

  it("combines the advanced filter with its own Or inside an And view", () => {
    expect(
      matchingIds(
        [
          rankFilter("is_not_empty"),
          advancedRule("less_than", "5", "or"),
          advancedRule("greater_than", "25", "or"),
        ],
        "and",
      ),
    ).toEqual(["rank-4", "rank-30"]);
  });

  it("combines a nested group with its own Or inside an And advanced filter", () => {
    const filters = [
      advancedRule("greater_than_or_equal", "5", "and"),
      nestedRule("advanced-a", "less_than", "6", {
        group: "or",
        parent: "and",
      }),
      nestedRule("advanced-a", "greater_than", "25", {
        group: "or",
        parent: "and",
      }),
    ];
    expect(matchingIds(filters, "and")).toEqual(["rank-5", "rank-30"]);
    // The view's Any reaches only its own members: the chip and the advanced
    // filter as a whole.
    expect(matchingIds([rankFilter("equals", "12"), ...filters], "or")).toEqual(
      ["rank-5", "rank-12", "rank-30"],
    );
  });

  it("creates the advanced parent for nested groups that have no rule of their own", () => {
    const filters = [
      rankFilter("less_than", "30"),
      nestedRule("advanced-a", "greater_than_or_equal", "5", {
        group: "and",
        parent: "or",
      }),
      nestedRule("advanced-a", "less_than_or_equal", "5", {
        group: "and",
        parent: "or",
      }),
      nestedRule("advanced-b", "greater_than_or_equal", "25", {
        group: "and",
        parent: "or",
      }),
    ];

    expect(matchingIds(filters, "and")).toEqual(["rank-5", "rank-25"]);
    const tree = contentDatabaseFilterTree(filters, "and");
    expect(tree.filters).toEqual([filters[0]]);
    expect(tree.groups).toMatchObject([
      {
        id: "advanced",
        mode: "or",
        filters: [],
        groups: [
          { id: "advanced-a", mode: "and" },
          { id: "advanced-b", mode: "and" },
        ],
      },
    ]);
  });

  it("keeps the tree two levels deep and ignores rules that name only a parent", () => {
    const deep = {
      ...rankFilter("equals", "4"),
      filterGroupId: "advanced-deep",
      parentFilterGroupId: "advanced-a",
    };
    const parentOnly = {
      ...rankFilter("equals", "5"),
      parentFilterGroupId: "advanced",
    };
    const filters = [
      nestedRule("advanced-a", "equals", "12"),
      deep,
      parentOnly,
    ];
    const tree = contentDatabaseFilterTree(filters, "or");

    expect(tree.groups.map((group) => group.id)).toEqual([
      "advanced",
      "advanced-deep",
    ]);
    expect(tree.groups[0]?.groups.map((group) => group.id)).toEqual([
      "advanced-a",
    ]);
    expect(tree.groups[1]?.groups).toEqual([]);
    expect(matchingIds(filters, "or")).toEqual(["rank-4", "rank-12"]);
  });

  it("reads a group's mode from the first rule that stores one", () => {
    const mixed = [
      rankFilter("is_not_empty"),
      advancedRule("less_than", "5"),
      advancedRule("greater_than", "25", "or"),
      advancedRule("equals", "12", "and"),
    ];
    expect(contentDatabaseFilterGroupMode(mixed, "advanced", "and")).toBe("or");
    expect(matchingIds(mixed, "and")).toEqual(["rank-4", "rank-12", "rank-30"]);

    const nestedOnly = [
      nestedRule("advanced-a", "less_than", "5"),
      nestedRule("advanced-a", "equals", "12", { parent: "or" }),
      nestedRule("advanced-b", "equals", "30", { parent: "and" }),
    ];
    expect(contentDatabaseFilterGroupMode(nestedOnly, "advanced", "and")).toBe(
      "or",
    );
    expect(contentDatabaseFilterGroupMode(nestedOnly, "advanced-a", "or")).toBe(
      "or",
    );
    expect(
      contentDatabaseFilterGroupMode(nestedOnly, "advanced-a", "and"),
    ).toBe("and");

    // A nested rule's parent mode counts as a stored mode in rule order.
    const nestedFirst = [
      nestedRule("advanced-a", "equals", "12", { parent: "or" }),
      advancedRule("less_than", "5", "and"),
    ];
    expect(contentDatabaseFilterGroupMode(nestedFirst, "advanced", "and")).toBe(
      "or",
    );
  });

  it("reads a group's mode from its inactive rules too", () => {
    expect(
      matchingIds(
        [
          advancedRule("less_than", "", "or"),
          advancedRule("less_than", "5"),
          advancedRule("greater_than", "25"),
        ],
        "and",
      ),
    ).toEqual(["rank-4", "rank-30"]);
  });

  it("writes a group's mode onto its rules and onto its nested rules as their parent mode", () => {
    const chip = rankFilter("is_not_empty");
    const filters = [
      chip,
      advancedRule("less_than", "5"),
      nestedRule("advanced-a", "equals", "12"),
      nestedRule("advanced-b", "equals", "30"),
    ];

    const advancedOr = withContentDatabaseFilterGroupMode(
      filters,
      "advanced",
      "or",
    );
    expect(advancedOr[0]).toBe(chip);
    expect(advancedOr[1]).toMatchObject({ filterGroupMode: "or" });
    expect(advancedOr[1]).not.toHaveProperty("parentFilterGroupMode");
    expect(advancedOr[2]).toMatchObject({ parentFilterGroupMode: "or" });
    expect(advancedOr[2]).not.toHaveProperty("filterGroupMode");
    expect(contentDatabaseFilterGroupMode(advancedOr, "advanced", "and")).toBe(
      "or",
    );

    const nestedAnd = withContentDatabaseFilterGroupMode(
      advancedOr,
      "advanced-a",
      "and",
    );
    expect(nestedAnd[2]).toMatchObject({
      filterGroupMode: "and",
      parentFilterGroupMode: "or",
    });
    expect(nestedAnd[3]).toMatchObject({ parentFilterGroupMode: "or" });
    expect(nestedAnd[3]).not.toHaveProperty("filterGroupMode");
    expect(filters[1]).not.toHaveProperty("filterGroupMode");
  });

  it("freezes inherited group modes so a later view mode change leaves them alone", () => {
    const chip = rankFilter("is_not_empty");
    const filters = [
      chip,
      advancedRule("less_than", "5"),
      advancedRule("greater_than", "25", "and"),
      nestedRule("advanced-a", "equals", "4"),
      nestedRule("advanced-a", "equals", "30"),
    ];
    const frozen = materializeContentDatabaseFilterGroupModes(filters, "or");
    expect(frozen[0]).toBe(chip);
    expect(frozen.slice(1).map((filter) => filter.filterGroupMode)).toEqual([
      "and",
      "and",
      "or",
      "or",
    ]);
    expect(
      frozen.slice(3).map((filter) => filter.parentFilterGroupMode),
    ).toEqual(["and", "and"]);
    expect(matchingIds(frozen, "or")).toEqual(matchingIds(filters, "or"));

    const inheriting = [
      chip,
      advancedRule("less_than", "5"),
      advancedRule("greater_than", "25"),
    ];
    const frozenOr = materializeContentDatabaseFilterGroupModes(
      inheriting,
      "or",
    );
    expect(matchingIds(inheriting, "and")).toEqual([]);
    expect(matchingIds(frozenOr, "and")).toEqual(["rank-4", "rank-30"]);
  });
});

function titledItem(id: string, title: string): ContentDatabaseItem {
  return { ...item(id, title, "2026-01-01"), properties: [] };
}

const titledItems = [
  titledItem("alpha", "Alpha launch"),
  titledItem("beta", "Beta Launch plan"),
  titledItem("padded", "  alpha notes "),
  titledItem("untitled", ""),
  titledItem("gamma", "Gamma"),
];

function titleMatches(
  operator: ContentDatabaseFilter["operator"],
  value: string,
) {
  return applyContentDatabaseTableQuery(titledItems, [], {
    search: "",
    filters: [{ key: "name", label: "Name", operator, value }],
    sorts: [],
  }).map((row) => row.document.id);
}

describe("content database text filters", () => {
  it("matches does not contain, starts with, and ends with without case", () => {
    expect(titleMatches("does_not_contain", "ALPHA")).toEqual([
      "beta",
      "untitled",
      "gamma",
    ]);
    expect(titleMatches("starts_with", "alpha")).toEqual(["alpha", "padded"]);
    expect(titleMatches("starts_with", "BETA")).toEqual(["beta"]);
    expect(titleMatches("ends_with", "launch")).toEqual(["alpha"]);
    expect(titleMatches("ends_with", "NOTES")).toEqual(["padded"]);
  });

  it("matches empty rows only with does not contain", () => {
    expect(titleMatches("does_not_contain", "a")).toEqual(["untitled"]);
    expect(titleMatches("starts_with", "a")).not.toContain("untitled");
    expect(titleMatches("ends_with", "a")).not.toContain("untitled");
  });

  it("ignores a text filter until it has a value", () => {
    const allIds = titledItems.map((row) => row.document.id);
    for (const operator of [
      "does_not_contain",
      "starts_with",
      "ends_with",
    ] as const) {
      expect(titleMatches(operator, "")).toEqual(allIds);
      expect(titleMatches(operator, "   ")).toEqual(allIds);
    }
  });

  it("offers the new text operators only to text-like properties", () => {
    for (const type of [
      "text",
      "url",
      "email",
      "phone",
      "created_by",
    ] as const) {
      expect(contentDatabaseFilterOperatorsForType(type)).toEqual([
        "contains",
        "does_not_contain",
        "equals",
        "does_not_equal",
        "starts_with",
        "ends_with",
        "is_empty",
        "is_not_empty",
      ]);
    }
    for (const type of [
      "number",
      "date",
      "select",
      "multi_select",
      "checkbox",
      "relation",
    ] as const) {
      const operators = contentDatabaseFilterOperatorsForType(type);
      expect(operators).not.toContain("does_not_contain");
      expect(operators).not.toContain("starts_with");
      expect(operators).not.toContain("ends_with");
    }
  });
});

function datedItem(
  id: string,
  value: DocumentProperty["value"],
): ContentDatabaseItem {
  const row = item(id, id, "2026-01-01");
  return { ...row, properties: [{ ...dateProperty, value }] };
}

// Thursday 22 October 2026. Its week runs Sunday the 18th to Saturday the 24th.
const TODAY = "2026-10-22";

const datedItems = [
  datedItem("day-before", { start: "2026-10-21", includeTime: false }),
  datedItem("morning", "2026-10-22T08:00"),
  datedItem("whole-day", { start: "2026-10-22", includeTime: false }),
  datedItem("evening", { start: "2026-10-22T18:00", includeTime: true }),
  datedItem("day-after", "2026-10-23"),
  datedItem("undated", null),
];

function dateMatches(
  operator: ContentDatabaseFilter["operator"],
  value: string,
  items = datedItems,
) {
  return applyContentDatabaseTableQuery(
    items,
    [dateProperty],
    {
      search: "",
      filters: [{ key: "date", label: "Date", operator, value }],
      sorts: [],
    },
    { today: TODAY },
  ).map((row) => row.document.id);
}

describe("content database date filters", () => {
  it("treats a date without a time as the whole day", () => {
    expect(dateMatches("equals", "2026-10-22")).toEqual([
      "morning",
      "whole-day",
      "evening",
    ]);
    expect(dateMatches("does_not_equal", "2026-10-22")).toEqual([
      "day-before",
      "day-after",
      "undated",
    ]);
    expect(dateMatches("before", "2026-10-22")).toEqual(["day-before"]);
    expect(dateMatches("after", "2026-10-22")).toEqual(["day-after"]);
    expect(
      dateMatches("between", JSON.stringify(["2026-10-21", "2026-10-22"])),
    ).toEqual(["day-before", "morning", "whole-day", "evening"]);
  });

  it("includes the whole boundary day for on or before and on or after", () => {
    expect(dateMatches("on_or_before", "2026-10-22")).toEqual([
      "day-before",
      "morning",
      "whole-day",
      "evening",
    ]);
    expect(dateMatches("on_or_after", "2026-10-22")).toEqual([
      "morning",
      "whole-day",
      "evening",
      "day-after",
    ]);
    expect(dateMatches("on_or_before", "2026-10-20")).toEqual([]);
  });

  it("compares a value written with a time as a moment", () => {
    expect(dateMatches("on_or_after", "2026-10-22T12:00")).toEqual([
      "evening",
      "day-after",
    ]);
  });

  it("matches nothing for a date that does not exist", () => {
    expect(dateMatches("on_or_before", "2026-02-30")).toEqual([]);
    expect(dateMatches("before", "not a date")).toEqual([]);
  });

  it("resolves today, tomorrow, and yesterday against the day it is read", () => {
    expect(dateMatches("on_or_before", "today")).toEqual([
      "day-before",
      "morning",
      "whole-day",
      "evening",
    ]);
    expect(dateMatches("equals", "tomorrow")).toEqual(["day-after"]);
    expect(dateMatches("equals", "yesterday")).toEqual(["day-before"]);
    expect(
      dateMatches("between", JSON.stringify(["yesterday", "today"])),
    ).toEqual(["day-before", "morning", "whole-day", "evening"]);
  });

  it("counts relative ranges in whole days from today", () => {
    const items = [
      datedItem("oct-14", "2026-10-14"),
      datedItem("oct-15", "2026-10-15T23:59"),
      ...datedItems,
      datedItem("oct-29", "2026-10-29T00:00"),
      datedItem("oct-30", "2026-10-30"),
    ];
    expect(dateMatches("is_within", "past_7_days", items)).toEqual([
      "oct-15",
      "day-before",
      "morning",
      "whole-day",
      "evening",
    ]);
    expect(dateMatches("is_within", "next_7_days", items)).toEqual([
      "morning",
      "whole-day",
      "evening",
      "day-after",
      "oct-29",
    ]);
    expect(dateMatches("is_within", "past_30_days", items)).toEqual([
      "oct-14",
      "oct-15",
      "day-before",
      "morning",
      "whole-day",
      "evening",
    ]);
  });

  it("runs weeks from Sunday to Saturday", () => {
    const items = [
      datedItem("sat-10", "2026-10-10"),
      datedItem("sun-11", "2026-10-11"),
      datedItem("sat-17", "2026-10-17T23:00"),
      datedItem("sun-18", "2026-10-18"),
      datedItem("sat-24", "2026-10-24"),
      datedItem("sun-25", "2026-10-25T09:00"),
      datedItem("sat-31", "2026-10-31"),
      datedItem("sun-nov-1", "2026-11-01"),
    ];
    expect(dateMatches("is_within", "last_week", items)).toEqual([
      "sun-11",
      "sat-17",
    ]);
    expect(dateMatches("is_within", "this_week", items)).toEqual([
      "sun-18",
      "sat-24",
    ]);
    expect(dateMatches("is_within", "next_week", items)).toEqual([
      "sun-25",
      "sat-31",
    ]);
  });

  it("matches nothing for a range it does not know", () => {
    expect(dateMatches("is_within", "next_fortnight")).toEqual([]);
  });

  it("marks only filters that depend on the day as relative", () => {
    const filter = (
      operator: ContentDatabaseFilter["operator"],
      value: string,
    ): ContentDatabaseFilter => ({
      key: "date",
      label: "Date",
      operator,
      value,
    });
    expect(
      contentDatabaseFilterIsRelative(filter("is_within", "this_week")),
    ).toBe(true);
    expect(
      contentDatabaseFilterIsRelative(filter("on_or_before", "today")),
    ).toBe(true);
    expect(
      contentDatabaseFilterIsRelative(
        filter("between", JSON.stringify(["2026-10-01", "today"])),
      ),
    ).toBe(true);
    expect(
      contentDatabaseFilterIsRelative(filter("on_or_before", "2026-10-22")),
    ).toBe(false);
    expect(contentDatabaseFilterIsRelative(filter("contains", "today"))).toBe(
      false,
    );
  });

  it("offers on or before, on or after, and is within only to dates", () => {
    for (const type of ["date", "created_time", "last_edited_time"] as const) {
      expect(contentDatabaseFilterOperatorsForType(type)).toEqual([
        "equals",
        "does_not_equal",
        "before",
        "after",
        "on_or_before",
        "on_or_after",
        "between",
        "is_within",
        "is_empty",
        "is_not_empty",
      ]);
    }
    for (const type of ["text", "number", "select", "relation"] as const) {
      const operators = contentDatabaseFilterOperatorsForType(type);
      expect(operators).not.toContain("on_or_before");
      expect(operators).not.toContain("on_or_after");
      expect(operators).not.toContain("is_within");
    }
  });
});

describe("content database filter today", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads today in the given time zone", () => {
    const now = new Date("2026-10-23T02:30:00Z");
    expect(contentDatabaseFilterToday("America/New_York", now)).toBe(
      "2026-10-22",
    );
    expect(contentDatabaseFilterToday("Asia/Tokyo", now)).toBe("2026-10-23");
    expect(contentDatabaseFilterToday("Not/AZone", now)).toBe(
      contentDatabaseFilterToday(undefined, now),
    );
  });

  it("counts from this machine's today when no day is given", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 22, 12));
    const ids = applyContentDatabaseTableQuery(datedItems, [dateProperty], {
      search: "",
      filters: [
        { key: "date", label: "Date", operator: "equals", value: "today" },
      ],
      sorts: [],
    }).map((row) => row.document.id);
    expect(ids).toEqual(["morning", "whole-day", "evening"]);
  });
});
