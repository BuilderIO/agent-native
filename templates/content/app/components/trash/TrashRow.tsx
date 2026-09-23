import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { ContentTrashItem } from "@shared/content-trash";
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconFileText,
} from "@tabler/icons-react";
import { type KeyboardEvent, type RefCallback } from "react";
import { Link, useNavigate } from "react-router";

import {
  ContentTableRowActionButton,
  ContentTableSelectionControl,
} from "@/components/editor/database/ContentTable";
import { DatabaseTableGrid } from "@/components/editor/database/DatabaseTableGrid";
import type {
  ContentTrashSort,
  ContentTrashSortDirection,
} from "@/hooks/use-content-trash";
import { cn } from "@/lib/utils";

export const TRASH_TABLE_COLUMNS = [
  "name",
  "createdBy",
  "updatedBy",
  "deletedBy",
  "deletedAt",
] as const;
export const TRASH_TABLE_PROPERTY_IDS = TRASH_TABLE_COLUMNS.filter(
  (column) => column !== "name",
);
export const TRASH_TABLE_WIDTHS: Record<string, number> = {
  name: 240,
  createdBy: 180,
  updatedBy: 180,
  deletedBy: 180,
  deletedAt: 150,
};
export const TRASH_TABLE_GUTTER_WIDTH = 44;
const TRASH_TABLE_MIN_USABLE_NAME_WIDTH = 160;
const TRASH_TABLE_WIDEST_METADATA_WIDTH = 180;

export function trashTableWidthsForViewport(viewportWidth?: number) {
  if (viewportWidth === undefined || viewportWidth >= 640)
    return TRASH_TABLE_WIDTHS;
  const availableNameWidth =
    viewportWidth -
    TRASH_TABLE_GUTTER_WIDTH -
    TRASH_TABLE_WIDEST_METADATA_WIDTH;
  return availableNameWidth >= TRASH_TABLE_MIN_USABLE_NAME_WIDTH
    ? { ...TRASH_TABLE_WIDTHS, name: availableNameWidth }
    : TRASH_TABLE_WIDTHS;
}

