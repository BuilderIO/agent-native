import { toast } from "sonner";
import { IconCircleCheck, IconCircle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useBulkUpdateTasks, useUpdateTask } from "@/hooks/use-tasks";
import { useMarkInboxItemReady } from "@/hooks/use-inbox-items";
import { type ListSelection } from "@/components/shared/selection/use-list-selection";
import { ListSelectionToolbar } from "@/components/shared/selection/ListSelectionToolbar";

interface ListSelectionBarProps<
  T extends { id: string; title: string; done?: boolean },
> {
  promotedToTask: boolean;
  items: T[];
  selection: ListSelection<T>;
  toolbarBusy: boolean;
  onOpenBulkDelete: () => void;
  includeDone?: boolean;
}

export function ListSelectionBar<
  T extends { id: string; title: string; done?: boolean },
>({
  promotedToTask,
  items,
  selection,
  toolbarBusy,
  onOpenBulkDelete,
  includeDone = false,
}: ListSelectionBarProps<T>) {
  const updateTask = useUpdateTask();
  const bulkUpdateTasks = useBulkUpdateTasks();
  const markInboxItemReady = useMarkInboxItemReady();

  const selectedItems = selection.state.selectedItems;
  const selectedCount = selectedItems.length;
  const selectedIdSet = new Set(selectedItems.map((item) => item.id));
  const allVisibleSelected =
    items.length > 0 && items.every((item) => selectedIdSet.has(item.id));

  const entityLabel = promotedToTask ? "task" : "item";

  async function markSelectedReady() {
    if (selectedCount === 0) return;

    try {
      await Promise.all(
        selectedItems.map((item) =>
          markInboxItemReady.mutateAsync({ inboxItemId: item.id }),
        ),
      );
      toast.success(
        `Marked ${selectedCount} ${selectedCount === 1 ? "item" : "items"} ready`,
      );
      selection.actions.clearSelection();
    } catch {
      toast.error("Could not mark selected items ready.");
    }
  }

  async function markSelectedDone(done: boolean) {
    const applicableTasks = selectedItems.filter((task) => task.done !== done);
    const skippedCount = selectedItems.length - applicableTasks.length;
    if (applicableTasks.length === 0) {
      toast.info(
        done
          ? "All selected tasks are already complete."
          : "All selected tasks are already incomplete.",
      );
      return;
    }

    const taskIds = applicableTasks.map((task) => task.id);

    try {
      if (!includeDone && done) {
        await Promise.all(
          taskIds.map((taskId) =>
            updateTask.mutateAsync({ taskId, done: true }),
          ),
        );
      } else {
        await bulkUpdateTasks.mutateAsync({ taskIds, done });
      }

      const countLabel = applicableTasks.length === 1 ? "task" : "tasks";
      toast.success(
        done
          ? skippedCount > 0
            ? `Marked ${applicableTasks.length} ${countLabel} complete (${skippedCount} already complete)`
            : `Marked ${applicableTasks.length} ${countLabel} complete`
          : skippedCount > 0
            ? `Marked ${applicableTasks.length} ${countLabel} incomplete (${skippedCount} already incomplete)`
            : `Marked ${applicableTasks.length} ${countLabel} incomplete`,
      );
      selection.actions.clearSelection();
    } catch {
      toast.error("Could not update selected tasks.");
    }
  }

  const allSelectedComplete =
    promotedToTask &&
    selectedCount > 0 &&
    selectedItems.every((task) => task.done === true);
  const allSelectedIncomplete =
    promotedToTask &&
    selectedCount > 0 &&
    selectedItems.every((task) => task.done !== true);

  const toolbarDisabled =
    toolbarBusy || (!promotedToTask && markInboxItemReady.isPending);

  return (
    <ListSelectionToolbar
      ariaLabel={
        promotedToTask ? "Task selection actions" : "Inbox selection actions"
      }
      emptySelectionHint={`Tap ${entityLabel}s to select them.`}
      visibleCount={items.length}
      selectedCount={selectedCount}
      allVisibleSelected={allVisibleSelected}
      toolbarDisabled={toolbarDisabled}
      selectionActions={selection.actions}
      onOpenBulkDelete={onOpenBulkDelete}
    >
      {promotedToTask ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1 px-2 text-xs"
            disabled={
              selectedCount === 0 || toolbarDisabled || allSelectedComplete
            }
            aria-label="Mark complete"
            onClick={() => void markSelectedDone(true)}
          >
            <IconCircleCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Complete</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1 px-2 text-xs"
            disabled={
              selectedCount === 0 || toolbarDisabled || allSelectedIncomplete
            }
            aria-label="Mark incomplete"
            onClick={() => void markSelectedDone(false)}
          >
            <IconCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Incomplete</span>
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-xs"
          disabled={selectedCount === 0 || toolbarDisabled}
          aria-label="Mark ready"
          onClick={() => void markSelectedReady()}
        >
          <IconCircleCheck className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Mark ready</span>
        </Button>
      )}
    </ListSelectionToolbar>
  );
}
