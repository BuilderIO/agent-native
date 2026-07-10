import { useEffect, useState } from "react";
import { toast } from "sonner";

import { InboxListRow } from "@/components/inbox/InboxListRow";
import { AddListItemInput } from "@/components/shared/AddListItemInput";
import { BulkDeleteDialog } from "@/components/shared/BulkDeleteDialog";
import { DeleteItemDialog } from "@/components/shared/DeleteItemDialog";
import { ListRowPreview } from "@/components/shared/dnd/ListRowPreview";
import { List } from "@/components/shared/list/List";
import { ListSkeletonRows } from "@/components/shared/list/ListSkeletonRows";
import { ListEmptyState } from "@/components/shared/ListEmptyState";
import { ListViewHeader } from "@/components/shared/ListViewHeader";
import { ListSelectionBar } from "@/components/shared/selection/ListSelectionBar";
import { useListSelection } from "@/components/shared/selection/use-list-selection";
import {
  useBulkDeleteInboxItems,
  useCreateInboxItem,
  useDeleteInboxItem,
  useMarkInboxItemReady,
  useReorderInboxItems,
  useUpdateInboxItem,
} from "@/hooks/use-inbox-items";
import type { InboxItem } from "@/hooks/use-inbox-items";

interface InboxListProps {
  serverItems: InboxItem[];
  isPending: boolean;
  selectedInboxItemId: string | null;
}

export function InboxList({
  serverItems,
  isPending,
  selectedInboxItemId,
}: InboxListProps) {
  const createInboxItem = useCreateInboxItem();
  const updateInboxItem = useUpdateInboxItem();
  const deleteInboxItem = useDeleteInboxItem();
  const markInboxItemReady = useMarkInboxItemReady();
  const reorderInboxItems = useReorderInboxItems();
  const bulkDeleteInboxItems = useBulkDeleteInboxItems();
  const [items, setItems] = useState<InboxItem[]>(serverItems);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const selection = useListSelection(items, "inboxSelection");
  const selectionActive = selection.state.selectionMode;
  const toolbarBusy =
    createInboxItem.isPending ||
    updateInboxItem.isPending ||
    deleteInboxItem.isPending ||
    markInboxItemReady.isPending;

  useEffect(() => {
    setItems(serverItems);
  }, [serverItems]);

  const pendingDeleteItem = pendingDeleteId
    ? items.find((item) => item.id === pendingDeleteId)
    : null;

  function handleReorder(nextItems: InboxItem[]) {
    setItems(nextItems);
    reorderInboxItems.mutate(
      { inboxItemIds: nextItems.map((item) => item.id) },
      { onError: () => setItems(serverItems) },
    );
  }

  async function handleBulkDelete(ids: string[]) {
    await bulkDeleteInboxItems.mutateAsync({ inboxItemIds: ids });
  }

  async function confirmBulkDelete() {
    const ids = selection.state.selectedItems.map((item) => item.id);
    if (ids.length === 0) return;

    try {
      await handleBulkDelete(ids);
      toast.success(
        `Deleted ${ids.length} ${ids.length === 1 ? "inbox item" : "inbox items"}`,
      );
      selection.actions.clearSelection();
      setBulkDeleteOpen(false);
    } catch {
      toast.error("Could not delete selected inbox items.");
    }
  }

  return (
    <>
      <ListViewHeader
        title="Inbox"
        description="Capture rough ideas here, then mark ready when they become tasks."
        isPending={isPending}
        showSelectToggle={items.length > 0}
        selection={selection}
        toolbarBusy={toolbarBusy}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0">
          {selectionActive ? (
            <ListSelectionBar
              promotedToTask={false}
              items={items}
              selection={selection}
              toolbarBusy={toolbarBusy}
              onOpenBulkDelete={() => setBulkDeleteOpen(true)}
            />
          ) : (
            <AddListItemInput
              disabled={createInboxItem.isPending}
              onCreate={(title) => createInboxItem.mutateAsync({ title })}
              placeholder="Add to inbox..."
              buttonLabel="Add item"
              inputAriaLabel="New inbox item title"
              errorMessage="Failed to add inbox item. Please try again."
            />
          )}
        </div>

        {isPending ? (
          <div
            aria-label="Inbox list"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 outline-none"
          >
            <ListSkeletonRows />
          </div>
        ) : items.length === 0 ? (
          <div
            aria-label="Inbox list"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 outline-none"
          >
            <ListEmptyState
              heading="Inbox is empty"
              description="Add an item above or ask chat to capture something for triage."
            />
          </div>
        ) : (
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 outline-none">
            <List
              items={items}
              selection={selection}
              ariaLabel="Inbox list"
              listClassName="flex flex-col gap-3 pb-6"
              onReorder={handleReorder}
              renderItem={({ item, sortable }) => (
                <InboxListRow
                  sortable={sortable}
                  selection={selection}
                  item={item}
                  highlighted={selectedInboxItemId === item.id}
                  onUpdateTitle={(title) =>
                    updateInboxItem.mutateAsync({ inboxItemId: item.id, title })
                  }
                  onMarkReady={() =>
                    markInboxItemReady.mutateAsync({ inboxItemId: item.id })
                  }
                  onRequestDelete={() => setPendingDeleteId(item.id)}
                />
              )}
              renderOverlay={({ item, blockDragCount }) => (
                <ListRowPreview
                  id={item.id}
                  title={item.title}
                  overlayDataAttribute="data-dnd-overlay-inbox-item-id"
                  blockDragCount={blockDragCount}
                  promotedToTask={false}
                />
              )}
            />
          </div>
        )}

        {!selectionActive ? (
          <DeleteItemDialog
            open={pendingDeleteItem !== null}
            onOpenChange={(open) => {
              if (!open) setPendingDeleteId(null);
            }}
            entityLabel="inbox item"
            itemTitle={pendingDeleteItem?.title ?? null}
            pending={deleteInboxItem.isPending}
            onConfirm={async () => {
              if (!pendingDeleteId) return;
              await deleteInboxItem.mutateAsync({
                inboxItemId: pendingDeleteId,
              });
              setPendingDeleteId(null);
            }}
          />
        ) : null}

        <BulkDeleteDialog
          open={bulkDeleteOpen}
          onOpenChange={setBulkDeleteOpen}
          selectedItems={selection.state.selectedItems}
          entitySingular="inbox item"
          entityPlural="inbox items"
          pending={bulkDeleteInboxItems.isPending}
          onConfirm={() => void confirmBulkDelete()}
        />
      </div>
    </>
  );
}
