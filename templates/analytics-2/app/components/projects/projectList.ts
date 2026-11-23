import {
  FALLBACK_READER_LOCALE,
  formatLocaleDate,
} from "@agent-native/toolkit/app/shared/reader-locale";

import type { Project, ProjectListRow } from "@/lib/model/contracts";

import {
  AVAILABLE_SORT_OPTIONS,
  DEFAULT_HIDDEN_COLUMNS,
  PROJECTS_COLUMN_ORDER,
  type ProjectsColumnId,
  type ProjectsSortOption,
  type ViewCountDuration,
} from "./columnDefinitions";

/**
 * A route inside this app, carrying the deployment's mount path when it is
 * served under one (labs serves /analytics-2). Pure: it only joins strings.
 */
export function appMountedHref(route: string, basePath: string): string {
  const mount = basePath.replace(/\/+$/, "");
  if (mount === "") return route;
  if (route === mount || route.startsWith(`${mount}/`)) return route;
  return `${mount}${route}`;
}

/**
 * The project route used by the shell, the recents list and the row menus.
 * `basePath` is the app's mount path: a link rendered without it opens the
 * fleet's "Page not found" on a mounted deployment.
 */
export function projectHref(id: string, basePath = ""): string {
  return appMountedHref(`/project/${encodeURIComponent(id)}/latest`, basePath);
}

/**
 * Where a row in the project list opens: a published project opens its app
 * view, an unpublished one opens the editor.
 */
export function projectListHref(
  project: { id: string; lastPublishedAt?: string | null },
  basePath = "",
): string {
  return project.lastPublishedAt
    ? appMountedHref(`/app/${encodeURIComponent(project.id)}/latest`, basePath)
    : projectHref(project.id, basePath);
}

/**
 * The absolute link a person copies for a project.
 *
 * Source: the thing the original copies is
 * `${location.protocol}//${location.host}/${basePath}${route}` - the mount path
 * sits between the host and the route. A host that serves this app under its
 * own path (labs serves /analytics-2) 404s on a link built from the origin
 * alone, so `basePath` is part of the link, not decoration.
 */
export function projectPublicUrl(
  id: string,
  origin: string,
  basePath: string,
): string {
  return new URL(projectHref(id, basePath), origin).toString();
}

export type ProjectsSortDirection = "ASC" | "DESC";

export interface ProjectsSortState {
  option: ProjectsSortOption;
  direction: ProjectsSortDirection;
}

export interface ProjectsFilterState {
  favoritedOnly: boolean;
  createdByMe: boolean;
  workspaceAccess?: boolean;
  /** Selected status ids; empty or absent means any status. */
  statusIds?: readonly string[];
  /** Selected category ids; a project matches when it carries any of them. */
  categoryIds?: readonly string[];
  /** Selected collection ids; a project matches when it is filed into any. */
  collectionIds?: readonly string[];
}

export const EMPTY_FILTERS: ProjectsFilterState = {
  favoritedOnly: false,
  createdByMe: false,
  statusIds: [],
  categoryIds: [],
};

export { DEFAULT_SORT } from "./columnDefinitions";

/** Source-visible columns for the active Projects view. */
export const VISIBLE_COLUMNS: readonly ProjectsColumnId[] =
  PROJECTS_COLUMN_ORDER.filter(
    (id) => !(DEFAULT_HIDDEN_COLUMNS as readonly string[]).includes(id),
  );

/**
 * Sorts real project fields only. Unavailable sort options are not offered by
 * the UI; when one is requested anyway, the list keeps the source default
 * order instead of pretending to sort by a missing field.
 */
export type ProjectsSortContext = {
  /** Status name by catalogue id, so a status sort uses the shown label. */
  statusNames?: ReadonlyMap<string, string>;
  /** Applied categories per project, so a category sort uses their names. */
  categoriesByProject?: ReadonlyMap<string, readonly { name: string }[]>;
  viewCountDuration?: ViewCountDuration;
};

export type ProjectListItem = Project & Partial<ProjectListRow>;

export function appViewsForDuration(
  project: ProjectListItem,
  duration: ViewCountDuration = "ALL_TIME",
): number | null {
  if (project.appViewsByDuration != null) {
    return project.appViewsByDuration[duration];
  }
  return project.appViews ?? null;
}

export function sortProjects<T extends ProjectListItem>(
  projects: readonly T[],
  sort: ProjectsSortState,
  context: ProjectsSortContext = {},
): T[] {
  const available = AVAILABLE_SORT_OPTIONS.includes(sort.option);
  if (!available) return [...projects];
  const direction = sort.direction === "ASC" ? 1 : -1;

  const value = (project: ProjectListItem): string | number => {
    switch (sort.option) {
      case "projectName":
        return project.title.toLocaleLowerCase();
      case "owner":
        return (
          project.ownerName?.trim() || project.ownerEmail
        ).toLocaleLowerCase();
      case "creator":
        return (
          project.creatorName?.trim() ||
          project.creatorEmail ||
          ""
        ).toLocaleLowerCase();
      case "appLastPublished":
        return Date.parse(project.lastPublishedAt ?? "") || 0;
      case "appViews":
        return appViewsForDuration(project, context.viewCountDuration) ?? -1;
      case "appLastViewed":
        return Date.parse(project.appLastViewedAt ?? "") || 0;
      case "status":
        return (
          project.statusId == null
            ? ""
            : (context.statusNames?.get(project.statusId) ?? "")
        ).toLocaleLowerCase();
      case "categories":
        return (context.categoriesByProject?.get(project.id) ?? [])
          .map((category) => category.name.toLocaleLowerCase())
          .sort()
          .join(", ");
      case "dateCreated":
        return Date.parse(project.createdAt) || 0;
      case "lastUpdated":
        return Date.parse(project.updatedAt) || 0;
      case "recentlyViewed":
      default:
        return Date.parse(project.lastOpenedAt ?? "") || 0;
    }
  };

  return [...projects].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === right) return a.id.localeCompare(b.id);
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * direction;
    }
    return String(left).localeCompare(String(right)) * direction;
  });
}

