import { describe, expect, it, vi } from "vitest";

import {
  activeFilterRuleCount,
  addFilterGroup,
  addFilterRule,
  countFilter,
  createFilterGroup,
  createFilterRule,
  createFilterState,
  FILTER_NOBODY,
  filterDateInstant,
  filterDatePresets,
  filterDateRangeDays,
  filterDateRangeToken,
  filterItemRules,
  filterOperatorsAcceptedFor,
  filterOperatorsFor,
  filterOperatorValueCount,
  filterToday,
  findFilterGroup,
  findFilterRule,
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

  it("takes a wide group and refuses a deep one without walking all of it", () => {
    const empty = createFilterState(fields);
    const wide = createFilterGroup(
      Array.from({ length: 150_000 }, () =>
        createFilterRule(titleField, ["clip"]),
      ),
    );
    expect(addFilterGroup(empty, wide).items).toHaveLength(1);
    let deep = createFilterGroup([createFilterRule(titleField, ["clip"])]);
    for (let level = 0; level < 10_000; level += 1) {
      deep = createFilterGroup([deep]);
    }
    expect(addFilterGroup(empty, deep)).toBe(empty);
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
    const member = group?.kind === "group" ? group.rules.at(0) : undefined;
    expect(member?.kind === "rule" ? member.value : null).toEqual(["bug"]);
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
    expect(resolveFilterDay("0099-12-31", today)).toBe("0099-12-31");
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
    expect(filterToday(undefined, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reads days in this machine's zone when it doesn't know the caller's", () => {
    const now = new Date("2026-11-21T03:00:00Z");
    expect(filterToday("Not/A_Zone", now)).toBe(filterToday(undefined, now));
    expect(filterToday("", now)).toBe(filterToday(undefined, now));
    const state = withRules(
      createFilterRule(createdField, ["2026-10-01", "2026-10-31"], "between"),
    );
    const first = clips.at(0);
    if (!first) throw new Error("No clips");
    const clip = { ...first, created: "2026-10-22T09:00Z" };
    expect(
      matchesFilter(clip, state, fields, {
        today: "2026-10-22",
        timeZone: "Bogus/Zone",
      }),
    ).toBe(true);
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

describe("date ranges and times", () => {
  const timedField: FilterField<Clip> = { ...createdField, times: true };
  const timedFields = [timedField];
  const clip: Clip = {
    id: "t",
    source: "clips",
    owner: null,
    tags: [],
    created: "",
    title: "",
    minutes: 0,
    starred: false,
  };
  const matches = (created: string, rule: FilterRule, timeZone = "UTC") =>
    matchesFilter(
      { ...clip, created },
      addFilterRule(createFilterState(timedFields), rule),
      timedFields,
      { today, timeZone },
    );

  it("lists between but only accepts is not on", () => {
    expect(filterOperatorsFor(createdField)).toContain("between");
    expect(filterOperatorsFor(createdField)).not.toContain("does_not_equal");
    expect(filterOperatorsAcceptedFor(createdField)).toContain(
      "does_not_equal",
    );
    expect(filterOperatorValueCount("between")).toBe(2);
    expect(filterOperatorValueCount("is_empty")).toBe(0);
  });

  it("offers and takes only the operators a field names", () => {
    const filesField: FilterField = {
      id: "files",
      label: "Files",
      type: "text",
      operators: ["contains", "is_empty", "is_not_empty"],
    };
    const narrowedDate: FilterField<Clip> = {
      ...createdField,
      operators: ["before", "after"],
    };
    expect(filterOperatorsFor(filesField)).toEqual([
      "contains",
      "is_empty",
      "is_not_empty",
    ]);
    expect(createFilterRule(filesField).operator).toBe("contains");
    expect(
      isFilterRuleComplete(
        createFilterRule(filesField, ["a"], "starts_with"),
        filesField,
      ),
    ).toBe(false);
    expect(filterOperatorsAcceptedFor(narrowedDate)).toEqual([
      "before",
      "after",
    ]);
  });

  it("needs both ends of a range", () => {
    expect(
      isFilterRuleComplete(
        createFilterRule(createdField, ["2026-10-01"], "between"),
        createdField,
      ),
    ).toBe(false);
    expect(
      isFilterRuleComplete(
        createFilterRule(createdField, ["2026-10-01", "today"], "between"),
        createdField,
      ),
    ).toBe(true);
  });

  it("takes a time only on a field with times", () => {
    const rule = createFilterRule(createdField, ["2026-10-22T09:00"], "after");
    expect(isFilterRuleComplete(rule, createdField)).toBe(false);
    expect(isFilterRuleComplete(rule, timedField)).toBe(true);
    expect(
      isFilterRuleComplete(
        createFilterRule(timedField, ["2026-10-22T24:00"], "after"),
        timedField,
      ),
    ).toBe(false);
  });

  it("matches days inside a range, either way round", () => {
    const range = createFilterRule(
      createdField,
      ["2026-10-01", "2026-11-19"],
      "between",
    );
    expect(matchingIds(withRules(range))).toEqual(["2"]);
    expect(
      matchingIds(withRules({ ...range, value: ["2026-11-19", "2026-10-01"] })),
    ).toEqual(["2"]);
    expect(
      matchingIds(
        withRules(
          createFilterRule(createdField, ["yesterday", "today"], "between"),
        ),
      ),
    ).toEqual(["1", "2"]);
  });

  it("matches is not on, including an empty date", () => {
    const notOn = createFilterRule(
      timedField,
      ["2026-11-20"],
      "does_not_equal",
    );
    expect(matches("2026-11-20", notOn)).toBe(false);
    expect(matches("2026-11-19", notOn)).toBe(true);
    expect(matches("", notOn)).toBe(true);
  });

  it("compares a time as a moment and a bare day by the day it falls on", () => {
    const after = createFilterRule(timedField, ["2026-10-22T09:00Z"], "after");
    expect(matches("2026-10-22T09:30:00Z", after)).toBe(true);
    expect(matches("2026-10-22T08:30:00Z", after)).toBe(false);
    expect(matches("2026-10-22", after)).toBe(false);
    expect(
      matches(
        "2026-10-22",
        createFilterRule(timedField, ["2026-10-22T09:00Z"], "equals"),
      ),
    ).toBe(true);
  });

  it("reads a time without an offset in the caller's zone", () => {
    const after = createFilterRule(timedField, ["2026-10-22T09:00"], "after");
    expect(matches("2026-10-22T12:30:00Z", after, "America/New_York")).toBe(
      false,
    );
    expect(matches("2026-10-22T13:30:00Z", after, "America/New_York")).toBe(
      true,
    );
    expect(filterDateInstant("2026-10-22T09:00", "America/New_York")).toBe(
      Date.UTC(2026, 9, 22, 13),
    );
  });

  it("reads a row's time without an offset in the caller's zone, as its rules", () => {
    const after = createFilterRule(timedField, ["2026-10-22T09:00"], "after");
    expect(matches("2026-10-22T08:30", after, "America/New_York")).toBe(false);
    expect(matches("2026-10-22T09:30", after, "America/New_York")).toBe(true);
  });

  it("resolves a rule's bounds once, not for every row", () => {
    const state = addFilterRule(
      createFilterState(timedFields),
      createFilterRule(
        timedField,
        ["2026-10-01T09:00", "2026-10-31T17:00"],
        "between",
      ),
    );
    const rows = Array.from({ length: 50 }, (_, index) => ({
      ...clip,
      created: `2026-10-${String((index % 28) + 1).padStart(2, "0")}T12:00:00Z`,
    }));
    const formatToParts = vi.spyOn(
      Intl.DateTimeFormat.prototype,
      "formatToParts",
    );
    try {
      for (const row of rows) {
        matchesFilter(row, state, timedFields, {
          today,
          timeZone: "America/New_York",
        });
      }
      expect(formatToParts.mock.calls.length).toBeLessThan(rows.length * 2);
    } finally {
      formatToParts.mockRestore();
    }
  });

  it("reads a skipped time forward and a repeated time as the first", () => {
    expect(filterDateInstant("2026-03-08T02:30", "America/New_York")).toBe(
      Date.UTC(2026, 2, 8, 7, 30),
    );
    expect(filterDateInstant("2026-11-01T01:30", "America/New_York")).toBe(
      Date.UTC(2026, 10, 1, 5, 30),
    );
  });

  it("keeps a range's first date when it changes to a single date", () => {
    const range = createFilterRule(
      createdField,
      ["2026-10-01", "2026-10-31"],
      "between",
    );
    expect(
      patchFilterRule(range, { operator: "before" }, fields).value,
    ).toEqual(["2026-10-01"]);
    const endOnly = createFilterRule(
      createdField,
      ["", "2026-10-31"],
      "between",
    );
    expect(
      patchFilterRule(endOnly, { operator: "after" }, fields).value,
    ).toEqual(["2026-10-31"]);
  });

  it("resets the value when the operator needs another shape", () => {
    const rule = createFilterRule(createdField, ["2026-10-01"], "before");
    expect(
      patchFilterRule(rule, { operator: "between" }, fields).value,
    ).toEqual([]);
    expect(patchFilterRule(rule, { operator: "after" }, fields).value).toEqual([
      "2026-10-01",
    ]);
    const range = createFilterRule(
      createdField,
      ["2026-10-01", "2026-10-31"],
      "between",
    );
    expect(
      patchFilterRule(range, { operator: "between" }, fields).value,
    ).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("reads a time in a row the way it reads one in a rule", () => {
    const at = (value: string) =>
      createFilterRule(timedField, [value], "equals");
    expect(
      matches("2026-10-22T09:00:00+05", at("2026-10-22T09:00:00+05")),
    ).toBe(true);
    // oracle-change: a row's time without an offset is now read in the caller's zone, as Content's server reads it, so this syntax check runs in UTC; the caller's-zone test above covers the zone
    expect(matches("2026-10-22t09:00", at("2026-10-22T09:00Z"))).toBe(true);
    expect(matches("2026-10-22 09:00", at("2026-10-22T09:00Z"))).toBe(true);
  });

  it("keeps a range in order when a day and a time share a day", () => {
    const range = (value: string[]) =>
      createFilterRule(timedField, value, "between");
    const untilNine = range(["2026-10-22", "2026-10-22T09:00Z"]);
    expect(matches("2026-10-22T08:00:00Z", untilNine)).toBe(true);
    expect(matches("2026-10-22T10:00:00Z", untilNine)).toBe(false);
    expect(matches("2026-10-22", untilNine)).toBe(true);
    const fromNine = range(["2026-10-22T09:00Z", "2026-10-22"]);
    expect(matches("2026-10-22T08:00:00Z", fromNine)).toBe(false);
    expect(matches("2026-10-22T10:00:00Z", fromNine)).toBe(true);
  });

  it("orders a range by the days its ends fall on", () => {
    const stJohns = createFilterRule(
      timedField,
      ["2009-11-01T02:45Z", "2009-10-31"],
      "between",
    );
    expect(matches("2009-10-31T14:00:00Z", stJohns, "America/St_Johns")).toBe(
      false,
    );
    expect(matches("2009-11-01T03:00:00Z", stJohns, "America/St_Johns")).toBe(
      true,
    );
    const days = (value: string[]) =>
      createFilterRule(createdField, value, "between");
    expect(matches("0099-12-15", days(["0099-12-01", "0100-01-01"]))).toBe(
      true,
    );
    expect(matches("9999-12-15", days(["9999-12-01", "9999-12-31"]))).toBe(
      true,
    );
  });

  it("compares a bare day with the day an offset time falls on in the caller's zone", () => {
    const on = createFilterRule(
      timedField,
      ["2026-10-22T02:00+05:30"],
      "equals",
    );
    expect(matches("2026-10-21", on)).toBe(true);
    expect(matches("2026-10-22", on, "Asia/Kolkata")).toBe(true);
    expect(matches("2026-10-21", on, "Asia/Kolkata")).toBe(false);
  });

  it("reads a time in a zone this runtime doesn't know as this machine's", () => {
    expect(filterDateInstant("2026-10-22T09:00", "Bogus/Zone")).toBe(
      filterDateInstant("2026-10-22T09:00"),
    );
  });
});

describe("groups inside groups", () => {
  const demo = () => createFilterRule(tagsField, ["demo"]);
  const agent = () => createFilterRule(ownerField, ["agent"]);
  const long = () => createFilterRule(minutesField, ["10"], "greater_than");

  function nestedState() {
    const agentRule = agent();
    const longRule = long();
    const inner = createFilterGroup([agentRule, longRule], "and");
    const outer = createFilterGroup([demo(), inner], "or");
    return {
      agentRule,
      longRule,
      inner,
      outer,
      state: addFilterGroup(createFilterState(fields), outer),
    };
  }

  it("matches a group inside a group with its own mode", () => {
    expect(matchingIds(nestedState().state)).toEqual(["1", "4"]);
  });

  it("makes a new group's ID one a reload can't hand out again", async () => {
    vi.resetModules();
    const before = await import("./model.js");
    const saved = before.createFilterGroup([]).id;
    vi.resetModules();
    const after = await import("./model.js");
    expect(after.createFilterGroup([]).id).not.toBe(saved);
  });

  it("adds a group only at the top or one level down", () => {
    const { outer, inner, state } = nestedState();
    const child = createFilterGroup([demo()]);
    expect(
      findFilterGroup(addFilterGroup(state, child, outer.id), child.id),
    ).toBeDefined();
    const tooDeep = createFilterGroup([demo()]);
    const unchanged = addFilterGroup(state, tooDeep, inner.id);
    expect(findFilterGroup(unchanged, tooDeep.id)).toBeUndefined();
    expect(unchanged).toEqual(state);
    const alreadyNested = createFilterGroup([createFilterGroup([demo()])]);
    expect(addFilterGroup(state, alreadyNested, outer.id)).toEqual(state);
    expect(
      addFilterGroup(
        state,
        createFilterGroup([createFilterGroup([alreadyNested])]),
      ),
    ).toEqual(state);
    expect(
      findFilterGroup(addFilterGroup(state, alreadyNested), alreadyNested.id),
    ).toBeDefined();
  });

  it("finds, updates, counts and removes rules inside a nested group", () => {
    const { agentRule, longRule, inner, outer, state } = nestedState();
    expect(findFilterRule(state, agentRule.id)?.field).toBe("owner");
    const updated = updateFilterRule(
      state,
      agentRule.id,
      { value: ["alice"] },
      fields,
    );
    expect(findFilterRule(updated, agentRule.id)?.value).toEqual(["alice"]);
    expect(activeFilterRuleCount(state, fields)).toBe(3);
    expect(filterItemRules(outer)).toHaveLength(3);
    const removed = removeFilterItem(
      removeFilterItem(state, agentRule.id),
      longRule.id,
    );
    expect(findFilterGroup(removed, inner.id)).toBeUndefined();
    expect(activeFilterRuleCount(removed, fields)).toBe(1);
  });

  it("sets a nested group's mode and prunes its unfinished rules", () => {
    const { inner, state } = nestedState();
    expect(
      findFilterGroup(setFilterMode(state, "or", inner.id), inner.id)?.mode,
    ).toBe("or");
    const unfinished = addFilterRule(
      state,
      createFilterRule(ownerField),
      inner.id,
    );
    expect(hasIncompleteFilterRules(unfinished, fields)).toBe(true);
    expect(pruneFilterState(unfinished, fields)).toEqual(state);
  });
});
