import { describe, expect, it } from "vitest";

import {
  duplicateFilterLine,
  filterGroupLevel,
  filterJoinIsWhole,
  filterLineJoin,
  filterLineParent,
  groupFilterLineWith,
  joinFilterLine,
  moveFilterLine,
  takeFilterLineOut,
  ungroupFilterLine,
} from "./lines.js";
import type {
  FilterGroup,
  FilterItem,
  FilterMode,
  FilterRule,
  FilterState,
} from "./model.js";

const rule = (id: string): FilterRule => ({
  kind: "rule",
  id,
  field: id.replace(/\d+$/, ""),
  operator: "equals",
  value: ["x"],
});

const group = (
  id: string,
  mode: FilterMode,
  ...rules: FilterItem[]
): FilterGroup => ({ kind: "group", id, mode, rules });

const state = (mode: FilterMode, ...items: FilterItem[]): FilterState => ({
  mode,
  items,
  pinned: {},
});

function read(filter: FilterState): string {
  const list = (items: readonly FilterItem[], mode: FilterMode): string =>
    items
      .map((item, index) => {
        const text =
          item.kind === "rule"
            ? item.id
            : `[${item.mode === "or" ? "either" : item.rules.length > 2 ? "all of" : "both"} ${list(item.rules, item.mode)}]`;
        return index === 0 ? text : `${mode} ${text}`;
      })
      .join(" ");
  return `Where ${list(filter.items, filter.mode)}`;
}

const start = () =>
  state(
    "and",
    rule("turn"),
    rule("status"),
    rule("needs"),
    rule("area"),
    group("g-either", "or", rule("status2"), rule("needs2")),
  );
const START =
  "Where turn and status and needs and area and [either status2 or needs2]";

function box(filter: FilterState, id: string): string {
  const parent = filterLineParent(filter, id);
  if (!parent) throw new Error(`${id} is not in a group`);
  return parent.id;
}

const join = (filter: FilterState, id: string, mode: FilterMode) =>
  joinFilterLine(filter, id, mode).state;

describe("and before or", () => {
  it("splits the run of ands where a word becomes or", () => {
    const split = join(start(), "area", "or");
    expect(read(split)).toBe(
      "Where [all of turn and status and needs] or [both area and [either status2 or needs2]]",
    );
    expect(join(split, box(split, "area"), "and")).toEqual(start());
  });

  it("splits a box again with an or inside it, and an and boxes the two it joins", () => {
    let filter = join(start(), "needs", "or");
    expect(read(filter)).toBe(
      "Where [both turn and status] or [all of needs and area and [either status2 or needs2]]",
    );
    const second = box(filter, "needs");
    filter = join(filter, "area", "or");
    expect(read(filter)).toBe(
      "Where [both turn and status] or needs or [both area and [either status2 or needs2]]",
    );
    expect(filterLineParent(filter, "needs")).toBeUndefined();
    expect(filterLineParent(filter, "area")?.id).not.toBe(second);
    filter = join(filter, "needs", "and");
    expect(read(filter)).toBe(
      "Where [all of turn and status and needs] or [both area and [either status2 or needs2]]",
    );
  });

  it("gives a group of two the word whole", () => {
    let filter = join(start(), "area", "or");
    filter = join(filter, "needs2", "and");
    expect(read(filter)).toBe(
      "Where [all of turn and status and needs] or [all of area and status2 and needs2]",
    );
    filter = join(filter, box(filter, "area"), "and");
    expect(read(filter)).toBe(
      "Where turn and status and needs and area and status2 and needs2",
    );
  });

  it("leaves the first line and an unchanged word alone", () => {
    const filter = start();
    expect(joinFilterLine(filter, "turn", "or").state).toBe(filter);
    expect(joinFilterLine(filter, "status", "and").state).toBe(filter);
    expect(joinFilterLine(filter, "missing", "or").state).toBe(filter);
  });

  it("changes the whole group where a box would nest too deep", () => {
    const filter = state(
      "or",
      rule("x"),
      group(
        "g-and",
        "and",
        rule("y"),
        group("g-or", "or", rule("p"), rule("q"), rule("r")),
      ),
    );
    expect(filterJoinIsWhole(filter, "q", "and")).toBe(true);
    const result = joinFilterLine(filter, "q", "and");
    expect(result.whole).toBe(true);
    expect(read(result.state)).toBe("Where x or [all of y and p and q and r]");
  });

  it("lifts the parts of a split into the or around them", () => {
    const filter = state(
      "or",
      rule("x"),
      group(
        "g-and",
        "and",
        rule("a"),
        rule("b"),
        group("g-or", "or", rule("c"), rule("d")),
      ),
    );
    const result = joinFilterLine(filter, "b", "or");
    expect(result.whole).toBe(false);
    expect(read(result.state)).toBe(
      "Where x or a or [both b and [either c or d]]",
    );
  });

  it("turns an and group saved inside another and into an or", () => {
    const filter = state(
      "and",
      rule("x"),
      group("g-and", "and", rule("a"), rule("b"), rule("c")),
    );
    const next = join(filter, "c", "or");
    expect(read(next)).toBe("Where x and [either [both a and b] or c]");
    expect(next.items[1]?.id).toBe("g-and");
  });

  it("keeps to one level of groups when told to", () => {
    const filter = state(
      "or",
      group("g-and", "and", rule("a"), rule("b"), rule("c")),
      rule("d"),
    );
    expect(read(joinFilterLine(filter, "b", "or", { levels: 1 }).state)).toBe(
      "Where a or [both b and c] or d",
    );
    const flat = state(
      "or",
      rule("a"),
      rule("b"),
      group("g-and", "and", rule("c"), rule("d")),
    );
    const boxed = joinFilterLine(flat, "b", "and", { levels: 1 });
    expect(read(boxed.state)).toBe("Where [both a and b] or [both c and d]");
    expect(boxed.whole).toBe(false);
  });
});

