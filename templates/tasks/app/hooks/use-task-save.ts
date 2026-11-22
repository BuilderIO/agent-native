import { useT } from "@agent-native/core/client/i18n";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import {
  isSameRecord,
  SaveOverlapError,
  saveWithMerge,
  type SavedRecord,
  type SaveOverlap,
} from "@agent-native/core/save-conflict";
import { useSaveConflictPrompt } from "@agent-native/toolkit/app/save-conflict";
import { useRef } from "react";

import type { FieldValue } from "../../server/custom-fields/values/store.js";
import {
  TASK_RECORD,
  taskRecordOf,
  type TaskRecord,
} from "../../shared/task-record.js";
import {
  usePatchCachedTask,
  useReadCachedTask,
  useUpdateTask,
  type TaskWithFields,
} from "./use-tasks";

export type TaskChange = {
  title?: string;
  done?: boolean;
  fieldValues?: Array<{ fieldId: string; value: FieldValue | null }>;
};

type PendingSave = {
  change: TaskChange;
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
};

export function applyTaskChange(
  record: TaskRecord,
  change: TaskChange,
): TaskRecord {
  const fields = { ...record.fields };
  for (const { fieldId, value } of change.fieldValues ?? []) {
    if (value === null) delete fields[fieldId];
    else fields[fieldId] = value;
  }
  return {
    title: change.title ?? record.title,
    done: change.done ?? record.done,
    fields,
  };
}

export function taskChangeBetween(
  from: TaskRecord,
  to: TaskRecord,
): TaskChange {
  const change: TaskChange = {};
  if (to.title !== from.title) change.title = to.title;
  if (to.done !== from.done) change.done = to.done;
  const fieldValues: NonNullable<TaskChange["fieldValues"]> = [];
  for (const fieldId of new Set([
    ...Object.keys(from.fields),
    ...Object.keys(to.fields),
  ])) {
    if (!isSameRecord(from.fields[fieldId], to.fields[fieldId])) {
      fieldValues.push({ fieldId, value: to.fields[fieldId] ?? null });
    }
  }
  if (fieldValues.length > 0) change.fieldValues = fieldValues;
  return change;
}

export function mergeTaskChanges(
  earlier: TaskChange,
  later: TaskChange,
): TaskChange {
  const values = new Map<string, FieldValue | null>();
  for (const { fieldId, value } of [
    ...(earlier.fieldValues ?? []),
    ...(later.fieldValues ?? []),
  ]) {
    values.set(fieldId, value);
  }
  const merged: TaskChange = { ...earlier, ...later };
  if (values.size > 0) {
    merged.fieldValues = [...values].map(([fieldId, value]) => ({
      fieldId,
      value,
    }));
  }
  return merged;
}

export function withoutTaskPaths(
  change: TaskChange,
  paths: string[],
): TaskChange {
  const covers = (path: string) =>
    paths.some(
      (candidate) => candidate === path || candidate.startsWith(`${path}.`),
    );
  const kept: TaskChange = {};
  if (change.title !== undefined && !covers("title")) kept.title = change.title;
  if (change.done !== undefined && !covers("done")) kept.done = change.done;
  const fieldValues = (change.fieldValues ?? []).filter(
    ({ fieldId }) => !covers(`fields.${fieldId}`),
  );
  if (fieldValues.length > 0) kept.fieldValues = fieldValues;
  return kept;
}

