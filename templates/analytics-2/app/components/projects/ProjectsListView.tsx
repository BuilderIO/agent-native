import { appBasePath } from "@agent-native/core/client/api-path";
import {
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  FALLBACK_READER_LOCALE,
  useReaderLocale,
} from "@agent-native/toolkit/app/shared/reader-locale";
import { useIsMobile } from "@agent-native/toolkit/hooks";
import {
  IconActivityHeartbeat,
  IconAlertTriangle,
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconCopy,
  IconDots,
  IconEraser,
  IconExternalLink,
  IconFileDownload,
  IconFileText,
  IconFilter,
  IconFolder,
  IconFolderMinus,
  IconFolderShare,
  IconLayoutGrid,
  IconLink,
  IconList,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconStar,
  IconStarFilled,
  IconTag,
  IconTrash,
  IconUpload,
  IconUser,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ArchiveSettings } from "@/lib/model/archive-settings-contracts";
import type { Project } from "@/lib/model/contracts";
import {
  downloadProjectIpynb,
  type ExportableNotebookCell,
} from "@/lib/notebook-ipynb";

import { capabilityAllowed } from "../../../shared/analytics-control-ids";
import type { CapabilityDecision } from "../../../shared/capabilities";
import { ArchiveProjectDialog } from "./ArchiveProjectDialog";
import {
  ARCHIVE_COLUMN_ORDER,
  AVAILABLE_SORT_OPTIONS,
  COLLECTION_COLUMN_ORDER,
  COLUMN_HEADERS,
  COLUMN_METADATA,
  DEFAULT_HIDDEN_COLUMNS,
  columnsForViewport,
  PROJECTS_COLUMN_ORDER,
  REQUIRED_COLUMNS,
  SORT_LABELS,
  SORT_OPTIONS,
  SORTABLE_COLUMNS,
  TRASH_COLUMN_ORDER,
  VIEW_COUNT_DURATIONS,
  type ProjectsColumnId,
  type ProjectsSortOption,
  type ViewCountDuration,
} from "./columnDefinitions";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { ProjectCategoriesDialog } from "./ProjectCategoriesDialog";
import { ProjectCollectionsPickerDialog } from "./ProjectCollectionsPickerDialog";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  appViewsForDuration,
  creatorLabel,
  filterProjects,
  hasActiveFilters,
  invokeCreateProject,
  ownerLabel,
  projectHref,
  absoluteDate,
  permanentDeletionDate,
  projectListHref,
  sortProjects,
  TRASH_RETENTION_DAYS,
  tableDate,
  type ProjectListItem,
  type ProjectsFilterState,
  type ProjectsSortDirection,
  type ProjectsSortState,
} from "./projectList";
import { ProjectStatusDialog } from "./ProjectStatusDialog";
import { RemoveFromCollectionDialog } from "./RemoveFromCollectionDialog";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { TransferProjectOwnerDialog } from "./TransferProjectOwnerDialog";
import { TrashProjectDialog } from "./TrashProjectDialog";
import { useCopyProjectLink } from "./useCopyProjectLink";

function ArchiveHelpLink() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <a
          href="#archive-help"
          onClick={(event) => {
            event.preventDefault();
            setOpen((current) => !current);
          }}
        >
          {t("analytics.lists.archiveLearnMore")}
        </a>
      </PopoverTrigger>
      <PopoverContent
        id="archive-help"
        aria-label={t("analytics.lists.archiveHelpTitle")}
      >
        <h2 className="text-sm font-semibold">
          {t("analytics.lists.archiveHelpTitle")}
        </h2>
        <p className="mt-2 text-sm">{t("analytics.lists.archiveGuideBody")}</p>
        <p className="mt-2 text-sm">
          {t("analytics.lists.archiveGuideRestore")}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export type ProjectsListStatus = "loading" | "ready" | "error";

/** The key that remembers this reader's Projects list layout (view and cards). */
export const WORKSPACE_PAGE_LAYOUT_KEY = "workspace_page_layout";

function detectMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const toMatch = [
    /Android/i,
    /webOS/i,
    /iPhone/i,
    /BlackBerry/i,
    /Windows Phone/i,
  ];
  return toMatch.some((item) => navigator.userAgent.match(item));
}

function readWorkspacePageLayout(): "list" | "card" {
  if (detectMobile()) return "card";
  try {
    const stored = window.localStorage.getItem(WORKSPACE_PAGE_LAYOUT_KEY);
    if (stored === "card" || stored === "list") return stored;
  } catch {
    // A blocked storage read falls back to the source default.
  }
  return "list";
}

export interface ProjectsListUser {
  name: string;
  email: string;
}

export interface ProjectsListViewProps {
  status: ProjectsListStatus;
  trashedSkills?: ReactNode;
  hasTrashedSkills?: boolean;
  projects: readonly ProjectListItem[];
  columnCapabilities?: readonly CapabilityDecision[];
  currentUser: ProjectsListUser;
  search: string;
  onSearchChange: (value: string) => void;
  onCreateProject?: (() => void) | undefined;
  onImportProject?: (() => void) | undefined;
  createPending?: boolean | undefined;
  errorMessage?: string | undefined;
  initialSort?: ProjectsSortState | undefined;
  onRetry?: (() => void) | undefined;
  /** Marks a component-harness render so fixtures can never be mistaken for data. */
  fixture?: string | undefined;
  /** Deterministic clock for date cells. */
  now?: number | undefined;
  /** Status and category choices for the filter menu. */
  filterOptions?:
    | {
        statuses: readonly { id: string; name: string }[];
        categories: readonly { id: string; name: string }[];
        collections?: readonly { id: string; name: string }[];
      }
    | undefined;
  /** Collections offered by the row menu's "Add to collection" action. */
  collections?:
    | readonly {
        id: string;
        name: string;
        canManage?: boolean | undefined;
      }[]
    | undefined;
  collectionsLoading?: boolean | undefined;
  collectionsLoadError?: boolean | undefined;
  onRetryCollections?: (() => void) | undefined;
  onRemoveFromCollection?: ((projectId: string) => Promise<void>) | undefined;
  /** Files a project into, or out of, one collection. */
  onToggleProjectCollection?:
    | ((projectId: string, collectionId: string, add: boolean) => Promise<void>)
    | undefined;
  /** Clears a project's saved cell outputs; absent when the caller cannot. */
  onClearOutputs?: ((projectId: string) => Promise<void>) | undefined;
  /** Moves a project to trash; absent when the caller cannot back the write. */
  onTrashProject?: ((projectId: string) => Promise<void>) | undefined;
  /** Duplicates a project and opens the copy; absent when unbacked. */
  onDuplicateProject?: ((projectId: string) => Promise<void>) | undefined;
  onRenameProject?:
    | ((projectId: string, title: string) => Promise<void>)
    | undefined;
  /** Puts a trashed project back; absent when unbacked. */
  onRestoreProject?: ((projectId: string) => Promise<void>) | undefined;
  /** Permanently deletes a trashed project; absent when unbacked. */
  onDeleteProject?: ((projectId: string) => Promise<void>) | undefined;
  /** Adds or removes a project from favorites; absent when unbacked. */
  onToggleFavorite?:
    | ((projectId: string, favorited: boolean) => Promise<void>)
    | undefined;
  /** Moves a project to the archive; absent when unbacked. */
  onArchiveProject?: ((projectId: string) => Promise<void>) | undefined;
  /** Returns an archived project to the active list; absent when unbacked. */
  onUnarchiveProject?: ((projectId: string) => Promise<void>) | undefined;
  archiveSettings?: ArchiveSettings | undefined;
  canConfigureAutoArchive?: boolean | undefined;
  onOpenArchiveSettings?: (() => void) | undefined;
  /** Rendered under another page's own header (a collection): no title bar. */
  embedded?: boolean | undefined;
  /** Opens the add-to-collection flow from an empty collection's empty state. */
  onAddToCollection?: (() => void) | undefined;
  onNewProjectInCollection?: (() => void) | undefined;
  /** Which list this is: trash rows offer Restore and Permanently delete. */
  listView?: "active" | "archive" | "trash" | undefined;
  /** Collection chips per project, from `list-project-collections`. */
  collectionsByProject?:
    | ReadonlyMap<string, readonly { id: string; name: string }[]>
    | undefined;
  /** Catalogue chips per project, from `list-project-categories`. */
  categoriesByProject?:
    | ReadonlyMap<string, readonly ProjectCategoryChip[]>
    | undefined;
}

