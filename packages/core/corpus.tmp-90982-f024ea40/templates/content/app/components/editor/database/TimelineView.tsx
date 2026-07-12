import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import type {
  ContentDatabaseItem,
  ContentDatabaseView,
  DocumentProperty,
} from "@shared/api";
import {
  IconArrowUp,
  IconCalendarDue,
  IconCalendarEvent,
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconTimeline,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { AddProperty, TYPE_ICONS, displayValue } from "../DocumentProperties";
import {
  DatabaseDateViewNoDateSection,
  DatabaseItemPageIcon,
  DatabaseNoMatchingPages,
  RowActionsCell,
  calendarDateKey,
  databaseCalendarDateProperties,
  databaseItemsWithoutDateValue,
  databaseTimelineDays,
  databaseTimelineEndDateProperty,
  databaseTimelineItemSpans,
  databaseTimelineRangeLabel,
  databaseViewHasNoMatchingPages,
  dbText,
  isDatabasePropertyVisibleInView,
  startOfMonth,
  type DatabaseFilter,
} from "./DatabaseView";

export function DatabaseTimelineView({
  activeView,
  properties,
  items,
  databaseDocumentId,
  canEdit,
  isLoading,
  isCreating,
  activeFilters,
  hasSearch,
  dateProperty,
  month,
  onClearResultConstraints,
  onMonthChange,
  onDatePropertyChange,
  onEndDatePropertyChange,
  onCreateCard,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  activeView: ContentDatabaseView;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  databaseDocumentId: string;
  canEdit: boolean;
  isLoading: boolean;
  isCreating: boolean;
  activeFilters: DatabaseFilter[];
  hasSearch: boolean;
  dateProperty: DocumentProperty | null;
  month: Date;
  onClearResultConstraints: () => void;
  onMonthChange: (month: Date) => void;
  onDatePropertyChange: (propertyId: string | null) => void;
  onEndDatePropertyChange: (propertyId: string | null) => void;
  onCreateCard: (
    dateKey: string,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  const dateProperties = databaseCalendarDateProperties(properties);
  const timelineDays = databaseTimelineDays(month);
  const endDateProperty = databaseTimelineEndDateProperty(
    activeView,
    properties,
    dateProperty?.definition.id ?? null,
  );
  const timelineSpans = databaseTimelineItemSpans(
    items,
    properties,
    dateProperty?.definition.id ?? null,
    endDateProperty?.definition.id ?? null,
    timelineDays,
  );
  const noDateItems = databaseItemsWithoutDateValue(
    items,
    properties,
    dateProperty?.definition.id ?? null,
  );
  const visibleProperties = properties
    .filter((property) =>
      isDatabasePropertyVisibleInView(property, items, activeView),
    )
    .filter(
      (property) =>
        property.definition.id !== dateProperty?.definition.id &&
        property.definition.id !== endDateProperty?.definition.id,
    );
  const canCreateOnDay =
    canEdit &&
    dateProperty?.editable &&
    dateProperty.definition.type === "date";
  const rangeLabel = databaseTimelineRangeLabel(timelineDays);

  function changeMonth(offset: number) {
    onMonthChange(
      startOfMonth(new Date(month.getFullYear(), month.getMonth() + offset)),
    );
  }

  return (
    <div className="border-b border-border">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-t border-border px-1 py-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <IconTimeline className="size-4 shrink-0" />
          <span className="truncate">{rangeLabel}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          {dateProperties.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-48 gap-1.5 px-2 text-xs text-muted-foreground"
                >
                  <IconCalendarDue className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {dateProperty?.definition.name ?? "Date"}
                  </span>
                  <IconChevronDown className="size-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {dbText("startDate")}
                </DropdownMenuLabel>
                {dateProperties.map((property) => {
                  const Icon = TYPE_ICONS[property.definition.type];
                  return (
                    <DropdownMenuItem
                      key={property.definition.id}
                      onSelect={(event) => {
                        event.preventDefault();
                        onDatePropertyChange(property.definition.id);
                      }}
                    >
                      <Icon className="mr-2 size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {property.definition.name}
                      </span>
                      {dateProperty?.definition.id ===
                      property.definition.id ? (
                        <IconCheck className="size-4 text-muted-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {dateProperties.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-48 gap-1.5 px-2 text-xs text-muted-foreground"
                >
                  <IconTimeline className="size-3.5 shrink-0" />
                  <span className="truncate">
                    End: {endDateProperty?.definition.name ?? "None"}
                  </span>
                  <IconChevronDown className="size-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {dbText("endDate")}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onEndDatePropertyChange(null);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {dbText("noEndDate")}
                  </span>
                  {!endDateProperty ? (
                    <IconCheck className="size-4 text-muted-foreground" />
                  ) : null}
                </DropdownMenuItem>
                {dateProperties
                  .filter(
                    (property) =>
                      property.definition.id !== dateProperty?.definition.id,
                  )
                  .map((property) => {
                    const Icon = TYPE_ICONS[property.definition.type];
                    return (
                      <DropdownMenuItem
                        key={property.definition.id}
                        onSelect={(event) => {
                          event.preventDefault();
                          onEndDatePropertyChange(property.definition.id);
                        }}
                      >
                        <Icon className="mr-2 size-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {property.definition.name}
                        </span>
                        {endDateProperty?.definition.id ===
                        property.definition.id ? (
                          <IconCheck className="size-4 text-muted-foreground" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onMonthChange(startOfMonth(new Date()))}
          >
            <IconCalendarEvent className="mr-1 size-3.5" />
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={dbText("previousTimelineRange")}
            onClick={() => changeMonth(-1)}
          >
            <IconArrowUp className="size-3.5 -rotate-90" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={dbText("nextTimelineRange")}
            onClick={() => changeMonth(1)}
          >
            <IconArrowUp className="size-3.5 rotate-90" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {dbText("loadingTimeline")}
        </div>
      ) : dateProperties.length === 0 ? (
        <div className="flex min-h-24 items-center justify-between gap-3 px-2 py-4 text-sm text-muted-foreground">
          <span>{dbText("addADatePropertyToUseTimelineView")}</span>
          {canEdit ? <AddProperty documentId={databaseDocumentId} /> : null}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-border">
            <div
              className="grid min-w-max"
              style={{
                gridTemplateColumns: `repeat(${timelineDays.length}, minmax(8rem, 1fr))`,
                gridTemplateRows: `auto repeat(${Math.max(timelineSpans.length, 1)}, minmax(3.25rem, auto)) auto minmax(0.75rem, auto)`,
              }}
            >
              {timelineDays.map((day, index) => {
                const dateKey = calendarDateKey(day);
                const inMonth = day.getMonth() === month.getMonth();
                return (
                  <div
                    key={dateKey}
                    className={cn(
                      "border-r border-border bg-background last:border-r-0",
                      !inMonth && "bg-muted/25",
                    )}
                    style={{
                      gridColumn: index + 1,
                      gridRow: `1 / ${Math.max(timelineSpans.length, 1) + 4}`,
                    }}
                    aria-label={`${dateKey} timeline day`}
                  />
                );
              })}
              {timelineDays.map((day, index) => {
                const dateKey = calendarDateKey(day);
                const inMonth = day.getMonth() === month.getMonth();
                return (
                  <div
                    key={`${dateKey}-header`}
                    className={cn(
                      "sticky top-0 z-10 grid gap-0.5 border-r border-b border-border bg-background px-2 py-2 last:border-r-0",
                      !inMonth && "bg-muted/70",
                    )}
                    style={{ gridColumn: index + 1, gridRow: 1 }}
                  >
                    <span className="text-[11px] uppercase text-muted-foreground">
                      {day.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span
                      className={cn(
                        "w-fit rounded px-1.5 py-0.5 text-sm font-medium",
                        dateKey === calendarDateKey(new Date()) &&
                          "bg-foreground text-background",
                      )}
                    >
                      {day.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                );
              })}
              {timelineSpans.map((span, index) => (
                <div
                  key={span.item.id}
                  className="z-[1] p-1.5"
                  style={{
                    gridColumn: `${span.startIndex + 1} / ${span.endIndex + 2}`,
                    gridRow: index + 2,
                  }}
                >
                  <DatabaseTimelineCard
                    item={span.item}
                    databaseDocumentId={databaseDocumentId}
                    dateLabel={span.label}
                    properties={visibleProperties}
                    canEdit={canEdit}
                    onPreviewItem={onPreview}
                    onDeletedPreviewItem={onDeletedPreviewItem}
                    onPreview={() => onPreview(span.item)}
                    onOpenPage={() => onOpenPage(span.item)}
                  />
                </div>
              ))}
              {databaseViewHasNoMatchingPages(
                items.length,
                hasSearch,
                activeFilters.length,
              ) ? (
                <div
                  className="z-[1] m-1.5"
                  style={{
                    gridColumn: `1 / ${timelineDays.length + 1}`,
                    gridRow: 2,
                  }}
                >
                  <DatabaseNoMatchingPages
                    className="rounded border border-dashed border-border/70 bg-background/80"
                    onClear={onClearResultConstraints}
                  />
                </div>
              ) : null}
              {canCreateOnDay
                ? timelineDays.map((day, index) => {
                    const dateKey = calendarDateKey(day);
                    return (
                      <div
                        key={`${dateKey}-new`}
                        className="z-[1] p-1.5"
                        style={{
                          gridColumn: index + 1,
                          gridRow: Math.max(timelineSpans.length, 1) + 2,
                        }}
                      >
                        <NewTimelineCard
                          dateKey={dateKey}
                          disabled={isCreating}
                          isPending={isCreating}
                          onCreate={onCreateCard}
                        />
                      </div>
                    );
                  })
                : null}
              <div
                className="min-h-3"
                style={{
                  gridColumn: `1 / ${timelineDays.length + 1}`,
                  gridRow: Math.max(timelineSpans.length, 1) + 3,
                }}
              />
            </div>
          </div>
          <DatabaseDateViewNoDateSection
            items={noDateItems}
            databaseDocumentId={databaseDocumentId}
            properties={visibleProperties}
            canEdit={canEdit}
            onPreview={onPreview}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        </>
      )}
    </div>
  );
}

function DatabaseTimelineCard({
  item,
  databaseDocumentId,
  dateLabel,
  properties,
  canEdit,
  onPreviewItem,
  onDeletedPreviewItem,
  onPreview,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  databaseDocumentId: string;
  dateLabel: string;
  properties: DocumentProperty[];
  canEdit: boolean;
  onPreviewItem: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onPreview: () => void;
  onOpenPage: () => void;
}) {
  const visibleProperties = properties.slice(0, 2);

  return (
    <div className="group/card rounded-md border border-border bg-background px-2 py-2 text-xs shadow-sm transition-colors hover:bg-accent/60">
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          className="grid min-w-0 flex-1 gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onPreview}
        >
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            <DatabaseItemPageIcon
              document={item.document}
              className="size-3.5 text-xs"
              fallbackClassName="size-3.5"
            />
            <span className="truncate">
              {item.document.title || "Untitled"}
            </span>
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {dateLabel}
          </span>
          {visibleProperties.length > 0 ? (
            <span className="grid gap-0.5">
              {visibleProperties.map((property) => {
                const itemProperty =
                  item.properties.find(
                    (candidate) =>
                      candidate.definition.id === property.definition.id,
                  ) ?? property;
                const Icon = TYPE_ICONS[property.definition.type];
                return (
                  <span
                    key={property.definition.id}
                    className="flex min-w-0 items-center gap-1 text-muted-foreground"
                  >
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate">
                      {displayValue(itemProperty)}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : null}
        </button>
        {canEdit ? (
          <RowActionsCell
            item={item}
            databaseDocumentId={databaseDocumentId}
            rowIndex={0}
            canReorder={false}
            canMoveUp={false}
            canMoveDown={false}
            showReorderActions={false}
            onPreviewItem={onPreviewItem}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        ) : null}
      </div>
    </div>
  );
}

function NewTimelineCard({
  dateKey,
  disabled,
  isPending,
  onCreate,
}: {
  dateKey: string;
  disabled: boolean;
  isPending: boolean;
  onCreate: (
    dateKey: string,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  async function submitNewCard() {
    if (disabled) return;
    const createdItem = await onCreate(dateKey, title.trim());
    setTitle("");
    if (!createdItem) inputRef.current?.focus();
  }

  return (
    <form
      className="rounded border border-dashed border-transparent bg-transparent transition-colors focus-within:border-border focus-within:bg-background/80 hover:bg-background/60"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewCard();
      }}
    >
      <label className="flex h-7 min-w-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
        {isPending ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <IconPlus className="size-3.5 shrink-0" />
        )}
        <input
          ref={inputRef}
          value={title}
          disabled={disabled}
          aria-label={`New ${dateKey} timeline card title`}
          placeholder={dbText("newPage")}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submitNewCard();
            }
            if (event.key === "Escape") {
              setTitle("");
              event.currentTarget.blur();
            }
          }}
          className="h-6 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/70"
        />
      </label>
    </form>
  );
}
