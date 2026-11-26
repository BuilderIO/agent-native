import type {
  FilterRule,
  FilterState,
} from "@agent-native/toolkit/app/filters";
import type { ContentTrashItem } from "@shared/content-trash";
import { describe, expect, it } from "vitest";

import {
  addTrashFilterOptions,
  collectTrashFilterOptions,
  trashFilterFields,
  trashFilterOptions,
  trashWhereFromFilterState,
} from "./trash-filter-model";

const fields = trashFilterFields(
  {
    createdBy: "Created by",
    updatedBy: "Last edited by",
    deletedBy: "Deleted by",
    workspace: "Workspace",
    location: "Location",
    kind: "Type",
    page: "Page",
    collection: "Collection",
    deletedAt: "Deleted at",
  },
  {
    people: [{ id: "ana@example.com", label: "Ana" }],
    spaces: [{ id: "space-a", label: "Personal" }],
    locations: [{ id: "parent-1", label: "Roadmap" }],
  },
);
const TODAY = "2026-11-25";

let ruleId = 0;
function rule(field: string, operator: string, value: string[]): FilterRule {
  ruleId += 1;
  return {
    kind: "rule",
    id: `r-${ruleId}`,
    field,
    operator: operator as FilterRule["operator"],
    value,
  };
}

function state(items: FilterState["items"], mode: "and" | "or" = "and") {
  return { mode, items, pinned: {} } satisfies FilterState;
}

const localStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const localEnd = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

describe("Trash filter chips", () => {
  it("offers people, workspace, and location pickers and a deleted date", () => {
    expect(fields.map((field) => [field.id, field.type])).toEqual([
      ["createdBy", "choice"],
      ["updatedBy", "choice"],
      ["deletedBy", "choice"],
      ["spaceId", "choice"],
      ["parentId", "choice"],
      ["kind", "choice"],
      ["deletedAt", "date"],
    ]);
    expect(fields.find((field) => field.id === "parentId")?.options).toEqual([
      { id: "parent-1", label: "Roadmap" },
    ]);
  });

  it("sends finished chips as the where filter, keeping and/or and groups", () => {
    const where = trashWhereFromFilterState(
      state(
        [
          rule("createdBy", "equals", ["ana@example.com"]),
          rule("spaceId", "does_not_equal", ["space-a"]),
          {
            kind: "group",
            id: "g-1",
            mode: "or",
            rules: [
              rule("kind", "equals", ["database"]),
              rule("parentId", "equals", ["parent-1"]),
            ],
          },
        ],
        "or",
      ),
      fields,
      TODAY,
    );

    expect(where).toEqual({
      mode: "or",
      items: [
        { field: "createdBy", operator: "is", values: ["ana@example.com"] },
        { field: "spaceId", operator: "isNot", values: ["space-a"] },
        {
          mode: "or",
          conditions: [
            { field: "kind", operator: "is", values: ["database"] },
            { field: "parentId", operator: "is", values: ["parent-1"] },
          ],
        },
      ],
    });
  });

  it("leaves out unfinished chips and sends nothing when none are finished", () => {
    expect(
      trashWhereFromFilterState(
        state([rule("deletedBy", "equals", [])]),
        fields,
        TODAY,
      ),
    ).toBeUndefined();
  });

  it("turns deleted-date chips into local-day bounds", () => {
    const dateWhere = (operator: string, value: string[]) =>
      trashWhereFromFilterState(
        state([rule("deletedAt", operator, value)]),
        fields,
        TODAY,
      )?.items;

    expect(dateWhere("is_within", ["past_7_days"])).toEqual([
      {
        field: "deletedAt",
        from: localStart("2026-11-19"),
        to: localEnd(TODAY),
      },
    ]);
    expect(dateWhere("equals", ["yesterday"])).toEqual([
      {
        field: "deletedAt",
        from: localStart("2026-11-24"),
        to: localEnd("2026-11-24"),
      },
    ]);
    expect(dateWhere("before", ["2026-11-20"])).toEqual([
      {
        field: "deletedAt",
        to: new Date(
          new Date("2026-11-20T00:00:00").getTime() - 1,
        ).toISOString(),
      },
    ]);
    expect(dateWhere("on_or_after", ["2026-11-20"])).toEqual([
      { field: "deletedAt", from: localStart("2026-11-20") },
    ]);
    expect(dateWhere("between", ["2026-11-22", "2026-11-18"])).toEqual([
      {
        field: "deletedAt",
        from: localStart("2026-11-18"),
        to: localEnd("2026-11-22"),
      },
    ]);
  });

  it("offers the people and locations of loaded rows, preferring names", () => {
    const options = collectTrashFilterOptions([
      {
        createdBy: "ana@example.com",
        createdByName: null,
        updatedBy: "ana@example.com",
        updatedByName: "Ana",
        trashedBy: "bo@example.com",
        trashedByName: "Bo",
        parentId: "parent-1",
        parentTitle: "Roadmap",
      } as ContentTrashItem,
    ]);

    expect(options.people).toEqual([
      { id: "ana@example.com", label: "Ana" },
      { id: "bo@example.com", label: "Bo" },
    ]);
    expect(options.locations).toEqual([{ id: "parent-1", label: "Roadmap" }]);
  });

  it("rebuilds the options from the server's latest answer", () => {
    const first = trashFilterOptions(
      [],
      {
        people: [{ email: "gone@example.com", name: "Gone" }],
        locations: [{ id: "old-parent", title: "Old" }],
      },
      "Untitled",
    );
    const refetched = trashFilterOptions(
      [],
      {
        people: [{ email: "cy@example.com", name: "Cy" }],
        locations: [],
      },
      "Untitled",
    );

    expect(first.people).toEqual([{ id: "gone@example.com", label: "Gone" }]);
    expect(refetched).toEqual({
      people: [{ id: "cy@example.com", label: "Cy" }],
      locations: [],
    });
  });

  it("adds people and locations from rows that are not loaded", () => {
    const loaded = {
      people: [{ id: "ana@example.com", label: "Ana" }],
      locations: [{ id: "parent-1", label: "Roadmap" }],
    };

    const next = addTrashFilterOptions(
      loaded,
      {
        people: [
          { email: "ana@example.com", name: null },
          { email: "cy@example.com", name: "Cy" },
          { email: "di@example.com", name: null },
        ],
        locations: [
          { id: "parent-1", title: "Renamed" },
          { id: "nested-parent", title: "" },
        ],
      },
      "Untitled",
    );

    expect(next.people).toEqual([
      { id: "ana@example.com", label: "Ana" },
      { id: "cy@example.com", label: "Cy" },
      { id: "di@example.com", label: "di@example.com" },
    ]);
    expect(next.locations).toEqual([
      { id: "parent-1", label: "Roadmap" },
      { id: "nested-parent", label: "Untitled" },
    ]);
  });
});
