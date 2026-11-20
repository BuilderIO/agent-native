import { describe, expect, it } from "vitest";

import {
  activeFilterRuleCount,
  addFilterGroup,
  addFilterRule,
  countFilter,
  createFilterGroup,
  createFilterRule,
  createFilterState,
  FILTER_NOBODY,
  filterDatePresets,
  filterDateRangeDays,
  filterDateRangeToken,
  filterOperatorsFor,
  filterToday,
  hasIncompleteFilterRules,
  isDefaultFilterState,
  isFilterRuleComplete,
  matchesFilter,
  parseFilterDateRange,
  patchFilterRule,
  pruneFilterState,
  removeFilterItem,
  resolveFilterDay,
  setFilterMode,
  setPinnedFilter,
  updateFilterRule,
  type FilterField,
  type FilterRule,
  type FilterState,
} from "./model.js";

interface Clip {
  id: string;
  source: "clips" | "content";
  owner: string | null;
  tags: string[];
  created: string;
  title: string;
  minutes: number;
  starred: boolean;
}

const sourceField: FilterField<Clip> = {
  id: "source",
  label: "Where it came from",
  type: "choice",
  options: [
    { id: "clips", label: "Recorded in Clips" },
    { id: "content", label: "Uploaded from Content" },
  ],
  pinned: { default: ["clips"] },
  get: (clip) => clip.source,
};

const ownerField: FilterField<Clip> = {
  id: "owner",
  label: "Made by",
  type: "person",
  options: [
    { id: "alice", label: "Alice" },
    { id: "agent", label: "An agent" },
  ],
  get: (clip) => clip.owner,
};

const tagsField: FilterField<Clip> = {
  id: "tags",
  label: "Tags",
  type: "multi",
  options: [
    { id: "demo", label: "Demo" },
    { id: "bug", label: "Bug" },
  ],
  get: (clip) => clip.tags,
};

const createdField: FilterField<Clip> = {
  id: "created",
  label: "Created",
  type: "date",
  dates: "past",
  alwaysSet: true,
  get: (clip) => clip.created,
};

const titleField: FilterField<Clip> = {
  id: "title",
  label: "Title",
  type: "text",
  get: (clip) => clip.title,
};

const minutesField: FilterField<Clip> = {
  id: "minutes",
  label: "Length",
  type: "number",
  get: (clip) => clip.minutes,
};

const starredField: FilterField<Clip> = {
  id: "starred",
  label: "Starred",
  type: "boolean",
  get: (clip) => clip.starred,
};

const fields = [
  sourceField,
  ownerField,
  tagsField,
  createdField,
  titleField,
  minutesField,
  starredField,
];

const today = "2026-11-20";
const context = { today };

const clips: Clip[] = [
  {
    id: "1",
    source: "clips",
    owner: "alice",
    tags: ["demo"],
    created: "2026-11-20",
    title: "Filter kit walkthrough",
    minutes: 4,
    starred: true,
  },
  {
    id: "2",
    source: "clips",
    owner: null,
    tags: [],
    created: "2026-11-19",
    title: "Bug repro",
    minutes: 12,
    starred: false,
  },
  {
    id: "3",
    source: "content",
    owner: "agent",
    tags: ["demo", "bug"],
    created: "2026-10-02",
    title: "Content upload",
    minutes: 1,
    starred: false,
  },
  {
    id: "4",
    source: "clips",
    owner: "agent",
    tags: ["bug"],
    created: "2025-12-31",
    title: "Old agent clip",
    minutes: 30,
    starred: true,
  },
];

function matchingIds(state: FilterState) {
  return clips
    .filter((clip) => matchesFilter(clip, state, fields, context))
    .map((clip) => clip.id);
}

function withRules(...rules: FilterRule[]) {
  return rules.reduce(
    (state, rule) => addFilterRule(state, rule),
    createFilterState(fields),
  );
}

