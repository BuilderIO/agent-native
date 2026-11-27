import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { ContentTrashItem } from "@shared/content-trash";
import {
  IconArrowBackUp,
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconEye,
  IconFileText,
  IconTrashX,
} from "@tabler/icons-react";
import {
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefCallback,
} from "react";
import { Link } from "react-router";

import {
  ContentTableRowActionButton,
  ContentTableSelectionControl,
} from "@/components/editor/database/ContentTable";
import { DatabaseTableGrid } from "@/components/editor/database/DatabaseTableGrid";
import {
  DEFAULT_NAME_COLUMN_WIDTH,
  DEFAULT_PROPERTY_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from "@/components/editor/database/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
export type TrashColumnId = (typeof TRASH_TABLE_COLUMNS)[number];
export type TrashColumnWidths = Record<TrashColumnId, number>;
export const TRASH_TABLE_PROPERTY_IDS = TRASH_TABLE_COLUMNS.filter(
  (column) => column !== "name",
);
export const TRASH_TABLE_WIDTHS: TrashColumnWidths = {
  name: DEFAULT_NAME_COLUMN_WIDTH,
  createdBy: DEFAULT_PROPERTY_COLUMN_WIDTH,
  updatedBy: DEFAULT_PROPERTY_COLUMN_WIDTH,
  deletedBy: DEFAULT_PROPERTY_COLUMN_WIDTH,
  deletedAt: DEFAULT_PROPERTY_COLUMN_WIDTH,
};
export const TRASH_TABLE_GUTTER_WIDTH = 44;
export const TRASH_TABLE_ACTION_WIDTH = 72;
const TRASH_TABLE_RESIZE_STEP = 16;

export function clampTrashColumnWidth(width: number) {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
}

export function trashTableWidths(
  widths: TrashColumnWidths,
  viewportWidth?: number,
): TrashColumnWidths {
  if (viewportWidth === undefined) return widths;
  const fixed = TRASH_TABLE_PROPERTY_IDS.reduce(
    (total, id) => total + widths[id],
    TRASH_TABLE_GUTTER_WIDTH + TRASH_TABLE_ACTION_WIDTH,
  );
  return {
    ...widths,
    name: Math.max(widths.name, Math.floor(viewportWidth - fixed)),
  };
}

export function TrashTableHeader({
  checked,
  sort,
  direction,
  onSelectLoaded,
  onSort,
  onResize,
  widths = TRASH_TABLE_WIDTHS,
}: {
  checked: boolean | "indeterminate";
  sort: ContentTrashSort;
  direction: ContentTrashSortDirection;
  onSelectLoaded: () => void;
  onSort: (sort: ContentTrashSort) => void;
  onResize?: (column: TrashColumnId, width: number) => void;
  widths?: TrashColumnWidths;
}) {
  const t = useT();
  const header = (
    label: string,
    field?: ContentTrashSort,
    column?: TrashColumnId,
  ) => (
    <div
      role="columnheader"
      aria-sort={
        field
          ? sort === field
            ? direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
          : undefined
      }
      className="group/header relative flex h-full min-w-0 items-center"
    >
      {field ? (
        <button
          type="button"
          className="flex h-full w-full min-w-0 items-center gap-1 px-3 text-start font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onSort(field)}
        >
          <span className="truncate">{label}</span>
          {sort === field ? (
            <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>
          ) : null}
        </button>
      ) : (
        <span className="truncate px-3 font-medium">{label}</span>
      )}
      {column && onResize ? (
        <TrashColumnResizeHandle
          label={t("trash.resizeColumn", { column: label })}
          width={widths[column]}
          onResize={(width) => onResize(column, width)}
        />
      ) : null}
    </div>
  );
  return (
    <DatabaseTableGrid
      role="row"
      className="sticky top-0 z-30 grid h-9 min-w-max border-b text-xs text-muted-foreground"
      propertyIds={[...TRASH_TABLE_PROPERTY_IDS]}
      widths={widths}
      gutterWidth={TRASH_TABLE_GUTTER_WIDTH}
      actionWidth={TRASH_TABLE_ACTION_WIDTH}
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
        header(t("trash.createdBy"), undefined, "createdBy"),
        header(t("trash.updatedBy"), "updatedAt", "updatedBy"),
        header(t("trash.deletedByColumn"), undefined, "deletedBy"),
        header(t("trash.deletedAtColumn"), "deletedAt", "deletedAt"),
      ]}
      actions={<span aria-hidden="true" />}
    />
  );
}

