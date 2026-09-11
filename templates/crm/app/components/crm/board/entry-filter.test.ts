import { describe, expect, it } from "vitest";

import { BoardFilterError, toEntryFilters } from "./entry-filter";

const attributes = [
  { id: "attr-stage", apiSlug: "stage" },
  { id: "attr-priority", apiSlug: "priority" },
];

describe("toEntryFilters", () => {
  it("maps record fields and attribute ids into the entry vocabulary", () => {
    expect(
      toEntryFilters(
        {
          op: "and",
          conditions: [
            { field: "ownerName", condition: "is", value: "Ada" },
            {
              attributeId: "attr-priority",
              condition: "is-any-of",
              value: ["p0"],
            },
            { attributeId: "stage", condition: "is-not-empty" },
          ],
        },
        attributes,
      ),
    ).toEqual([
      { attribute: "record.ownerName", operator: "eq", value: "Ada" },
      { attribute: "priority", operator: "in", value: ["p0"] },
      { attribute: "stage", operator: "is-not-empty" },
    ]);
  });

  it("treats an empty or absent filter as no filter", () => {
    expect(toEntryFilters(undefined, attributes)).toEqual([]);
    expect(toEntryFilters({ op: "and", conditions: [] }, attributes)).toEqual(
      [],
    );
  });

  it("throws rather than dropping anything it cannot express", () => {
    expect(() =>
      toEntryFilters(
        {
          op: "and",
          conditions: [
            { field: "displayName", condition: "starts-with", value: "A" },
          ],
        },
        attributes,
      ),
    ).toThrow(BoardFilterError);
    expect(() =>
      toEntryFilters(
        {
          op: "and",
          conditions: [{ attributeId: "ghost", condition: "is", value: "x" }],
        },
        attributes,
      ),
    ).toThrow(/not an attribute of this list/);
    expect(() =>
      toEntryFilters(
        {
          op: "and",
          conditions: [{ field: "secretColumn", condition: "is", value: "x" }],
        },
        attributes,
      ),
    ).toThrow(/record field/);
    expect(() =>
      toEntryFilters(
        {
          op: "or",
          conditions: [
            { field: "kind", condition: "is", value: "account" },
            { field: "kind", condition: "is", value: "person" },
          ],
        },
        attributes,
      ),
    ).toThrow(/OR filter/);
    expect(() =>
      toEntryFilters(
        { op: "and", conditions: [{ op: "and", conditions: [] }] },
        attributes,
      ),
    ).toThrow(/nested filter group/);
  });
});
