import type {
  ContentDatabaseItem,
  ContentDatabaseItemLayout,
  DocumentProperty,
} from "@shared/api";
import type {
  ContentDatabaseItemLayoutSlot,
  ResolvedContentDatabaseItemLayout,
} from "@shared/database-item-layout";
import { stripMarkdownForPreview } from "@shared/og-description";
import {
  isEmptyPropertyValue,
  type DocumentPropertyOptionColor,
} from "@shared/properties";
import { IconCheck } from "@tabler/icons-react";
import type { ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { displayValue, PropertyValuePopover } from "../DocumentProperties";
import { DatabaseItemPageIcon, dbText } from "./DatabaseView";
import {
  ListItemLayoutSlotEditor,
  listItemLayoutSlotLabel,
} from "./ListItemLayout";

export interface ListItemRowLayout {
  /** The layout being edited: the saved one or the default rows' equivalent. */
  layout: ContentDatabaseItemLayout;
  resolved: ResolvedContentDatabaseItemLayout<DocumentProperty>;
  properties: DocumentProperty[];
  editing: boolean;
  onLayoutChange: (layout: ContentDatabaseItemLayout) => void;
  onToggleCheckbox: (
    item: ContentDatabaseItem,
    property: DocumentProperty,
  ) => void;
}

const STATUS_DOT_CLASSES: Record<DocumentPropertyOptionColor, string> = {
  gray: "border-muted-foreground/50 bg-muted-foreground/10 dark:border-muted-foreground dark:bg-muted-foreground/20",
  brown: "border-amber-700 bg-amber-700/25",
  orange: "border-orange-500 bg-orange-500/25",
  yellow: "border-yellow-500 bg-yellow-500/30",
  green: "border-emerald-500 bg-emerald-500",
  blue: "border-sky-500 bg-sky-500/30",
  purple: "border-violet-500 bg-violet-500/30",
  pink: "border-pink-500 bg-pink-500/30",
  red: "border-rose-500 bg-rose-500/30",
};

const LINE_CLAMP_CLASSES = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
} as const;

const TITLE_WEIGHT_CLASSES = {
  regular: "font-normal",
  medium: "font-medium",
  bold: "font-semibold",
} as const;

function itemValue(item: ContentDatabaseItem, property: DocumentProperty) {
  return (
    item.properties.find(
      (candidate) => candidate.definition.id === property.definition.id,
    ) ?? { ...property, value: null }
  );
}

/** Values a row leaves out entirely, so empty slots take no space. */
function isBlankValue(property: DocumentProperty) {
  return (
    isEmptyPropertyValue(property.value) ||
    (property.definition.type === "checkbox" && property.value !== true)
  );
}

function line2Text(property: DocumentProperty) {
  const value = property.value;
  if (typeof value !== "string") return "";
  return property.definition.type === "blocks"
    ? stripMarkdownForPreview(value)
    : value.trim();
}

function SlotZone({
  slot,
  row,
  showPlaceholder,
  empty,
  className,
  children,
}: {
  slot: ContentDatabaseItemLayoutSlot;
  row: ListItemRowLayout;
  showPlaceholder: boolean;
  empty: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!row.editing) return empty ? null : <>{children}</>;
  if (empty && !showPlaceholder) return null;
  const label = listItemLayoutSlotLabel(slot);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={dbText(empty ? "listRowsAddSlot" : "listRowsChangeSlot", {
            slot: label,
          })}
          className={cn(
            "rounded-md border border-dashed border-database-blue/50 text-left transition-colors hover:border-database-blue hover:bg-database-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-database-blue data-[state=open]:bg-database-blue/10",
            empty ? "px-2 py-0.5 text-xs text-database-blue/80" : "px-1 py-0.5",
            className,
          )}
        >
          {empty ? `+ ${label}` : children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          {label}
        </div>
        <ListItemLayoutSlotEditor
          slot={slot}
          layout={row.layout}
          properties={row.properties}
          onChange={row.onLayoutChange}
        />
      </PopoverContent>
    </Popover>
  );
}

function MetaValues({ values }: { values: DocumentProperty[] }) {
  return values.map((property) => (
    <span
      key={property.definition.id}
      className="inline-flex max-w-48 min-w-0 items-center truncate"
    >
      {displayValue(property)}
    </span>
  ));
}

