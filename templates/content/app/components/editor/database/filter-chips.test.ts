import type { DocumentProperty } from "@shared/api";
import { applyContentDatabaseTableQuery } from "@shared/database-query";
import { describe, expect, it } from "vitest";

import {
  databaseFilterChipToReopen,
  databaseFilterEncodeSelectedValues,
  foldDatabaseFilterChips,
} from "./filter-chips";
import type { DatabaseFilter, DatabaseFilterMode } from "./types";

function property(
  id: string,
  type: DocumentProperty["definition"]["type"],
  value: DocumentProperty["value"] = null,
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name: id,
      type,
      visibility: "always_show",
      options:
        type === "status"
          ? {
              options: ["active", "done", "dropped"].map((name) => ({
                id: name,
                name,
                color: "gray",
              })),
            }
          : {},
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value,
    editable: true,
  };
}

const properties = [
  property("status", "status"),
  property("tags", "multi_select"),
  property("due", "date"),
];

function chip(
  key: string,
  operator: DatabaseFilter["operator"],
  value = "",
): DatabaseFilter {
  return { key, label: key, operator, value };
}

const statusRows = ["active", "done", "dropped", null].map((status, index) => ({
  document: { id: `row-${index}`, title: `Row ${index}` },
  properties: [property("status", "status", status)],
})) as unknown as Parameters<typeof applyContentDatabaseTableQuery>[0];

// The rows a set of chips shows, by title.
function matchingRows(
  filters: DatabaseFilter[],
  filterMode: DatabaseFilterMode,
) {
  return applyContentDatabaseTableQuery(statusRows, properties, {
    search: "",
    filters,
    sorts: [],
    filterMode,
  }).map((item) => item.document.title);
}

describe("databaseFilterChipToReopen", () => {
  it("reopens a status chip, whose second value never means more on a chip of its own", () => {
    const filters = [
      chip("due", "after", "2026-01-01"),
      chip("status", "does_not_equal", "done"),
    ];
    expect(
      databaseFilterChipToReopen(filters, "status", "and", properties),
    ).toBe(1);
    expect(
      databaseFilterChipToReopen(filters, "status", "or", properties),
    ).toBe(1);
    expect(
      databaseFilterChipToReopen(
        [chip("status", "contains", "active")],
        "status",
        "and",
        properties,
      ),
    ).toBe(0);
  });

  it("reopens a status chip, where a second value shows rows a second chip can't", () => {
    // Under All, "is done" gets "dropped" picked in its reopened chip. As one
    // chip that shows rows with either status; as two chips it showed none.
    const isDone = chip("status", "contains", "done");
    expect(
      databaseFilterChipToReopen([isDone], "status", "and", properties),
    ).toBe(0);
    expect(
      matchingRows(
        [
          {
            ...isDone,
            value: databaseFilterEncodeSelectedValues(["done", "dropped"]),
          },
        ],
        "and",
      ),
    ).toEqual(["Row 1", "Row 2"]);
    expect(
      matchingRows([isDone, chip("status", "contains", "dropped")], "and"),
    ).toEqual([]);

    // Under Any, "is not done" the same way: one chip hides both statuses;
    // two chips showed every row.
    const isNotDone = chip("status", "does_not_equal", "done");
    expect(
      databaseFilterChipToReopen([isNotDone], "status", "or", properties),
    ).toBe(0);
    expect(
      matchingRows(
        [
          {
            ...isNotDone,
            value: databaseFilterEncodeSelectedValues(["done", "dropped"]),
          },
        ],
        "or",
      ),
    ).toEqual(["Row 0", "Row 3"]);
    expect(
      matchingRows(
        [isNotDone, chip("status", "does_not_equal", "dropped")],
        "or",
      ),
    ).toEqual(["Row 0", "Row 1", "Row 2", "Row 3"]);
  });

  it("reopens a multi-select chip only when another value means the same there", () => {
    const is = [chip("tags", "contains", "a")];
    const isNot = [chip("tags", "does_not_equal", "a")];
    expect(databaseFilterChipToReopen(is, "tags", "or", properties)).toBe(0);
    expect(databaseFilterChipToReopen(isNot, "tags", "and", properties)).toBe(
      0,
    );
    // "Tagged a" and "tagged b" under All means tagged both, which one chip
    // can't say.
    expect(
      databaseFilterChipToReopen(is, "tags", "and", properties),
    ).toBeNull();
    expect(
      databaseFilterChipToReopen(isNot, "tags", "or", properties),
    ).toBeNull();
  });

  it("adds a chip for dates, so two can bound a range", () => {
    expect(
      databaseFilterChipToReopen(
        [chip("due", "after", "2026-01-01")],
        "due",
        "and",
        properties,
      ),
    ).toBeNull();
  });

  it("adds a chip when the property's chip takes no values", () => {
    expect(
      databaseFilterChipToReopen(
        [chip("status", "is_empty")],
        "status",
        "and",
        properties,
      ),
    ).toBeNull();
  });

  it("leaves the advanced filter's rules alone", () => {
    expect(
      databaseFilterChipToReopen(
        [{ ...chip("status", "contains", "done"), filterGroupId: "advanced" }],
        "status",
        "and",
        properties,
      ),
    ).toBeNull();
  });
});