describe("filter operators", () => {
  it("offers each field type its own operators", () => {
    expect(filterOperatorsFor(ownerField)).toEqual([
      "equals",
      "does_not_equal",
    ]);
    expect(filterOperatorsFor(tagsField)).toEqual([
      "contains",
      "does_not_contain",
      "is_empty",
      "is_not_empty",
    ]);
    expect(filterOperatorsFor(starredField)).toEqual([
      "is_checked",
      "is_unchecked",
    ]);
  });

  it("drops the emptiness operators from fields that are always set", () => {
    expect(filterOperatorsFor(createdField)).not.toContain("is_empty");
    expect(filterOperatorsFor(createdField)).not.toContain("is_not_empty");
    expect(filterOperatorsFor(createdField).at(0)).toBe("is_within");
  });
});

describe("rule completeness", () => {
  it("needs a value unless the operator takes none", () => {
    expect(isFilterRuleComplete(createFilterRule(ownerField), ownerField)).toBe(
      false,
    );
    expect(
      isFilterRuleComplete(
        createFilterRule(tagsField, [], "is_empty"),
        tagsField,
      ),
    ).toBe(true);
    expect(
      isFilterRuleComplete(
        createFilterRule(starredField, [], "is_checked"),
        starredField,
      ),
    ).toBe(true);
  });

  it("rejects operators the field does not offer", () => {
    expect(
      isFilterRuleComplete(
        createFilterRule(createdField, [], "is_empty"),
        createdField,
      ),
    ).toBe(false);
  });

  it("checks dates and numbers", () => {
    expect(
      isFilterRuleComplete(
        createFilterRule(createdField, ["past_7_days"]),
        createdField,
      ),
    ).toBe(true);
    expect(
      isFilterRuleComplete(
        createFilterRule(createdField, ["last week"]),
        createdField,
      ),
    ).toBe(false);
    expect(
      isFilterRuleComplete(
        createFilterRule(createdField, ["2026-02-30x"], "before"),
        createdField,
      ),
    ).toBe(false);
    expect(
      isFilterRuleComplete(
        createFilterRule(minutesField, ["ten"], "greater_than"),
        minutesField,
      ),
    ).toBe(false);
  });

  it("never treats a pinned field as a rule", () => {
    expect(
      isFilterRuleComplete(
        createFilterRule(sourceField, ["content"]),
        sourceField,
      ),
    ).toBe(false);
  });

  it("keeps single-value operators to one value", () => {
    expect(
      isFilterRuleComplete(
        createFilterRule(titleField, ["a", "b"], "contains"),
        titleField,
      ),
    ).toBe(false);
  });
});

