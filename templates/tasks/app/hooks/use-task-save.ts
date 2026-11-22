import { useT } from "@agent-native/core/client/i18n";
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
import { useReadCachedTask, useUpdateTask } from "./use-tasks";

export type TaskChange = {
  title?: string;
  done?: boolean;
  fieldValues?: Array<{ fieldId: string; value: FieldValue | null }>;
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

export function useTaskSave() {
  const t = useT();
  const updateTask = useUpdateTask();
  const { mutateAsync } = updateTask;
  const readCachedTask = useReadCachedTask();
  const savedRef = useRef(new Map<string, SavedRecord<TaskRecord>>());
  const queueRef = useRef(new Map<string, Promise<void>>());
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
      if (!taskId || !task?.fields) return;
      const current = taskRecordOf(task, task.fields);
      void save(taskId, taskChangeBetween(current, restoreOnto(current))).catch(
        () => {},
      );
    },
  });

  const saveOne = async (taskId: string, change: TaskChange) => {
    const cached = readCachedTask(taskId);
    const base =
      savedRef.current.get(taskId) ??
      (cached?.fields && cached.revision
        ? {
            value: taskRecordOf(cached, cached.fields),
            revision: cached.revision,
          }
        : null);
    if (!base) {
      await mutateAsync({ taskId, ...change });
      return;
    }
    const mine = applyTaskChange(base.value, change);
    if (isSameRecord(mine, base.value)) return;
    const resolveOverlap = (
      overlap: SaveOverlap<TaskRecord>,
      finished: Promise<boolean>,
    ) => {
      overlapTaskRef.current.set(overlap.keepMine, taskId);
      overlapTaskRef.current.set(overlap.useTheirs, taskId);
      return conflict.resolveOverlap(overlap, finished);
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

  const save = (taskId: string, change: TaskChange) => {
    const queue = queueRef.current;
    const previous = queue.get(taskId) ?? Promise.resolve();
    const run = previous.then(() => saveOne(taskId, change));
    const settled = run.catch(() => {});
    queue.set(taskId, settled);
    void settled.then(() => {
      if (queue.get(taskId) !== settled) return;
      queue.delete(taskId);
      savedRef.current.delete(taskId);
    });
    return run;
  };

  return {
    save,
    isPending: updateTask.isPending,
    conflictPrompt: conflict.prompt,
  };
}
