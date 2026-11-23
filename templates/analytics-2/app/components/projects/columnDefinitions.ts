import type { ProjectListRow } from "@/lib/model/contracts";

import { ANALYTICS_CONTROL_IDS as ids } from "../../../shared/analytics-control-ids";
import type { ControlId } from "../../../shared/capabilities";

/**
 * Column and sort vocabulary recovered from the original Projects table.
 *
 * Ids, order, default visibility, headers and sort labels are the source's,
 * including the neutral rewrites the rebuild already uses elsewhere
 * ("Last edited" rather than a product name).
 */

export const PROJECTS_COLUMN_ORDER = [
  "name",
  "status",
  "categories",
  "creator",
  "owner",
  "lastViewedByMe",
  "dateCreated",
  "dateLastEdited",
  "appViews",
  "dateLastPublished",
  "datePublishedAppLastViewed",
  "myAccess",
  "sharedWith",
  "collections",
] as const;

export const COLLECTION_COLUMN_ORDER: readonly ProjectsColumnId[] = [
  "name",
  "status",
  "categories",
  "owner",
  "creator",
  "lastViewedByMe",
  "dateCreated",
  "dateLastEdited",
  "dateLastPublished",
  "appViews",
  "datePublishedAppLastViewed",
  "myAccess",
  "sharedWith",
  "collections",
];

export type ProjectsColumnId =
  | (typeof PROJECTS_COLUMN_ORDER)[number]
  | "archivedAt"
  | "trashedAt";

export const ARCHIVE_COLUMN_ORDER: readonly ProjectsColumnId[] = [
  "name",
  "archivedAt",
  "owner",
  "categories",
  "status",
  "dateLastPublished",
];

export const TRASH_COLUMN_ORDER: readonly ProjectsColumnId[] = [
  "name",
  "trashedAt",
  "status",
  "categories",
  "lastViewedByMe",
  "dateLastPublished",
];

/** Source default-hidden grid state; a collection uses the same one. */
export const DEFAULT_HIDDEN_COLUMNS: readonly ProjectsColumnId[] = [
  "creator",
  "dateCreated",
  "dateLastEdited",
  "datePublishedAppLastViewed",
];

/** Required columns cannot be hidden, matching the source visibility rules. */
export const REQUIRED_COLUMNS: readonly ProjectsColumnId[] = [
  "name",
  "status",
  "categories",
  "dateCreated",
  "dateLastEdited",
  "dateLastPublished",
  "myAccess",
  "sharedWith",
];

export const COLUMN_HEADERS: Record<ProjectsColumnId, string> = {
  name: "Title",
  status: "Status",
  categories: "Categories",
  creator: "Creator",
  owner: "Owner",
  lastViewedByMe: "Last viewed by you",
  dateCreated: "Created",
  dateLastEdited: "Last edited",
  appViews: "App views",
  dateLastPublished: "App last published",
  datePublishedAppLastViewed: "App last viewed",
  myAccess: "Your access",
  sharedWith: "Shared with",
  collections: "Collections",
  archivedAt: "Archived",
  trashedAt: "Permanent deletion",
};

export const COLUMN_METADATA: Partial<
  Record<
    ProjectsColumnId,
    { field: keyof ProjectListRow; controlId: ControlId }
  >
> = {
  appViews: {
    field: "appViews",
    controlId: ids.projectAppViews,
  },
  dateLastPublished: {
    field: "lastPublishedAt",
    controlId: ids.projectAppLastPublished,
  },
  datePublishedAppLastViewed: {
    field: "appLastViewedAt",
    controlId: ids.projectAppLastViewed,
  },
  myAccess: {
    field: "yourAccess",
    controlId: ids.projectYourAccess,
  },
  sharedWith: {
    field: "sharedWith",
    controlId: ids.projectSharedWith,
  },
};

/** Source "Show app views from" choices, in the source's order. */
export const VIEW_COUNT_DURATIONS = [
  { value: "ALL_TIME", label: "All time" },
  { value: "ONE_WEEK", label: "Last 7 days" },
  { value: "TWO_WEEKS", label: "Last 14 days" },
  { value: "ONE_MONTH", label: "Last 30 days" },
] as const;

export type ViewCountDuration = (typeof VIEW_COUNT_DURATIONS)[number]["value"];

export const SORT_OPTIONS = [
  "recentlyViewed",
  "projectName",
  "categories",
  "status",
  "creator",
  "owner",
  "dateCreated",
  "lastUpdated",
  "appViews",
  "appLastPublished",
  "appLastViewed",
  "myAccess",
] as const;

export type ProjectsSortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<ProjectsSortOption, string> = {
  recentlyViewed: "Last viewed by you",
  projectName: "Project title",
  categories: "Categories",
  status: "Status",
  creator: "Creator",
  owner: "Owner",
  dateCreated: "Created",
  lastUpdated: "Last edited",
  appViews: "App views",
  appLastPublished: "App last published",
  appLastViewed: "App last viewed",
  myAccess: "Your access",
};

/** Sort options whose value exists in the project contract. */
export const AVAILABLE_SORT_OPTIONS: readonly ProjectsSortOption[] = [
  "recentlyViewed",
  "projectName",
  "categories",
  "status",
  "creator",
  "owner",
  "dateCreated",
  "lastUpdated",
  "appViews",
  "appLastPublished",
  "appLastViewed",
];

export const DEFAULT_SORT: {
  option: ProjectsSortOption;
  direction: "ASC" | "DESC";
} = { option: "recentlyViewed", direction: "DESC" };

/** Columns that can sort against real project fields. */
export const SORTABLE_COLUMNS: Partial<
  Record<ProjectsColumnId, ProjectsSortOption>
> = {
  name: "projectName",
  owner: "owner",
  creator: "creator",
  dateLastPublished: "appLastPublished",
  appViews: "appViews",
  datePublishedAppLastViewed: "appLastViewed",
  lastViewedByMe: "recentlyViewed",
  dateCreated: "dateCreated",
  dateLastEdited: "lastUpdated",
};

export const PHONE_COLUMN_LIMIT = 2;

export function columnsForViewport(
  columns: readonly ProjectsColumnId[],
  isMobile: boolean,
): ProjectsColumnId[] {
  return isMobile ? columns.slice(0, PHONE_COLUMN_LIMIT) : [...columns];
}