function TrashColumnResizeHandle({
  label,
  width,
  onResize,
}: {
  label: string;
  width: number;
  onResize: (width: number) => void;
}) {
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const direction =
      getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
    const body = globalThis.document.body;
    body.style.userSelect = "none";
    body.style.cursor = "col-resize";
    const move = (moveEvent: PointerEvent) =>
      onResize(
        clampTrashColumnWidth(width + (moveEvent.clientX - startX) * direction),
      );
    const stop = () => {
      body.style.userSelect = "";
      body.style.cursor = "";
      globalThis.document.removeEventListener("pointermove", move);
      globalThis.document.removeEventListener("pointerup", stop);
    };
    globalThis.document.addEventListener("pointermove", move);
    globalThis.document.addEventListener("pointerup", stop);
  }
  return (
    <button
      type="button"
      aria-label={label}
      data-column-resize-handle=""
      className="absolute inset-y-0 -end-1 z-10 w-2 cursor-col-resize rounded-sm opacity-0 transition-opacity hover:bg-primary/60 hover:opacity-100 focus-visible:bg-primary/60 focus-visible:opacity-100 focus-visible:outline-none group-hover/header:opacity-60"
      onPointerDown={startDrag}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowRight"
            ? TRASH_TABLE_RESIZE_STEP
            : event.key === "ArrowLeft"
              ? -TRASH_TABLE_RESIZE_STEP
              : 0;
        if (!step) return;
        event.preventDefault();
        onResize(clampTrashColumnWidth(width + step));
      }}
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
  onRestore,
  onDelete,
  restoring = false,
  purgeable = true,
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
  onRestore: () => void;
  onDelete: (invoker: HTMLElement | null) => void;
  restoring?: boolean;
  purgeable?: boolean;
  focused: boolean;
  rowRef: RefCallback<HTMLDivElement>;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  nested?: boolean;
  widths?: TrashColumnWidths;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const deleteOnMenuCloseRef = useRef(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const title = item.title || t("sidebar.untitled");
  const previewHref = `/trash?preview=${encodeURIComponent(item.documentId)}`;
  const location =
    item.parentTitle || item.spaceName || t("trash.unknownLocation");
  // A person with no profile name shows as their email, as in the sidebar.
  const actorCell = (id?: string | null, name?: string | null) => (
    <span className="flex h-full items-center truncate px-3 text-sm text-muted-foreground">
      {name || id || t("trash.unresolvedActor")}
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
          "grid min-h-12 min-w-max border-b hover:bg-[color-mix(in_srgb,hsl(var(--muted))_35%,hsl(var(--background)))] group-focus/trash-row:bg-[color-mix(in_srgb,hsl(var(--muted))_35%,hsl(var(--background)))] group-focus-within/trash-row:bg-[color-mix(in_srgb,hsl(var(--muted))_35%,hsl(var(--background)))]",
          selected &&
            "bg-[color-mix(in_srgb,hsl(var(--muted))_55%,hsl(var(--background)))]",
        )}
        propertyIds={[...TRASH_TABLE_PROPERTY_IDS]}
        widths={widths}
        gutterWidth={TRASH_TABLE_GUTTER_WIDTH}
        actionWidth={TRASH_TABLE_ACTION_WIDTH}
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
              to={previewHref}
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
          <div className="flex items-center justify-end gap-0.5 pe-2">
            {item.canRestore ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-trash-row-restore
                    aria-label={t("trash.restore")}
                    disabled={restoring}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none group-hover:opacity-100 group-focus-within/trash-row:opacity-100 [@media(any-hover:none)]:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRestore();
                    }}
                  >
                    <IconArrowBackUp className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("trash.restore")}</TooltipContent>
              </Tooltip>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ContentTableRowActionButton
                  ref={menuTriggerRef}
                  label={t("trash.rowActions", { title })}
                  className="group-focus-within/trash-row:opacity-100"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-44"
                onCloseAutoFocus={(event) => {
                  if (!deleteOnMenuCloseRef.current) return;
                  deleteOnMenuCloseRef.current = false;
                  event.preventDefault();
                  onDelete(menuTriggerRef.current);
                }}
              >
                <DropdownMenuItem
                  disabled={!item.canRestore || restoring}
                  onSelect={onRestore}
                >
                  <IconArrowBackUp className="size-4" />
                  {t("trash.restore")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={previewHref} onClick={onOpen}>
                    <IconEye className="size-4" />
                    {t("trash.openPreview")}
                  </Link>
                </DropdownMenuItem>
                {purgeable ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!item.canPermanentlyDelete}
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      onSelect={() => {
                        deleteOnMenuCloseRef.current = true;
                      }}
                    >
                      <IconTrashX className="size-4" />
                      {t("trash.deletePermanently")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
    </div>
  );
}