/** A list row whose parts follow the view's item layout. */
export function DatabaseLayoutListRow({
  row,
  isFirst,
  item,
  databaseDocumentId,
  canEdit,
  onPreview,
  actions,
}: {
  row: ListItemRowLayout;
  isFirst: boolean;
  item: ContentDatabaseItem;
  databaseDocumentId: string;
  canEdit: boolean;
  onPreview: () => void;
  actions: ReactNode;
}) {
  const { resolved, editing } = row;
  const title = item.document.title || "Untitled";
  const leadingProperty = resolved.leading.property
    ? itemValue(item, resolved.leading.property)
    : null;
  const checked =
    resolved.leading.kind === "checkbox" && leadingProperty?.value === true;
  const interactive = canEdit && !editing && leadingProperty?.editable === true;

  let leading: ReactNode = null;
  if (resolved.leading.kind === "page_icon") {
    leading = (
      <DatabaseItemPageIcon
        document={item.document}
        className="size-4 text-sm"
        fallbackClassName="size-4"
      />
    );
  } else if (resolved.leading.kind === "checkbox" && leadingProperty) {
    leading = (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`${leadingProperty.definition.name}: ${title}`}
        disabled={!interactive}
        className={cn(
          "flex size-4 items-center justify-center rounded border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
          checked
            ? "border-database-blue bg-database-blue text-database-blue-foreground"
            : "border-muted-foreground/60 enabled:hover:border-foreground",
        )}
        onClick={() => row.onToggleCheckbox(item, leadingProperty)}
      >
        {checked ? <IconCheck className="size-3" stroke={3} /> : null}
      </button>
    );
  } else if (resolved.leading.kind === "status" && leadingProperty) {
    const option = (leadingProperty.definition.options.options ?? []).find(
      (candidate) => candidate.id === leadingProperty.value,
    );
    const dot = (
      <span
        title={option?.name ?? dbText("listRowsNoStatus")}
        className={cn(
          "block size-3.5 shrink-0 rounded-full border-2",
          option
            ? STATUS_DOT_CLASSES[option.color]
            : "border-dashed border-muted-foreground/60",
        )}
      />
    );
    leading = interactive ? (
      <span className="flex w-6 justify-center">
        <PropertyValuePopover
          property={leadingProperty}
          documentId={item.document.id}
          databaseDocumentId={databaseDocumentId}
        >
          {dot}
        </PropertyValuePopover>
      </span>
    ) : (
      dot
    );
  }

  const line2Property = resolved.line2.property
    ? itemValue(item, resolved.line2.property)
    : null;
  const line2 = line2Property ? line2Text(line2Property) : "";
  const filled = (properties: DocumentProperty[]) =>
    properties
      .map((property) => itemValue(item, property))
      .filter((property) => !isBlankValue(property));
  const line3 = filled(resolved.line3);
  const trailing = filled(resolved.trailing);

  const body = (
    <>
      <SlotZone
        slot="title"
        row={row}
        showPlaceholder={false}
        empty={false}
        className="block max-w-full"
      >
        <span
          className={cn(
            "block min-w-0 truncate text-sm",
            TITLE_WEIGHT_CLASSES[resolved.titleWeight],
            checked &&
              "text-muted-foreground line-through decoration-muted-foreground/70",
          )}
        >
          {title}
        </span>
      </SlotZone>
      <SlotZone
        slot="line2"
        row={row}
        showPlaceholder={isFirst}
        empty={!line2}
        className="mt-0.5 block w-full"
      >
        <span
          className={cn(
            "text-xs leading-relaxed whitespace-pre-line text-muted-foreground",
            LINE_CLAMP_CLASSES[resolved.line2.lines],
          )}
        >
          {line2}
        </span>
      </SlotZone>
      <SlotZone
        slot="line3"
        row={row}
        showPlaceholder={isFirst}
        empty={line3.length === 0}
        className="mt-1 inline-flex max-w-full"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <MetaValues values={line3} />
        </span>
      </SlotZone>
      {trailing.length > 0 && !editing ? (
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden">
          <MetaValues values={trailing} />
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "group flex min-h-10 items-start gap-2 border-t border-border px-1 py-1.5",
        !editing && "hover:bg-muted/40",
      )}
    >
      <SlotZone
        slot="leading"
        row={row}
        showPlaceholder={isFirst}
        empty={!leading}
        className="mt-1 shrink-0"
      >
        <span className="flex min-w-5 h-5 items-center justify-center">
          {leading}
        </span>
      </SlotZone>
      {editing ? (
        <div className="min-w-0 flex-1 px-1.5 py-0.5">{body}</div>
      ) : (
        <button
          type="button"
          className="block min-w-0 flex-1 rounded px-1.5 py-0.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onPreview}
        >
          {body}
        </button>
      )}
      <SlotZone
        slot="trailing"
        row={row}
        showPlaceholder={isFirst}
        empty={trailing.length === 0}
        className="mt-0.5 hidden shrink-0 sm:inline-flex"
      >
        <span className="mt-1 hidden max-w-xs min-w-0 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground sm:flex">
          <MetaValues values={trailing} />
        </span>
      </SlotZone>
      {editing ? null : actions}
    </div>
  );
}
