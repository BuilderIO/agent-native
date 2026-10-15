import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { DataNote } from "@shared/data-notes";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** An annotation list query and how to reach the items in its result. */
interface AnnotationList<Data, Item> {
  action: "list-data-notes" | "list-key-dates";
  items(data: Data): Item[];
  with(data: Data, items: Item[]): Data;
}

const DATA_NOTES: AnnotationList<{ notes: DataNote[] }, DataNote> = {
  action: "list-data-notes",
  items: (data) => data.notes,
  with: (data, notes) => ({ ...data, notes }),
};

const KEY_DATE_SETS: AnnotationList<{ sets: KeyDateSet[] }, KeyDateSet> = {
  action: "list-key-dates",
  items: (data) => data.sets,
  with: (data, sets) => ({ ...data, sets }),
};

/** An optimistic edit, and how to take back only that edit. */
type Change<T> = { next: T; revert: (current: T) => T };

const PENDING_PREFIX = "pending-";
let pendingCount = 0;
/** Unique, so a failed add takes back its own placeholder and no other. */
const pendingId = () => `${PENDING_PREFIX}${++pendingCount}`;

/**
 * Whether an annotation is still the placeholder shown before the server
 * confirms it. The server knows no such id, so nothing may act on one or save
 * it until the refetch brings the real id.
 */
export const isPendingAnnotation = (id: string) =>
  id.startsWith(PENDING_PREFIX);

function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function removeItem<T extends { id: string }>(
  items: T[],
  id: string,
): Change<T[]> {
  const index = items.findIndex((item) => item.id === id);
  const removed = items[index];
  return {
    next: items.filter((item) => item.id !== id),
    revert: (current) =>
      !removed || current.some((item) => item.id === id)
        ? current
        : insertAt(current, index, removed),
  };
}

/**
 * Writes an annotation list optimistically. Failures toast here rather than
 * through `mutate`'s per-call callbacks: those never run once the dialog that
 * called `mutate` has closed. A failure reverts only its own change, since
 * restoring a snapshot would also erase other writes still in flight, and the
 * list refetches once the last overlapping write settles.
 */
function useAnnotationWrite<TInput, Data, Item>(
  action: string,
  list: AnnotationList<Data, Item>,
  failure: "annotations.saveFailed" | "annotations.deleteFailed",
  change: (items: Item[], input: TInput) => Change<Item[]>,
) {
  const client = useQueryClient();
  const t = useT();
  const queryKey = ["action", list.action, undefined];
  const mutationKey = ["annotation-write", list.action];
  return useActionMutation<unknown, TInput>(action, {
    mutationKey,
    skipActionQueryInvalidation: true,
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey });
      const data = client.getQueryData<Data>(queryKey);
      if (!data) return undefined;
      const { next, revert } = change(list.items(data), input as TInput);
      client.setQueryData<Data>(queryKey, list.with(data, next));
      return { revert };
    },
    onError: (error, _input, context) => {
      const revert = (context as Pick<Change<Item[]>, "revert"> | undefined)
        ?.revert;
      if (revert) {
        client.setQueryData<Data>(
          queryKey,
          (current) =>
            current && list.with(current, revert(list.items(current))),
        );
      }
      toast.error(t(failure, { message: error.message }));
    },
    onSettled: () => {
      // The settling write still counts as pending here.
      if (client.isMutating({ mutationKey }) > 1) return;
      void client.invalidateQueries({ queryKey: ["action", list.action] });
    },
  });
}

export type DataNoteInput = Partial<
  Omit<
    DataNote,
    "id" | "addedBy" | "updatedAt" | "startDate" | "endDate" | "fix"
  >
> & {
  id?: string;
  startDate?: string | null;
  endDate?: string | null;
  fix?: string | null;
};

