import { useT } from "@agent-native/core/client/i18n";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import {
  isSameRecord,
  SaveOverlapError,
  saveWithMerge,
  type RecordMerge,
  type SaveOverlap,
} from "@agent-native/core/save-conflict";
import { useSaveConflictPrompt } from "@agent-native/toolkit/app/save-conflict";
import type { CalendarEvent } from "@shared/api";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { withCalendarEventSourceIdentity } from "@/lib/calendar-event-identity";

import { findCalendarEventById } from "./event-list-cache";
import {
  useUpdateEvent,
  type UpdateEventInput,
  type UpdateEventResult,
} from "./use-events";

export const CALENDAR_EVENT_RECORD = "calendar_event";

export type EventEdit = Record<string, unknown>;

type ChangeFields = Omit<
  UpdateEventInput,
  "cacheEventIdentity" | "expectedRevision"
>;

export type EventChanges = {
  [Key in keyof ChangeFields]?: ChangeFields[Key] | undefined;
};

export type EventSaveResult = UpdateEventResult & { usedTheirs?: true };

export interface EventSaveCallbacks {
  onSuccess?: (saved: EventSaveResult) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
}

const WHEN_KEYS = [
  "start",
  "end",
  "allDay",
  "startTimeZone",
  "endTimeZone",
] as const;
const REMINDER_KEYS = ["remindersUseDefault", "reminders"] as const;
const OPTION_KEYS = ["scope", "sendUpdates", "notificationMessage"] as const;
const INTENT_KEYS = [
  "targetAccountEmail",
  "addGoogleMeet",
  "removeGoogleMeet",
  "addZoom",
  "addAttendees",
  "workingLocationType",
  "workingLocationLabel",
] as const;
const IDENTITY_KEYS = [
  "id",
  "accountEmail",
  "cacheEventIdentity",
  "expectedRevision",
] as const;
const RESTORE_OPTION_KEYS = ["scope", "sendUpdates"] as const;
const GROUPED_PATHS = new Set(["when", "reminders", "intents"]);

function includesKey(keys: readonly string[], key: string) {
  return keys.includes(key);
}

function pickDefined(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

function appliedFields(
  request: Record<string, unknown>,
): Record<string, unknown> {
  const applied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (
      value !== undefined &&
      !includesKey(IDENTITY_KEYS, key) &&
      !includesKey(OPTION_KEYS, key) &&
      !includesKey(INTENT_KEYS, key)
    ) {
      applied[key] = value;
    }
  }
  return applied;
}

function pickPaths(edit: EventEdit, paths: string[]): EventEdit {
  const picked: EventEdit = {};
  for (const path of paths) picked[path] = edit[path];
  return picked;
}

export function eventEditPaths(changes: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  for (const [key, value] of Object.entries(changes)) {
    if (
      value === undefined ||
      includesKey(IDENTITY_KEYS, key) ||
      includesKey(OPTION_KEYS, key) ||
      includesKey(INTENT_KEYS, key)
    ) {
      continue;
    }
    if (includesKey(WHEN_KEYS, key)) paths.add("when");
    else if (includesKey(REMINDER_KEYS, key)) paths.add("reminders");
    else paths.add(key);
  }
  return [...paths];
}

export function eventEditOf(source: object, paths: string[]): EventEdit {
  const record = source as Record<string, unknown>;
  const edit: EventEdit = {};
  for (const path of paths) {
    if (path === "when") edit.when = pickDefined(record, WHEN_KEYS);
    else if (path === "reminders") {
      edit.reminders = pickDefined(record, REMINDER_KEYS);
    } else edit[path] = record[path];
  }
  return edit;
}

function isEmptyValue(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function sameTime(a: unknown, b: unknown, allDay: boolean) {
  if (typeof a !== "string" || typeof b !== "string") return a === b;
  if (allDay) return a.slice(0, 10) === b.slice(0, 10);
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right)
    ? left === right
    : a === b;
}

function sameTimeZone(a: unknown, b: unknown) {
  return (isEmptyValue(a) && isEmptyValue(b)) || a === b;
}

function sameWhen(a: unknown, b: unknown) {
  const left = asRecord(a);
  const right = asRecord(b);
  const allDay = Boolean(left.allDay);
  return (
    allDay === Boolean(right.allDay) &&
    sameTime(left.start, right.start, allDay) &&
    sameTime(left.end, right.end, allDay) &&
    (allDay ||
      (sameTimeZone(left.startTimeZone, right.startTimeZone) &&
        sameTimeZone(left.endTimeZone, right.endTimeZone)))
  );
}

function remindersOf(value: unknown) {
  const record = asRecord(value);
  const useDefault =
    record.remindersUseDefault ?? record.reminders === undefined;
  if (useDefault === true) return { useDefault: true };
  return {
    useDefault: false,
    reminders: isEmptyValue(record.reminders) ? [] : record.reminders,
  };
}

