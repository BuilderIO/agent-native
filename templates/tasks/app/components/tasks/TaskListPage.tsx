import { useT } from "@agent-native/core/client";
import {
  INCLUDE_DONE_QUERY_VALUE,
  parseIncludeDoneParam,
} from "@shared/boolean-param";
import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";

import { ListErrorMessage } from "@/components/shared/ListErrorMessage";
import { ListViewHeader } from "@/components/shared/ListViewHeader";
import { TaskList } from "@/components/tasks/TaskList";
import { useTasks } from "@/hooks/use-tasks";

export function TaskListPage() {
  const t = useT();
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

  const {
    tasks: serverTasks,
    hasCompletedTasks,
    isPending,
    isError,
    error,
  } = useTasks({
    includeDone,
    includeFields: true,
  });

  useEffect(() => {
    if (!activeTaskId || isPending) return;
    if (serverTasks.some((task) => task.id === activeTaskId)) return;
    if (!includeDone) {
      setIncludeDone(true);
      return;
    }
    setActiveTaskId(null);
  }, [
    activeTaskId,
    includeDone,
    isPending,
    serverTasks,
    setActiveTaskId,
    setIncludeDone,
  ]);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-6 overflow-hidden p-4 md:p-6">
      {isError ? (
        <>
          <ListViewHeader
            title={t("tasks.pageTitle")}
            description={t("tasks.pageDescription")}
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
            fallbackMessage={t("tasks.loadError")}
          />
        </>
      ) : (
        <TaskList
          serverTasks={serverTasks}
          hasCompletedTasks={hasCompletedTasks}
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