export function useTaskSave() {
  const t = useT();
  const updateTask = useUpdateTask();
  const { mutateAsync } = updateTask;
  const readCachedTask = useReadCachedTask();
  const patchCachedTask = usePatchCachedTask();
  const savedRef = useRef(new Map<string, SavedRecord<TaskRecord>>());
  const pendingRef = useRef(new Map<string, PendingSave>());
  const runningRef = useRef(new Set<string>());
  const overlapTaskRef = useRef(new WeakMap<TaskRecord, string>());

  const conflict = useSaveConflictPrompt<TaskRecord>({
    record: TASK_RECORD,
    describeField: (path, overlap) => {
      if (path === "title") return t("taskFields.titleLabel");
      if (path === "done") return t("selection.completeLabel");
      const fieldId = path.split(".")[1];
      const taskId = overlapTaskRef.current.get(overlap.keepMine);
      const field = taskId
        ? readCachedTask(taskId)?.fields?.find((item) => item.id === fieldId)
        : undefined;
      return field?.title ?? null;
    },
    onRestore: (restoreOnto, other) => {
      const taskId = overlapTaskRef.current.get(other);
      const task = taskId ? readCachedTask(taskId) : undefined;
      if (!task?.fields) return;
      const current = taskRecordOf(task, task.fields);
      void save(task, taskChangeBetween(current, restoreOnto(current))).catch(
        (error: unknown) => reportWriteFailure(error),
      );
    },
  });

  const saveOne = async (taskId: string, change: TaskChange) => {
    const base = savedRef.current.get(taskId);
    if (!base) {
      const result = await mutateAsync({ taskId, ...change });
      if (result.fields && result.revision) {
        savedRef.current.set(taskId, {
          value: taskRecordOf(result, result.fields),
          revision: result.revision,
        });
      }
      return;
    }
    const mine = applyTaskChange(base.value, change);
    if (isSameRecord(mine, base.value)) return;
    const resolveOverlap = async (
      overlap: SaveOverlap<TaskRecord>,
      finished: Promise<boolean>,
    ) => {
      overlapTaskRef.current.set(overlap.keepMine, taskId);
      overlapTaskRef.current.set(overlap.useTheirs, taskId);
      const chosen = await conflict.resolveOverlap(overlap, finished);
      const pending = pendingRef.current.get(taskId);
      if (pending && chosen === overlap.useTheirs) {
        pending.change = withoutTaskPaths(pending.change, overlap.fields);
      }
      return chosen;
    };
    try {
      const saved = await saveWithMerge<TaskRecord>({
        base,
        mine,
        resolveOverlap,
        save: async ({ value, revision, base: from }) => {
          const result = await mutateAsync({
            taskId,
            ...taskChangeBetween(from, value),
            ...(revision === null ? {} : { expectedRevision: revision }),
          });
          return {
            value: taskRecordOf(result, result.fields ?? []),
            revision: result.revision ?? null,
          };
        },
      });
      savedRef.current.set(taskId, saved);
    } catch (error) {
      if (error instanceof SaveOverlapError) return;
      throw error;
    }
  };

  const run = async (taskId: string) => {
    runningRef.current.add(taskId);
    try {
      for (
        let next = pendingRef.current.get(taskId);
        next;
        next = pendingRef.current.get(taskId)
      ) {
        pendingRef.current.delete(taskId);
        try {
          await saveOne(taskId, next.change);
          for (const waiter of next.waiters) waiter.resolve();
        } catch (error) {
          for (const waiter of next.waiters) waiter.reject(error);
        }
        const queued = pendingRef.current.get(taskId);
        if (queued) patchCachedTask(taskId, queued.change);
      }
    } finally {
      runningRef.current.delete(taskId);
      savedRef.current.delete(taskId);
    }
  };

  const save = (
    task: TaskWithFields,
    change: TaskChange,
    startedFrom: TaskWithFields = task,
  ) => {
    const taskId = task.id;
    if (
      !runningRef.current.has(taskId) &&
      startedFrom.fields &&
      startedFrom.revision
    ) {
      savedRef.current.set(taskId, {
        value: taskRecordOf(startedFrom, startedFrom.fields),
        revision: startedFrom.revision,
      });
    }
    patchCachedTask(taskId, change);
    return new Promise<void>((resolve, reject) => {
      const pending = pendingRef.current.get(taskId);
      pendingRef.current.set(taskId, {
        change: pending ? mergeTaskChanges(pending.change, change) : change,
        waiters: [...(pending?.waiters ?? []), { resolve, reject }],
      });
      if (!runningRef.current.has(taskId)) void run(taskId);
    });
  };

  return {
    save,
    isPending: updateTask.isPending,
    conflictPrompt: conflict.prompt,
  };
}
