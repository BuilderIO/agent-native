import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  matchQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import type { TaskFieldValue } from "../../server/custom-fields/task-fields.js";
import type { FieldValue } from "../../server/custom-fields/values/store.js";
import type { Task } from "../../server/tasks/store.js";
import { LIST_TASKS_QUERY_KEY, invalidateTasks } from "./cache";

export type { Task } from "../../server/tasks/store.js";
export { LIST_TASKS_QUERY_KEY };

export type TaskWithFields = Task & {
  fields?: TaskFieldValue[];
  revision?: string;
};

type ListTasksData = { tasks: TaskWithFields[]; hasCompletedTasks?: boolean };

type ListTasksMutationContext = {
  previous: [readonly unknown[], ListTasksData | undefined][];
};

function patchListTasksCache(
  queryClient: QueryClient,
  patch: (tasks: TaskWithFields[]) => TaskWithFields[],
) {
  queryClient.setQueriesData<ListTasksData>(
    { queryKey: LIST_TASKS_QUERY_KEY },
    (old) => {
      if (!old?.tasks) return old;
      return { ...old, tasks: patch(old.tasks) };
    },
  );
}

function snapshotListTasksQueries(queryClient: QueryClient) {
  return queryClient.getQueriesData<ListTasksData>({
    queryKey: LIST_TASKS_QUERY_KEY,
  });
}

function restoreListTasksQueries(
  queryClient: QueryClient,
  previous: ListTasksMutationContext["previous"],
) {
  for (const [key, data] of previous) {
    queryClient.setQueryData(key, data);
  }
}

function getPreviousListTasksQueries(
  context: unknown,
): ListTasksMutationContext["previous"] {
  if (
    context &&
    typeof context === "object" &&
    "previous" in context &&
    Array.isArray(context.previous)
  ) {
    return context.previous;
  }
  return [];
}

async function beginListTasksOptimisticUpdate(
  queryClient: QueryClient,
  patch: (tasks: TaskWithFields[]) => TaskWithFields[],
) {
  await queryClient.cancelQueries({ queryKey: LIST_TASKS_QUERY_KEY });
  const previous = snapshotListTasksQueries(queryClient);
  patchListTasksCache(queryClient, patch);
  return { previous };
}

function listTasksOptimisticLifecycle(queryClient: QueryClient) {
  return {
    onError: (_error: unknown, _variables: unknown, context: unknown) => {
      restoreListTasksQueries(
        queryClient,
        getPreviousListTasksQueries(context),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: LIST_TASKS_QUERY_KEY });
    },
  };
}

function makeOptimisticTask(title: string, tasks: TaskWithFields[]): Task {
  const now = new Date().toISOString();
  const minSortOrder = Math.min(0, ...tasks.map((task) => task.sortOrder));
  return {
    id: `optimistic-${crypto.randomUUID()}`,
    title,
    done: false,
    sortOrder: minSortOrder - 1000,
    ownerEmail: "",
    createdAt: now,
    updatedAt: now,
  };
}

function getOptimisticTaskId(context: unknown) {
  if (
    context &&
    typeof context === "object" &&
    "optimisticId" in context &&
    typeof context.optimisticId === "string"
  ) {
    return context.optimisticId;
  }
  return undefined;
}

export function useTasks(opts?: {
  includeDone?: boolean;
  includeFields?: boolean;
}) {
  const params = {
    ...(opts?.includeDone ? { includeDone: true } : {}),
    ...(opts?.includeFields ? { includeFields: true } : {}),
  };
  const query = useActionQuery("list-tasks", params);
  const listData = query.data as ListTasksData | undefined;

  return {
    ...query,
    tasks: listData?.tasks ?? [],
    hasCompletedTasks: listData?.hasCompletedTasks ?? false,
  };
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useActionMutation<Task, { title: string }>("create-task", {
    onMutate: async ({ title }) => {
      const existing =
        queryClient
          .getQueriesData<ListTasksData>({ queryKey: LIST_TASKS_QUERY_KEY })
          .find(([, data]) => data?.tasks)?.[1]?.tasks ?? [];
      const optimisticTask = makeOptimisticTask(title, existing);
      const context = await beginListTasksOptimisticUpdate(
        queryClient,
        (tasks) => [optimisticTask, ...tasks],
      );
      return { ...context, optimisticId: optimisticTask.id };
    },
    onSuccess: (created, _variables, context) => {
      const optimisticId = getOptimisticTaskId(context);
      patchListTasksCache(queryClient, (tasks) =>
        tasks.map((task) =>
          optimisticId && task.id === optimisticId ? created : task,
        ),
      );
    },
    ...listTasksOptimisticLifecycle(queryClient),
  });
}

export type TaskPatch = {
  title?: string | undefined;
  done?: boolean | undefined;
  fieldValues?:
    | Array<{ fieldId: string; value: FieldValue | null }>
    | undefined;
};

function withTaskPatch(
  task: TaskWithFields,
  { title, done, fieldValues }: TaskPatch,
  updatedAt: string,
): TaskWithFields {
  return {
    ...task,
    ...(title !== undefined ? { title } : {}),
    ...(done !== undefined ? { done } : {}),
    ...(fieldValues && task.fields
      ? {
          fields: task.fields.map((field) => {
            const next = fieldValues.find(
              (value) => value.fieldId === field.id,
            );
            return next ? { ...field, value: next.value } : field;
          }),
        }
      : {}),
    updatedAt,
  };
}

function patchCachedTask(
  queryClient: QueryClient,
  taskId: string,
  patch: TaskPatch,
) {
  const timestamp = new Date().toISOString();
  patchListTasksCache(queryClient, (tasks) =>
    tasks.map((task) =>
      task.id === taskId ? withTaskPatch(task, patch, timestamp) : task,
    ),
  );
}

