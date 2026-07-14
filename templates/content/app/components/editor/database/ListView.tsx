import { Spinner } from "@agent-native/toolkit/ui/spinner";
import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import { IconList, IconPlus } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { displayValue } from "../DocumentProperties";
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

export function DatabaseListView({
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
    { type: "list", groupByPropertyId },
    groupableProperties,
  );

  return (
    <div className="border-b border-border">
      <div className="flex min-h-9 items-center gap-2 border-t border-border px-1 text-xs text-muted-foreground">
        <IconList className="size-4 shrink-0" />
        <span>List</span>
      </div>
      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {dbText("loadingList")}
        </div>
      ) : (
        <div className="grid">
          {databaseViewHasNoMatchingPages(
            items.length,
            hasSearch,
            activeFilters.length,
          ) ? (
            <DatabaseNoMatchingPages onClear={onClearResultConstraints} />
          ) : null}
          {grouped
            ? groups.map((group) => (
                <DatabaseGroupedListSection
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
                <DatabaseListRow
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
            <NewListRow
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

function DatabaseGroupedListSection({
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
    <section>
      <DatabaseGroupHeader
        group={group}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
      />
      {!collapsed ? (
        <>
          {group.items.map((item, index) => (
            <DatabaseListRow
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
            <NewListRow
              disabled={isCreating}
              isPending={isCreating}
              onCreate={(title) => onCreateRow(group, title)}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function DatabaseListRow({
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
    <div className="group flex min-h-10 items-center gap-2 border-t border-border px-1 py-1 hover:bg-muted/40">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onPreview}
      >
        <DatabaseItemPageIcon
          document={item.document}
          className="size-4 text-sm"
          fallbackClassName="size-4"
        />
        <span className="min-w-0 truncate text-sm font-medium">
          {item.document.title || "Untitled"}
        </span>
        {visibleProperties.length > 0 ? (
          <span className="ml-2 hidden min-w-0 flex-wrap items-center gap-1 md:flex">
            {visibleProperties.map((property) => {
              const itemProperty =
                item.properties.find(
                  (candidate) =>
                    candidate.definition.id === property.definition.id,
                ) ?? property;
              return (
                <span
                  key={property.definition.id}
                  className="max-w-36 truncate rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
                >
                  {displayValue(itemProperty)}
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
          rowIndex={rowIndex}
          canReorder={canReorder}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onPreviewItem={onPreviewItem}
          onDeletedPreviewItem={onDeletedPreviewItem}
          onOpenPage={onOpenPage}
        />
      ) : null}
    </div>
  );
}

function NewListRow({
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

  async function submitNewRow() {
    if (disabled) return;
    const createdItem = await onCreate(title.trim());
    setTitle("");
    if (!createdItem) inputRef.current?.focus();
  }

  return (
    <form
      className="flex h-10 items-center gap-2 border-t border-border px-2 text-sm text-muted-foreground hover:bg-muted/40 focus-within:bg-muted/40 focus-within:text-foreground"
      onSubmit={(event) => {
        event.preventDefault();
        void submitNewRow();
      }}
    >
      {isPending ? (
        <Spinner className="size-4 shrink-0" />
      ) : (
        <IconPlus className="size-4 shrink-0" />
      )}
      <input
        ref={inputRef}
        value={title}
        disabled={disabled}
        aria-label={dbText("newDatabaseListItemTitle")}
        placeholder={dbText("newPage")}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submitNewRow();
          }
          if (event.key === "Escape") {
            setTitle("");
            event.currentTarget.blur();
          }
        }}
        className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/70"
      />
    </form>
  );
}
