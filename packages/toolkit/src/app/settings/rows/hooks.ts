import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type {
  SettingsBinding,
  SettingsCollectionAdd,
  SettingsCollectionField,
  SettingsCollectionFieldValue,
  SettingsRowAction,
  SettingsRowDefinition,
  SettingsWriteConfirmation,
} from "./schema.js";

/**
 * The behavior of a row, without markup. Every skin uses these, so a write, a
 * confirmation or a form submit happens the same way whatever draws it.
 */

/** The two attributes every skin writes on a row, a control or a sub-part. */
export function settingsTags(
  rid: string,
  part: string,
  key?: string,
  also?: { rid: string; part: string },
): Record<string, string> {
  const tags = {
    "data-rid": also ? `${rid} ${also.rid}` : rid,
    "data-part": also ? `${part} ${also.part}` : part,
  };
  return key === undefined ? tags : { ...tags, "data-rid-key": key };
}

export function isSettingsRowDisabled(row: SettingsRowDefinition): boolean {
  if (row.condition?.disabled || row.condition?.disabledReason) return true;
  if (row.state) return true;
  if ("binding" in row) return !row.binding.set || row.binding.pending === true;
  return false;
}

export function isSettingsActionDisabled(action: SettingsRowAction): boolean {
  return Boolean(
    action.pending ||
    action.condition?.disabled ||
    action.condition?.disabledReason,
  );
}

async function settle(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    // coercion-ok: the model reports its own failures (a toast, an `error`
    // field); a renderer only needs the write to have finished.
  }
}

/**
 * A write that may ask first. `write` either commits or opens the
 * confirmation; the skin draws the dialog from `confirmation`.
 */
export function useSettingsWrite<Value>(binding: SettingsBinding<Value>) {
  const [pendingValue, setPendingValue] = useState<{ value: Value } | null>(
    null,
  );
  const confirm: SettingsWriteConfirmation<Value> | undefined = binding.confirm;
  return {
    write(next: Value) {
      if (!binding.set) return;
      if (confirm?.when(next)) setPendingValue({ value: next });
      else void settle(() => binding.set?.(next));
    },
    /** Present while the confirmation is open. */
    confirmation:
      confirm && pendingValue
        ? {
            title: confirm.title,
            description: confirm.description,
            confirmLabel: confirm.confirmLabel,
            cancelLabel: confirm.cancelLabel,
            intent: confirm.intent ?? "neutral",
            confirm() {
              const { value } = pendingValue;
              setPendingValue(null);
              void settle(() => binding.set?.(value));
            },
            cancel() {
              setPendingValue(null);
            },
          }
        : null,
  };
}

/**
 * What activating an action does: run it, navigate, or open a dialog the skin
 * then draws.
 */
