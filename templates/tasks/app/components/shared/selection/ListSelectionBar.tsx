import { useT } from "@agent-native/core/client";
import { IconCircleCheck, IconCircle } from "@tabler/icons-react";
import { toast } from "sonner";

import { ListSelectionToolbar } from "@/components/shared/selection/ListSelectionToolbar";
import { type ListSelection } from "@/components/shared/selection/use-list-selection";
import { Button } from "@/components/ui/button";
import { useBulkMarkInboxItemsReady } from "@/hooks/use-inbox-items";
import { useBulkUpdateTasks } from "@/hooks/use-tasks";

interface ListSelectionBarProps<
  T extends { id: string; title: string; done?: boolean },
> {
  promotedToTask: boolean;
  items: T[];
  selection: ListSelection<T>;
  toolbarBusy: boolean;
  onOpenBulkDelete: () => void;
}

export function ListSelectionBar<
  T extends { id: string; title: string; done?: boolean },
>({
  promotedToTask,
  items,
  selection,
  toolbarBusy,
  onOpenBulkDelete,
}: ListSelectionBarProps<T>) {
  const t = useT();
  const bulkUpdateTasks = useBulkUpdateTasks();
  const bulkMarkInboxItemsReady = useBulkMarkInboxItemsReady();

  const selectedItems = selection.state.selectedItems;
  const selectedCount = selectedItems.length;
  const selectedIdSet = new Set(selectedItems.map((item) => item.id));
  const allVisibleSelected =
    items.length > 0 && items.every((item) => selectedIdSet.has(item.id));

  async function markSelectedReady() {
    if (selectedCount === 0) return;

    try {
      await bulkMarkInboxItemsReady.mutateAsync({
        inboxItemIds: selectedItems.map((item) => item.id),
      });
      toast.success(
        selectedCount === 1
          ? t("selection.markedReadyOne", { count: selectedCount })
          : t("selection.markedReadyOther", { count: selectedCount }),
      );
      selection.actions.clearSelection();
    } catch {
      toast.error(t("selection.couldNotMarkReady"));
    }
  }

  async function markSelectedDone(done: boolean) {
    const applicableTasks = selectedItems.filter((task) => task.done !== done);
    const skippedCount = selectedItems.length - applicableTasks.length;
    if (applicableTasks.length === 0) {
      toast.info(
        done
          ? t("selection.allTasksAlreadyComplete")
          : t("selection.allTasksAlreadyIncomplete"),
      );
      return;
    }

    const taskIds = applicableTasks.map((task) => task.id);

    try {
      await bulkUpdateTasks.mutateAsync({ taskIds, done });

      const unit =
        applicableTasks.length === 1
          ? t("tasks.entitySingular")
          : t("tasks.entityPlural");
      toast.success(
        done
          ? skippedCount > 0
            ? t("selection.markedDoneWithSkipped", {
                count: applicableTasks.length,
                unit,
                skipped: skippedCount,
              })
            : t("selection.markedDone", { count: applicableTasks.length, unit })
          : skippedCount > 0
            ? t("selection.markedNotDoneWithSkipped", {
                count: applicableTasks.length,
                unit,
                skipped: skippedCount,
              })
            : t("selection.markedNotDone", {
                count: applicableTasks.length,
                unit,
              }),
      );
      selection.actions.clearSelection();
    } catch {
      toast.error(t("selection.couldNotUpdateTasks"));
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
    toolbarBusy || (!promotedToTask && bulkMarkInboxItemsReady.isPending);

  return (
    <ListSelectionToolbar
      ariaLabel={
        promotedToTask
          ? t("selection.taskSelectionActionsAriaLabel")
          : t("selection.inboxSelectionActionsAriaLabel")
      }
      emptySelectionHint={
        promotedToTask
          ? t("selection.tapToSelectTasks")
          : t("selection.tapToSelectItems")
      }
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
            aria-label={t("selection.markComplete")}
            onClick={() => void markSelectedDone(true)}
          >
            <IconCircleCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {t("selection.completeLabel")}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1 px-2 text-xs"
            disabled={
              selectedCount === 0 || toolbarDisabled || allSelectedIncomplete
            }
            aria-label={t("selection.markIncomplete")}
            onClick={() => void markSelectedDone(false)}
          >
            <IconCircle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {t("selection.incompleteLabel")}
            </span>
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-xs"
          disabled={selectedCount === 0 || toolbarDisabled}
          aria-label={t("common.markReady")}
          onClick={() => void markSelectedReady()}
        >
          <IconCircleCheck className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("common.markReady")}</span>
        </Button>
      )}
    </ListSelectionToolbar>
  );
}
