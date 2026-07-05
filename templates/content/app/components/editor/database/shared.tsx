import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import type {
  ContentDatabaseItem,
  ContentDatabaseViewType,
  Document,
  DocumentProperty,
  DocumentPropertyOption,
  DocumentPropertyType,
} from "@shared/api";
import {
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconExternalLink,
  IconFileText,
  IconFilter,
  IconLayoutGrid,
  IconLayoutKanban,
  IconList,
  IconMinus,
  IconSearch,
  IconTable,
  IconTimeline,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
// i18n-raw-literal-disable-file -- unused shared helper copy; live database editor owns localized UI.
// Shared UI primitives used by multiple database view modules.
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { useDuplicateDatabaseItem } from "@/hooks/use-content-database";
import { useDeleteDocument } from "@/hooks/use-documents";
import { cn } from "@/lib/utils";

import { OPTION_COLOR_CLASSES, TYPE_ICONS } from "../DocumentProperties";
import { databaseDuplicatedItemFromResponse } from "./navigation-state";
import type { DatabaseBoardGroup, DatabaseDropSide } from "./types";

// ---------------------------------------------------------------------------
// View icon (returns the React component constructor for a view type)
// ---------------------------------------------------------------------------

export function databaseViewIcon(type: ContentDatabaseViewType) {
  if (type === "board") return IconLayoutKanban;
  if (type === "list") return IconList;
  if (type === "gallery") return IconLayoutGrid;
  if (type === "calendar") return IconCalendar;
  if (type === "timeline") return IconTimeline;
  return IconTable;
}

// ---------------------------------------------------------------------------
// Drag preview / drop indicator
// ---------------------------------------------------------------------------

export type DatabaseDragPreviewState =
  | {
      kind: "view";
      label: string;
      type: ContentDatabaseViewType;
      x: number;
      y: number;
      width: number;
    }
  | {
      kind: "property";
      label: string;
      type: DocumentPropertyType;
      x: number;
      y: number;
      width: number;
    };

export function DatabaseDragPreview({
  preview,
}: {
  preview: DatabaseDragPreviewState | null;
}) {
  if (!preview) return null;

  const Icon =
    preview.kind === "view"
      ? databaseViewIcon(preview.type)
      : TYPE_ICONS[preview.type];

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed left-0 top-0 z-[9999] flex max-w-56 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-background/95 px-2 text-sm shadow-lg",
        preview.kind === "view" ? "h-7 font-medium" : "h-8 text-xs",
      )}
      style={{
        width: preview.width,
        transform: `translate3d(${preview.x + 12}px, ${preview.y + 10}px, 0)`,
      }}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{preview.label}</span>
    </div>
  );
}

export function DatabaseDropIndicator({
  side,
}: {
  side: DatabaseDropSide | null;
}) {
  if (!side) return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute bottom-1 top-1 z-20 w-[3px] rounded-full",
        side === "before" ? "-left-0.5" : "-right-0.5",
      )}
      style={{
        background: "hsl(210 100% 52%)",
        boxShadow: "0 0 0 1px hsl(var(--background))",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Page icon
// ---------------------------------------------------------------------------

export function databaseItemPageIconText(
  document: Pick<Document, "icon"> | null | undefined,
) {
  const icon = document?.icon?.trim();
  return icon ? icon : null;
}

export function DatabaseItemPageIcon({
  document,
  className,
  fallbackClassName,
}: {
  document: Pick<Document, "icon">;
  className?: string;
  fallbackClassName?: string;
}) {
  const icon = databaseItemPageIconText(document);
  if (icon) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center leading-none",
          className,
        )}
      >
        {icon}
      </span>
    );
  }

  return (
    <IconFileText
      className={cn("shrink-0 text-muted-foreground", fallbackClassName)}
    />
  );
}

// ---------------------------------------------------------------------------
// Group header (used by table, list, gallery grouped sections)
// ---------------------------------------------------------------------------

