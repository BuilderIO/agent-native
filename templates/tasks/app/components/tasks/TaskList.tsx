import { focusAgentChat } from "@agent-native/core/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { INERT_SORTABLE_PROPS } from "@/components/dnd/SortableItem";
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
import { TaskFieldsSidebar } from "@/components/tasks/fields/TaskFieldsSidebar";
import { TaskListHeaderRow } from "@/components/tasks/TaskListHeaderRow";
import { TaskListRow } from "@/components/tasks/TaskListRow";
import {
  useBulkDeleteTasks,
  useBulkUpdateTasks,
  useCreateTask,
  useDeleteTask,
  useReorderTasks,
  useUpdateTask,
  type TaskWithFields,
} from "@/hooks/use-tasks";

interface TaskListProps {
  serverTasks: TaskWithFields[];
  hasCompletedTasks?: boolean;
  isPending: boolean;
  includeDone: boolean;
  onIncludeDoneChange: (next: boolean) => void;
  activeTaskId: string | null;
  setActiveTaskId: (taskId: string | null) => void;
}

function NoTasksMessage({
  hasHiddenCompletedTasks,
}: {
  hasHiddenCompletedTasks: boolean;
}) {
  if (hasHiddenCompletedTasks) {
    return (
      <ListEmptyState
        heading="All tasks complete"
        description="Toggle Show all to review completed tasks."
      />
    );
  }

  return (
    <ListEmptyState
      heading="No tasks yet"
      description="Add one above or ask chat to create a task for you."
    />
  );
}