/** Client-side filters over the complete project list the action returns. */
export function filterProjects<T extends ProjectListItem>(
  projects: readonly T[],
  filters: ProjectsFilterState,
  currentUserEmail: string,
  search = "",
  categoriesByProject: ReadonlyMap<
    string,
    readonly { id: string }[]
  > = new Map(),
  collectionsByProject: ReadonlyMap<
    string,
    readonly { id: string }[]
  > = new Map(),
): T[] {
  const term = search.trim().toLocaleLowerCase();
  return projects.filter((project) => {
    if (filters.favoritedOnly && !project.favorited) return false;
    if (
      filters.createdByMe &&
      project.creatorEmail?.toLowerCase() !== currentUserEmail.toLowerCase()
    )
      return false;
    if (filters.workspaceAccess && !project.sharedWith?.workspace) return false;
    const statusIds = filters.statusIds ?? [];
    if (
      statusIds.length > 0 &&
      (project.statusId == null || !statusIds.includes(project.statusId))
    )
      return false;
    const categoryIds = filters.categoryIds ?? [];
    if (categoryIds.length > 0) {
      const applied = categoriesByProject.get(project.id) ?? [];
      if (!applied.some((category) => categoryIds.includes(category.id)))
        return false;
    }
    const collectionIds = filters.collectionIds ?? [];
    if (collectionIds.length > 0) {
      const applied = collectionsByProject.get(project.id) ?? [];
      if (!applied.some((collection) => collectionIds.includes(collection.id)))
        return false;
    }
    if (term.length > 0 && !project.title.toLocaleLowerCase().includes(term))
      return false;
    return true;
  });
}

export function hasActiveFilters(
  filters: ProjectsFilterState,
  search: string,
): boolean {
  return (
    filters.favoritedOnly ||
    filters.createdByMe ||
    filters.workspaceAccess === true ||
    (filters.statusIds?.length ?? 0) > 0 ||
    (filters.categoryIds?.length ?? 0) > 0 ||
    (filters.collectionIds?.length ?? 0) > 0 ||
    search.trim().length > 0
  );
}

const WEEK_IN_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const ABSOLUTE_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

export const TRASH_RETENTION_DAYS = 30;

export function absoluteDate(
  iso: string,
  locale: string = FALLBACK_READER_LOCALE,
): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "";
  return formatLocaleDate(timestamp, locale, ABSOLUTE_DATE);
}

export function permanentDeletionDate(
  trashedAt: string,
  locale: string = FALLBACK_READER_LOCALE,
): string {
  const timestamp = Date.parse(trashedAt);
  if (!Number.isFinite(timestamp)) return "";
  return absoluteDate(
    new Date(timestamp + TRASH_RETENTION_DAYS * 86_400_000).toISOString(),
    locale,
  );
}

/**
 * The original date cell language: relative with hour/day units inside a week,
 * then the short calendar date ("Oct 26, 2026"). Invalid or absent dates render
 * an empty cell.
 */
export function tableDate(
  iso: string,
  now = Date.now(),
  locale: string = FALLBACK_READER_LOCALE,
): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "";
  const milliseconds = Math.max(0, now - timestamp);
  if (milliseconds >= WEEK_IN_MILLISECONDS) {
    return formatLocaleDate(timestamp, locale, ABSOLUTE_DATE);
  }
  const seconds = Math.floor(milliseconds / 1000);
  const label = (value: number, one: string, many: string) =>
    value <= 1 ? one : many.replace("%d", String(value));
  if (seconds < 60) return `${label(seconds, "1 sec", "%d secs")} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${label(minutes, "1 min", "%d mins")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${label(hours, "1 hr", "%d hrs")} ago`;
  const days = Math.floor(hours / 24);
  return `${label(days, "1 day", "%d days")} ago`;
}

/** The source's owner cell shows the current person's name, not their email. */
export function ownerLabel(
  project: ProjectListItem,
  currentUser: { name: string; email: string },
): string {
  if (project.ownerEmail.toLowerCase() === currentUser.email.toLowerCase()) {
    return currentUser.name;
  }
  const name = project.ownerName?.trim();
  return name ? name : project.ownerEmail;
}

export function creatorLabel(
  project: ProjectListItem,
  currentUser: { name: string; email: string },
): string | null {
  const creator = project.creatorEmail;
  if (!creator) return null;
  if (creator.toLowerCase() === currentUser.email.toLowerCase()) {
    return currentUser.name;
  }
  const name = project.creatorName?.trim();
  return name ? name : creator;
}

/**
 * The New project control's handler boundary. Pending creates are ignored,
 * matching the shell handler's guard; the real action is injected by the page.
 */
export function invokeCreateProject(
  onCreateProject: () => void,
  pending = false,
): boolean {
  if (pending) return false;
  onCreateProject();
  return true;
}
