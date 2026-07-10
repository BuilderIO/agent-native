import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";
import { TaskList } from "@/components/tasks/TaskList";
import { ListViewHeader } from "@/components/shared/ListViewHeader";
import { ListErrorMessage } from "@/components/shared/ListErrorMessage";
import { useTasks } from "@/hooks/use-tasks";
import {
  INCLUDE_DONE_QUERY_VALUE,
  parseIncludeDoneParam,
} from "@shared/boolean-param";

export function TaskListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const includeDone = parseIncludeDoneParam(searchParams.get("includeDone"));
  const activeTaskId = searchParams.get("task");

  const setIncludeDone = useCallback(
    (next: boolean) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (next) {
            nextParams.set("includeDone", INCLUDE_DONE_QUERY_VALUE);
          } else {
            nextParams.delete("includeDone");
          }
          return nextParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setActiveTaskId = useCallback(
    (nextTaskId: string | null) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (nextTaskId) {
            nextParams.set("task", nextTaskId);
          } else {
            nextParams.delete("task");
          }
          return nextParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const { tasks: serverTasks, isPending, isError, error } = useTasks({
    includeDone: true,
    includeFields: true,
  });

  useEffect(() => {
    if (!activeTaskId || isPending) return;
    if (serverTasks.some((task) => task.id === activeTaskId)) return;
    setActiveTaskId(null);
  }, [activeTaskId, isPending, serverTasks, setActiveTaskId]);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-6 overflow-hidden p-4 md:p-6">
      {isError ? (
        <>
          <ListViewHeader
            title="Tasks"
            description="Manage your task list, drag to reorder, or ask chat to add reminders."
            isPending={false}
            showSelectToggle={false}
            selection={null}
            toolbarBusy={false}
            includeDone={includeDone}
            onIncludeDoneChange={setIncludeDone}
            showAgentToggle
          />
          <ListErrorMessage
            error={error}
            fallbackMessage="Failed to load tasks."
          />
        </>
      ) : (
        <TaskList
          serverTasks={serverTasks}
          isPending={isPending}
          includeDone={includeDone}
          onIncludeDoneChange={setIncludeDone}
          activeTaskId={activeTaskId}
          setActiveTaskId={setActiveTaskId}
        />
      )}
    </div>
  );
}