const EMPTY_CATEGORIES: ReadonlyMap<string, readonly ProjectCategoryChip[]> =
  new Map();
const EMPTY_COLLECTIONS: ReadonlyMap<
  string,
  readonly { id: string; name: string }[]
> = new Map();

const SELECT_COLUMN_WIDTH = 44;

const COLUMN_WIDTH: Record<ProjectsColumnId, number> = {
  name: 360,
  status: 200,
  categories: 200,
  creator: 200,
  owner: 200,
  lastViewedByMe: 200,
  dateCreated: 200,
  dateLastEdited: 200,
  appViews: 200,
  dateLastPublished: 200,
  datePublishedAppLastViewed: 200,
  myAccess: 200,
  sharedWith: 200,
  collections: 200,
  archivedAt: 200,
  trashedAt: 200,
};

/** Adds or removes one id from a multi-select filter. */
function toggleValue(values: readonly string[], id: string): string[] {
  return values.includes(id)
    ? values.filter((value) => value !== id)
    : [...values, id];
}

function defaultDirection(option: ProjectsSortOption): ProjectsSortDirection {
  switch (option) {
    case "projectName":
    case "owner":
    case "categories":
    case "status":
    case "creator":
      return "ASC";
    default:
      return "DESC";
  }
}

export type ProjectCategoryChip = {
  id: string;
  name: string;
  color: string | null;
};