export function sameEventEditValue(path: string, a: unknown, b: unknown) {
  if (path === "when") return sameWhen(a, b);
  if (path === "reminders") {
    return isSameRecord(remindersOf(a), remindersOf(b));
  }
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  return isSameRecord(a, b);
}

export function mergeEventEdits(
  base: EventEdit,
  mine: EventEdit,
  theirs: EventEdit,
): RecordMerge<EventEdit> {
  const keepMine: EventEdit = {};
  const useTheirs: EventEdit = {};
  const fields: string[] = [];
  const paths = new Set([
    ...Object.keys(base),
    ...Object.keys(mine),
    ...Object.keys(theirs),
  ]);
  for (const path of paths) {
    const from = base[path];
    const mineValue = mine[path];
    const theirValue = theirs[path];
    if (sameEventEditValue(path, mineValue, from)) {
      keepMine[path] = theirValue;
      useTheirs[path] = theirValue;
    } else if (sameEventEditValue(path, theirValue, mineValue)) {
      keepMine[path] = theirValue;
      useTheirs[path] = theirValue;
    } else if (sameEventEditValue(path, theirValue, from)) {
      keepMine[path] = mineValue;
      useTheirs[path] = mineValue;
    } else {
      fields.push(path);
      keepMine[path] = mineValue;
      useTheirs[path] = theirValue;
    }
  }
  return fields.length === 0
    ? { ok: true, merged: keepMine }
    : { ok: false, fields, keepMine, useTheirs };
}

export function eventRequestFields(
  from: EventEdit,
  value: EventEdit,
): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  for (const [path, next] of Object.entries(value)) {
    if (path !== "intents" && sameEventEditValue(path, next, from[path])) {
      continue;
    }
    if (GROUPED_PATHS.has(path)) Object.assign(request, asRecord(next));
    else request[path] = next;
  }
  return request;
}

function eventSaveKey(event: CalendarEvent) {
  return JSON.stringify([event.accountEmail ?? null, event.id]);
}

interface EventSaveQueue {
  tail: Promise<void>;
  last?: { readRevision: string; saved: Record<string, unknown> } | undefined;
}

interface HeldOverlap {
  event: CalendarEvent;
  chosen: EventEdit;
  options: Record<string, unknown>;
}

interface EventSaveContextValue {
  save: (
    event: CalendarEvent,
    changes: EventChanges,
  ) => Promise<EventSaveResult>;
}

const EventSaveContext = createContext<EventSaveContextValue | null>(null);

