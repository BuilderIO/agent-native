// A search that finds nothing in a filtered view says which filter hides
// what the search alone would find, and pressing that filter opens it.
import {
  filterItemRules,
  findFilterField,
  useFilterText,
  type FilterField,
  type FilterItem,
  type FilterState,
} from "@agent-native/toolkit/app/filters";
import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import { createContext, Fragment, useContext } from "react";

import { kitStateToContentFilters } from "./filter-kit";
import { applyDatabaseView } from "./filter-sort";
import { dbText } from "./text";

export interface FilterInTheWay {
  search: string;
  /** A few rows the search finds with no filters. */
  rows: readonly ContentDatabaseItem[];
  /** How many more the search finds. */
  more: number;
  properties: DocumentProperty[];
  fields: readonly FilterField<never>[];
  state: FilterState;
  nameLabel: string;
  onOpenLine: (id: string) => void;
}

const FilterInTheWayContext = createContext<FilterInTheWay | null>(null);

export const FilterInTheWayProvider = FilterInTheWayContext.Provider;

export function useFilterInTheWay() {
  return useContext(FilterInTheWayContext);
}

/** The top-level filter lines that each hide this row. */
export function filtersHidingRow(
  row: ContentDatabaseItem,
  state: FilterState,
  properties: DocumentProperty[],
  nameLabel: string,
): FilterItem[] {
  return state.items.filter((item) => {
    const filters = kitStateToContentFilters(
      { ...state, items: [item] },
      properties,
      { nameLabel },
    );
    return (
      applyDatabaseView([row], properties, "", filters, [], state.mode)
        .length === 0
    );
  });
}

export function DatabaseFilterInTheWay({ way }: { way: FilterInTheWay }) {
  const text = useFilterText();
  const name = (item: FilterItem) => {
    if (item.kind === "group") return dbText("filterAGroup");
    const field = findFilterField(way.fields, item.field);
    return field ? text.ruleLabel(field, item) : item.field;
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-medium text-foreground">
        {dbText("filterNoRowsMatchSearch", { search: way.search })}
      </span>
      {way.rows.map((row) => (
        <span key={row.id}>
          {dbText("filterRowHiddenBy", {
            row: row.document.title || dbText("untitled"),
          })}{" "}
          {filtersHidingRow(row, way.state, way.properties, way.nameLabel).map(
            (item, index) => (
              <Fragment key={item.id}>
                {index > 0 ? ` ${dbText("filterAnd")} ` : null}
                <button
                  type="button"
                  className="rounded-sm text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => {
                    const id = filterItemRules(item)[0]?.id;
                    if (id) way.onOpenLine(id);
                  }}
                >
                  {name(item)}
                </button>
              </Fragment>
            ),
          )}
        </span>
      ))}
      {way.more > 0 ? (
        <span>{dbText("filterAndMore", { count: way.more })}</span>
      ) : null}
    </div>
  );
}
