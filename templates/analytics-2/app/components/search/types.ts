/**
 * Workspace search contract.
 *
 * The component is pure: it owns interaction and presentation only. Every
 * result, label and navigation target comes from the caller's workspace-scoped
 * search action.
 */

/** Fields the workspace query matches against. */
export type SearchField = "title" | "description" | "cellContents";

/** Last-edited window used by the Date filter. */
export type SearchDateRange = "24h" | "7d" | "30d" | "90d";

/**
 * A typed day or range. The reference's date filter is an editable date field
 * with its own picker, not a preset list, so the search accepts exact bounds.
 */
export type SearchCustomDateRange = { from: string; to: string };

/**
 * One complete search request. A trimmed empty `text` with default filters
 * means "recents"; the component still asks the caller, so recents are real.
 */
export type SearchQuery = {
  text: string;
  fields: SearchField[];
  /** The reference's field selector: which column the picked days narrow. */
  customDateField?: "lastEdited" | "created";
  /** Exact bounds, when the reader typed a range instead of picking a preset. */
  customRange?: SearchCustomDateRange | null;
  /** The reference's After / Before / Between choice that shapes those bounds. */
  customDateMode?: "after" | "before" | "between";
  includeArchived: boolean;
  creatorIds: string[];
  categoryIds: string[];
  statusIds: string[];
};

export type SearchCellMatch = {
  cellId: string;
  cellKind: "sql" | "python" | "r" | "markdown" | "text" | "chart";
  snippet: string;
};

type SearchResultBase = {
  id: string;
  title: string;
  /** Same-app path. Rows with an external or empty href are ignored. */
  href: string;
  /** ISO timestamp. */
  updatedAt: string;
};

export type SearchProjectResult = SearchResultBase & {
  kind: "project";
  description?: string;
  ownerName?: string;
  accessLabel?: string | undefined;
  archived?: boolean;
  /** Present only when the project has a published app. */
  publishedAppHref?: string | undefined;
  cellMatches?: SearchCellMatch[];
};

export type SearchThreadResult = SearchResultBase & {
  kind: "thread";
  /** ISO timestamp. */
  createdAt?: string;
  /** ISO timestamp. */
  latestMessageAt?: string;
};

export type SearchResult = SearchProjectResult | SearchThreadResult;

export type SearchFilterOption = {
  id: string;
  label: string;
};

/**
 * Workspace metadata the filter bar needs before a query runs. Omitted
 * lists are rendered with a real empty state; the component never invents
 * members, categories or statuses.
 */
export type SearchFilterOptions = {
  creators?: SearchFilterOption[];
  creatorSearch?: {
    text: string;
    status: "loading" | "ready" | "error";
    hasMore: boolean;
    onSearch: (text: string) => void;
    onMore: () => void;
  };
  categories?: SearchFilterOption[];
  statuses?: SearchFilterOption[];
};

export type WorkspaceSearchProps = {
  open: boolean;
  onClose: () => void;
  queryText?: string;
  onQueryTextChange?: (text: string) => void;
  onSearch: (
    query: SearchQuery,
    onPartial?: (results: SearchResult[]) => void,
  ) => Promise<SearchResult[]>;
  onNavigate: (href: string) => void;
  onCreateThread?: (
    query: string,
    options: { newTab: boolean },
  ) => void | Promise<void>;
  filterOptions?: SearchFilterOptions;
};