export function useUpdateTask(
  options: {
    overlay?: ((taskId: string) => TaskPatch | undefined) | undefined;
  } = {},
) {
  const queryClient = useQueryClient();
  const lifecycle = listTasksOptimisticLifecycle(queryClient);
  const applyOverlay = (taskId: string) => {
    const overlay = options.overlay?.(taskId);
    if (overlay) patchCachedTask(queryClient, taskId, overlay);
  };
  return useActionMutation<
    TaskWithFields,
    {
      taskId: string;
      title?: string;
      done?: boolean;
      fieldValues?: Array<{ fieldId: string; value: FieldValue | null }>;
      expectedRevision?: string;
    }
  >("update-task", {
    onMutate: async ({ taskId, ...patch }) => {
      const timestamp = new Date().toISOString();
      const context = await beginListTasksOptimisticUpdate(
        queryClient,
        (tasks) =>
          tasks.map((task) =>
            task.id === taskId ? withTaskPatch(task, patch, timestamp) : task,
          ),
      );
      applyOverlay(taskId);
      return context;
    },
    onSuccess: (updated) => {
      patchListTasksCache(queryClient, (tasks) =>
        tasks.map((task) => {
          if (task.id !== updated.id) return task;
          const fields = updated.fields ?? task.fields;
          return fields
            ? { ...task, ...updated, fields }
            : { ...task, ...updated };
        }),
      );
      applyOverlay(updated.id);
    },
    onError: (error, variables, context) => {
      lifecycle.onError(error, variables, context);
      applyOverlay(variables.taskId);
    },
    onSettled: lifecycle.onSettled,
  });
}

export function usePatchCachedTask() {
  const queryClient = useQueryClient();
  return useCallback(
    (taskId: string, patch: TaskPatch) =>
      patchCachedTask(queryClient, taskId, patch),
    [queryClient],
  );
}

export function useOnListTasksReload(onReload: () => void) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "success" &&
          event.action.manual !== true &&
          matchQuery({ queryKey: LIST_TASKS_QUERY_KEY }, event.query)
        ) {
          onReload();
        }
      }),
    [queryClient, onReload],
  );
}

export function useSetCachedTaskRecord() {
  const queryClient = useQueryClient();
  return useCallback(
    (
      taskId: string,
      record: {
        title: string;
        done: boolean;
        fields: Record<string, FieldValue>;
      },
      revision: string | null,
    ) => {
      const values = new Map(Object.entries(record.fields));
      patchListTasksCache(queryClient, (tasks) =>
        tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                title: record.title,
                done: record.done,
                ...(task.fields
                  ? {
                      fields: task.fields.map((field) => ({
                        ...field,
                        value: values.get(field.id) ?? null,
                      })),
                    }
                  : {}),
                ...(revision === null ? {} : { revision }),
              }
            : task,
        ),
      );
    },
    [queryClient],
  );
}

export function useReadCachedTask() {
  const queryClient = useQueryClient();
  return useCallback(
    (taskId: string): TaskWithFields | undefined => {
      let newest: { task: TaskWithFields; at: number } | undefined;
      for (const [key, data] of snapshotListTasksQueries(queryClient)) {
        const task = data?.tasks.find((candidate) => candidate.id === taskId);
        if (!task?.fields || !task.revision) continue;
        const at = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
        if (!newest || at > newest.at) newest = { task, at };
      }
      return newest?.task;
    },
    [queryClient],
  );
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useActionMutation<{ ok: true }, { taskId: string }>("delete-task", {
    onMutate: async ({ taskId }) =>
      beginListTasksOptimisticUpdate(queryClient, (tasks) =>
        tasks.filter((task) => task.id !== taskId),
      ),
    ...listTasksOptimisticLifecycle(queryClient),
    errorNotification: "shared",
  });
}

export function useBulkUpdateTasks() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { tasks: Task[] },
    { taskIds: string[]; title?: string; done?: boolean }
  >("bulk-update-tasks", {
    onMutate: async ({ taskIds, title, done }) => {
      const selected = new Set(taskIds);
      const timestamp = new Date().toISOString();
      return beginListTasksOptimisticUpdate(queryClient, (tasks) =>
        tasks.map((task) =>
          selected.has(task.id)
            ? {
                ...task,
                ...(title !== undefined ? { title } : {}),
                ...(done !== undefined ? { done } : {}),
                updatedAt: timestamp,
              }
            : task,
        ),
      );
    },
    onSuccess: ({ tasks: updatedTasks }) => {
      const byId = new Map(updatedTasks.map((task) => [task.id, task]));
      patchListTasksCache(queryClient, (tasks) =>
        tasks.map((task) => {
          const updated = byId.get(task.id);
          return updated ? { ...task, ...updated, fields: task.fields } : task;
        }),
      );
    },
    ...listTasksOptimisticLifecycle(queryClient),
  });
}

export function useBulkDeleteTasks() {
  const queryClient = useQueryClient();
  return useActionMutation<
    { ok: true; deleted: number },
    { taskIds: string[] }
  >("bulk-delete-tasks", {
    onMutate: async ({ taskIds }) => {
      const selected = new Set(taskIds);
      return beginListTasksOptimisticUpdate(queryClient, (tasks) =>
        tasks.filter((task) => !selected.has(task.id)),
      );
    },
    ...listTasksOptimisticLifecycle(queryClient),
  });
}

export function useReorderTasks() {
  const queryClient = useQueryClient();
  return useActionMutation("reorder-tasks", {
    onSettled: () => {
      void invalidateTasks(queryClient);
    },
    errorNotification: "shared",
  });
}