describe("moving lines", () => {
  it("moves a line into a group and out again", () => {
    const filter = state(
      "and",
      rule("a"),
      group("g", "or", rule("b"), rule("c")),
    );
    const into = moveFilterLine(filter, "a", { groupId: "g", index: 1 });
    expect(read(into)).toBe("Where [either b or a or c]");
    const out = moveFilterLine(into, "a", { index: 0 });
    expect(read(out)).toEqual(read(filter));
  });

  it("turns a group left with one line into that line", () => {
    const filter = state(
      "and",
      rule("a"),
      group("g", "or", rule("b"), rule("c")),
    );
    expect(read(moveFilterLine(filter, "b", { index: 0 }))).toBe(
      "Where b and a and c",
    );
  });

  it("merges a group dropped into a group with its word", () => {
    const filter = state(
      "or",
      group("g1", "and", rule("a"), rule("b")),
      group("g2", "and", rule("c"), rule("d")),
    );
    expect(
      read(moveFilterLine(filter, "g2", { groupId: "g1", index: 2 })),
    ).toBe("Where [all of a and b and c and d]");
  });

  it("refuses a move that nests too deep or into itself", () => {
    const filter = state(
      "and",
      group("g1", "or", rule("a"), group("g2", "and", rule("b"), rule("c"))),
      group("g3", "or", rule("d"), rule("e")),
    );
    expect(moveFilterLine(filter, "g3", { groupId: "g2", index: 0 })).toBe(
      filter,
    );
    expect(moveFilterLine(filter, "g1", { groupId: "g2", index: 0 })).toBe(
      filter,
    );
    expect(moveFilterLine(filter, "missing", { index: 0 })).toBe(filter);
  });

  it("takes a line out to just after its group", () => {
    const filter = state(
      "and",
      rule("a"),
      group("g", "or", rule("b"), rule("c"), rule("d")),
    );
    expect(read(takeFilterLineOut(filter, "c"))).toBe(
      "Where a and [either b or d] and c",
    );
    expect(takeFilterLineOut(filter, "a")).toBe(filter);
  });
});

describe("group edits", () => {
  it("groups a line with a new one, with the other word", () => {
    const filter = state("and", rule("a"), rule("b"));
    const next = groupFilterLineWith(filter, "b", rule("c"));
    expect(read(next)).toBe("Where a and [either b or c]");
  });

  it("refuses a group that would nest too deep", () => {
    const filter = state(
      "or",
      group("g1", "and", rule("a"), group("g2", "or", rule("b"), rule("c"))),
    );
    expect(groupFilterLineWith(filter, "b", rule("d"))).toBe(filter);
  });

  it("ungroups into the parent, keeping words", () => {
    const filter = state(
      "and",
      rule("a"),
      group("g", "and", rule("b"), rule("c")),
      group("h", "or", rule("d"), rule("e")),
    );
    expect(read(ungroupFilterLine(filter, "g"))).toBe(
      "Where a and b and c and [either d or e]",
    );
  });

  it("duplicates a line or a group just after it, with new ids", () => {
    const filter = state(
      "and",
      rule("a"),
      group("g", "or", rule("b"), rule("c")),
    );
    const copy = duplicateFilterLine(filter, "g");
    expect(copy.id).toBeDefined();
    expect(copy.id).not.toBe("g");
    expect(copy.state.items).toHaveLength(3);
    const copied = copy.state.items.at(2);
    expect(
      copied?.kind === "group" && copied.rules.map((item) => item.id),
    ).not.toContain("b");
    expect(duplicateFilterLine(filter, "missing")).toEqual({
      state: filter,
      id: undefined,
    });
  });

  it("reads the word before a line and how deep a group sits", () => {
    const filter = start();
    expect(filterLineJoin(filter, "turn")).toBeUndefined();
    expect(filterLineJoin(filter, "status")).toBe("and");
    expect(filterLineJoin(filter, "needs2")).toBe("or");
    expect(filterLineJoin(filter, "status2")).toBeUndefined();
    expect(filterGroupLevel(filter, "g-either")).toBe(1);
    expect(filterLineParent(filter, "turn")).toBeUndefined();
  });
});
