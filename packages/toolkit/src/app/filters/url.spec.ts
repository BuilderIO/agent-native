import { describe, expect, it } from "vitest";

import {
  addFilterGroup,
  addFilterRule,
  createFilterGroup,
  createFilterRule,
  createFilterState,
  setFilterMode,
  setPinnedFilter,
  type FilterField,
  type FilterItem,
  type FilterState,
} from "./model.js";
import {
  filterSearchKey,
  filterStateKey,
  filterStateToParams,
  readFilterParams,
  writeFilterSearch,
} from "./url.js";

const sourceField: FilterField = {
  id: "source",
  label: "Where it came from",
  type: "choice",
  options: [
    { id: "clips", label: "Recorded in Clips" },
    { id: "content", label: "Uploaded from Content" },
  ],
  pinned: { default: ["clips"] },
};

const ownerField: FilterField = {
  id: "owner",
  label: "Made by",
  type: "person",
};

const tagsField: FilterField = { id: "tags", label: "Tags", type: "multi" };

const titleField: FilterField = { id: "title", label: "Title", type: "text" };

const createdField: FilterField = {
  id: "created",
  label: "Created",
  type: "date",
};

const fields = [sourceField, ownerField, tagsField, titleField, createdField];

function shape(items: readonly FilterItem[]): unknown[] {
  return items.map((item) =>
    item.kind === "rule"
      ? { field: item.field, operator: item.operator, value: item.value }
      : { mode: item.mode, rules: shape(item.rules) },
  );
}

function roundTrip(state: FilterState) {
  return readFilterParams(writeFilterSearch("", state, fields), fields);
}

