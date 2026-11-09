import type { DocumentProperty } from "@shared/api";
import { DOCUMENT_PROPERTY_TYPES } from "@shared/properties";
import { describe, expect, it } from "vitest";

import { messagesByLocale } from "@/i18n-data";

import {
  databaseSortDirectionLabel,
  databaseSortPropertyType,
} from "./sort-direction";

function property(
  id: string,
  type: DocumentProperty["definition"]["type"],
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name: id,
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

function labels(
  key: string,
  type: DocumentProperty["definition"]["type"] | null,
) {
  return [
    databaseSortDirectionLabel("asc", key, type),
    databaseSortDirectionLabel("desc", key, type),
  ];
}

describe("database sort direction labels", () => {
  it("names each direction for what it does to the column's values", () => {
    expect(labels("name", null)).toEqual(["A → Z", "Z → A"]);
    expect(labels("title", "text")).toEqual(["A → Z", "Z → A"]);
    expect(labels("stage", "status")).toEqual(["A → Z", "Z → A"]);
    expect(labels("estimate", "number")).toEqual(["Low → high", "High → low"]);
    expect(labels("total", "rollup")).toEqual(["Low → high", "High → low"]);
    expect(labels("due", "date")).toEqual(["Old → new", "New → old"]);
    expect(labels("edited", "last_edited_time")).toEqual([
      "Old → new",
      "New → old",
    ]);
    expect(labels("done", "checkbox")).toEqual([
      "Unchecked → checked",
      "Checked → unchecked",
    ]);
  });

  it("falls back to ascending and descending where values have no named order", () => {
    expect(labels("score", "formula")).toEqual(["Ascending", "Descending"]);
    expect(labels("links", "relation")).toEqual(["Ascending", "Descending"]);
    expect(labels("removed", null)).toEqual(["Ascending", "Descending"]);
  });

  it("gives every property type two different labels in every locale", () => {
    for (const messages of Object.values(messagesByLocale)) {
      const { database } = messages;
      expect(database.sortAscending).not.toBe(database.sortDescending);
      expect(database.sortAToZ).not.toBe(database.sortZToA);
      expect(database.sortLowToHigh).not.toBe(database.sortHighToLow);
      expect(database.sortOldToNew).not.toBe(database.sortNewToOld);
      expect(database.sortUncheckedToChecked).not.toBe(
        database.sortCheckedToUnchecked,
      );
      expect(database.sortedInDirection).toContain("{{direction}}");
    }
    for (const type of DOCUMENT_PROPERTY_TYPES) {
      const [ascending, descending] = labels("property", type);
      expect(ascending).toBeTruthy();
      expect(ascending).not.toBe(descending);
    }
  });

  it("reads a sort key's type from the collection's properties", () => {
    const properties = [property("due", "date"), property("done", "checkbox")];

    expect(databaseSortPropertyType("name", properties)).toBe("text");
    expect(databaseSortPropertyType("done", properties)).toBe("checkbox");
    expect(databaseSortPropertyType("deleted", properties)).toBeNull();
  });
});