export function useSettingsAction(action: SettingsRowAction) {
  const [ownOpen, setOwnOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const trigger = action.trigger;
  const disabled = isSettingsActionDisabled(action) || running;
  const controlled =
    trigger.kind === "dialog" && trigger.open !== undefined && trigger.setOpen;
  const open =
    trigger.kind === "dialog" && controlled ? trigger.open === true : ownOpen;
  const setOpen = (next: boolean) => {
    if (trigger.kind === "dialog" && controlled) trigger.setOpen?.(next);
    else setOwnOpen(next);
  };
  async function run(fn: () => void | Promise<void>) {
    setRunning(true);
    try {
      await settle(fn);
    } finally {
      setRunning(false);
    }
  }
  return {
    disabled,
    running,
    href: trigger.kind === "navigate" ? trigger.href : undefined,
    external: trigger.kind === "navigate" ? trigger.external === true : false,
    opensDialog: trigger.kind === "dialog" || trigger.kind === "confirm",
    open,
    setOpen,
    activate() {
      if (disabled) return;
      if (trigger.kind === "invoke") void run(trigger.run);
      else if (trigger.kind === "dialog" || trigger.kind === "confirm") {
        setOpen(true);
      }
    },
    /** Closes the dialog when the run succeeds; a run that fails leaves it open. */
    async confirm() {
      if (trigger.kind !== "confirm") return;
      setRunning(true);
      try {
        await trigger.run();
        setOpen(false);
      } catch {
        // coercion-ok: the model reports the failure; the dialog stays for another try.
      } finally {
        setRunning(false);
      }
    },
  };
}

function initialFieldValue(
  field: SettingsCollectionField,
): SettingsCollectionFieldValue {
  if (field.initialValue !== undefined) return field.initialValue;
  if (field.kind === "checkbox") return false;
  if (field.kind === "image") return null;
  return "";
}

/** A collection's add form: field values, validity and submit, without markup. */
export function useSettingsCollectionAdd(
  add: Extract<SettingsCollectionAdd, { kind: "fields" }>,
) {
  const initial = () =>
    Object.fromEntries(
      add.fields.map((field) => [field.id, initialFieldValue(field)]),
    ) as Record<string, SettingsCollectionFieldValue>;
  const [values, setValues] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const missing = add.fields.some((field) => {
    if (!("required" in field) || !field.required) return false;
    const value = values[field.id];
    if (typeof value === "string") return value.trim() === "";
    return value === null;
  });
  return {
    values,
    set(id: string, value: SettingsCollectionFieldValue) {
      setSubmitError(null);
      setValues((current) => ({ ...current, [id]: value }));
    },
    reset() {
      setSubmitError(null);
      setValues(initial());
    },
    canSubmit: !missing && !submitting && !add.pending,
    submitting: submitting || add.pending === true,
    fieldsDisabled: submitting,
    /** The model's message, or the one the last submit returned. */
    error: add.error ?? submitError,
    /** Resolves `true` when the item was saved. A failed submit keeps the values. */
    async submit(): Promise<boolean> {
      if (missing || submitting) return false;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const result = await add.submit(values);
        if (result && typeof result === "object" && "error" in result) {
          setSubmitError(result.error);
          return false;
        }
        setValues((current) => {
          const next = initial();
          for (const field of add.fields) {
            const kept = Object.entries(current).find(
              ([id]) => id === field.id,
            );
            if (field.keepAfterSubmit && kept) next[field.id] = kept[1];
          }
          return next;
        });
        return true;
      } catch {
        // coercion-ok: `false` is "not saved"; the model reports why and the form keeps its values.
        return false;
      } finally {
        setSubmitting(false);
      }
    },
  };
}

type TextRow = Extract<
  SettingsRowDefinition,
  { kind: "text" | "textarea" | "time" }
>;

/**
 * A text row's draft and when it is written: on each change, on leaving the
 * field (or Enter in a one-line field), or on an explicit save. A `view` row
 * shows its value until editing starts.
 */
export function useSettingsTextDraft(row: TextRow) {
  const binding = row.binding;
  const commit =
    row.mode === "view" ? "explicit" : (binding.commit ?? "change");
  const [draft, setDraft] = useState<string | null>(null);
  const [ownEditing, setOwnEditing] = useState(false);
  // The model may own the editing state, so it can end an edit itself and
  // hears when one ends without a write.
  const controlled = row.editing !== undefined && row.setEditing !== undefined;
  const editing =
    row.mode !== "view" ? true : controlled ? row.editing === true : ownEditing;
  const setEditing = (next: boolean) => {
    if (controlled) row.setEditing?.(next);
    else setOwnEditing(next);
  };
  useEffect(() => {
    if (!editing) setDraft(null);
  }, [editing]);
  const value = draft ?? binding.value;
  const dirty = draft !== null && draft !== binding.value;
  // A write that fails keeps the draft, so the user can try again.
  const flush = () => {
    const next = draft;
    if (next === null || next === binding.value) {
      setDraft(null);
      if (row.mode === "view") setEditing(false);
      return;
    }
    void (async () => {
      try {
        await binding.set?.(next);
        setDraft((current) => (current === next ? null : current));
        if (row.mode === "view") setEditing(false);
      } catch {
        // coercion-ok: the model reports the failure through `error` or `status`.
      }
    })();
  };
  return {
    value,
    dirty,
    commit,
    editing,
    startEditing() {
      row.onEditStart?.();
      setEditing(true);
    },
    change(next: string) {
      if (commit === "change") void settle(() => binding.set?.(next));
      else setDraft(next);
    },
    blur() {
      if (commit === "blur") flush();
    },
    keyDown(event: ReactKeyboardEvent<HTMLElement>) {
      if (
        event.key === "Enter" &&
        commit === "blur" &&
        row.kind !== "textarea"
      ) {
        flush();
      }
    },
    save: flush,
    cancel() {
      setDraft(null);
      if (row.mode === "view") setEditing(false);
    },
  };
}