export function DatabaseGroupHeader({
  group,
  collapsed,
  onCollapsedChange,
}: {
  group: DatabaseBoardGroup;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-9 w-full items-center gap-2 border-t border-border bg-muted/30 px-2 text-left text-xs text-muted-foreground hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={!collapsed}
      onClick={() => onCollapsedChange(!collapsed)}
    >
      <IconChevronRight
        className={cn(
          "size-3.5 shrink-0 transition-transform",
          !collapsed && "rotate-90",
        )}
      />
      <span className="min-w-0 truncate font-medium text-foreground">
        {group.label}
      </span>
      <span className="rounded bg-background px-1.5 py-0.5 text-[11px]">
        {group.items.length}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Row selection control
// ---------------------------------------------------------------------------

export function DatabaseRowSelectionControl({
  checked,
  indeterminate = false,
  disabled = false,
  quietUntilHover = false,
  label,
  onToggle,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  quietUntilHover?: boolean;
  label: string;
  onToggle: () => void;
}) {
  const quiet = quietUntilHover && !checked && !indeterminate;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
        (checked || indeterminate) && "text-foreground",
        quiet &&
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-hover/name:opacity-100 group-focus-within/name:opacity-100",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 items-center justify-center rounded border",
          checked || indeterminate
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40 bg-background text-transparent",
        )}
      >
        {indeterminate ? (
          <IconMinus className="size-3" />
        ) : checked ? (
          <IconCheck className="size-3" />
        ) : null}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bulk option pill
// ---------------------------------------------------------------------------

export function DatabaseBulkOptionPill({
  option,
}: {
  option: DocumentPropertyOption;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-xs font-medium",
        OPTION_COLOR_CLASSES[option.color],
      )}
    >
      <span className="truncate">{option.name}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// DatabaseNoMatchingPages
// ---------------------------------------------------------------------------

export function DatabaseNoMatchingPages({
  label = "No pages match this view",
  className,
  onClear,
}: {
  label?: string;
  className?: string;
  onClear: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-20 items-center justify-between gap-3 px-4 py-4 text-sm text-muted-foreground",
        className,
      )}
    >
      <span>{label}</span>
      <button
        type="button"
        className="shrink-0 rounded px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onClear}
      >
        Clear filters
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DatabaseConstraintChip
// ---------------------------------------------------------------------------

export function DatabaseConstraintChip({
  icon,
  label,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="flex items-center gap-1 rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground">
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove: ${label}`}
        className="flex size-3.5 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onRemove}
      >
        <IconX className="size-3" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Property picker (shared by SortMenu, FilterMenu, settings panels)
// ---------------------------------------------------------------------------

export type DatabasePropertyPickerOption = {
  key: string;
  label: string;
  type: DocumentPropertyType | "name";
};

export function databasePropertyPickerItems(
  properties: DocumentProperty[],
  query: string,
  { includeName = true }: { includeName?: boolean } = {},
): DatabasePropertyPickerOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const items: DatabasePropertyPickerOption[] = [
    ...(includeName
      ? [{ key: "name", label: "Name", type: "name" as const }]
      : []),
    ...properties.map((property) => ({
      key: property.definition.id,
      label: property.definition.name,
      type: property.definition.type,
    })),
  ];

  if (!normalizedQuery) return items;
  return items.filter((item) =>
    [item.key, item.label, item.type].some((value) =>
      String(value).toLowerCase().includes(normalizedQuery),
    ),
  );
}

export function DatabasePropertyPickerSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-b border-border/70 p-1">
      <div className="flex h-8 items-center gap-2 rounded border border-input bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Search properties"
          aria-label="Search properties"
          className="h-6 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

export function DatabasePropertyPickerItem({
  item,
  selected,
  onSelect,
}: {
  item: DatabasePropertyPickerOption;
  selected: boolean;
  onSelect: (key: string, label: string) => void;
}) {
  const Icon = item.type === "name" ? IconFileText : TYPE_ICONS[item.type];
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onSelect(item.key, item.label);
      }}
    >
      <Icon className="mr-2 size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {selected ? <IconCheck className="size-4 text-muted-foreground" /> : null}
    </DropdownMenuItem>
  );
}

export function DatabasePropertyPickerSubContent({
  properties,
  selectedKey,
  includeName,
  onSelect,
}: {
  properties: DocumentProperty[];
  selectedKey: string;
  includeName?: boolean;
  onSelect: (key: string, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const items = databasePropertyPickerItems(properties, query, { includeName });

  return (
    <DropdownMenuSubContent className="max-h-80 w-64 overflow-auto">
      <DatabasePropertyPickerSearch value={query} onChange={setQuery} />
      {items.map((item) => (
        <DatabasePropertyPickerItem
          key={item.key}
          item={item}
          selected={selectedKey === item.key}
          onSelect={onSelect}
        />
      ))}
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          No properties found
        </div>
      ) : null}
    </DropdownMenuSubContent>
  );
}

// ---------------------------------------------------------------------------
// Toolbar button class helper
// ---------------------------------------------------------------------------

export function databaseToolbarIconButtonClass(active = false) {
  return cn(
    "h-7 w-7 p-0 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-45",
    active && "bg-muted text-foreground",
  );
}

// Suppress unused-import lint warning for IconFilter — it's re-exported via
// this module so callers can import it from one place.
export { IconFilter };

// ---------------------------------------------------------------------------
// Row actions cell (used by all 6 views)
// ---------------------------------------------------------------------------

export function RowActionsCell({
  item,
  databaseDocumentId,
  onPreviewItem,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  databaseDocumentId: string;
  onPreviewItem?: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem?: (item: ContentDatabaseItem) => boolean;
  onOpenPage: () => void;
}) {
  const queryClient = useQueryClient();
  const deleteDocument = useDeleteDocument();
  const duplicateItem = useDuplicateDatabaseItem(databaseDocumentId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const title = item.document.title || "Untitled";

  async function duplicateRow() {
    setMenuOpen(false);
    try {
      const response = await duplicateItem.mutateAsync({ itemId: item.id });
      const duplicatedItem = databaseDuplicatedItemFromResponse(response);
      if (duplicatedItem) onPreviewItem?.(duplicatedItem);
    } catch (err) {
      toast.error("Failed to duplicate row", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  async function deleteRow() {
    const previewMoved = onDeletedPreviewItem?.(item) ?? false;
    try {
      await deleteDocument.mutateAsync({ id: item.document.id });
      await queryClient.invalidateQueries({
        queryKey: [
          "action",
          "get-content-database",
          { documentId: databaseDocumentId },
        ],
      });
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-documents"],
      });
    } catch (err) {
      if (previewMoved) onPreviewItem?.(item);
      toast.error("Failed to delete row", {
        description:
          err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  return (
    <div className="flex items-center justify-center">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Row actions for ${title}`}
            className="flex size-7 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          >
            <IconDots className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              onOpenPage();
            }}
          >
            <IconExternalLink className="mr-2 size-4 text-muted-foreground" />
            Open page
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={duplicateItem.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void duplicateRow();
            }}
          >
            <IconCopy className="mr-2 size-4 text-muted-foreground" />
            Duplicate row
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              setConfirmDeleteOpen(true);
            }}
          >
            <IconTrash className="mr-2 size-4" />
            Delete row
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete row?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{title}&rdquo; and any sub-pages will be permanently
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteDocument.isPending}
              onClick={() => void deleteRow()}
            >
              {deleteDocument.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
