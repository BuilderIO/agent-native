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
import { useCallback, useRef } from "react";

import type { FieldValue } from "../../server/custom-fields/values/store.js";
import {
  TASK_RECORD,
  taskRecordOf,
  type TaskRecord,
} from "../../shared/task-record.js";
import {
  useOnListTasksReload,
  usePatchCachedTask,
  useReadCachedTask,
  useSetCachedTaskRecord,
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
  start: SavedRecord<TaskRecord> | null;
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

function editsOnTopOf(
  entry: PendingSave,
  start: SavedRecord<TaskRecord> | null,
) {
  if (!entry.start || !start) return !entry.start && !start;
  return isSameRecord(
    applyTaskChange(entry.start.value, entry.change),
    start.value,
  );
}

export function useTaskSave() {
  const t = useT();
  const pendingRef = useRef(new Map<string, PendingSave[]>());
  const inFlightRef = useRef(new Map<string, TaskChange>());
  const savedRef = useRef(new Map<string, SavedRecord<TaskRecord>>());
  const runningRef = useRef(new Set<string>());
  const overlapTaskRef = useRef(new WeakMap<TaskRecord, string>());
  const queuedChange = (taskId: string) => {
    const queued = pendingRef.current.get(taskId);
    return queued?.length
      ? queued.map((entry) => entry.change).reduce(mergeTaskChanges)
      : undefined;
  };
  const updateTask = useUpdateTask({ overlay: queuedChange });
  const { mutateAsync } = updateTask;
  const readCachedTask = useReadCachedTask();
  const patchCachedTask = usePatchCachedTask();
  const setCachedTaskRecord = useSetCachedTaskRecord();
  const showUnsaved = useCallback(() => {
    for (const taskId of runningRef.current) {
      const changes = (pendingRef.current.get(taskId) ?? []).map(
        (entry) => entry.change,
      );
      const inFlight = inFlightRef.current.get(taskId);
      if (inFlight) changes.unshift(inFlight);
      if (changes.length > 0) {
        patchCachedTask(taskId, changes.reduce(mergeTaskChanges));
      }
    }
  }, [patchCachedTask]);
  useOnListTasksReload(showUnsaved);

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

  const saveOne = async (taskId: string, entry: PendingSave) => {
    const { change, start } = entry;
    const lastSaved = savedRef.current.get(taskId);
    const base =
      lastSaved && (!start || isSameRecord(lastSaved.value, start.value))
        ? lastSaved
        : start;
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
      if (chosen === overlap.useTheirs) {
        const inFlight = inFlightRef.current.get(taskId);
        if (inFlight) {
          inFlightRef.current.set(
            taskId,
            withoutTaskPaths(inFlight, overlap.fields),
          );
        }
        for (const queued of pendingRef.current.get(taskId) ?? []) {
          queued.change = withoutTaskPaths(queued.change, overlap.fields);
        }
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
      setCachedTaskRecord(taskId, saved.value, saved.revision);
      const queued = queuedChange(taskId);
      if (queued) patchCachedTask(taskId, queued);
    } catch (error) {
      if (error instanceof SaveOverlapError) return;
      throw error;
    }
  };

  const run = async (taskId: string) => {
    runningRef.current.add(taskId);
    try {
      for (
        let next = pendingRef.current.get(taskId)?.shift();
        next;
        next = pendingRef.current.get(taskId)?.shift()
      ) {
        inFlightRef.current.set(taskId, next.change);
        try {
          await saveOne(taskId, next);
          for (const waiter of next.waiters) waiter.resolve();
        } catch (error) {
          for (const waiter of next.waiters) waiter.reject(error);
        } finally {
          inFlightRef.current.delete(taskId);
        }
      }
    } finally {
      runningRef.current.delete(taskId);
      savedRef.current.delete(taskId);
      pendingRef.current.delete(taskId);
    }
  };

  const save = (
    task: TaskWithFields,
    change: TaskChange,
    startedFrom: TaskWithFields = task,
  ) => {
    const taskId = task.id;
    const start =
      startedFrom.fields && startedFrom.revision
        ? {
            value: taskRecordOf(startedFrom, startedFrom.fields),
            revision: startedFrom.revision,
          }
        : null;
    patchCachedTask(taskId, change);
    return new Promise<void>((resolve, reject) => {
      const queued = pendingRef.current.get(taskId) ?? [];
      pendingRef.current.set(taskId, queued);
      const last = queued.length > 0 ? queued[queued.length - 1] : undefined;
      if (last && editsOnTopOf(last, start)) {
        last.change = mergeTaskChanges(last.change, change);
        last.waiters.push({ resolve, reject });
      } else {
        queued.push({ change, start, waiters: [{ resolve, reject }] });
      }
      if (!runningRef.current.has(taskId)) void run(taskId);
    });
  };

  return {
    save,
    isPending: updateTask.isPending,
    conflictPrompt: conflict.prompt,
  };
}
