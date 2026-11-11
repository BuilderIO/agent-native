import type { DocumentProperty } from "@shared/api";
import { DOCUMENT_PROPERTY_TYPES } from "@shared/properties";
import { describe, expect, it } from "vitest";

import arSA from "@/i18n/ar-SA";
import deDE from "@/i18n/de-DE";
import enUS from "@/i18n/en-US";
import esES from "@/i18n/es-ES";
import frFR from "@/i18n/fr-FR";
import hiIN from "@/i18n/hi-IN";
import jaJP from "@/i18n/ja-JP";
import koKR from "@/i18n/ko-KR";
import ptBR from "@/i18n/pt-BR";
import zhCN from "@/i18n/zh-CN";
import zhTW from "@/i18n/zh-TW";

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
    // Imported directly: only en-US is registered until the app loads a locale.
    const translated = [
      arSA,
      deDE,
      esES,
      frFR,
      hiIN,
      jaJP,
      koKR,
      ptBR,
      zhCN,
      zhTW,
    ];
    for (const { database } of [enUS, ...translated]) {
      expect(database.sortAscending).not.toBe(database.sortDescending);
      expect(database.sortAToZ).not.toBe(database.sortZToA);
      expect(database.sortLowToHigh).not.toBe(database.sortHighToLow);
      expect(database.sortOldToNew).not.toBe(database.sortNewToOld);
      expect(database.sortUncheckedToChecked).not.toBe(
        database.sortCheckedToUnchecked,
      );
      expect(database.sortedInDirection).toContain("{{direction}}");
    }
    // A key a locale leaves out falls back to English silently, so check each
    // locale has its own words. ("A → Z" stays as it is in most locales.)
    for (const { database } of translated) {
      for (const key of [
        "sortAscending",
        "sortLowToHigh",
        "sortOldToNew",
        "sortUncheckedToChecked",
        "sortedInDirection",
      ] as const) {
        expect(database[key]).not.toBe(enUS.database[key]);
      }
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
