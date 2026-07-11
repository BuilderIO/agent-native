import { Spinner } from "@agent-native/toolkit/ui/spinner";
import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import { IconLayoutGrid, IconPlus } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { TYPE_ICONS, displayValue } from "../DocumentProperties";
import {
  DatabaseGroupHeader,
  DatabaseItemPageIcon,
  DatabaseNoMatchingPages,
  RowActionsCell,
  dbText,
  databaseGroupIsCollapsed,
  databaseViewGroupingProperty,
  databaseViewHasNoMatchingPages,
  databaseViewItemGroups,
  databaseVisibleGroups,
  type CreateDatabaseRowHandler,
  type DatabaseBoardGroup,
  type DatabaseFilter,
} from "./DatabaseView";

export function DatabaseGalleryView({
  properties,
  groupableProperties,
  items,
  databaseDocumentId,
  canEdit,
  isLoading,
  isCreating,
  activeFilters,
  hasSearch,
  rowsAreManuallyOrdered,
  groupByPropertyId,
  collapsedGroupIds,
  hideEmptyGroups,
  onClearResultConstraints,
  onCreateRow,
  onCreateGroupedRow,
  onGroupCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  properties: DocumentProperty[];
  groupableProperties: DocumentProperty[];
  items: ContentDatabaseItem[];
  databaseDocumentId: string;
  canEdit: boolean;
  isLoading: boolean;
  isCreating: boolean;
  activeFilters: DatabaseFilter[];
  hasSearch: boolean;
  rowsAreManuallyOrdered: boolean;
  groupByPropertyId: string | null;
  collapsedGroupIds: string[];
  hideEmptyGroups: boolean;
  onClearResultConstraints: () => void;
  onCreateRow: CreateDatabaseRowHandler;
  onCreateGroupedRow: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onGroupCollapsedChange: (groupId: string, collapsed: boolean) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  const groups = databaseVisibleGroups(
    databaseViewItemGroups(items, groupableProperties, groupByPropertyId),
    hideEmptyGroups,
  );
  const grouped = !!databaseViewGroupingProperty(
    { type: "gallery", groupByPropertyId },
    groupableProperties,
  );

  return (
    <div className="border-b border-border">
      <div className="flex min-h-9 items-center gap-2 border-t border-border px-1 text-xs text-muted-foreground">
        <IconLayoutGrid className="size-4 shrink-0" />
        <span>Gallery</span>
      </div>
      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {dbText("loadingGallery")}
        </div>
      ) : (
        <div className="content-database-gallery-grid grid gap-3 px-1 py-3">
          {databaseViewHasNoMatchingPages(
            items.length,
            hasSearch,
            activeFilters.length,
          ) ? (
            <DatabaseNoMatchingPages
              className="col-span-full"
              onClear={onClearResultConstraints}
            />
          ) : null}
          {grouped
            ? groups.map((group) => (
                <DatabaseGroupedGallerySection
                  key={group.id}
                  group={group}
                  properties={properties}
                  databaseDocumentId={databaseDocumentId}
                  canEdit={canEdit}
                  isCreating={isCreating}
                  collapsed={databaseGroupIsCollapsed(
                    collapsedGroupIds,
                    group.id,
                  )}
                  onCreateRow={onCreateGroupedRow}
                  onCollapsedChange={(collapsed) =>
                    onGroupCollapsedChange(group.id, collapsed)
                  }
                  onPreview={onPreview}
                  onDeletedPreviewItem={onDeletedPreviewItem}
                  onOpenPage={onOpenPage}
                />
              ))
            : items.map((item, index) => (
                <DatabaseGalleryCard
                  key={item.id}
                  item={item}
                  properties={properties}
                  databaseDocumentId={databaseDocumentId}
                  canEdit={canEdit}
                  rowIndex={index}
                  canReorder={rowsAreManuallyOrdered}
                  canMoveUp={rowsAreManuallyOrdered && index > 0}
                  canMoveDown={
                    rowsAreManuallyOrdered && index < items.length - 1
                  }
                  onPreviewItem={onPreview}
                  onDeletedPreviewItem={onDeletedPreviewItem}
                  onPreview={() => onPreview(item)}
                  onOpenPage={() => onOpenPage(item)}
                />
              ))}
          {canEdit && !grouped ? (
            <NewGalleryCard
              disabled={isCreating}
              isPending={isCreating}
              onCreate={onCreateRow}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function DatabaseGroupedGallerySection({
  group,
  properties,
  databaseDocumentId,
  canEdit,
  isCreating,
  collapsed,
  onCreateRow,
  onCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  group: DatabaseBoardGroup;
  properties: DocumentProperty[];
  databaseDocumentId: string;
  canEdit: boolean;
  isCreating: boolean;
  collapsed: boolean;
  onCreateRow: (
    group: DatabaseBoardGroup,
    title?: string,
  ) => Promise<ContentDatabaseItem | null>;
  onCollapsedChange: (collapsed: boolean) => void;
  onPreview: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onOpenPage: (item: ContentDatabaseItem) => void;
}) {
  return (
    <section className="col-span-full grid gap-3">
      <DatabaseGroupHeader
        group={group}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />
      {!collapsed ? (
        <div className="content-database-gallery-grid grid gap-3">
          {group.items.map((item, index) => (
            <DatabaseGalleryCard
              key={`${group.id}-${item.id}`}
              item={item}
              properties={properties}
              databaseDocumentId={databaseDocumentId}
              canEdit={canEdit}
              rowIndex={index}
              canReorder={false}
              canMoveUp={false}
              canMoveDown={false}
              onPreviewItem={onPreview}
              onDeletedPreviewItem={onDeletedPreviewItem}
              onPreview={() => onPreview(item)}
              onOpenPage={() => onOpenPage(item)}
            />
          ))}
          {canEdit ? (
            <NewGalleryCard
              disabled={isCreating}
              isPending={isCreating}
              onCreate={(title) => onCreateRow(group, title)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DatabaseGalleryCard({
  item,
  properties,
  databaseDocumentId,
  canEdit,
  rowIndex,
  canReorder,
  canMoveUp,
  canMoveDown,
  onPreviewItem,
  onDeletedPreviewItem,
  onPreview,
  onOpenPage,
}: {
  item: ContentDatabaseItem;
  properties: DocumentProperty[];
  databaseDocumentId: string;
  canEdit: boolean;
  rowIndex: number;
  canReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPreviewItem: (item: ContentDatabaseItem) => void;
  onDeletedPreviewItem: (item: ContentDatabaseItem) => boolean;
  onPreview: () => void;
  onOpenPage: () => void;
}) {
  const visibleProperties = properties.slice(0, 4);

  return (
    <div className="group overflow-hidden rounded-md border border-border bg-background shadow-sm transition-colors hover:bg-accent/40">
      <button
        type="button"
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onPreview}
      >
        <div className="flex aspect-[5/3] items-center justify-center border-b border-border bg-muted/45">
          <DatabaseItemPageIcon
            document={item.document}
            className="size-10 text-4xl"
            fallbackClassName="size-8 text-muted-foreground/70"
          />
        </div>
        <div className="grid gap-2 p-3">
          <span className="min-w-0 truncate text-sm font-medium">
            {item.document.title || "Untitled"}
          </span>
          {visibleProperties.length > 0 ? (
            <span className="grid gap-1">
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
                    className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {displayValue(itemProperty)}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : null}
        </div>
      </button>
      {canEdit ? (
        <div className="flex justify-end border-t border-border/70 px-2 py-1">
          <RowActionsCell
            item={item}
            databaseDocumentId={databaseDocumentId}
            rowIndex={rowIndex}
            canReorder={canReorder}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onPreviewItem={onPreviewItem}
            onDeletedPreviewItem={onDeletedPreviewItem}
            onOpenPage={onOpenPage}
          />
        </div>
      ) : null}
    </div>
  );
}

function NewGalleryCard({
  disabled,
  isPending,
  onCreate,
}: {
  disabled: boolean;
  isPending: boolean;
  onCreate: CreateDatabaseRowHandler;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  async function submitNewCard() {
    if (disabled) return;
    const createdItem = await onCreate(title.trim());
    setTitle("");
    if (!createdItem) inputRef.current?.focus();
  }

  return (
    <form
      className="flex min-h-40 flex-col justify-between rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground hover:bg-muted/35 focus-within:bg-muted/35"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewCard();
      }}
    >
      <div className="flex items-center gap-2">
        {isPending ? (
          <Spinner className="size-4 shrink-0" />
        ) : (
          <IconPlus className="size-4 shrink-0" />
        )}
        <input
          ref={inputRef}
          value={title}
          disabled={disabled}
          aria-label={dbText("newDatabaseGalleryCardTitle")}
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
          className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/70"
        />
      </div>
    </form>
  );
}