function patchNote(note: DataNote, input: DataNoteInput): DataNote {
  const next: Record<string, unknown> = { ...note };
  for (const [key, value] of Object.entries(input)) {
    if (key === "id" || value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as unknown as DataNote;
}

/** Saves a data note, showing the change before the server confirms it. */
export function useSaveDataNote() {
  return useAnnotationWrite(
    "save-data-note",
    DATA_NOTES,
    "annotations.saveFailed",
    (notes, input: DataNoteInput): Change<DataNote[]> => {
      const { id } = input;
      if (!id) {
        const added = pendingId();
        const blank: DataNote = {
          id: added,
          kind: "data",
          title: "",
          note: "",
          status: "open",
          matchEvents: [],
          unlessEvents: [],
          panels: [],
          addedBy: "",
          updatedAt: new Date().toISOString(),
        };
        return {
          next: [patchNote(blank, input), ...notes],
          revert: (current) => current.filter((note) => note.id !== added),
        };
      }
      const before = notes.find((note) => note.id === id);
      const replace = (current: DataNote[], note: DataNote) =>
        current.map((other) => (other.id === id ? note : other));
      return {
        next: before ? replace(notes, patchNote(before, input)) : notes,
        revert: (current) => (before ? replace(current, before) : current),
      };
    },
  );
}

export function useDeleteDataNote() {
  return useAnnotationWrite(
    "delete-data-note",
    DATA_NOTES,
    "annotations.deleteFailed",
    (notes, { id }: { id: string }) => removeItem(notes, id),
  );
}

export type KeyDateInput = {
  id?: string;
  setId?: string;
  setName?: string;
  date: string;
  /** Omitted on an edit keeps the saved time; null clears it and its zone. */
  time?: string | null;
  timeZone?: string | null;
  label: string;
};

type PlacedKeyDate = { date: KeyDate; index: number };

function findKeyDate(
  sets: readonly KeyDateSet[],
  id: string,
): PlacedKeyDate | undefined {
  for (const set of sets) {
    const index = set.dates.findIndex((date) => date.id === id);
    if (index >= 0) return { date: set.dates[index], index };
  }
  return undefined;
}

const withoutKeyDate = (sets: KeyDateSet[], id: string) =>
  sets.map((set) =>
    set.dates.some((date) => date.id === id)
      ? { ...set, dates: set.dates.filter((date) => date.id !== id) }
      : set,
  );

/** Puts a key date back where it was, unless its set is gone or has it again. */
const withKeyDateBack = (sets: KeyDateSet[], { date, index }: PlacedKeyDate) =>
  sets.map((set) =>
    set.id === date.setId && !set.dates.some((other) => other.id === date.id)
      ? { ...set, dates: insertAt(set.dates, index, date) }
      : set,
  );

function withKeyDate(
  sets: KeyDateSet[],
  input: KeyDateInput,
  ids: { date: string; newSet: string },
): KeyDateSet[] {
  const { id: _id, setId, setName, time, timeZone, ...fields } = input;
  const saved = findKeyDate(sets, ids.date)?.date;
  // The server's rules, so the optimistic date matches what it will save.
  const keptTime = time === undefined ? saved?.time : (time ?? undefined);
  const keptZone =
    timeZone !== undefined || time === null
      ? (timeZone ?? undefined)
      : saved?.timeZone;
  const target =
    sets.find((set) => set.id === setId) ??
    sets.find(
      (set) => set.name.toLowerCase() === setName?.trim().toLowerCase(),
    );
  const date: KeyDate = {
    id: ids.date,
    setId: target?.id ?? ids.newSet,
    addedBy: saved?.addedBy ?? "",
    updatedAt: new Date().toISOString(),
    ...fields,
    ...(keptTime === undefined ? {} : { time: keptTime }),
    ...(keptZone === undefined ? {} : { timeZone: keptZone }),
  };
  const without = withoutKeyDate(sets, ids.date);
  if (!target) {
    return [
      ...without,
      {
        id: ids.newSet,
        name: setName?.trim() ?? "",
        createdBy: "",
        updatedAt: date.updatedAt,
        dates: [date],
      },
    ];
  }
  return without.map((set) =>
    set.id === target.id ? { ...set, dates: [...set.dates, date] } : set,
  );
}

/** Saves a key date, showing it on charts before the server confirms it. */
export function useSaveKeyDate() {
  return useAnnotationWrite(
    "save-key-date",
    KEY_DATE_SETS,
    "annotations.saveFailed",
    (sets, input: KeyDateInput): Change<KeyDateSet[]> => {
      const ids = { date: input.id ?? pendingId(), newSet: pendingId() };
      const before = input.id ? findKeyDate(sets, input.id) : undefined;
      return {
        next: withKeyDate(sets, input, ids),
        revert: (current) => {
          const reverted = withoutKeyDate(
            current.filter((set) => set.id !== ids.newSet),
            ids.date,
          );
          return before ? withKeyDateBack(reverted, before) : reverted;
        },
      };
    },
  );
}

export function useDeleteKeyDate() {
  return useAnnotationWrite(
    "delete-key-date",
    KEY_DATE_SETS,
    "annotations.deleteFailed",
    (sets, { id }: { id: string }): Change<KeyDateSet[]> => {
      const before = findKeyDate(sets, id);
      return {
        next: withoutKeyDate(sets, id),
        revert: (current) =>
          before ? withKeyDateBack(current, before) : current,
      };
    },
  );
}

export function useRenameKeyDateSet() {
  return useAnnotationWrite(
    "save-key-date-set",
    KEY_DATE_SETS,
    "annotations.saveFailed",
    (sets, { id, name }: { id: string; name: string }) => {
      const before = sets.find((set) => set.id === id)?.name;
      const rename = (current: KeyDateSet[], to: string) =>
        current.map((set) => (set.id === id ? { ...set, name: to } : set));
      return {
        next: rename(sets, name),
        revert: (current) =>
          before === undefined ? current : rename(current, before),
      };
    },
  );
}

export function useDeleteKeyDateSet() {
  return useAnnotationWrite(
    "delete-key-date-set",
    KEY_DATE_SETS,
    "annotations.deleteFailed",
    (sets, { id }: { id: string }) => removeItem(sets, id),
  );
}