describe("matching", () => {
  it("hides rows outside a pinned field's default", () => {
    expect(matchingIds(createFilterState(fields))).toEqual(["1", "2", "4"]);
  });

  it("shows every row once a pinned field covers all its options", () => {
    const state = setPinnedFilter(createFilterState(fields), "source", [
      "clips",
      "content",
    ]);
    expect(matchingIds(state)).toEqual(["1", "2", "3", "4"]);
  });

  it("matches Nobody against an empty person cell", () => {
    expect(
      matchingIds(withRules(createFilterRule(ownerField, [FILTER_NOBODY]))),
    ).toEqual(["2"]);
    expect(
      matchingIds(
        withRules(createFilterRule(ownerField, [FILTER_NOBODY, "alice"])),
      ),
    ).toEqual(["1", "2"]);
    expect(
      matchingIds(
        withRules(
          createFilterRule(ownerField, [FILTER_NOBODY], "does_not_equal"),
        ),
      ),
    ).toEqual(["1", "4"]);
  });

  it("matches tags with has any of, has none of and emptiness", () => {
    expect(
      matchingIds(withRules(createFilterRule(tagsField, ["demo"]))),
    ).toEqual(["1"]);
    expect(
      matchingIds(
        withRules(createFilterRule(tagsField, ["demo"], "does_not_contain")),
      ),
    ).toEqual(["2", "4"]);
    expect(
      matchingIds(withRules(createFilterRule(tagsField, [], "is_empty"))),
    ).toEqual(["2"]);
  });

  it("matches relative and exact dates", () => {
    expect(
      matchingIds(
        withRules(createFilterRule(createdField, ["today"], "equals")),
      ),
    ).toEqual(["1"]);
    expect(
      matchingIds(
        withRules(createFilterRule(createdField, ["yesterday"], "equals")),
      ),
    ).toEqual(["2"]);
    expect(
      matchingIds(withRules(createFilterRule(createdField, ["past_7_days"]))),
    ).toEqual(["1", "2"]);
    expect(
      matchingIds(withRules(createFilterRule(createdField, ["this_year"]))),
    ).toEqual(["1", "2"]);
    expect(
      matchingIds(
        withRules(createFilterRule(createdField, ["2026-01-01"], "before")),
      ),
    ).toEqual(["4"]);
  });

  it("matches text without regard to case", () => {
    expect(
      matchingIds(withRules(createFilterRule(titleField, ["FILTER"]))),
    ).toEqual(["1"]);
    expect(
      matchingIds(
        withRules(createFilterRule(titleField, ["bug"], "starts_with")),
      ),
    ).toEqual(["2"]);
  });

  it("compares numbers and booleans", () => {
    expect(
      matchingIds(
        withRules(createFilterRule(minutesField, ["10"], "greater_than")),
      ),
    ).toEqual(["2", "4"]);
    expect(
      matchingIds(withRules(createFilterRule(starredField, [], "is_checked"))),
    ).toEqual(["1", "4"]);
  });

  it("combines rules with all or any", () => {
    const state = withRules(
      createFilterRule(ownerField, ["alice"]),
      createFilterRule(minutesField, ["20"], "greater_than"),
    );
    expect(matchingIds(state)).toEqual([]);
    expect(matchingIds(setFilterMode(state, "or"))).toEqual(["1", "4"]);
  });

  it("evaluates a group with its own mode", () => {
    const group = createFilterGroup([
      createFilterRule(tagsField, ["bug"]),
      createFilterRule(starredField, [], "is_checked"),
    ]);
    const state = addFilterGroup(
      withRules(createFilterRule(ownerField, ["agent"])),
      group,
    );
    expect(matchingIds(state)).toEqual(["4"]);
    expect(
      matchingIds(
        addFilterGroup(
          withRules(createFilterRule(titleField, ["clip"])),
          createFilterGroup(
            [
              createFilterRule(tagsField, ["bug"]),
              createFilterRule(starredField, [], "is_checked"),
            ],
            "and",
          ),
        ),
      ),
    ).toEqual(["4"]);
  });

  it("ignores rules that are not finished", () => {
    const state = withRules(createFilterRule(ownerField));
    expect(matchingIds(state)).toEqual(["1", "2", "4"]);
    expect(activeFilterRuleCount(state, fields)).toBe(0);
  });
});

describe("state helpers", () => {
  it("knows the default state", () => {
    const state = createFilterState(fields);
    expect(isDefaultFilterState(state, fields)).toBe(true);
    expect(isDefaultFilterState(setFilterMode(state, "or"), fields)).toBe(
      false,
    );
    expect(
      isDefaultFilterState(
        setPinnedFilter(state, "source", ["content"]),
        fields,
      ),
    ).toBe(false);
    expect(
      isDefaultFilterState(
        addFilterRule(state, createFilterRule(ownerField)),
        fields,
      ),
    ).toBe(true);
  });

  it("prunes unfinished rules and empty groups", () => {
    const finished = createFilterRule(ownerField, ["alice"]);
    const state = addFilterGroup(
      withRules(createFilterRule(titleField), finished),
      createFilterGroup([createFilterRule(tagsField)]),
    );
    expect(hasIncompleteFilterRules(state, fields)).toBe(true);
    const pruned = pruneFilterState(state, fields);
    expect(pruned.items).toEqual([finished]);
    expect(hasIncompleteFilterRules(pruned, fields)).toBe(false);
  });

  it("removes a rule and drops a group it leaves empty", () => {
    const rule = createFilterRule(tagsField, ["bug"]);
    const group = createFilterGroup([rule]);
    const state = addFilterGroup(createFilterState(fields), group);
    expect(removeFilterItem(state, rule.id).items).toEqual([]);
  });

  it("adds a rule to a group and sets a group's mode", () => {
    const group = createFilterGroup([createFilterRule(tagsField, ["bug"])]);
    const rule = createFilterRule(starredField, [], "is_checked");
    const state = setFilterMode(
      addFilterRule(
        addFilterGroup(createFilterState(fields), group),
        rule,
        group.id,
      ),
      "and",
      group.id,
    );
    const updated = state.items.at(0);
    expect(updated?.kind === "group" ? updated.rules.at(1) : null).toEqual(
      rule,
    );
    expect(updated?.kind === "group" ? updated.mode : null).toBe("and");
    expect(state.mode).toBe("and");
  });
});

