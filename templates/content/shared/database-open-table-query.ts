import {
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
  type ContentDatabaseFilter,
  type ContentDatabaseFilterMode,
  type ContentDatabasePersonalViewOverrides,
  type ContentDatabaseSort,
  type ContentDatabaseTableQuery,
  type ContentDatabaseViewConfig,
} from "./api.js";
import { contentDatabaseFilterIsActive } from "./database-query.js";

/** The rows a collection page reads first, as its table asks for them. */
export const OPENING_DATABASE_ROW_LIMIT = 100;

type OpeningView = {
  id: string;
  type: string;
  sorts: ContentDatabaseSort[];
  filters: ContentDatabaseFilter[];
  filterMode: ContentDatabaseFilterMode;
};

/**
 * The rows query a collection page sends first: its saved view with the
 * reader's personal sorts and filters, or the view the URL names. A table view
 * with sorts or filters reads its rows with this query; any other view shows
 * the collection read's own rows, so it has none.
 *
 * This follows the collection view's own steps (normalize the saved views,
 * apply the personal overrides, select the view), keeping only what decides
 * the query. A spec holds the two to the same answer; if they ever differ, a
 * rows read made with this query is simply not the one the page asks for.
 */
export function openingDatabaseTableQuery({
  viewConfig,
  overrides,
  requestedViewId,
}: {
  viewConfig: Partial<ContentDatabaseViewConfig> | null | undefined;
  overrides: ContentDatabasePersonalViewOverrides | null | undefined;
  requestedViewId?: string | null;
}): ContentDatabaseTableQuery | undefined {
  const saved = savedViews(viewConfig);
  const personal = personalOverrides(overrides);
  const overridesById = new Map(personal?.views.map((view) => [view.id, view]));
  const views = saved.views.map((view) => {
    const override = overridesById.get(view.id);
    return override ? { ...view, ...override } : view;
  });
  const has = (id: string | null | undefined): id is string =>
    !!id && views.some((view) => view.id === id);
  const activeViewId = has(personal?.activeViewId)
    ? personal.activeViewId
    : saved.activeViewId;
  const requested = requestedViewId?.trim() || null;
  const selectedViewId = has(requested) ? requested : activeViewId;
  const view = views.find((candidate) => candidate.id === selectedViewId);
  if (!view || view.type !== "table") return undefined;
  const constraints =
    view.sorts.length +
    view.filters.filter(contentDatabaseFilterIsActive).length;
  if (constraints === 0) return undefined;
  return {
    search: "",
    filters: view.filters,
    sorts: view.sorts,
    filterMode: view.filterMode,
  };
}

function savedViews(
  value: Partial<ContentDatabaseViewConfig> | null | undefined,
): { activeViewId: string; views: OpeningView[] } {
  const views = Array.isArray(value?.views)
    ? value.views.flatMap((view): OpeningView[] =>
        view && typeof view.id === "string" && view.id.trim()
          ? [
              {
                id: view.id,
                type: openingViewType(view.type),
                sorts: validSorts(view.sorts),
                filters: validFilters(view.filters),
                filterMode: view.filterMode === "or" ? "or" : "and",
              },
            ]
          : [],
      )
    : [];
  const normalized: OpeningView[] =
    views.length > 0
      ? views
      : [
          {
            id: "default",
            type: "table",
            sorts: validSorts(value?.sorts),
            filters: validFilters(value?.filters),
            filterMode: "and",
          },
        ];
  const activeViewId =
    typeof value?.activeViewId === "string" &&
    normalized.some((view) => view.id === value.activeViewId)
      ? value.activeViewId
      : (normalized[0]?.id ?? "default");
  return { activeViewId, views: normalized };
}

function personalOverrides(
  value: ContentDatabasePersonalViewOverrides | null | undefined,
): {
  activeViewId: string | undefined;
  views: Array<Omit<OpeningView, "type">>;
} | null {
  if (
    !value ||
    value.version !== CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION ||
    !Array.isArray(value.views)
  ) {
    return null;
  }
  return {
    activeViewId:
      typeof value.activeViewId === "string" ? value.activeViewId : undefined,
    views: value.views
      .filter((view) => typeof view?.id === "string")
      .map((view) => ({
        id: view.id,
        sorts: validSorts(view.sorts),
        filters: validFilters(view.filters),
        filterMode: view.filterMode === "or" ? "or" : "and",
      })),
  };
}

function openingViewType(type: unknown) {
  return type === "board" ||
    type === "list" ||
    type === "gallery" ||
    type === "calendar" ||
    type === "timeline" ||
    type === "form"
    ? type
    : "table";
}

function validSorts(value: unknown): ContentDatabaseSort[] {
  return Array.isArray(value)
    ? value.filter(
        (sort): sort is ContentDatabaseSort =>
          !!sort &&
          typeof sort === "object" &&
          typeof sort.key === "string" &&
          typeof sort.label === "string" &&
          (sort.direction === "asc" || sort.direction === "desc"),
      )
    : [];
}

function validFilters(value: unknown): ContentDatabaseFilter[] {
  return Array.isArray(value)
    ? value.filter(
        (filter): filter is ContentDatabaseFilter =>
          !!filter &&
          typeof filter === "object" &&
          typeof filter.key === "string" &&
          typeof filter.label === "string" &&
          typeof filter.operator === "string" &&
          typeof filter.value === "string",
      )
    : [];
}