describe("filter URL params", () => {
  it("writes nothing for the default state", () => {
    expect(filterStateToParams(createFilterState(fields), fields)).toEqual([]);
    expect(writeFilterSearch("", createFilterState(fields), fields)).toBe("");
  });

  it("writes a pinned field only when it differs from its default", () => {
    const state = createFilterState(fields);
    expect(
      filterStateToParams(
        setPinnedFilter(state, "source", ["content"]),
        fields,
      ),
    ).toEqual([["source", "content"]]);
    expect(
      filterStateToParams(
        setPinnedFilter(state, "source", ["content", "clips"]),
        fields,
      ),
    ).toEqual([["source", "all"]]);
  });

  it("reads all as every option and ignores unknown option ids", () => {
    expect(readFilterParams("?source=all", fields).pinned.source).toEqual([
      "clips",
      "content",
    ]);
    expect(readFilterParams("?source=nope", fields).pinned.source).toEqual([
      "clips",
    ]);
  });

  it("round-trips rules, groups and the match mode", () => {
    const state = setFilterMode(
      addFilterGroup(
        addFilterRule(
          createFilterState(fields),
          createFilterRule(ownerField, ["~nobody", "alice"]),
        ),
        createFilterGroup(
          [
            createFilterRule(tagsField, ["a,b", "c:d"]),
            createFilterRule(titleField, ["50% / off"], "starts_with"),
          ],
          "and",
        ),
      ),
      "or",
    );
    const search = writeFilterSearch("", state, fields);
    expect(search).toContain("match=any");
    expect(search).toContain("g=1:all");
    expect(search).toContain("r=owner:equals:~nobody,alice");
    const read = roundTrip(state);
    expect(read.mode).toBe("or");
    expect(shape(read.items)).toEqual(shape(state.items));
  });

  it("writes the match mode only beside a finished rule", () => {
    const anyOf = setFilterMode(createFilterState(fields), "or");
    expect(filterStateToParams(anyOf, fields)).toEqual([]);
    expect(
      writeFilterSearch(
        "?match=any",
        addFilterRule(anyOf, createFilterRule(ownerField)),
        fields,
      ),
    ).toBe("");
    expect(
      filterStateToParams(
        addFilterRule(anyOf, createFilterRule(ownerField, ["alice"])),
        fields,
      ),
    ).toEqual([
      ["match", "any"],
      ["r", "owner:equals:alice"],
    ]);
  });

  it("numbers groups in order", () => {
    const state = addFilterGroup(
      addFilterGroup(
        createFilterState(fields),
        createFilterGroup([createFilterRule(tagsField, ["a"])]),
      ),
      createFilterGroup([createFilterRule(tagsField, ["b"])]),
    );
    expect(filterStateToParams(state, fields)).toEqual([
      ["g", "1:any"],
      ["r", "1/tags:contains:a"],
      ["g", "2:any"],
      ["r", "2/tags:contains:b"],
    ]);
  });

  it("writes a group inside a group after its parent's earlier rules", () => {
    const inner = createFilterGroup(
      [createFilterRule(tagsField, ["b"]), createFilterRule(titleField, ["x"])],
      "and",
    );
    const outer = createFilterGroup([
      createFilterRule(tagsField, ["a"]),
      inner,
      createFilterRule(ownerField, ["alice"]),
    ]);
    const state = addFilterGroup(createFilterState(fields), outer);
    expect(filterStateToParams(state, fields)).toEqual([
      ["g", "1:any"],
      ["r", "1/tags:contains:a"],
      ["g", "1.1:all"],
      ["r", "1.1/tags:contains:b"],
      ["r", "1.1/title:contains:x"],
      ["r", "1/owner:equals:alice"],
    ]);
    expect(shape(roundTrip(state).items)).toEqual(shape(state.items));
  });

  it("drops groups nested too deep or without a parent", () => {
    const read = readFilterParams(
      "?g=1:any&r=1/tags:contains:a&g=1.1.1:all&r=1.1.1/tags:contains:b&g=2.1:all&r=2.1/tags:contains:c&g=1.:all",
      fields,
    );
    expect(shape(read.items)).toEqual([
      {
        mode: "or",
        rules: [{ field: "tags", operator: "contains", value: ["a"] }],
      },
    ]);
  });

  it("reads a group or rule that comes before its parent group in a link", () => {
    const read = readFilterParams(
      "?g=1.1:any&r=1.1/tags:contains:a&r=1/tags:contains:b&g=1:all",
      fields,
    );
    expect(shape(read.items)).toEqual([
      {
        mode: "and",
        rules: [
          {
            mode: "or",
            rules: [{ field: "tags", operator: "contains", value: ["a"] }],
          },
          { field: "tags", operator: "contains", value: ["b"] },
        ],
      },
    ]);
  });

  it("round-trips a date range and a date with a time", () => {
    const timed: FilterField = { ...createdField, times: true };
    const local = [timed];
    const state = addFilterRule(
      addFilterRule(
        createFilterState(local),
        createFilterRule(timed, ["2026-10-01", "today"], "between"),
      ),
      createFilterRule(timed, ["2026-10-22T09:30"], "on_or_after"),
    );
    const search = writeFilterSearch("", state, local);
    expect(search).toContain("r=created:between:2026-10-01,today");
    expect(search).toContain("r=created:on_or_after:2026-10-22T09%253A30");
    expect(shape(readFilterParams(search, local).items)).toEqual(
      shape(state.items),
    );
  });

  it('reads a saved "is not on" date and drops a time the field doesn\'t take', () => {
    const read = readFilterParams(
      "?r=created:does_not_equal:2026-10-22&r=created:after:2026-10-22T09%253A30",
      fields,
    );
    expect(shape(read.items)).toEqual([
      { field: "created", operator: "does_not_equal", value: ["2026-10-22"] },
    ]);
  });

  it("leaves half-finished rules out", () => {
    const state = addFilterGroup(
      addFilterRule(createFilterState(fields), createFilterRule(ownerField)),
      createFilterGroup([createFilterRule(tagsField)]),
    );
    expect(filterStateToParams(state, fields)).toEqual([]);
  });

  it("writes rules that take no value without a trailing colon", () => {
    const state = addFilterRule(
      createFilterState(fields),
      createFilterRule(tagsField, [], "is_empty"),
    );
    expect(filterStateToParams(state, fields)).toEqual([
      ["r", "tags:is_empty"],
    ]);
    expect(shape(roundTrip(state).items)).toEqual(shape(state.items));
  });

  it("drops unknown fields, operators and broken rules", () => {
    const read = readFilterParams(
      "?r=nope:equals:x&r=tags:between:x&r=tags:contains&r=created:is_within:last_week&r=title:contains:%E0%A4%A&r=tags:contains:ok",
      fields,
    );
    expect(shape(read.items)).toEqual([
      { field: "tags", operator: "contains", value: ["ok"] },
    ]);
  });

  it("drops a group's rules when the group was never declared", () => {
    const read = readFilterParams("?r=3/tags:contains:a", fields);
    expect(read.items).toEqual([]);
  });

  it("keeps other params and replaces old filter params", () => {
    const state = addFilterRule(
      createFilterState(fields),
      createFilterRule(tagsField, ["new"]),
    );
    expect(
      writeFilterSearch(
        "?view=grid&r=tags:contains:old&match=any",
        state,
        fields,
      ),
    ).toBe("?view=grid&r=tags:contains:new");
  });

  it("namespaces params with a prefix", () => {
    const state = setPinnedFilter(
      addFilterRule(
        createFilterState(fields),
        createFilterRule(tagsField, ["a"]),
      ),
      "source",
      ["content"],
    );
    const search = writeFilterSearch("?r=keep", state, fields, {
      prefix: "f.",
    });
    expect(search).toBe("?r=keep&f.source=content&f.r=tags:contains:a");
    const read = readFilterParams(search, fields, { prefix: "f." });
    expect(read.pinned.source).toEqual(["content"]);
    expect(shape(read.items)).toEqual(shape(state.items));
  });

  it("round-trips ids that look like the URL's own syntax", () => {
    const sources: FilterField = {
      ...sourceField,
      options: [
        { id: "clips", label: "Recorded in Clips" },
        { id: "all", label: "All-hands" },
        { id: "external,import", label: "Imported" },
      ],
    };
    const nested: FilterField = {
      id: "meta/title:en",
      label: "Title",
      type: "text",
    };
    const local = [sources, nested];
    const read = (state: FilterState) =>
      readFilterParams(writeFilterSearch("", state, local), local);
    expect(
      read(setPinnedFilter(createFilterState(local), "source", ["all"])).pinned
        .source,
    ).toEqual(["all"]);
    expect(
      read(
        setPinnedFilter(createFilterState(local), "source", [
          "external,import",
        ]),
      ).pinned.source,
    ).toEqual(["external,import"]);
    const state = addFilterRule(
      createFilterState(local),
      createFilterRule(nested, ["a"]),
    );
    expect(shape(read(state).items)).toEqual(shape(state.items));
  });

  it("keeps unknown options but drops impossible dates and group modes", () => {
    const people: FilterField = {
      ...ownerField,
      options: [{ id: "alice", label: "Alice" }],
    };
    const read = readFilterParams(
      "?r=owner:equals:deleted&r=created:equals:2026-02-30&g=1:typo&r=1/tags:contains:a",
      [people, tagsField, createdField],
    );
    expect(shape(read.items)).toEqual([
      { field: "owner", operator: "equals", value: ["deleted"] },
    ]);
  });

  it("gives equal states the same key", () => {
    const state = addFilterRule(
      createFilterState(fields),
      createFilterRule(tagsField, ["a"]),
    );
    expect(filterStateKey(state, fields)).toBe(
      filterSearchKey("?r=tags:contains:a&view=grid", fields),
    );
    expect(filterStateKey(createFilterState(fields), fields)).toBe(
      filterSearchKey("?source=clips", fields),
    );
  });
});