describe("patching a rule", () => {
  it("resets the operator and value when the field changes", () => {
    const rule = createFilterRule(ownerField, ["alice"]);
    expect(patchFilterRule(rule, { field: "tags" }, fields)).toMatchObject({
      field: "tags",
      operator: "contains",
      value: [],
    });
  });

  it("clears the value for an operator that takes none", () => {
    const rule = createFilterRule(tagsField, ["demo"]);
    expect(
      patchFilterRule(rule, { operator: "is_empty" }, fields).value,
    ).toEqual([]);
  });

  it("clears a date when switching between a range and a day", () => {
    const rule = createFilterRule(createdField, ["past_7_days"]);
    expect(patchFilterRule(rule, { operator: "before" }, fields).value).toEqual(
      [],
    );
  });

  it("trims to one value for a single-value operator", () => {
    const rule = createFilterRule(ownerField, ["alice", "agent"]);
    expect(
      patchFilterRule(rule, { operator: "does_not_equal" }, fields).value,
    ).toEqual(["alice", "agent"]);
    const text = createFilterRule(titleField, ["clip"]);
    expect(
      patchFilterRule(
        { ...text, value: ["a", "b"] },
        { operator: "ends_with" },
        fields,
      ).value,
    ).toEqual(["a"]);
  });

  it("updates a rule inside a group", () => {
    const rule = createFilterRule(tagsField, ["demo"]);
    const state = addFilterGroup(
      createFilterState(fields),
      createFilterGroup([rule]),
    );
    const next = updateFilterRule(state, rule.id, { value: ["bug"] }, fields);
    const group = next.items.at(0);
    expect(group?.kind === "group" ? group.rules.at(0)?.value : null).toEqual([
      "bug",
    ]);
  });
});

