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

function shape(items: FilterItem[]) {
  return items.map((item) =>
    item.kind === "rule"
      ? { field: item.field, operator: item.operator, value: item.value }
      : {
          mode: item.mode,
          rules: item.rules.map((rule) => ({
            field: rule.field,
            operator: rule.operator,
            value: rule.value,
          })),
        },
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

  it("drops missing options, impossible dates and unknown group modes", () => {
    const people: FilterField = {
      ...ownerField,
      options: [{ id: "alice", label: "Alice" }],
    };
    const read = readFilterParams(
      "?r=owner:equals:deleted&r=owner:equals:alice,deleted&r=created:equals:2026-02-30&g=1:typo&r=1/tags:contains:a",
      [people, tagsField, createdField],
    );
    expect(shape(read.items)).toEqual([
      { field: "owner", operator: "equals", value: ["alice"] },
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
