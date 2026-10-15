import { useActionMutation } from "@agent-native/core/client/hooks";
import type { DataNote } from "@shared/data-notes";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

const DATA_NOTES_KEY = ["action", "list-data-notes", undefined];
const KEY_DATES_KEY = ["action", "list-key-dates", undefined];

type NotesData = { notes: DataNote[] };
type SetsData = { sets: KeyDateSet[] };
type Snapshot<T> = { previous: T | undefined };

const PENDING_ID = "pending";

async function snapshot<T>(
  client: QueryClient,
  key: readonly unknown[],
  update: (data: T) => T,
): Promise<Snapshot<T>> {
  await client.cancelQueries({ queryKey: key });
  const previous = client.getQueryData<T>(key);
  if (previous) client.setQueryData<T>(key, update(previous));
  return { previous };
}

function restore<T>(
  client: QueryClient,
  key: readonly unknown[],
  context: unknown,
) {
  const previous = (context as Snapshot<T> | undefined)?.previous;
  if (previous) client.setQueryData<T>(key, previous);
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
  const client = useQueryClient();
  return useActionMutation<DataNote, DataNoteInput>("save-data-note", {
    onMutate: (input) =>
      snapshot<NotesData>(client, DATA_NOTES_KEY, (data) => ({
        notes: input.id
          ? data.notes.map((note) =>
              note.id === input.id ? patchNote(note, input) : note,
            )
          : [
              patchNote(
                {
                  id: PENDING_ID,
                  kind: "data",
                  title: "",
                  note: "",
                  status: "open",
                  matchEvents: [],
                  unlessEvents: [],
                  panels: [],
                  addedBy: "",
                  updatedAt: new Date().toISOString(),
                },
                input,
              ),
              ...data.notes,
            ],
      })),
    onError: (_error, _input, context) =>
      restore<NotesData>(client, DATA_NOTES_KEY, context),
  });
}

export function useDeleteDataNote() {
  const client = useQueryClient();
  return useActionMutation<{ id: string }, { id: string }>("delete-data-note", {
    onMutate: ({ id }) =>
      snapshot<NotesData>(client, DATA_NOTES_KEY, (data) => ({
        notes: data.notes.filter((note) => note.id !== id),
      })),
    onError: (_error, _input, context) =>
      restore<NotesData>(client, DATA_NOTES_KEY, context),
  });
}

export type KeyDateInput = {
  id?: string;
  setId?: string;
  setName?: string;
  date: string;
  time?: string;
  timeZone?: string;
  label: string;
};

function withKeyDate(sets: KeyDateSet[], input: KeyDateInput): KeyDateSet[] {
  const { id, setId, setName, ...fields } = input;
  const target =
    sets.find((set) => set.id === setId) ??
    sets.find(
      (set) => set.name.toLowerCase() === setName?.trim().toLowerCase(),
    );
  const existing = sets
    .flatMap((set) => set.dates)
    .find((date) => id && date.id === id);
  const date: KeyDate = {
    id: id ?? PENDING_ID,
    setId: target?.id ?? PENDING_ID,
    addedBy: existing?.addedBy ?? "",
    updatedAt: new Date().toISOString(),
    ...fields,
  };
  const without = sets.map((set) => ({
    ...set,
    dates: set.dates.filter((other) => other.id !== id),
  }));
  if (!target) {
    return [
      ...without,
      {
        id: PENDING_ID,
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
  const client = useQueryClient();
  return useActionMutation<KeyDate, KeyDateInput>("save-key-date", {
    onMutate: (input) =>
      snapshot<SetsData>(client, KEY_DATES_KEY, (data) => ({
        sets: withKeyDate(data.sets, input),
      })),
    onError: (_error, _input, context) =>
      restore<SetsData>(client, KEY_DATES_KEY, context),
  });
}

export function useDeleteKeyDate() {
  const client = useQueryClient();
  return useActionMutation<{ id: string }, { id: string }>("delete-key-date", {
    onMutate: ({ id }) =>
      snapshot<SetsData>(client, KEY_DATES_KEY, (data) => ({
        sets: data.sets.map((set) => ({
          ...set,
          dates: set.dates.filter((date) => date.id !== id),
        })),
      })),
    onError: (_error, _input, context) =>
      restore<SetsData>(client, KEY_DATES_KEY, context),
  });
}

export function useRenameKeyDateSet() {
  const client = useQueryClient();
  return useActionMutation<unknown, { id: string; name: string }>(
    "save-key-date-set",
    {
      onMutate: ({ id, name }) =>
        snapshot<SetsData>(client, KEY_DATES_KEY, (data) => ({
          sets: data.sets.map((set) =>
            set.id === id ? { ...set, name } : set,
          ),
        })),
      onError: (_error, _input, context) =>
        restore<SetsData>(client, KEY_DATES_KEY, context),
    },
  );
}

export function useDeleteKeyDateSet() {
  const client = useQueryClient();
  return useActionMutation<unknown, { id: string }>("delete-key-date-set", {
    onMutate: ({ id }) =>
      snapshot<SetsData>(client, KEY_DATES_KEY, (data) => ({
        sets: data.sets.filter((set) => set.id !== id),
      })),
    onError: (_error, _input, context) =>
      restore<SetsData>(client, KEY_DATES_KEY, context),
  });
}
