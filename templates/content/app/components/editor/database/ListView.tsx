import type {
  ContentDatabaseItem,
  ContentDatabaseItemLayout,
  DocumentProperty,
} from "@shared/api";
import {
  resolveContentDatabaseItemLayout,
  startingContentDatabaseItemLayout,
} from "@shared/database-item-layout";
import { IconCheck, IconList, IconPencil, IconPlus } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { useSetDocumentProperty } from "@/hooks/use-document-properties";
import { cn } from "@/lib/utils";

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
import { ListItemLayoutPresets } from "./ListItemLayout";
import { DatabaseLayoutListRow, type ListItemRowLayout } from "./ListItemRow";

export function DatabaseListView({
  properties,
  groupableProperties,
  items,
  databaseId,
  databaseDocumentId,
  itemLayout,
  editingRows,
  canEdit,
  canCreateItems,
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
  onItemLayoutChange,
  onEditingRowsChange,
}: {
  properties: DocumentProperty[];
  groupableProperties: DocumentProperty[];
  items: ContentDatabaseItem[];
  databaseId: string;
  databaseDocumentId: string;
  itemLayout: ContentDatabaseItemLayout | null;
  editingRows: boolean;
  canEdit: boolean;
  canCreateItems: boolean;
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
  onItemLayoutChange: (layout: ContentDatabaseItemLayout | null) => void;
  onEditingRowsChange: (editing: boolean) => void;
}) {
  const setProperty = useSetDocumentProperty(
    databaseDocumentId,
    databaseId,
    databaseDocumentId,
    { errorNotification: "caller" },
  );
  const editing = canEdit && editingRows;
  const layout =
    itemLayout ??
    (editing ? startingContentDatabaseItemLayout(properties) : null);
  const layoutRow: ListItemRowLayout | null = layout
    ? {
        layout,
        resolved: resolveContentDatabaseItemLayout(layout, groupableProperties),
        properties: groupableProperties,
        editing,
        onLayoutChange: onItemLayoutChange,
        onToggleCheckbox: (item, property) => {
          setProperty
            .mutateAsync({
              documentId: item.document.id,
              propertyId: property.definition.id,
              value: property.value !== true,
            })
            .catch((err: unknown) => {
              toast.error(dbText("failedToUpdateCheckbox"), {
                description:
                  err instanceof Error
                    ? err.message
                    : dbText("somethingWentWrong"),
              });
            });
        },
      }
    : null;
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
        {canEdit ? (
          <button
            type="button"
            aria-pressed={editing}
            className={cn(
              "ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              editing
                ? "bg-database-blue text-database-blue-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => onEditingRowsChange(!editing)}
          >
            {editing ? (
              <IconCheck className="size-3.5" />
            ) : (
              <IconPencil className="size-3.5" />
            )}
            {dbText(editing ? "listRowsDone" : "listRowsEdit")}
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-database-blue/40 bg-database-blue/5 px-2 py-2 text-xs text-muted-foreground">
          <ListItemLayoutPresets
            layout={itemLayout}
            properties={groupableProperties}
            onChange={onItemLayoutChange}
          />
          <span>{dbText("listRowsEditHint")}</span>
        </div>
      ) : null}
      {isLoading ? (
        <div className="flex h-16 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {dbText("loadingList")}
        </div>
      ) : (
        <div className="grid grid-cols-1">
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
                  layoutRow={layoutRow}
                  group={group}
                  properties={properties}
                  databaseDocumentId={databaseDocumentId}
                  canEdit={canEdit}
                  canCreateItems={canCreateItems}
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
                  layoutRow={layoutRow}
                  isFirst={index === 0}
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
          {canEdit && canCreateItems && !grouped && !editing ? (
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
  layoutRow,
  group,
  properties,
  databaseDocumentId,
  canEdit,
  canCreateItems,
  isCreating,
  collapsed,
  onCreateRow,
  onCollapsedChange,
  onPreview,
  onDeletedPreviewItem,
  onOpenPage,
}: {
  layoutRow: ListItemRowLayout | null;
  group: DatabaseBoardGroup;
  properties: DocumentProperty[];
  databaseDocumentId: string;
  canEdit: boolean;
  canCreateItems: boolean;
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
              layoutRow={layoutRow}
              isFirst={index === 0}
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
          {canEdit && canCreateItems && !layoutRow?.editing ? (
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
  layoutRow,
  isFirst,
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
  layoutRow: ListItemRowLayout | null;
  isFirst: boolean;
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
  const actions = canEdit ? (
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
  ) : null;

  if (layoutRow) {
    return (
      <DatabaseLayoutListRow
        row={layoutRow}
        isFirst={isFirst}
        item={item}
        databaseDocumentId={databaseDocumentId}
        canEdit={canEdit}
        onPreview={onPreview}
        actions={actions}
      />
    );
  }

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
      {actions}
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