describe("dates", () => {
  it("parses and writes range tokens", () => {
    expect(parseFilterDateRange("past_7_days")).toEqual({
      direction: "past",
      count: 7,
      unit: "day",
    });
    expect(parseFilterDateRange("this_month")).toEqual({
      direction: "this",
      unit: "month",
    });
    expect(parseFilterDateRange("past_0_days")).toBeNull();
    expect(parseFilterDateRange("past_1000_days")).toBeNull();
    expect(
      filterDateRangeToken({ direction: "next", count: 1, unit: "week" }),
    ).toBe("next_1_week");
    expect(
      filterDateRangeToken({ direction: "past", count: 3, unit: "month" }),
    ).toBe("past_3_months");
  });

  it("turns ranges into inclusive days", () => {
    expect(
      filterDateRangeDays({ direction: "past", count: 7, unit: "day" }, today),
    ).toEqual(["2026-11-14", "2026-11-20"]);
    expect(
      filterDateRangeDays({ direction: "next", count: 1, unit: "week" }, today),
    ).toEqual(["2026-11-20", "2026-11-26"]);
    expect(
      filterDateRangeDays({ direction: "this", unit: "week" }, today),
    ).toEqual(["2026-11-15", "2026-11-21"]);
    expect(
      filterDateRangeDays({ direction: "this", unit: "month" }, "2026-02-10"),
    ).toEqual(["2026-02-01", "2026-02-28"]);
    expect(
      filterDateRangeDays(
        { direction: "past", count: 1, unit: "month" },
        "2026-03-31",
      ),
    ).toEqual(["2026-03-01", "2026-03-31"]);
  });

  it("resolves relative days and rejects bad ones", () => {
    expect(resolveFilterDay("yesterday", "2026-03-01")).toBe("2026-02-28");
    expect(resolveFilterDay("tomorrow", "2026-12-31")).toBe("2027-01-01");
    expect(resolveFilterDay("2026-11-02", today)).toBe("2026-11-02");
    expect(resolveFilterDay("11/02/2026", today)).toBeNull();
    expect(resolveFilterDay("2026-02-30", today)).toBeNull();
  });

  it("reads a timestamp without an offset as UTC", () => {
    const atField: FilterField<{ at: string }> = {
      id: "at",
      label: "At",
      type: "date",
      get: (row) => row.at,
    };
    const state = addFilterRule(
      createFilterState([atField]),
      createFilterRule(atField, ["today"], "equals"),
    );
    const zone = { today, timeZone: "America/New_York" };
    expect(
      matchesFilter({ at: "2026-11-20T00:30:00" }, state, [atField], zone),
    ).toBe(false);
    expect(
      matchesFilter({ at: "2026-11-20 12:00:00" }, state, [atField], zone),
    ).toBe(true);
  });

  it("reads today in a time zone", () => {
    const now = new Date("2026-11-21T03:00:00Z");
    expect(filterToday("America/New_York", now)).toBe("2026-11-20");
    expect(filterToday("UTC", now)).toBe("2026-11-21");
    expect(() => filterToday("Not/A_Zone", now)).toThrow(RangeError);
  });

  it("offers presets that fit the field", () => {
    const past = filterDatePresets({ dates: "past" }).map(
      (preset) => preset.value,
    );
    expect(past).toContain("yesterday");
    expect(past).not.toContain("tomorrow");
    const future = filterDatePresets({ dates: "future" }).map(
      (preset) => preset.value,
    );
    expect(future).toContain("next_7_days");
    expect(future).not.toContain("past_7_days");
    const any = filterDatePresets({}).map(
      (preset) => `${preset.operator}:${preset.value}`,
    );
    expect(new Set(any).size).toBe(any.length);
  });
});

describe("counting", () => {
  it("counts matching rows and the rows a pinned field hides", () => {
    const counts = countFilter(
      clips,
      createFilterState(fields),
      fields,
      context,
    );
    expect(counts.matching).toBe(3);
    expect(counts.hiddenByPinned).toBe(1);
  });

  it("counts a pinned field's options as if it were unset", () => {
    const counts = countFilter(
      clips,
      createFilterState(fields),
      fields,
      context,
    );
    expect(counts.option("source", "clips")).toBe(3);
    expect(counts.option("source", "content")).toBe(1);
  });

  it("counts a field's options without its own rules when all must match", () => {
    const state = withRules(
      createFilterRule(ownerField, ["alice"]),
      createFilterRule(starredField, [], "is_checked"),
    );
    const counts = countFilter(clips, state, fields, context);
    expect(counts.matching).toBe(1);
    expect(counts.option("owner", "agent")).toBe(1);
    expect(counts.option("owner", FILTER_NOBODY)).toBe(0);
    expect(counts.option("tags", "bug")).toBe(0);
    expect(counts.option("tags", "demo")).toBe(1);
  });

  it("counts empty cells under Nobody", () => {
    const counts = countFilter(
      clips,
      createFilterState(fields),
      fields,
      context,
    );
    expect(counts.option("owner", FILTER_NOBODY)).toBe(1);
  });

  it("has no count for a field it cannot read", () => {
    const counts = countFilter(
      clips,
      createFilterState(fields),
      [...fields, { id: "space", label: "Space", type: "choice" }],
      context,
    );
    expect(counts.option("space", "home")).toBeUndefined();
  });
});