export function EventSaveProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { mutateAsync } = useUpdateEvent();
  const queuesRef = useRef(new Map<string, EventSaveQueue>());
  const overlapEventRef = useRef(new WeakMap<EventEdit, HeldOverlap>());
  const saveRef = useRef<EventSaveContextValue["save"] | null>(null);

  const readCachedEvent = useCallback(
    (event: CalendarEvent) => {
      for (const [, events] of queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: ["action", "list-events"],
      })) {
        const found = events
          ? findCalendarEventById(events, event.id, event.accountEmail)
          : undefined;
        if (found) return found;
      }
      return undefined;
    },
    [queryClient],
  );

  const conflict = useSaveConflictPrompt<EventEdit>({
    record: CALENDAR_EVENT_RECORD,
    describeField: (path) => {
      switch (path) {
        case "title":
          return t("eventForm.title");
        case "description":
          return t("eventForm.description");
        case "location":
          return t("eventForm.location");
        case "when":
          return `${t("eventDialog.start")}, ${t("eventDialog.end")}`;
        case "attendees":
          return t("eventForm.attendees");
        case "attachments":
          return t("eventForm.attachments");
        case "colorId":
          return t("eventForm.color");
        case "recurrence":
          return t("eventForm.repeat");
        case "visibility":
          return t("eventForm.visibility");
        case "transparency":
          return t("eventForm.busy");
        default:
          return null;
      }
    },
    onRestore: (_restoreOnto, other) => {
      const held = overlapEventRef.current.get(other);
      const save = saveRef.current;
      if (!held || !save) return;
      const event = readCachedEvent(held.event) ?? held.event;
      const paths = Object.keys(other).filter((path) => path !== "intents");
      const current = eventEditOf(event, paths);
      const restored = mergeEventEdits(
        pickPaths(held.chosen, paths),
        pickPaths(other, paths),
        current,
      );
      const changes = eventRequestFields(
        current,
        restored.ok ? restored.merged : restored.keepMine,
      );
      if (Object.keys(changes).length === 0) return;
      void save(event, { ...held.options, ...changes } as EventChanges).catch(
        (error: unknown) => reportWriteFailure(error),
      );
    },
  });
  const { resolveOverlap } = conflict;

  const saveOne = useCallback(
    async (
      event: CalendarEvent,
      changes: EventChanges,
      queue: EventSaveQueue,
    ): Promise<EventSaveResult> => {
      const last = queue.last;
      queue.last = undefined;
      const carried =
        last && event.revision && last.readRevision === event.revision
          ? last.saved
          : undefined;
      const startedFrom = carried
        ? ({ ...event, ...carried, id: event.id } as CalendarEvent)
        : event;
      const {
        id: _id,
        accountEmail: _accountEmail,
        ...request
      } = changes as Record<string, unknown>;
      const paths = eventEditPaths(request);
      const intents = pickDefined(request, INTENT_KEYS);
      const options = pickDefined(request, OPTION_KEYS);
      const base = eventEditOf(startedFrom, paths);
      const mine = eventEditOf({ ...startedFrom, ...request }, paths);
      if (Object.keys(intents).length > 0) mine.intents = intents;
      const outcome: {
        attempts: number;
        result?: UpdateEventResult;
        current?: UpdateEventResult;
        sent?: Record<string, unknown>;
        usedTheirs?: boolean;
      } = { attempts: 0 };
      await saveWithMerge<EventEdit>({
        base: { value: base, revision: startedFrom.revision ?? null },
        mine,
        merge: mergeEventEdits,
        parseCurrent: (value) => {
          outcome.current = asRecord(value) as UpdateEventResult;
          return eventEditOf(asRecord(value), paths);
        },
        resolveOverlap: async (overlap: SaveOverlap<EventEdit>, finished) => {
          const restoreOptions = pickDefined(request, RESTORE_OPTION_KEYS);
          overlapEventRef.current.set(overlap.keepMine, {
            event,
            chosen: overlap.useTheirs,
            options: restoreOptions,
          });
          overlapEventRef.current.set(overlap.useTheirs, {
            event,
            chosen: overlap.keepMine,
            options: restoreOptions,
          });
          const chosen = await resolveOverlap(overlap, finished);
          outcome.usedTheirs = chosen === overlap.useTheirs;
          return chosen;
        },
        save: async ({ value, revision, base: from }) => {
          outcome.attempts += 1;
          const body =
            outcome.attempts === 1
              ? request
              : { ...options, ...eventRequestFields(from, value) };
          const input = {
            ...body,
            id: event.id,
            ...(event.accountEmail ? { accountEmail: event.accountEmail } : {}),
            ...(revision === null ? {} : { expectedRevision: revision }),
          } as UpdateEventInput;
          const result = await mutateAsync(
            withCalendarEventSourceIdentity(input, event),
          );
          outcome.result = result;
          outcome.sent = body;
          return {
            value: eventEditOf(asRecord(result), paths),
            revision: result.revision ?? null,
          };
        },
      });
      const { result } = outcome;
      if (result?.id === event.id && !result.replacedId && event.revision) {
        queue.last = {
          readRevision: event.revision,
          saved: {
            ...(outcome.attempts === 1 ? carried : outcome.current),
            ...appliedFields(outcome.sent ?? request),
            ...asRecord(result),
          },
        };
      }
      if (!result && outcome.usedTheirs) {
        return { ...outcome.current, usedTheirs: true };
      }
      return result ?? outcome.current ?? {};
    },
    [mutateAsync, resolveOverlap],
  );

  const save = useCallback(
    (event: CalendarEvent, changes: EventChanges) => {
      const key = eventSaveKey(event);
      const queue = queuesRef.current.get(key) ?? {
        tail: Promise.resolve(),
      };
      queuesRef.current.set(key, queue);
      const run = queue.tail.then(() => saveOne(event, changes, queue));
      queue.tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [saveOne],
  );
  saveRef.current = save;

  const value = useMemo(() => ({ save }), [save]);

  return (
    <EventSaveContext.Provider value={value}>
      {children}
      {conflict.prompt}
    </EventSaveContext.Provider>
  );
}

export function useEventSave() {
  const context = useContext(EventSaveContext);
  if (!context) throw new Error("useEventSave needs an EventSaveProvider");
  const { save } = context;
  const [running, setRunning] = useState(0);

  const mutateAsync = useCallback(
    async (event: CalendarEvent, changes: EventChanges) => {
      setRunning((count) => count + 1);
      try {
        return await save(event, changes);
      } finally {
        setRunning((count) => count - 1);
      }
    },
    [save],
  );

  const mutate = useCallback(
    (
      event: CalendarEvent,
      changes: EventChanges,
      callbacks: EventSaveCallbacks = {},
    ) => {
      void mutateAsync(event, changes)
        .then(
          (saved) => callbacks.onSuccess?.(saved),
          (error: unknown) => {
            if (callbacks.onError) callbacks.onError(error);
            else if (!(error instanceof SaveOverlapError)) {
              reportWriteFailure(error);
            }
          },
        )
        .finally(() => callbacks.onSettled?.());
    },
    [mutateAsync],
  );

  return useMemo(
    () => ({ mutate, mutateAsync, isPending: running > 0 }),
    [mutate, mutateAsync, running],
  );
}
