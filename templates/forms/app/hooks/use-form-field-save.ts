import {
  isSameRecord,
  isSaveConflict,
  rebaseOntoSaved,
  saveWithMerge,
  type SavedRecord,
} from "@agent-native/core/save-conflict";
import { useSaveConflictPrompt } from "@agent-native/toolkit/app/save-conflict";
import type { Form, FormField } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeFields } from "@/lib/normalize-fields";

import { usePatchFormFields } from "./use-forms";

const SAVE_DEBOUNCE_MS = 500;
const CONTENDED_RETRY_MS = 1_000;

export type FieldOp =
  | { op: "upsert"; field: FormField }
  | { op: "remove"; id: string }
  | { op: "reorder"; ids: string[] };

/** The smallest ops that turn one field list into another on the server. */
export function fieldOpsBetween(from: FormField[], to: FormField[]): FieldOp[] {
  const ops: FieldOp[] = [];
  const toIds = new Set(to.map((field) => field.id));
  for (const field of from) {
    if (!toIds.has(field.id)) ops.push({ op: "remove", id: field.id });
  }
  const before = new Map(from.map((field) => [field.id, field]));
  for (const field of to) {
    if (!isSameRecord(before.get(field.id), field)) {
      ops.push({ op: "upsert", field });
    }
  }
  // Upserts keep a field's place and append new ones, which leaves this order.
  const afterOps = [
    ...from.filter((field) => toIds.has(field.id)),
    ...to.filter((field) => !before.has(field.id)),
  ].map((field) => field.id);
  const wanted = to.map((field) => field.id);
  if (afterOps.some((id, index) => id !== wanted[index])) {
    ops.push({ op: "reorder", ids: wanted });
  }
  return ops;
}

/**
 * The builder's field list: local edits save on a debounce against the revision
 * they started from, and merge onto anything another tab or the agent saved.
 */
export function useFormFieldSave(
  form: Pick<Form, "id" | "fields" | "revision"> | undefined,
) {
  const patchFormFields = usePatchFormFields();
  const formId = form?.id;
  const [localFields, setLocalFields] = useState<FormField[]>(() =>
    normalizeFields(form?.fields),
  );
  const localRef = useRef(localFields);
  const savedRef = useRef<SavedRecord<FormField[]>>({
    value: localFields,
    revision: form?.revision ?? null,
  });
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const replaceLocal = useCallback((next: FormField[]) => {
    localRef.current = next;
    setLocalFields(next);
  }, []);

  const flushRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((delayMs: number) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      void flushRef.current();
    }, delayMs);
  }, []);

  const editFields = useCallback(
    (change: (fields: FormField[]) => FormField[]) => {
      replaceLocal(change(localRef.current));
      dirtyRef.current = true;
      schedule(SAVE_DEBOUNCE_MS);
    },
    [replaceLocal, schedule],
  );

  const conflict = useSaveConflictPrompt<FormField[]>({
    record: "form_fields",
    describeField: (path, overlap) => {
      const id = path.split(".")[0];
      const field =
        overlap.mine.find((candidate) => candidate.id === id) ??
        overlap.theirs.find((candidate) => candidate.id === id);
      return field?.label ?? null;
    },
    onRestore: (fields) => editFields(() => fields),
  });

  flushRef.current = async () => {
    if (savingRef.current || !formId) return;
    savingRef.current = true;
    try {
      while (!isSameRecord(savedRef.current.value, localRef.current)) {
        const mine = localRef.current;
        const saved = await saveWithMerge<FormField[]>({
          base: savedRef.current,
          mine,
          parseCurrent: (current) => normalizeFields(current as FormField[]),
          resolveOverlap: conflict.resolveOverlap,
          save: async ({ value, revision, base }) => {
            const result = await patchFormFields.mutateAsync({
              id: formId,
              ops: fieldOpsBetween(base, value),
              expectedRevision: revision ?? undefined,
            });
            return {
              value: normalizeFields(result.fields),
              revision: result.revision,
            };
          },
        });
        savedRef.current = saved;
        replaceLocal(rebaseOntoSaved(mine, localRef.current, saved.value));
      }
      dirtyRef.current = false;
    } catch (error) {
      // Other failures toast from the mutation and keep the edits for the next
      // save. Only a record too contended to settle in one go tries by itself.
      if (isSaveConflict(error)) schedule(CONTENDED_RETRY_MS);
    } finally {
      savingRef.current = false;
    }
  };

  const serverFields = form?.fields;
  const serverRevision = form?.revision;
  useEffect(() => {
    if (!serverFields || dirtyRef.current) return;
    const fields = normalizeFields(serverFields);
    savedRef.current = { value: fields, revision: serverRevision ?? null };
    replaceLocal(fields);
  }, [replaceLocal, serverFields, serverRevision]);

  useEffect(
    () => () => {
      if (!dirtyRef.current) return;
      clearTimeout(timerRef.current);
      void flushRef.current();
    },
    [],
  );

  return { localFields, editFields, fieldConflictPrompt: conflict.prompt };
}