export function TrashTableHeader({
  checked,
  sort,
  direction,
  onSelectLoaded,
  onSort,
  widths = TRASH_TABLE_WIDTHS,
}: {
  checked: boolean | "indeterminate";
  sort: ContentTrashSort;
  direction: ContentTrashSortDirection;
  onSelectLoaded: () => void;
  onSort: (sort: ContentTrashSort) => void;
  widths?: Record<string, number>;
}) {
  const t = useT();
  const header = (label: string, field?: ContentTrashSort) =>
    field ? (
      <div
        role="columnheader"
        aria-sort={
          sort === field
            ? direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <button
          type="button"
          className="flex h-full w-full items-center gap-1 px-3 text-start font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onSort(field)}
        >
          <span className="truncate">{label}</span>
          {sort === field ? (
            <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>
          ) : null}
        </button>
      </div>
    ) : (
      <span
        role="columnheader"
        className="flex h-full items-center truncate px-3 font-medium"
      >
        {label}
      </span>
    );
  return (
    <DatabaseTableGrid
      role="row"
      className="grid h-9 min-w-max border-b text-xs text-muted-foreground"
      propertyIds={[...TRASH_TABLE_PROPERTY_IDS]}
      widths={widths}
      gutterWidth={TRASH_TABLE_GUTTER_WIDTH}
      selectionCell={
        <ContentTableSelectionControl
          checked={checked === true}
          indeterminate={checked === "indeterminate"}
          onToggle={onSelectLoaded}
          label={t("trash.selectLoaded")}
        />
      }
      nameCell={header(t("trash.name"), "name")}
      propertyCells={[
        header(t("trash.createdBy")),
        header(t("trash.updatedBy"), "updatedAt"),
        header(t("trash.deletedByColumn")),
        header(t("trash.deletedAtColumn"), "deletedAt"),
      ]}
      actions={<span aria-hidden="true" />}
    />
  );
}

export function TrashRow({
  item,
  selected,
  expanded,
  onSelect,
  onToggle,
  onOpen,
  focused,
  rowRef,
  onFocus,
  onKeyDown,
  nested = false,
  widths = TRASH_TABLE_WIDTHS,
}: {
  item: ContentTrashItem;
  selected: boolean;
  expanded: boolean;
  onSelect: (selected: boolean) => void;
  onToggle: () => void;
  onOpen: () => void;
  focused: boolean;
  rowRef: RefCallback<HTMLDivElement>;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  nested?: boolean;
  widths?: Record<string, number>;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { formatDate } = useFormatters();
  const title = item.title || t("sidebar.untitled");
  const location =
    item.parentTitle || item.spaceName || t("trash.unknownLocation");
  const actorCell = (id?: string | null, name?: string | null) => (
    <span className="flex h-full items-center truncate px-3 text-sm text-muted-foreground">
      {name || t(id ? "trash.knownActor" : "trash.unresolvedActor")}
    </span>
  );
  return (
    <div
      ref={rowRef}
      role="row"
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className="group group/trash-row min-w-max focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <DatabaseTableGrid
        className={cn(
          "grid min-h-12 min-w-max border-b hover:bg-muted/35 group-focus/trash-row:bg-muted/35 group-focus-within/trash-row:bg-muted/35",
          selected && "bg-muted/55",
        )}
        propertyIds={[...TRASH_TABLE_PROPERTY_IDS]}
        widths={widths}
        gutterWidth={TRASH_TABLE_GUTTER_WIDTH}
        selectionCell={
          <ContentTableSelectionControl
            checked={selected}
            onToggle={() => onSelect(!selected)}
            label={t("trash.selectPage", { title })}
          />
        }
        nameCell={
          <div
            className={cn(
              "flex h-full min-w-0 items-center gap-2 pe-3",
              nested && "ps-4",
            )}
          >
            <span className="relative flex size-7 shrink-0 items-center justify-center">
              {item.kind === "database" ? (
                <IconDatabase
                  data-trash-row-icon
                  size={17}
                  className={cn(
                    "text-muted-foreground transition-opacity",
                    item.hasAccessibleTrashedChildren &&
                      "opacity-0 lg:opacity-100 lg:group-hover/trash-row:opacity-0 lg:group-focus-within/trash-row:opacity-0",
                  )}
                />
              ) : (
                <IconFileText
                  data-trash-row-icon
                  size={17}
                  className={cn(
                    "text-muted-foreground transition-opacity",
                    item.hasAccessibleTrashedChildren &&
                      "opacity-0 lg:opacity-100 lg:group-hover/trash-row:opacity-0 lg:group-focus-within/trash-row:opacity-0",
                  )}
                />
              )}
              {item.hasAccessibleTrashedChildren ? (
                <button
                  type="button"
                  data-trash-row-expander
                  className="absolute inset-0 flex items-center justify-center rounded-md text-muted-foreground opacity-100 transition-opacity hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:opacity-0 lg:group-hover/trash-row:opacity-100 lg:group-focus-within/trash-row:opacity-100"
                  onClick={onToggle}
                  aria-label={t(expanded ? "trash.collapse" : "trash.expand", {
                    title,
                  })}
                >
                  {expanded ? (
                    <IconChevronDown size={15} />
                  ) : (
                    <IconChevronRight size={15} />
                  )}
                </button>
              ) : null}
            </span>
            <Link
              to={`/trash?preview=${encodeURIComponent(item.documentId)}`}
              onClick={onOpen}
              className="min-w-0 flex-1 py-1.5 focus-visible:outline-none"
            >
              <span className="block truncate text-sm font-medium">
                {title}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {location}
              </span>
            </Link>
          </div>
        }
        propertyCells={[
          actorCell(item.createdBy, item.createdByName),
          actorCell(item.updatedBy, item.updatedByName),
          actorCell(item.trashedBy, item.trashedByName),
          <time
            key="deletedAt"
            className="flex h-full items-center px-3 text-sm text-muted-foreground"
            dateTime={item.trashedAt}
            title={item.trashedAt}
          >
            {formatDate(new Date(item.trashedAt), { dateStyle: "medium" })}
          </time>,
        ]}
        actions={
          <div className="flex items-center justify-center">
            <ContentTableRowActionButton
              label={t("trash.preview")}
              onClick={(event) => {
                event.stopPropagation();
                void navigate(
                  `/trash?preview=${encodeURIComponent(item.documentId)}`,
                );
                onOpen();
              }}
            />
          </div>
        }
      />
    </div>
  );
}