describe("foldDatabaseFilterChips", () => {
  it("folds is not chips under All into one that hides both", () => {
    const filters = [
      chip("status", "does_not_equal", "done"),
      chip("due", "after", "2026-01-01"),
      chip("status", "does_not_equal", "dropped"),
    ];
    expect(foldDatabaseFilterChips(filters, "and", properties)).toEqual([
      chip("status", "does_not_equal", JSON.stringify(["done", "dropped"])),
      chip("due", "after", "2026-01-01"),
    ]);
  });

  it("folds is chips under Any into one that matches either", () => {
    const filters = [
      chip("tags", "contains", JSON.stringify(["a", "b"])),
      chip("tags", "contains", JSON.stringify(["B", "c"])),
    ];
    expect(foldDatabaseFilterChips(filters, "or", properties)).toEqual([
      chip("tags", "contains", JSON.stringify(["a", "b", "c"])),
    ]);
  });

  it("keeps chips apart when together they mean something else", () => {
    const isUnderAll = [
      chip("tags", "contains", "a"),
      chip("tags", "contains", "b"),
    ];
    const isNotUnderAny = [
      chip("status", "does_not_equal", "done"),
      chip("status", "does_not_equal", "dropped"),
    ];
    const mixed = [
      chip("tags", "contains", "a"),
      chip("tags", "does_not_equal", "b"),
    ];
    expect(foldDatabaseFilterChips(isUnderAll, "and", properties)).toBe(
      isUnderAll,
    );
    expect(foldDatabaseFilterChips(isNotUnderAny, "or", properties)).toBe(
      isNotUnderAny,
    );
    expect(foldDatabaseFilterChips(mixed, "and", properties)).toBe(mixed);
  });

  it("leaves a chip with no value yet where it is", () => {
    const unfinishedSecond = [
      chip("status", "does_not_equal", "done"),
      chip("status", "does_not_equal"),
    ];
    const unfinishedFirst = [
      chip("status", "does_not_equal"),
      chip("status", "does_not_equal", "done"),
      chip("status", "does_not_equal", "dropped"),
    ];
    expect(foldDatabaseFilterChips(unfinishedSecond, "and", properties)).toBe(
      unfinishedSecond,
    );
    expect(foldDatabaseFilterChips(unfinishedFirst, "and", properties)).toEqual(
      [
        chip("status", "does_not_equal"),
        chip("status", "does_not_equal", JSON.stringify(["done", "dropped"])),
      ],
    );
  });

  it("matches the same rows before and after folding", () => {
    const filters = [
      chip("status", "does_not_equal", "done"),
      chip("status", "does_not_equal", "dropped"),
    ];

    expect(
      matchingRows(foldDatabaseFilterChips(filters, "and", properties), "and"),
    ).toEqual(matchingRows(filters, "and"));
    expect(matchingRows(filters, "and")).toEqual(["Row 0", "Row 3"]);
  });
});