export function TaskList({
  serverTasks,
  hasCompletedTasks = false,
  isPending,
  includeDone,
  onIncludeDoneChange,
  activeTaskId,
  setActiveTaskId,
}: TaskListProps) {
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const reorderTasks = useReorderTasks();
  const bulkDeleteTasks = useBulkDeleteTasks();
  const bulkUpdateTasks = useBulkUpdateTasks();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [allTasks, setAllTasks] = useState<TaskWithFields[]>(serverTasks);
  const [orderedTasks, setOrderedTasks] =
    useState<TaskWithFields[]>(serverTasks);
  const exitingIdsRef = useRef<Set<string>>(new Set());
  const tasks = useMemo(
    () => (includeDone ? allTasks : allTasks.filter((task) => !task.done)),
    [allTasks, includeDone],
  );
  const hasTasks = allTasks.length > 0;
  const hasHiddenCompletedTasks =
    !includeDone && tasks.length === 0 && (hasTasks || hasCompletedTasks);
  const selection = useListSelection(tasks, "tasksSelection");
  const selectionActive = selection.state.selectionMode;
  const toolbarBusy = bulkUpdateTasks.isPending || updateTask.isPending;
  const panelTask = activeTaskId
    ? (allTasks.find((task) => task.id === activeTaskId) ?? null)
    : null;

  const pendingDeleteTask = pendingDeleteId
    ? tasks.find((task) => task.id === pendingDeleteId)
    : null;

  useEffect(() => {
    setAllTasks(serverTasks);
  }, [serverTasks]);

  useEffect(() => {
    setOrderedTasks((prev) => {
      const exitingIds = exitingIdsRef.current;

      if (includeDone) {
        exitingIds.clear();
      } else {
        for (const id of [...exitingIds]) {
          const serverTask = tasks.find((task) => task.id === id);
          if (serverTask && !serverTask.done) {
            exitingIds.delete(id);
          }
        }
      }

      if (exitingIds.size === 0) {
        return tasks;
      }

      const nextTasks = [...tasks];
      for (const [previousIndex, task] of prev.entries()) {
        if (!exitingIds.has(task.id)) continue;
        const insertAt = Math.min(previousIndex, nextTasks.length);
        nextTasks.splice(insertAt, 0, { ...task, done: true });
      }

      return nextTasks;
    });
  }, [tasks, includeDone]);

  useEffect(() => {
    if (!activeTaskId || includeDone || isPending) return;
    if (tasks.some((task) => task.id === activeTaskId)) return;
    onIncludeDoneChange(true);
  }, [activeTaskId, includeDone, isPending, tasks, onIncludeDoneChange]);

  function handleReorder(nextTasks: TaskWithFields[]) {
    setOrderedTasks(nextTasks);
    reorderTasks.mutate(
      { taskIds: nextTasks.map((task) => task.id), includeDone },
      {
        onError: () => {
          setOrderedTasks(
            tasks.filter((task) => !exitingIdsRef.current.has(task.id)),
          );
        },
      },
    );
  }

  async function handleBulkDelete(ids: string[]) {
    await bulkDeleteTasks.mutateAsync({ taskIds: ids });
  }

  async function confirmBulkDelete() {
    const ids = selection.state.selectedItems.map((item) => item.id);
    if (ids.length === 0) return;

    try {
      await handleBulkDelete(ids);
      toast.success(
        `Deleted ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`,
      );
      selection.actions.clearSelection();
      setBulkDeleteOpen(false);
    } catch {
      toast.error("Could not delete selected tasks.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-col gap-6 overflow-hidden">
          <ListViewHeader
            title="Tasks"
            description="Manage your task list, drag to reorder, or ask chat to add reminders."
            isPending={isPending}
            showSelectToggle={hasTasks}
            selection={selection}
            toolbarBusy={toolbarBusy}
            includeDone={includeDone}
            onIncludeDoneChange={onIncludeDoneChange}
            showAgentToggle
          />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0">
              {selectionActive ? (
                <ListSelectionBar
                  promotedToTask
                  items={tasks.length === 0 ? [] : orderedTasks}
                  selection={selection}
                  toolbarBusy={toolbarBusy}
                  onOpenBulkDelete={() => setBulkDeleteOpen(true)}
                />
              ) : (
                <AddListItemInput
                  disabled={createTask.isPending}
                  onCreate={async (title) => {
                    await createTask.mutateAsync({ title });
                  }}
                />
              )}
            </div>

            {!selectionActive ? (
              <div className="shrink-0">
                <TaskListHeaderRow
                  task={orderedTasks.find((task) => task.fields)}
                />
              </div>
            ) : null}

            <div
              aria-label={
                isPending || tasks.length === 0 ? "Tasks list" : undefined
              }
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 outline-none"
            >
              {isPending ? (
                <ListSkeletonRows />
              ) : tasks.length === 0 ? (
                <NoTasksMessage
                  hasHiddenCompletedTasks={hasHiddenCompletedTasks}
                />
              ) : (
                <List
                  items={orderedTasks}
                  selection={selection}
                  ariaLabel="Tasks list"
                  onReorder={handleReorder}
                  renderItem={({ item, sortable }) => (
                    <TaskListRow
                      sortable={sortable}
                      selection={selection}
                      item={item}
                      fields={item.fields}
                      done={item.done}
                      highlighted={activeTaskId === item.id}
                      hideAfterComplete={!includeDone}
                      onUpdateTitle={(title) =>
                        updateTask.mutateAsync({ taskId: item.id, title })
                      }
                      onUpdateDone={(done) =>
                        updateTask.mutateAsync({ taskId: item.id, done })
                      }
                      onOpenDetails={() => {
                        focusAgentChat();
                        setActiveTaskId(item.id);
                      }}
                      onRequestDelete={() => setPendingDeleteId(item.id)}
                      onBeginExit={() => {
                        exitingIdsRef.current.add(item.id);
                        setOrderedTasks((prev) =>
                          prev.map((row) =>
                            row.id === item.id ? { ...row, done: true } : row,
                          ),
                        );
                      }}
                      onExitAfterComplete={() => {
                        exitingIdsRef.current.delete(item.id);
                        setOrderedTasks((prev) =>
                          prev.filter((row) => row.id !== item.id),
                        );
                      }}
                    />
                  )}
                  renderOverlay={({ item, blockDragCount }) => (
                    <ListRowPreview
                      id={item.id}
                      overlayDataAttribute="data-dnd-overlay-task-id"
                      blockDragCount={blockDragCount}
                    >
                      <TaskListRow
                        sortable={INERT_SORTABLE_PROPS}
                        selection={selection}
                        item={item}
                        fields={item.fields}
                        done={item.done}
                        highlighted={false}
                        hideAfterComplete={false}
                        onUpdateTitle={async () => {}}
                        onUpdateDone={async () => {}}
                        onOpenDetails={() => {}}
                        onRequestDelete={() => {}}
                        onBeginExit={() => {}}
                        onExitAfterComplete={() => {}}
                      />
                    </ListRowPreview>
                  )}
                />
              )}
            </div>

            {!selectionActive ? (
              <DeleteItemDialog
                open={pendingDeleteTask !== null}
                onOpenChange={(open) => {
                  if (!open) setPendingDeleteId(null);
                }}
                entityLabel="task"
                itemTitle={pendingDeleteTask?.title ?? null}
                pending={deleteTask.isPending}
                onConfirm={async () => {
                  if (!pendingDeleteId) return;
                  await deleteTask.mutateAsync({ taskId: pendingDeleteId });
                  setPendingDeleteId(null);
                }}
              />
            ) : null}

            <BulkDeleteDialog
              open={bulkDeleteOpen}
              onOpenChange={setBulkDeleteOpen}
              selectedItems={selection.state.selectedItems}
              entitySingular="task"
              entityPlural="tasks"
              pending={bulkDeleteTasks.isPending}
              onConfirm={() => void confirmBulkDelete()}
            />
          </div>
        </div>
      </div>

      <TaskFieldsSidebar
        task={panelTask}
        onClose={() => setActiveTaskId(null)}
      />
    </div>
  );
}
