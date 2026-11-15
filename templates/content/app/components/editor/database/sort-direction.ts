// Sort direction labels: each direction named for the column's values, the
// same in every sort control. Pure logic — no React, no icons.
import type { DocumentProperty, DocumentPropertyType } from "@shared/api";
import {
  contentDatabaseSortOrder,
  type ContentDatabaseSortOrder,
} from "@shared/database-query";

import { dbText, type DatabaseMessageKey } from "./text";
import type { ColumnKey, SortDirection } from "./types";

const DIRECTION_LABEL_KEYS: Record<
  ContentDatabaseSortOrder,
  Record<SortDirection, DatabaseMessageKey>
> = {
  text: { asc: "sortAToZ", desc: "sortZToA" },
  number: { asc: "sortLowToHigh", desc: "sortHighToLow" },
  date: { asc: "sortOldToNew", desc: "sortNewToOld" },
  checkbox: { asc: "sortUncheckedToChecked", desc: "sortCheckedToUnchecked" },
  other: { asc: "sortAscending", desc: "sortDescending" },
};

/** The type of the column a sort key names, or null once that property is gone. */
export function databaseSortPropertyType(
  key: ColumnKey,
  properties: readonly DocumentProperty[],
): DocumentPropertyType | null {
  if (key === "name") return "text";
  return (
    properties.find((property) => property.definition.id === key)?.definition
      .type ?? null
  );
}

/** "A → Z", "Old → new" and so on: what a direction does to this column. */
export function databaseSortDirectionLabel(
  direction: SortDirection,
  key: ColumnKey,
  type: DocumentPropertyType | null | undefined,
): string {
  return dbText(
    DIRECTION_LABEL_KEYS[contentDatabaseSortOrder(key, type)][direction],
  );
}