function ProjectNameCell({
  project,
  onTransfer,
  onStatus,
  onCategories,
  onTrash,
  onDuplicate,
  onRename,
  onRestore,
  onDelete,
  onArchive,
  onUnarchive,
  onFavorite,
  listMode,
  onClearOutputs,
  onAddToCollection,
  onRemoveFromCollection,
}: {
  project: Project;
  onTransfer: () => void;
  onStatus: () => void;
  onCategories: () => void;
  onTrash: () => void;
  onDuplicate?: (() => void) | undefined;
  onRename?: (() => void) | undefined;
  onRestore: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onFavorite: ProjectsListViewProps["onToggleFavorite"];
  listMode: "active" | "archive" | "trash";
  onClearOutputs?: (() => void) | undefined;
  onAddToCollection?: (() => void) | undefined;
  onRemoveFromCollection?: (() => void) | undefined;
}) {
  const t = useT();
  const [favoritePending, setFavoritePending] = useState<boolean | null>(null);
  const favorited = favoritePending ?? project.favorited;
  const favoriteLabel = t(
    favorited
      ? "analytics.lists.actionRemoveFromFavorites"
      : "analytics.lists.actionAddFavorite",
  );
  const toggleFavorite = onFavorite
    ? async () => {
        const next = !favorited;
        setFavoritePending(next);
        try {
          await onFavorite(project.id, next);
        } catch (error) {
          toast.error(
            actionErrorMessage(error) ??
              t(
                next
                  ? "analytics.lists.favoriteFailed"
                  : "analytics.lists.unfavoriteFailed",
                { noun: t("analytics.lists.projectNoun") },
              ),
          );
        } finally {
          setFavoritePending(null);
        }
      }
    : undefined;
  return (
    <span className="ws-projects-title-cell">
      <IconFileText size={15} aria-hidden="true" />
      <a
        className="ws-projects-title-link"
        data-rid="projects.list.open"
        href={projectListHref(project, appBasePath())}
        data-project-href={projectListHref(project, appBasePath())}
      >
        {project.title.trim().length > 0 ? project.title : "Untitled project"}
      </a>
      {toggleFavorite ? (
        <button
          type="button"
          className="ws-projects-row-favorite"
          aria-label={favoriteLabel}
          aria-pressed={favorited}
          disabled={favoritePending !== null}
          onClick={() => void toggleFavorite()}
        >
          {favorited ? (
            <IconStarFilled size={14} aria-hidden="true" />
          ) : (
            <IconStar size={14} aria-hidden="true" />
          )}
        </button>
      ) : favorited ? (
        <IconStarFilled
          size={14}
          className="ws-projects-favorite-mark"
          aria-hidden="true"
        />
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className="ws-projects-row-actions"
          aria-label="View more actions"
        >
          <IconDots size={16} aria-hidden="true" />
        </DropdownMenuTrigger>
        <RowMenu
          project={project}
          onTransfer={onTransfer}
          onStatus={onStatus}
          onCategories={onCategories}
          onTrash={onTrash}
          onDuplicate={onDuplicate}
          onRename={onRename}
          onRestore={onRestore}
          onDelete={onDelete}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onFavorite={
            toggleFavorite && favoritePending === null
              ? () => void toggleFavorite()
              : undefined
          }
          listMode={listMode}
          onClearOutputs={onClearOutputs}
          onAddToCollection={onAddToCollection}
          onRemoveFromCollection={onRemoveFromCollection}
        />
      </DropdownMenu>
    </span>
  );
}

function categoryChips(categories: readonly ProjectCategoryChip[]) {
  if (categories.length === 0) {
    return <span className="ws-projects-gap">—</span>;
  }
  return (
    <span className="ws-projects-category-chips">
      {categories.map((category) => (
        <span className="ws-projects-category-chip" key={category.id}>
          <span
            className="ws-projects-category-dot"
            style={{ background: category.color ?? "#6b7280" }}
            aria-hidden="true"
          />
          {category.name}
        </span>
      ))}
    </span>
  );
}

function cell(
  project: ProjectListItem,
  column: ProjectsColumnId,
  user: ProjectsListUser,
  t: ReturnType<typeof useT>,
  now?: number | undefined,
  categories: readonly ProjectCategoryChip[] = [],
  status?: { id: string; name: string } | undefined,
  collections: readonly { id: string; name: string }[] = [],
  locale: string = FALLBACK_READER_LOCALE,
  onAddStatus?: (() => void) | undefined,
  viewCountDuration: ViewCountDuration = "ALL_TIME",
) {
  switch (column) {
    case "collections":
      return collections.length === 0 ? (
        <span className="ws-projects-gap">—</span>
      ) : (
        <span className="ws-projects-category-chips">
          {collections.map((collection) => (
            <span className="ws-projects-category-chip" key={collection.id}>
              {collection.name}
            </span>
          ))}
        </span>
      );
    case "status":
      if (status)
        return onAddStatus ? (
          <button
            type="button"
            className="ws-projects-category-chip ws-projects-status-chip"
            onClick={onAddStatus}
          >
            {status.name}
          </button>
        ) : (
          <span className="ws-projects-category-chip">{status.name}</span>
        );
      return onAddStatus ? (
        <button
          type="button"
          className="ws-projects-add-status"
          onClick={onAddStatus}
        >
          <IconActivityHeartbeat size={14} aria-hidden="true" />
          {t("analytics.lists.actionAddStatus")}
        </button>
      ) : (
        <span className="ws-projects-gap">—</span>
      );
    case "categories":
      return categoryChips(categories);
    case "creator": {
      const creator = project.creatorEmail;
      const name = creatorLabel(project, user);
      if (!creator || !name) return <span className="ws-projects-gap">—</span>;
      return (
        <span className="ws-projects-cell-text" title={creator}>
          {name}
        </span>
      );
    }
    case "owner":
      return (
        <span className="ws-projects-owner">
          <span className="ws-projects-avatar" aria-hidden="true">
            {ownerLabel(project, user).slice(0, 1).toUpperCase()}
          </span>
          <span className="ws-projects-cell-text" title={project.ownerEmail}>
            {ownerLabel(project, user)}
          </span>
        </span>
      );
    case "lastViewedByMe":
      return (
        <span className="ws-projects-cell-text">
          {project.lastOpenedAt == null
            ? null
            : tableDate(project.lastOpenedAt, now, locale)}
        </span>
      );
    case "archivedAt":
      return (
        <span className="ws-projects-cell-text">
          {project.archivedAt ? absoluteDate(project.archivedAt, locale) : "—"}
        </span>
      );
    case "trashedAt":
      return project.trashedAt ? (
        <span className="ws-projects-date-chip">
          {permanentDeletionDate(project.trashedAt, locale)}
        </span>
      ) : (
        <span className="ws-projects-gap">—</span>
      );
    case "dateLastPublished":
      return (
        <span className="ws-projects-cell-text">
          {project.lastPublishedAt
            ? tableDate(project.lastPublishedAt, now, locale)
            : "—"}
        </span>
      );
    case "appViews": {
      const views = appViewsForDuration(project, viewCountDuration);
      return (
        <span className="ws-projects-cell-text">
          {views == null ? "—" : views.toLocaleString(locale)}
        </span>
      );
    }
    case "datePublishedAppLastViewed":
      return (
        <span className="ws-projects-cell-text">
          {project.appLastViewedAt
            ? tableDate(project.appLastViewedAt, now, locale)
            : "—"}
        </span>
      );
    case "myAccess":
      return (
        <span className="ws-projects-cell-text">
          {project.yourAccess === "owner"
            ? t("share.ownerRole")
            : project.yourAccess === "manage"
              ? t("share.admin")
              : project.yourAccess === "edit"
                ? t("share.editor")
                : project.yourAccess === "read"
                  ? t("share.viewer")
                  : "—"}
        </span>
      );
    case "sharedWith": {
      const sharing = project.sharedWith;
      if (!sharing) return <span className="ws-projects-gap">—</span>;
      return (
        <span className="ws-projects-cell-text">
          {sharing.workspace
            ? t("analytics.lists.sharingWorkspace")
            : sharing.directCount > 0
              ? t("analytics.lists.directShares", {
                  count: sharing.directCount,
                })
              : t("analytics.lists.privateSharing")}
        </span>
      );
    }
    case "dateCreated":
      return (
        <span className="ws-projects-cell-text">
          {tableDate(project.createdAt, now, locale)}
        </span>
      );
    case "dateLastEdited":
      return (
        <span className="ws-projects-cell-text">
          {tableDate(project.updatedAt, now, locale)}
        </span>
      );
    default:
      return null;
  }
}

export function SortMenu({
  sort,
  onSelect,
  onClose,
  availableOptions = AVAILABLE_SORT_OPTIONS,
}: {
  sort: ProjectsSortState;
  onSelect: (option: ProjectsSortOption) => void;
  onClose: () => void;
  availableOptions?: readonly ProjectsSortOption[];
}) {
  return (
    <div className="ws-projects-popover ws-projects-sort-menu" role="menu">
      {/* Only fields the workspace project contract exposes get a row: an
          option we cannot sort by is absent, not a disabled button. */}
      {SORT_OPTIONS.filter((option) => availableOptions.includes(option)).map(
        (option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={sort.option === option}
            className={`ws-projects-menu-item${
              sort.option === option ? " is-active" : ""
            }`}
            onClick={() => {
              onSelect(option);
              onClose();
            }}
          >
            <span className="ws-projects-menu-label">
              {SORT_LABELS[option]}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

function DisplayMenu({
  columns,
  hidden,
  unavailable,
  showColumns,
  viewCountDuration,
  onViewCountDurationChange,
  onToggle,
  onToggleAll,
  onReset,
}: {
  columns: readonly ProjectsColumnId[];
  hidden: ReadonlySet<ProjectsColumnId>;
  unavailable: ReadonlySet<ProjectsColumnId>;
  showColumns: boolean;
  viewCountDuration: ViewCountDuration;
  onViewCountDurationChange: (value: ViewCountDuration) => void;
  onToggle: (column: ProjectsColumnId) => void;
  onToggleAll: (checked: boolean) => void;
  onReset: () => void;
}) {
  const toggleable = columns.filter(
    (column) => !REQUIRED_COLUMNS.includes(column) && !unavailable.has(column),
  );
  const allChecked = toggleable.every((column) => !hidden.has(column));
  const someChecked = toggleable.some((column) => !hidden.has(column));
  return (
    <div
      className="ws-projects-popover ws-projects-display-menu"
      role="dialog"
      aria-label="Display settings"
    >
      <p className="ws-projects-menu-heading">Display settings</p>
      <label className="ws-projects-column-option">
        <span className="ws-projects-menu-label">Show app views from</span>
        <select
          aria-label="Show app views from"
          value={viewCountDuration}
          onChange={(event) =>
            onViewCountDurationChange(event.target.value as ViewCountDuration)
          }
        >
          {VIEW_COUNT_DURATIONS.map((duration) => (
            <option key={duration.value} value={duration.value}>
              {duration.label}
            </option>
          ))}
        </select>
      </label>
      {showColumns ? (
        <>
          <div className="ws-projects-menu-divider" />
          <div className="ws-projects-column-header">
            <p className="ws-projects-menu-heading">Columns</p>
            <button
              type="button"
              className="ws-projects-menu-item"
              onClick={onReset}
            >
              Reset
            </button>
          </div>
          <label className="ws-projects-column-option">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(input) => {
                if (input) input.indeterminate = !allChecked && someChecked;
              }}
              onChange={(event) => onToggleAll(event.target.checked)}
            />
            <span className="ws-projects-menu-label">All columns</span>
          </label>
          {columns.map((column) => {
            const enabled = !unavailable.has(column);
            const required = REQUIRED_COLUMNS.includes(column);
            return (
              <label key={column} className="ws-projects-column-option">
                <input
                  type="checkbox"
                  checked={enabled && !hidden.has(column)}
                  disabled={!enabled || required}
                  onChange={() => onToggle(column)}
                />
                <span className="ws-projects-menu-label">
                  {COLUMN_HEADERS[column]}
                </span>
              </label>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

function RowMenu({
  project,
  onTransfer,
  onStatus,
  onCategories,
  onTrash,
  onDuplicate,
  onRename,
  onRestore,
  onDelete,
  onArchive,
  onUnarchive,
  onFavorite,
  listMode,
  onClearOutputs,
  onAddToCollection,
  onRemoveFromCollection,
}: {
  project: Project;
  onTransfer: () => void;
  onStatus: () => void;
  onCategories: () => void;
  onTrash: () => void;
  onDuplicate?: (() => void) | undefined;
  onRename?: (() => void) | undefined;
  onRestore: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onFavorite: (() => void) | undefined;
  listMode: "active" | "archive" | "trash";
  onClearOutputs?: (() => void) | undefined;
  onAddToCollection?: (() => void) | undefined;
  onRemoveFromCollection?: (() => void) | undefined;
}) {
  const t = useT();
  const copyProjectLink = useCopyProjectLink();
  const href = projectHref(project.id, appBasePath());
  return (
    <DropdownMenuContent
      align="end"
      className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
    >
      <DropdownMenuItem asChild>
        <a
          href={projectListHref(project, appBasePath())}
          target="_blank"
          rel="noreferrer"
        >
          <IconExternalLink size={14} aria-hidden="true" />
          {t("analytics.lists.actionOpenNewTab")}
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void copyProjectLink(project.id)}>
        <IconLink size={14} aria-hidden="true" />
        {t("analytics.lists.actionCopyLink")}
      </DropdownMenuItem>
      {onFavorite != null ? (
        <DropdownMenuItem onSelect={onFavorite}>
          <IconStar size={14} aria-hidden="true" />
          {t(
            project.favorited
              ? "analytics.lists.actionRemoveFromFavorites"
              : "analytics.lists.actionAddFavorite",
          )}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      {onRename != null && listMode !== "trash" ? (
        <DropdownMenuItem onSelect={onRename}>
          <IconPencil size={14} aria-hidden="true" />
          {t("analytics.lists.actionRename")}
        </DropdownMenuItem>
      ) : null}
      {onDuplicate != null ? (
        <DropdownMenuItem onSelect={onDuplicate}>
          <IconCopy size={14} aria-hidden="true" />
          {t("analytics.lists.actionDuplicate")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={onStatus}>
        <IconTag size={14} aria-hidden="true" />
        {t("analytics.lists.actionSetStatus")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onCategories}>
        <IconPlus size={14} aria-hidden="true" />
        {t("analytics.lists.addCategories")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onTransfer}>
        <IconUser size={14} aria-hidden="true" />
        {t("analytics.lists.actionTransferOwner")}
      </DropdownMenuItem>
      {project.language === "python" ? (
        <DropdownMenuItem asChild>
          <a
            href={`${href}?export=ipynb`}
            onClick={(event) => {
              event.preventDefault();
              void (async () => {
                try {
                  const fullProject = (await callAction("get-project", {
                    projectId: project.id,
                  })) as {
                    title: string;
                    language: string;
                    cells: readonly ExportableNotebookCell[];
                  };
                  downloadProjectIpynb(fullProject);
                } catch (error) {
                  toast.error(
                    actionErrorMessage(
                      error,
                      t("analytics.lists.actionExportJupyterNotebook"),
                    ),
                  );
                }
              })();
            }}
          >
            <IconFileDownload size={14} aria-hidden="true" />
            {t("analytics.lists.actionExportJupyterNotebook")}
          </a>
        </DropdownMenuItem>
      ) : null}
      {onAddToCollection != null ? (
        <DropdownMenuItem onSelect={onAddToCollection}>
          <IconFolder size={14} aria-hidden="true" />
          {t("analytics.lists.actionAddToCollection")}
        </DropdownMenuItem>
      ) : null}
      {onAddToCollection != null && listMode !== "trash" ? (
        <DropdownMenuItem onSelect={onAddToCollection}>
          <IconFolderShare size={14} aria-hidden="true" />
          {t("projectMenu.moveTo")}
        </DropdownMenuItem>
      ) : null}
      {onRemoveFromCollection != null ? (
        <DropdownMenuItem onSelect={onRemoveFromCollection}>
          <IconFolderMinus size={14} aria-hidden="true" />
          {t("analytics.lists.actionRemoveFromCollectionMenu")}
        </DropdownMenuItem>
      ) : null}
      {onClearOutputs != null ? (
        <DropdownMenuItem
          title="This will clear all cell outputs from the Notebook"
          onSelect={onClearOutputs}
        >
          <IconEraser size={14} aria-hidden="true" />
          {t("notebook.runClearOutputs")}
        </DropdownMenuItem>
      ) : null}
      {listMode === "archive" ? (
        <DropdownMenuItem onSelect={onUnarchive}>
          <IconRefresh size={14} aria-hidden="true" />
          {t("analytics.lists.actionUnarchive")}
        </DropdownMenuItem>
      ) : listMode === "active" ? (
        <DropdownMenuItem onSelect={onArchive}>
          <IconArchive size={14} aria-hidden="true" />
          {t("analytics.lists.actionArchive")}
        </DropdownMenuItem>
      ) : null}
      {listMode === "trash" ? (
        <>
          <DropdownMenuItem onSelect={onRestore}>
            <IconRefresh size={14} aria-hidden="true" />
            {t("analytics.lists.actionRestore")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={onDelete}
          >
            <IconTrash size={14} aria-hidden="true" />
            {t("analytics.lists.actionDelete")}
          </DropdownMenuItem>
        </>
      ) : (
        <DropdownMenuItem onSelect={onTrash}>
          <IconTrash size={14} aria-hidden="true" />
          {t("analytics.lists.actionMoveToTrash")}
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}

export function parseProjectsSortParam(
  param: string | null | undefined,
): ProjectsSortState | undefined {
  if (!param) return undefined;
  const trimmed = param.trim();
  if (trimmed === "popular" || trimmed === "appViews") {
    return { option: "appViews", direction: "DESC" };
  }
  if ((AVAILABLE_SORT_OPTIONS as readonly string[]).includes(trimmed)) {
    return {
      option: trimmed as ProjectsSortState["option"],
      direction: trimmed === "projectName" ? "ASC" : "DESC",
    };
  }
  return undefined;
}

export function ProjectsListView({
  status,
  trashedSkills,
  hasTrashedSkills = false,
  projects,
  columnCapabilities,
  currentUser,
  categoriesByProject = EMPTY_CATEGORIES,
  collectionsByProject = EMPTY_COLLECTIONS,
  collections,
  collectionsLoading = false,
  collectionsLoadError = false,
  onRetryCollections,
  onToggleProjectCollection,
  onRemoveFromCollection,
  filterOptions,
  onTrashProject,
  onDuplicateProject,
  onRenameProject,
  onRestoreProject,
  onDeleteProject,
  onToggleFavorite,
  onArchiveProject,
  onUnarchiveProject,
  archiveSettings,
  canConfigureAutoArchive = false,
  onOpenArchiveSettings,
  listView = "active",
  embedded = false,
  onAddToCollection,
  onNewProjectInCollection,
  onClearOutputs,
  search,
  onSearchChange,
  onCreateProject,
  onImportProject,
  createPending = false,
  errorMessage,
  onRetry,
  fixture,
  now,
  initialSort,
}: ProjectsListViewProps) {
  const t = useT();
  const locale = useReaderLocale();
  const [panelOpen, setPanelOpen] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const moreFiltersTriggerRef = useRef<HTMLButtonElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  const displayTriggerRef = useRef<HTMLButtonElement>(null);
  const [selectedSort, setSort] = useState<ProjectsSortState>(
    initialSort ?? DEFAULT_SORT,
  );
  useEffect(() => {
    if (initialSort) setSort(initialSort);
  }, [initialSort?.option, initialSort?.direction]);
  const [filters, setFilters] = useState<ProjectsFilterState>(EMPTY_FILTERS);
  const [viewCountDuration, setViewCountDuration] =
    useState<ViewCountDuration>("ALL_TIME");
  const [hidden, setHidden] = useState<ReadonlySet<ProjectsColumnId>>(
    () => new Set(DEFAULT_HIDDEN_COLUMNS),
  );
  const [transferProject, setTransferProject] = useState<Project | null>(null);
  const [statusProject, setStatusProject] = useState<Project | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [categoriesProject, setCategoriesProject] = useState<Project | null>(
    null,
  );
  const [collectionTarget, setCollectionTarget] = useState<Project | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [trashTarget, setTrashTarget] = useState<Project | null>(null);
  const [trashPending, setTrashPending] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  async function moveToTrash() {
    if (trashTarget == null || trashPending || onTrashProject == null) return;
    setTrashPending(true);
    setTrashError(null);
    try {
      await onTrashProject(trashTarget.id);
      setTrashTarget(null);
    } catch (cause) {
      setTrashError(
        cause instanceof Error
          ? cause.message
          : "The project could not be moved to trash.",
      );
    } finally {
      setTrashPending(false);
    }
  }
  async function moveToArchive() {
    if (archiveTarget == null || archivePending || onArchiveProject == null)
      return;
    setArchivePending(true);
    setArchiveError(null);
    try {
      await onArchiveProject(archiveTarget.id);
      setArchiveTarget(null);
    } catch (cause) {
      setArchiveError(
        cause instanceof Error
          ? cause.message
          : "The project could not be archived.",
      );
    } finally {
      setArchivePending(false);
    }
  }
  async function deleteForever() {
    if (deleteTarget == null || deletePending || onDeleteProject == null)
      return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await onDeleteProject(deleteTarget.id);
      setDeleteTarget(null);
    } catch (cause) {
      setDeleteError(
        cause instanceof Error
          ? cause.message
          : "The project could not be deleted.",
      );
    } finally {
      setDeletePending(false);
    }
  }
  const [layout, setLayoutState] = useState<"list" | "card">(
    readWorkspacePageLayout,
  );
  const setLayout = useCallback((next: "list" | "card") => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(WORKSPACE_PAGE_LAYOUT_KEY, next);
    } catch {
      // Persisting the preference is best-effort; the view still switches.
    }
  }, []);
  const rootRef = useRef<HTMLDivElement>(null);

  const statusById = useMemo(
    () =>
      new Map(
        (filterOptions?.statuses ?? []).map((status) => [status.id, status]),
      ),
    [filterOptions],
  );
  const filtersApplied = hasActiveFilters(filters, search);
  const columnOrder: readonly ProjectsColumnId[] = embedded
    ? COLLECTION_COLUMN_ORDER
    : listView === "archive"
      ? ARCHIVE_COLUMN_ORDER
      : listView === "trash"
        ? TRASH_COLUMN_ORDER
        : PROJECTS_COLUMN_ORDER;
  const unavailableColumns = useMemo(
    () =>
      new Set<ProjectsColumnId>(
        PROJECTS_COLUMN_ORDER.filter((column) => {
          const metadata = COLUMN_METADATA[column];
          return (
            metadata &&
            (columnCapabilities === undefined
              ? !projects.some(
                  (project) => project[metadata.field] !== undefined,
                )
              : !capabilityAllowed(columnCapabilities, metadata.controlId))
          );
        }),
      ),
    [columnCapabilities, projects],
  );
  const availableSortOptions = AVAILABLE_SORT_OPTIONS.filter(
    (option) =>
      ![...unavailableColumns].some(
        (column) => SORTABLE_COLUMNS[column] === option,
      ),
  );
  const sort = availableSortOptions.includes(selectedSort.option)
    ? selectedSort
    : DEFAULT_SORT;
  const rows = useMemo(
    () =>
      sortProjects(
        filterProjects(
          projects,
          filters,
          currentUser.email,
          search,
          categoriesByProject,
          collectionsByProject,
        ),
        sort,
        {
          statusNames: new Map(
            (filterOptions?.statuses ?? []).map((status) => [
              status.id,
              status.name,
            ]),
          ),
          categoriesByProject,
          viewCountDuration,
        },
      ),
    [
      projects,
      filters,
      currentUser.email,
      search,
      sort,
      categoriesByProject,
      collectionsByProject,
      filterOptions,
      viewCountDuration,
    ],
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  function toggleRowSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllSelected(checked: boolean) {
    setSelectedIds(checked ? new Set(rows.map((row) => row.id)) : new Set());
  }

  const bulkActions: readonly {
    id: string;
    label: string;
    handler: ((projectId: string) => Promise<void>) | undefined;
    keys: { ok: string; partial: string; failed: string };
    confirm?: boolean;
  }[] =
    listView === "trash"
      ? [
          {
            id: "restore",
            label: t("analytics.lists.actionRestore"),
            handler: onRestoreProject,
            keys: {
              ok: "analytics.lists.restoredToast",
              partial: "analytics.lists.restoredPartial",
              failed: "analytics.lists.restoreFailed",
            },
          },
          {
            id: "delete",
            label: t("analytics.lists.actionDelete"),
            handler: onDeleteProject,
            confirm: true,
            keys: {
              ok: "analytics.lists.deletedToast",
              partial: "analytics.lists.deletedPartial",
              failed: "analytics.lists.deleteFailed",
            },
          },
        ]
      : [
          listView === "archive"
            ? {
                id: "unarchive",
                label: t("analytics.lists.actionUnarchive"),
                handler: onUnarchiveProject,
                keys: {
                  ok: "analytics.lists.unarchivedToast",
                  partial: "analytics.lists.unarchivedPartial",
                  failed: "analytics.lists.unarchiveFailed",
                },
              }
            : {
                id: "archive",
                label: t("analytics.lists.actionArchive"),
                handler: onArchiveProject,
                keys: {
                  ok: "analytics.lists.archivedToast",
                  partial: "analytics.lists.archivedPartial",
                  failed: "analytics.lists.archiveFailed",
                },
              },
          {
            id: "trash",
            label: t("analytics.lists.actionTrash"),
            handler: onTrashProject,
            keys: {
              ok: "analytics.lists.trashedToast",
              partial: "analytics.lists.trashedPartial",
              failed: "analytics.lists.trashFailed",
            },
          },
          ...(listView === "active" && onRemoveFromCollection != null
            ? [
                {
                  id: "removeFromCollection",
                  label: t("analytics.lists.actionRemoveFromCollectionMenu"),
                  handler: onRemoveFromCollection,
                  keys: {
                    ok: "analytics.lists.removedFromCollectionToast",
                    partial: "analytics.lists.removedFromCollectionPartial",
                    failed: "analytics.lists.removeFromCollectionFailed",
                  },
                },
              ]
            : []),
        ];

  async function runBulk(action: (typeof bulkActions)[number]) {
    const handler = action.handler;
    if (handler == null || bulkPending || selectedRows.length === 0) return;
    const targets = selectedRows.map((row) => row.id);
    const many = targets.length > 1;
    setBulkPending(true);
    const failedIds = new Set<string>();
    for (const id of targets) {
      try {
        await handler(id);
      } catch {
        failedIds.add(id);
      }
    }
    setBulkPending(false);
    setBulkDeleteOpen(false);
    setBulkRemoveOpen(false);
    setSelectedIds(failedIds);
    const done = targets.length - failedIds.size;
    if (failedIds.size === 0) {
      toast.success(
        t(action.keys.ok, {
          noun: t(
            many
              ? "analytics.lists.projectsTitleNoun"
              : "analytics.lists.projectTitleNoun",
          ),
        }),
      );
    } else if (done > 0) {
      toast.error(
        t(action.keys.partial, {
          done,
          failed: failedIds.size,
          noun: t("analytics.lists.projectsNoun"),
        }),
      );
    } else {
      toast.error(
        t(action.keys.failed, {
          noun: t(
            many
              ? "analytics.lists.projectsNoun"
              : "analytics.lists.projectNoun",
          ),
        }),
      );
    }
  }

  const isMobile = useIsMobile();
  const visibleColumns = columnsForViewport(
    columnOrder.filter(
      (column) => !unavailableColumns.has(column) && !hidden.has(column),
    ),
    isMobile,
  );
  const columnWidth = (column: ProjectsColumnId) =>
    isMobile
      ? Math.min(
          COLUMN_WIDTH[column],
          column === "name" ? 180 - SELECT_COLUMN_WIDTH : 180,
        )
      : COLUMN_WIDTH[column];
  const tableWidth = visibleColumns.reduce(
    (width, column) => width + columnWidth(column),
    SELECT_COLUMN_WIDTH,
  );

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    onSearchChange("");
  }

  useEffect(() => {
    if (!sortOpen && !displayOpen && !moreFiltersOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      const insidePopover =
        active instanceof Element &&
        active.closest(".ws-projects-popover") != null;
      const restoreTarget = insidePopover
        ? displayOpen
          ? displayTriggerRef.current
          : sortOpen
            ? sortTriggerRef.current
            : moreFiltersOpen
              ? moreFiltersTriggerRef.current
              : null
        : null;
      setSortOpen(false);
      setDisplayOpen(false);
      setMoreFiltersOpen(false);
      if (restoreTarget) {
        queueMicrotask(() => restoreTarget.focus());
      }
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".ws-projects-popover") != null) return;
      if (target.closest('[aria-expanded="true"]') != null) return;
      setSortOpen(false);
      setDisplayOpen(false);
      setMoreFiltersOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [displayOpen, moreFiltersOpen, sortOpen]);

  function toggleColumn(column: ProjectsColumnId) {
    if (unavailableColumns.has(column) || REQUIRED_COLUMNS.includes(column))
      return;
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  }

  function toggleAllColumns(checked: boolean) {
    setHidden(
      checked
        ? new Set()
        : new Set(
            columnOrder.filter((column) => !REQUIRED_COLUMNS.includes(column)),
          ),
    );
  }

  function chooseSort(option: ProjectsSortOption) {
    setSort((current) =>
      current.option === option
        ? current
        : { option, direction: defaultDirection(option) },
    );
  }

  function toggleHeaderSort(option: ProjectsSortOption) {
    setSort((current) =>
      current.option === option
        ? {
            option,
            direction: current.direction === "ASC" ? "DESC" : "ASC",
          }
        : { option, direction: defaultDirection(option) },
    );
  }

  return (
    <div
      ref={rootRef}
      className="ws-projects"
      data-workspace-surface="projects"
      data-list-view={listView}
      data-fixture={fixture}
    >
      {embedded ? null : (
        <header className="ws-projects-header">
          <div className="ws-projects-heading">
            <div className="ws-projects-heading-row">
              <span className="ws-projects-heading-icon" aria-hidden="true">
                {listView === "archive" ? (
                  <IconArchive size={15} />
                ) : listView === "trash" ? (
                  <IconTrash size={15} />
                ) : (
                  <IconFileText size={15} />
                )}
              </span>
              <h1 className="ws-projects-title">
                {listView === "archive"
                  ? "Archive"
                  : listView === "trash"
                    ? "Trash"
                    : "Projects"}
              </h1>
            </div>
            {listView === "archive" ? (
              <>
                <p className="ws-projects-subtitle">
                  {t("analytics.lists.archiveHelp")}
                  <ArchiveHelpLink />
                </p>
                {archiveSettings &&
                (archiveSettings.noEditArchiveCadence !== null ||
                  archiveSettings.noViewArchiveCadence !== null) ? (
                  <p className="ws-projects-subtitle">
                    {t("analytics.lists.archiveAutoArchiveNotice", {
                      rules:
                        archiveSettings.noEditArchiveCadence !== null &&
                        archiveSettings.noViewArchiveCadence !== null
                          ? t("analytics.lists.archiveAutoArchiveJoin", {
                              first: t(
                                "analytics.lists.archiveAutoArchiveNoEdits",
                                {
                                  days: archiveSettings.noEditArchiveCadence,
                                },
                              ),
                              second: t(
                                "analytics.lists.archiveAutoArchiveNoViews",
                                {
                                  days: archiveSettings.noViewArchiveCadence,
                                },
                              ),
                            })
                          : archiveSettings.noEditArchiveCadence !== null
                            ? t("analytics.lists.archiveAutoArchiveNoEdits", {
                                days: archiveSettings.noEditArchiveCadence,
                              })
                            : t("analytics.lists.archiveAutoArchiveNoViews", {
                                days: archiveSettings.noViewArchiveCadence ?? 0,
                              }),
                    })}
                  </p>
                ) : null}
              </>
            ) : listView === "trash" ? (
              <p className="ws-projects-subtitle">
                {t("analytics.lists.trashRetentionNotice", {
                  days: TRASH_RETENTION_DAYS,
                })}
              </p>
            ) : null}
          </div>
          {listView === "active" && onCreateProject && (
            <div className="ws-projects-header-actions">
              <div
                className={
                  onImportProject ? "ws-projects-split-button" : undefined
                }
              >
                <button
                  type="button"
                  className="ws-projects-primary"
                  data-project-action="new-project"
                  data-test="create-project"
                  disabled={createPending}
                  onClick={() =>
                    invokeCreateProject(onCreateProject, createPending)
                  }
                >
                  <IconPlus size={14} aria-hidden="true" />
                  {t("analytics.lists.createProject")}
                </button>
                {onImportProject ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="ws-projects-primary ws-projects-split-trigger"
                        data-test="new-project-dropdown"
                        aria-label={t("analytics.lists.createProjectActions")}
                        disabled={createPending}
                      >
                        <IconChevronDown size={14} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        data-test="import-project"
                        onSelect={() => onImportProject()}
                      >
                        <IconUpload size={14} aria-hidden="true" />
                        {t("commandPalette.importProject")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          )}
        </header>
      )}

      {trashedSkills}

      <div className="ws-projects-controls">
        <div className="ws-projects-filters">
          <button
            type="button"
            className="ws-projects-filter-button"
            aria-expanded={panelOpen}
            onClick={() => {
              if (panelOpen) resetFilters();
              setPanelOpen(!panelOpen);
              setMoreFiltersOpen(false);
            }}
          >
            <IconFilter size={14} aria-hidden="true" />
            Filter
          </button>

          {panelOpen ? (
            <div className="ws-projects-filter-panel">
              <label className="ws-projects-search-filter">
                <IconSearch size={14} aria-hidden="true" />
                <span className="ws-projects-search-label">Title</span>
                <input
                  type="search"
                  value={search}
                  placeholder="Project title"
                  aria-label="Title"
                  onChange={(event) => onSearchChange(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="ws-projects-chip"
                aria-pressed={filters.favoritedOnly}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    favoritedOnly: !current.favoritedOnly,
                  }))
                }
              >
                <IconStar size={13} aria-hidden="true" />
                Favorited
              </button>
              <button
                type="button"
                className="ws-projects-chip"
                aria-pressed={filters.createdByMe}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    createdByMe: !current.createdByMe,
                  }))
                }
              >
                Created by you
              </button>
              <button
                type="button"
                className="ws-projects-chip"
                aria-pressed={filters.workspaceAccess === true}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    workspaceAccess: !current.workspaceAccess,
                  }))
                }
              >
                Workspace access
              </button>
              <span className="ws-projects-more-wrap">
                <button
                  ref={moreFiltersTriggerRef}
                  type="button"
                  className="ws-projects-icon-button"
                  aria-label="More filters"
                  title="More filters"
                  aria-expanded={moreFiltersOpen}
                  onClick={() => setMoreFiltersOpen(!moreFiltersOpen)}
                >
                  <IconPlus size={14} aria-hidden="true" />
                </button>
                {moreFiltersOpen ? (
                  <div
                    className="ws-projects-popover ws-projects-more-menu"
                    role="menu"
                  >
                    <p className="ws-projects-menu-heading">More filters</p>
                    {filterOptions == null ||
                    (filterOptions.statuses.length === 0 &&
                      filterOptions.categories.length === 0 &&
                      (filterOptions.collections ?? []).length === 0) ? (
                      <p className="ws-projects-menu-note">
                        No statuses or categories in this workspace yet.
                      </p>
                    ) : null}
                    {filterOptions != null &&
                    filterOptions.statuses.length > 0 ? (
                      <>
                        <p className="ws-projects-menu-heading">Status</p>
                        {filterOptions.statuses.map((status) => (
                          <button
                            key={status.id}
                            type="button"
                            className="ws-projects-menu-item"
                            role="menuitemcheckbox"
                            aria-checked={(filters.statusIds ?? []).includes(
                              status.id,
                            )}
                            onClick={() =>
                              setFilters((current) => ({
                                ...current,
                                statusIds: toggleValue(
                                  current.statusIds ?? [],
                                  status.id,
                                ),
                              }))
                            }
                          >
                            <span className="ws-projects-menu-check">
                              {(filters.statusIds ?? []).includes(status.id)
                                ? "✓"
                                : ""}
                            </span>
                            <span className="ws-projects-menu-label">
                              {status.name}
                            </span>
                          </button>
                        ))}
                      </>
                    ) : null}
                    {(filterOptions?.collections ?? []).length > 0 ? (
                      <>
                        <p className="ws-projects-menu-heading">Collections</p>
                        {(filterOptions?.collections ?? []).map(
                          (collection) => (
                            <button
                              key={collection.id}
                              type="button"
                              className="ws-projects-menu-item"
                              role="menuitemcheckbox"
                              aria-checked={(
                                filters.collectionIds ?? []
                              ).includes(collection.id)}
                              onClick={() =>
                                setFilters((current) => ({
                                  ...current,
                                  collectionIds: toggleValue(
                                    current.collectionIds ?? [],
                                    collection.id,
                                  ),
                                }))
                              }
                            >
                              <span className="ws-projects-menu-check">
                                {(filters.collectionIds ?? []).includes(
                                  collection.id,
                                )
                                  ? "✓"
                                  : ""}
                              </span>
                              <span className="ws-projects-menu-label">
                                {collection.name}
                              </span>
                            </button>
                          ),
                        )}
                      </>
                    ) : null}
                    {filterOptions != null &&
                    filterOptions.categories.length > 0 ? (
                      <>
                        <p className="ws-projects-menu-heading">Categories</p>
                        {filterOptions.categories.map((category) => (
                          <button
                            key={category.id}
                            type="button"
                            className="ws-projects-menu-item"
                            role="menuitemcheckbox"
                            aria-checked={(filters.categoryIds ?? []).includes(
                              category.id,
                            )}
                            onClick={() =>
                              setFilters((current) => ({
                                ...current,
                                categoryIds: toggleValue(
                                  current.categoryIds ?? [],
                                  category.id,
                                ),
                              }))
                            }
                          >
                            <span className="ws-projects-menu-check">
                              {(filters.categoryIds ?? []).includes(category.id)
                                ? "✓"
                                : ""}
                            </span>
                            <span className="ws-projects-menu-label">
                              {category.name}
                            </span>
                          </button>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </span>
              {filtersApplied ? (
                <button
                  type="button"
                  className="ws-projects-reset"
                  onClick={resetFilters}
                >
                  Reset filter
                </button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="ws-projects-chip"
              onClick={() => {
                setPanelOpen(true);
                setFilters((current) => ({ ...current, createdByMe: true }));
              }}
            >
              Created by you
            </button>
          )}
        </div>

        <div className="ws-projects-control-actions">
          <div className="ws-projects-sort">
            <button
              ref={sortTriggerRef}
              type="button"
              className="ws-projects-sort-button"
              aria-label={`Sort by: ${SORT_LABELS[sort.option]}`}
              aria-expanded={sortOpen}
              onClick={() => setSortOpen(!sortOpen)}
            >
              <span>{SORT_LABELS[sort.option]}</span>
              <IconChevronDown size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ws-projects-icon-button"
              aria-label="Change sort direction"
              title="Change sort direction"
              onClick={() =>
                setSort((current) => ({
                  ...current,
                  direction: current.direction === "ASC" ? "DESC" : "ASC",
                }))
              }
            >
              {sort.direction === "ASC" ? (
                <IconArrowUp size={14} aria-hidden="true" />
              ) : (
                <IconArrowDown size={14} aria-hidden="true" />
              )}
            </button>
            {sortOpen ? (
              <SortMenu
                sort={sort}
                availableOptions={availableSortOptions}
                onSelect={chooseSort}
                onClose={() => setSortOpen(false)}
              />
            ) : null}
          </div>

          <span className="ws-projects-display-wrap">
            <button
              ref={displayTriggerRef}
              type="button"
              className="ws-projects-icon-button"
              aria-label="Display settings"
              title="Display settings"
              aria-expanded={displayOpen}
              onClick={() => setDisplayOpen(!displayOpen)}
            >
              <IconSettings size={15} aria-hidden="true" />
            </button>
            {displayOpen ? (
              <DisplayMenu
                columns={columnOrder}
                hidden={hidden}
                unavailable={unavailableColumns}
                showColumns={layout === "list"}
                viewCountDuration={viewCountDuration}
                onViewCountDurationChange={setViewCountDuration}
                onToggle={toggleColumn}
                onToggleAll={toggleAllColumns}
                onReset={() => setHidden(new Set(DEFAULT_HIDDEN_COLUMNS))}
              />
            ) : null}
          </span>

          <span
            className="ws-projects-layout-toggle"
            role="group"
            aria-label="Layout"
          >
            <button
              type="button"
              className={`ws-projects-icon-button${layout === "list" ? " is-active" : ""}`}
              aria-label="Switch to table view"
              title="Switch to table view"
              aria-pressed={layout === "list"}
              onClick={() => setLayout("list")}
            >
              <IconList size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`ws-projects-icon-button${layout === "card" ? " is-active" : ""}`}
              aria-label="Switch to card view"
              title="Switch to card view"
              aria-pressed={layout === "card"}
              onClick={() => setLayout("card")}
            >
              <IconLayoutGrid size={15} aria-hidden="true" />
            </button>
          </span>
        </div>
      </div>

      {selectedRows.length > 0 ? (
        <div className="ws-projects-selection-bar" role="toolbar">
          <span aria-live="polite">
            {t("analytics.lists.selectedCount", {
              count: selectedRows.length,
            })}
          </span>
          {bulkActions.map((action) =>
            action.handler == null ? null : (
              <button
                key={action.id}
                type="button"
                className="ws-projects-secondary"
                disabled={bulkPending}
                onClick={() =>
                  action.id === "removeFromCollection"
                    ? setBulkRemoveOpen(true)
                    : action.confirm
                      ? setBulkDeleteOpen(true)
                      : void runBulk(action)
                }
              >
                {action.label}
              </button>
            ),
          )}
          <button
            type="button"
            className="ws-projects-secondary"
            onClick={() => toggleAllSelected(false)}
          >
            {t("analytics.lists.deselectAll")}
          </button>
        </div>
      ) : null}

      <div className="ws-projects-table-scroll">
        {layout === "list" ? (
          <table className="ws-projects-table" style={{ width: tableWidth }}>
            <colgroup>
              <col style={{ width: `${SELECT_COLUMN_WIDTH}px` }} />
              {visibleColumns.map((column) => (
                <col
                  key={column}
                  style={{ width: `${columnWidth(column)}px` }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="ws-projects-select-cell">
                  <Checkbox
                    aria-label={t("analytics.lists.selectAllRows")}
                    checked={allSelected}
                    disabled={rows.length === 0}
                    onCheckedChange={(checked) =>
                      toggleAllSelected(checked === true)
                    }
                  />
                </th>
                {visibleColumns.map((column) => {
                  const sortOption = SORTABLE_COLUMNS[column];
                  const sorted =
                    sortOption != null && sort.option === sortOption;
                  return (
                    <th
                      key={column}
                      scope="col"
                      aria-sort={
                        sorted
                          ? sort.direction === "ASC"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      {sortOption == null ? (
                        <span className="ws-projects-header-text">
                          {COLUMN_HEADERS[column]}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="ws-projects-header-button"
                          onClick={() => toggleHeaderSort(sortOption)}
                        >
                          <span>{COLUMN_HEADERS[column]}</span>
                          {sorted ? (
                            sort.direction === "ASC" ? (
                              <IconArrowUp size={12} aria-hidden="true" />
                            ) : (
                              <IconArrowDown size={12} aria-hidden="true" />
                            )
                          ) : null}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {status === "ready" && rows.length > 0
                ? rows.map((project) => (
                    <tr key={project.id} data-project-id={project.id}>
                      <td className="ws-projects-select-cell">
                        <Checkbox
                          aria-label={t("analytics.lists.selectRow", {
                            name:
                              project.title.trim() === ""
                                ? "Untitled project"
                                : project.title,
                          })}
                          checked={selectedIds.has(project.id)}
                          onCheckedChange={(checked) =>
                            toggleRowSelected(project.id, checked === true)
                          }
                        />
                      </td>
                      {visibleColumns.map((column) => (
                        <td key={column}>
                          {column === "name" ? (
                            <ProjectNameCell
                              project={project}
                              onTransfer={() => setTransferProject(project)}
                              onStatus={() => setStatusProject(project)}
                              onCategories={() => setCategoriesProject(project)}
                              onTrash={() => setTrashTarget(project)}
                              onDuplicate={
                                onDuplicateProject &&
                                (() => void onDuplicateProject(project.id))
                              }
                              onRename={
                                onRenameProject &&
                                (() => setRenameTarget(project))
                              }
                              onRestore={() =>
                                void onRestoreProject?.(project.id)
                              }
                              onDelete={() => setDeleteTarget(project)}
                              onArchive={() => setArchiveTarget(project)}
                              onUnarchive={() =>
                                void onUnarchiveProject?.(project.id)
                              }
                              onFavorite={onToggleFavorite}
                              listMode={listView}
                              onClearOutputs={
                                onClearOutputs == null
                                  ? undefined
                                  : () => void onClearOutputs(project.id)
                              }
                              onAddToCollection={
                                onToggleProjectCollection == null ||
                                ((collections ?? []).length === 0 &&
                                  !collectionsLoading &&
                                  !collectionsLoadError)
                                  ? undefined
                                  : () => setCollectionTarget(project)
                              }
                              onRemoveFromCollection={
                                onRemoveFromCollection == null
                                  ? undefined
                                  : () => setRemoveTarget(project)
                              }
                            />
                          ) : (
                            cell(
                              project,
                              column,
                              currentUser,
                              t,
                              now,
                              categoriesByProject.get(project.id) ?? [],
                              project.statusId == null
                                ? undefined
                                : statusById.get(project.statusId),
                              collectionsByProject.get(project.id) ?? [],
                              locale,
                              listView === "active" && column === "status"
                                ? () => setStatusProject(project)
                                : undefined,
                              viewCountDuration,
                            )
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        ) : (
          <div className="ws-projects-card-grid">
            {status === "ready" && rows.length > 0
              ? rows.map((project) => (
                  <article
                    className="ws-projects-card"
                    data-project-id={project.id}
                    key={project.id}
                  >
                    <ProjectNameCell
                      project={project}
                      onTransfer={() => setTransferProject(project)}
                      onStatus={() => setStatusProject(project)}
                      onCategories={() => setCategoriesProject(project)}
                      onTrash={() => setTrashTarget(project)}
                      onDuplicate={
                        onDuplicateProject &&
                        (() => void onDuplicateProject(project.id))
                      }
                      onRename={
                        onRenameProject && (() => setRenameTarget(project))
                      }
                      onRestore={() => void onRestoreProject?.(project.id)}
                      onDelete={() => setDeleteTarget(project)}
                      onArchive={() => setArchiveTarget(project)}
                      onUnarchive={() => void onUnarchiveProject?.(project.id)}
                      onFavorite={onToggleFavorite}
                      listMode={listView}
                      onClearOutputs={
                        onClearOutputs == null
                          ? undefined
                          : () => void onClearOutputs(project.id)
                      }
                      onAddToCollection={
                        onToggleProjectCollection == null ||
                        ((collections ?? []).length === 0 &&
                          !collectionsLoading &&
                          !collectionsLoadError)
                          ? undefined
                          : () => setCollectionTarget(project)
                      }
                      onRemoveFromCollection={
                        onRemoveFromCollection == null
                          ? undefined
                          : () => setRemoveTarget(project)
                      }
                    />
                    {project.description.trim().length > 0 ? (
                      <p className="ws-projects-card-description">
                        {project.description}
                      </p>
                    ) : null}
                    <span className="ws-projects-card-meta">
                      Updated {tableDate(project.updatedAt, now, locale)}
                    </span>
                  </article>
                ))
              : null}
          </div>
        )}

        {status === "loading" ? (
          <div className="ws-projects-state" role="status" aria-live="polite">
            <span
              className="ws-projects-spinner"
              aria-label="Loading projects"
            />
          </div>
        ) : null}

        {status === "error" ? (
          <div className="ws-projects-state" role="alert">
            <IconAlertTriangle
              className="ws-projects-state-icon"
              size={28}
              aria-hidden="true"
            />
            <h2 className="ws-projects-state-title">
              {embedded
                ? "Error loading collection projects"
                : "Error loading projects"}
            </h2>
            {errorMessage ? (
              <p className="ws-projects-state-detail">{errorMessage}</p>
            ) : null}
            {onRetry ? (
              <button
                type="button"
                className="ws-projects-primary"
                onClick={onRetry}
              >
                {t("error.retry")}
              </button>
            ) : null}
          </div>
        ) : null}

        {status === "ready" &&
        rows.length === 0 &&
        !(listView === "trash" && hasTrashedSkills && !filtersApplied) ? (
          <div className="ws-projects-state" aria-live="polite">
            {filtersApplied ? (
              <>
                <IconSearch
                  className="ws-projects-state-icon"
                  size={28}
                  aria-hidden="true"
                />
                <h2 className="ws-projects-state-title">
                  {listView === "trash"
                    ? "No projects or components match that filter"
                    : "No projects match that filter"}
                </h2>
                <button
                  type="button"
                  className="ws-projects-primary"
                  onClick={resetFilters}
                >
                  Clear all filters
                </button>
              </>
            ) : (
              <>
                <IconFileText
                  className="ws-projects-state-icon"
                  size={28}
                  aria-hidden="true"
                />
                <h2 className="ws-projects-state-title">
                  {embedded
                    ? "You don't have anything in this collection yet"
                    : listView === "archive"
                      ? "No archived projects"
                      : listView === "trash"
                        ? "No projects or components in trash"
                        : "No projects yet"}
                </h2>
                {embedded ? (
                  <>
                    <p className="ws-projects-state-description">
                      Add projects or components to this collection to help
                      organize the files you care about and find them quickly
                    </p>
                    {onAddToCollection != null &&
                    onNewProjectInCollection != null ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="ws-projects-primary"
                            data-test="add-to-collection"
                          >
                            Add to collection
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem
                            data-test="collection-new-project"
                            onSelect={() => onNewProjectInCollection()}
                          >
                            New project
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            data-test="collection-existing-project"
                            onSelect={() => onAddToCollection()}
                          >
                            Existing project
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : onAddToCollection != null ? (
                      <button
                        type="button"
                        className="ws-projects-primary"
                        onClick={onAddToCollection}
                      >
                        Add to collection
                      </button>
                    ) : null}
                  </>
                ) : listView === "archive" && canConfigureAutoArchive ? (
                  <p className="ws-projects-state-description">
                    {t("analytics.lists.archiveEmptyDescriptionBefore")}
                    <a
                      href={`${appBasePath()}/settings/organization#settings-organization-auto-archive`}
                      className="underline hover:text-foreground"
                      onClick={(event) => {
                        if (
                          onOpenArchiveSettings &&
                          event.button === 0 &&
                          !event.metaKey &&
                          !event.ctrlKey &&
                          !event.shiftKey &&
                          !event.altKey
                        ) {
                          event.preventDefault();
                          onOpenArchiveSettings();
                        }
                      }}
                    >
                      {t("analytics.lists.archiveEmptySettingsLink")}
                    </a>
                    {t("analytics.lists.archiveEmptyDescriptionAfter")}
                  </p>
                ) : listView === "active" ? (
                  <p className="ws-projects-state-description">
                    A Project is the central organizational unit. It includes
                    the Notebook view and App builder view, as well as the
                    associated published App.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {renameTarget != null && onRenameProject != null ? (
        <RenameProjectDialog
          project={renameTarget}
          onRename={onRenameProject}
          onClose={() => setRenameTarget(null)}
        />
      ) : null}
      {statusProject != null ? (
        <ProjectStatusDialog
          project={statusProject}
          onClose={() => setStatusProject(null)}
        />
      ) : null}
      {collectionTarget != null && onToggleProjectCollection != null ? (
        <ProjectCollectionsPickerDialog
          projectTitle={collectionTarget.title}
          collections={collections ?? []}
          filedIds={(collectionsByProject.get(collectionTarget.id) ?? []).map(
            (collection) => collection.id,
          )}
          loading={collectionsLoading}
          loadError={collectionsLoadError}
          {...(onRetryCollections ? { onRetry: onRetryCollections } : {})}
          onClose={() => setCollectionTarget(null)}
          onToggle={(collectionId, add) =>
            onToggleProjectCollection(collectionTarget.id, collectionId, add)
          }
          staged
        />
      ) : null}
      {bulkRemoveOpen && onRemoveFromCollection != null ? (
        <RemoveFromCollectionDialog
          count={selectedRows.length}
          silent
          onClose={() => setBulkRemoveOpen(false)}
          onConfirm={async () => {
            const action = bulkActions.find(
              (item) => item.id === "removeFromCollection",
            );
            if (action != null) await runBulk(action);
          }}
        />
      ) : null}
      {removeTarget != null && onRemoveFromCollection != null ? (
        <RemoveFromCollectionDialog
          onClose={() => setRemoveTarget(null)}
          onConfirm={() => onRemoveFromCollection(removeTarget.id)}
        />
      ) : null}
      {archiveTarget != null ? (
        <ArchiveProjectDialog
          pending={archivePending}
          error={archiveError}
          onCancel={() => {
            setArchiveTarget(null);
            setArchiveError(null);
          }}
          onConfirm={() => void moveToArchive()}
        />
      ) : null}
      {bulkDeleteOpen ? (
        <DeleteProjectDialog
          count={selectedRows.length}
          pending={bulkPending}
          error={null}
          onCancel={() => setBulkDeleteOpen(false)}
          onConfirm={() => {
            const action = bulkActions.find((item) => item.confirm);
            if (action != null) void runBulk(action);
          }}
        />
      ) : null}
      {deleteTarget != null ? (
        <DeleteProjectDialog
          pending={deletePending}
          error={deleteError}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={() => void deleteForever()}
        />
      ) : null}
      {trashTarget != null ? (
        <TrashProjectDialog
          projectTitle={
            trashTarget.title.trim() === ""
              ? "Untitled project"
              : trashTarget.title
          }
          pending={trashPending}
          error={trashError}
          onCancel={() => {
            setTrashTarget(null);
            setTrashError(null);
          }}
          onConfirm={() => void moveToTrash()}
        />
      ) : null}
      {categoriesProject != null ? (
        <ProjectCategoriesDialog
          project={categoriesProject}
          onClose={() => setCategoriesProject(null)}
        />
      ) : null}
      {transferProject != null ? (
        <TransferProjectOwnerDialog
          project={transferProject}
          onClose={() => setTransferProject(null)}
        />
      ) : null}
    </div>
  );
}
