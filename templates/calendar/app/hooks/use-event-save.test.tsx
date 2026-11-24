// @vitest-environment happy-dom
import type { SaveOverlap } from "@agent-native/core/save-conflict";
import type { CalendarEvent } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Edit = Record<string, unknown>;

const {
  updateEventMutateAsync,
  resolveOverlap,
  reportWriteFailure,
  conflictPrompt,
} = vi.hoisted(() => ({
  updateEventMutateAsync: vi.fn(),
  resolveOverlap: vi.fn(),
  reportWriteFailure: vi.fn(),
  conflictPrompt: {
    onRestore: undefined as
      | ((restoreOnto: (current: Edit) => Edit, other: Edit) => void)
      | undefined,
  },
}));

vi.mock("./use-events", () => ({
  useUpdateEvent: () => ({ mutateAsync: updateEventMutateAsync }),
}));

vi.mock("@agent-native/toolkit/app/save-conflict", () => ({
  useSaveConflictPrompt: (options: {
    onRestore: (restoreOnto: (current: Edit) => Edit, other: Edit) => void;
  }) => {
    conflictPrompt.onRestore = options.onRestore;
    return { resolveOverlap, prompt: null };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/write-failure", () => ({
  reportWriteFailure,
}));

import {
  EventSaveProvider,
  eventRequestFields,
  mergeEventEdits,
  sameEventEditValue,
  useEventSave,
} from "./use-event-save";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const base: CalendarEvent = {
    id: "google-event-1",
    title: "Planning",
    description: "",
    start: "2026-11-23T15:00:00-05:00",
    end: "2026-11-23T16:00:00-05:00",
    location: "Room A",
    allDay: false,
    source: "google",
    accountEmail: "agent@example.com",
    revision: '"1"',
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
  return Object.assign(base, overrides);
}

function conflict(current: CalendarEvent) {
  return Object.assign(new Error("changed"), {
    errorCode: "save_conflict",
    details: { current, currentRevision: current.revision ?? null },
  });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let queryClient: QueryClient | null = null;
let save: ReturnType<typeof useEventSave> | null = null;

function Harness() {
  save = useEventSave();
  return null;
}

function rendered() {
  if (!save) throw new Error("Harness isn't rendered");
  return save;
}

beforeEach(() => {
  updateEventMutateAsync.mockReset();
  resolveOverlap.mockReset();
  reportWriteFailure.mockReset();
  conflictPrompt.onRestore = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient();
  queryClient = client;
  act(() => {
    root?.render(
      <QueryClientProvider client={client}>
        <EventSaveProvider>
          <Harness />
        </EventSaveProvider>
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  queryClient = null;
  save = null;
});

describe("mergeEventEdits", () => {
  it("keeps both changes when the writers changed different fields", () => {
    expect(
      mergeEventEdits(
        { title: "Planning", location: "Room A" },
        { title: "Roadmap", location: "Room A" },
        { title: "Planning", location: "Room B" },
      ),
    ).toEqual({
      ok: true,
      merged: { title: "Roadmap", location: "Room B" },
    });
  });

  it("reports a field both writers changed, with both ways to settle it", () => {
    expect(
      mergeEventEdits(
        { title: "Planning" },
        { title: "Roadmap" },
        { title: "Retro" },
      ),
    ).toEqual({
      ok: false,
      fields: ["title"],
      keepMine: { title: "Roadmap" },
      useTheirs: { title: "Retro" },
    });
  });

  it("treats the event's time as one field and compares instants", () => {
    const base = {
      when: {
        start: "2026-11-23T15:00:00-05:00",
        end: "2026-11-23T16:00:00-05:00",
        allDay: false,
      },
    };
    const mine = {
      when: {
        start: "2026-11-23T21:00:00.000Z",
        end: "2026-11-23T22:00:00.000Z",
        allDay: false,
      },
    };
    expect(
      mergeEventEdits(base, mine, {
        when: {
          start: "2026-11-23T20:00:00.000Z",
          end: "2026-11-23T21:00:00.000Z",
          allDay: false,
        },
      }),
    ).toEqual({ ok: true, merged: mine });
    expect(
      mergeEventEdits(base, mine, {
        when: {
          start: "2026-11-23T15:00:00-05:00",
          end: "2026-11-23T17:00:00-05:00",
          allDay: false,
        },
      }),
    ).toMatchObject({ ok: false, fields: ["when"] });
  });

  it("counts a time zone added on one side as a change to the time", () => {
    const base = {
      when: {
        start: "2026-11-23T15:00:00-05:00",
        end: "2026-11-23T16:00:00-05:00",
        allDay: false,
      },
    };
    expect(
      mergeEventEdits(
        base,
        {
          when: {
            ...base.when,
            startTimeZone: "America/New_York",
            endTimeZone: "America/New_York",
          },
        },
        {
          when: {
            ...base.when,
            startTimeZone: "Europe/London",
            endTimeZone: "Europe/London",
          },
        },
      ),
    ).toMatchObject({ ok: false, fields: ["when"] });
  });

  it("never sees a change in an empty value written another way", () => {
    expect(
      mergeEventEdits(
        { description: "", recurrence: undefined },
        { description: "Notes", recurrence: [] },
        { description: undefined, recurrence: [] },
      ),
    ).toEqual({
      ok: true,
      merged: { description: "Notes", recurrence: [] },
    });
  });
});

describe("sameEventEditValue", () => {
  it("compares reminders as Google keeps them", () => {
    expect(
      sameEventEditValue(
        "reminders",
        {
          remindersUseDefault: true,
          reminders: [{ method: "popup", minutes: 10 }],
        },
        { remindersUseDefault: true },
      ),
    ).toBe(true);
    expect(
      sameEventEditValue(
        "reminders",
        { remindersUseDefault: false, reminders: [] },
        { remindersUseDefault: false },
      ),
    ).toBe(true);
    expect(
      sameEventEditValue(
        "reminders",
        { remindersUseDefault: false, reminders: [] },
        { remindersUseDefault: true },
      ),
    ).toBe(false);
  });
});

describe("eventRequestFields", () => {
  it("sends what differs from the current event, with the whole time and every request", () => {
    expect(
      eventRequestFields(
        {
          title: "Planning",
          location: "Room B",
          when: { start: "a", end: "b", allDay: false },
        },
        {
          title: "Roadmap",
          location: "Room B",
          when: { start: "c", end: "b", allDay: false },
          intents: { addGoogleMeet: true },
        },
      ),
    ).toEqual({
      title: "Roadmap",
      start: "c",
      end: "b",
      allDay: false,
      addGoogleMeet: true,
    });
  });
});

describe("useEventSave", () => {
  it("sends the revision the edit started from and returns the new one", async () => {
    updateEventMutateAsync.mockResolvedValueOnce({
      id: "google-event-1",
      revision: '"2"',
    });

    let saved: unknown;
    await act(async () => {
      saved = await rendered().mutateAsync(event(), {
        title: "Roadmap",
        sendUpdates: "none",
      });
    });

    expect(updateEventMutateAsync).toHaveBeenCalledTimes(1);
    expect(updateEventMutateAsync).toHaveBeenCalledWith({
      id: "google-event-1",
      accountEmail: "agent@example.com",
      title: "Roadmap",
      sendUpdates: "none",
      expectedRevision: '"1"',
    });
    expect(saved).toEqual({ id: "google-event-1", revision: '"2"' });
  });

  it("sends no revision for an event read without one", async () => {
    updateEventMutateAsync.mockResolvedValueOnce({ id: "local-1" });
    const { revision: _revision, ...local } = event({
      id: "local-1",
      source: "local",
    });

    await act(async () => {
      await rendered().mutateAsync(local, { title: "Roadmap" });
    });

    expect(updateEventMutateAsync).toHaveBeenCalledWith({
      id: "local-1",
      accountEmail: "agent@example.com",
      title: "Roadmap",
    });
  });

  it("puts the edit on top of another writer's change to a different field, without asking", async () => {
    updateEventMutateAsync
      .mockRejectedValueOnce(
        conflict(event({ location: "Room B", revision: '"2"' })),
      )
      .mockResolvedValueOnce({ id: "google-event-1", revision: '"3"' });

    await act(async () => {
      await rendered().mutateAsync(event(), {
        title: "Roadmap",
        sendUpdates: "none",
      });
    });

    expect(resolveOverlap).not.toHaveBeenCalled();
    expect(updateEventMutateAsync).toHaveBeenCalledTimes(2);
    expect(updateEventMutateAsync).toHaveBeenLastCalledWith({
      id: "google-event-1",
      accountEmail: "agent@example.com",
      title: "Roadmap",
      sendUpdates: "none",
      expectedRevision: '"2"',
    });
  });

  it("asks when both changed the time, and saves the kept version over the current one", async () => {
    updateEventMutateAsync
      .mockRejectedValueOnce(
        conflict(
          event({
            start: "2026-11-23T17:00:00-05:00",
            end: "2026-11-23T18:00:00-05:00",
            revision: '"2"',
          }),
        ),
      )
      .mockResolvedValueOnce({ id: "google-event-1", revision: '"3"' });
    resolveOverlap.mockImplementationOnce(
      (overlap: SaveOverlap<Record<string, unknown>>) =>
        Promise.resolve(overlap.keepMine),
    );

    await act(async () => {
      await rendered().mutateAsync(event(), {
        start: "2026-11-23T21:00:00.000Z",
        end: "2026-11-23T22:00:00.000Z",
      });
    });

    expect(resolveOverlap).toHaveBeenCalledTimes(1);
    expect(resolveOverlap.mock.calls[0]?.[0]).toMatchObject({
      fields: ["when"],
    });
    expect(updateEventMutateAsync).toHaveBeenLastCalledWith({
      id: "google-event-1",
      accountEmail: "agent@example.com",
      start: "2026-11-23T21:00:00.000Z",
      end: "2026-11-23T22:00:00.000Z",
      allDay: false,
      expectedRevision: '"2"',
    });
  });

  it("writes nothing more when the person keeps the other version", async () => {
    const current = event({ title: "Retro", revision: '"2"' });
    updateEventMutateAsync.mockRejectedValueOnce(conflict(current));
    resolveOverlap.mockImplementationOnce(
      (overlap: SaveOverlap<Record<string, unknown>>) =>
        Promise.resolve(overlap.useTheirs),
    );

    let saved: unknown;
    await act(async () => {
      saved = await rendered().mutateAsync(event(), { title: "Roadmap" });
    });

    expect(updateEventMutateAsync).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({
      title: "Retro",
      revision: '"2"',
      usedTheirs: true,
    });
  });

  it("writes nothing more when the other writer already made the same move", async () => {
    updateEventMutateAsync.mockRejectedValueOnce(
      conflict(
        event({
          start: "2026-11-23T16:00:00-05:00",
          end: "2026-11-23T17:00:00-05:00",
          revision: '"2"',
        }),
      ),
    );

    let saved: unknown;
    await act(async () => {
      saved = await rendered().mutateAsync(event(), {
        start: "2026-11-23T21:00:00.000Z",
        end: "2026-11-23T22:00:00.000Z",
      });
    });

    expect(resolveOverlap).not.toHaveBeenCalled();
    expect(updateEventMutateAsync).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveProperty("usedTheirs");
  });

  it("gets the other time back whole, with the edit's scope", async () => {
    const theirs = event({
      start: "2026-11-23T17:00:00-05:00",
      end: "2026-11-23T18:00:00-05:00",
      revision: '"2"',
    });
    updateEventMutateAsync.mockRejectedValueOnce(conflict(theirs));
    let keptMine: Edit = {};
    resolveOverlap.mockImplementationOnce((overlap: SaveOverlap<Edit>) => {
      keptMine = overlap.keepMine;
      return Promise.resolve(overlap.useTheirs);
    });

    await act(async () => {
      await rendered().mutateAsync(event(), {
        start: "2026-11-23T22:00:00.000Z",
        end: "2026-11-24T00:00:00.000Z",
        scope: "all",
        sendUpdates: "none",
      });
    });
    expect(updateEventMutateAsync).toHaveBeenCalledTimes(1);

    queryClient?.setQueryData<CalendarEvent[]>(
      ["action", "list-events", {}],
      [theirs],
    );
    const restored = new Promise<void>((resolve) => {
      updateEventMutateAsync.mockImplementationOnce(() => {
        resolve();
        return Promise.resolve({ id: "google-event-1", revision: '"3"' });
      });
    });
    await act(async () => {
      conflictPrompt.onRestore?.((current) => current, keptMine);
      await restored;
    });

    expect(updateEventMutateAsync).toHaveBeenLastCalledWith({
      id: "google-event-1",
      accountEmail: "agent@example.com",
      scope: "all",
      sendUpdates: "none",
      start: "2026-11-23T22:00:00.000Z",
      end: "2026-11-24T00:00:00.000Z",
      allDay: false,
      expectedRevision: '"2"',
    });
  });

  it("moves the event to another account after another writer's change", async () => {
    updateEventMutateAsync
      .mockRejectedValueOnce(
        conflict(event({ title: "Retro", revision: '"2"' })),
      )
      .mockResolvedValueOnce({
        id: "google-moved",
        replacedId: "google-event-1",
      });

    await act(async () => {
      await rendered().mutateAsync(event(), {
        targetAccountEmail: "other@example.com",
      });
    });

    expect(updateEventMutateAsync).toHaveBeenLastCalledWith({
      id: "google-event-1",
      accountEmail: "agent@example.com",
      targetAccountEmail: "other@example.com",
      expectedRevision: '"2"',
    });
  });

  it("saves a second quick edit of one event after the first, over the revision the first returned", async () => {
    let finishFirst: (value: unknown) => void = () => {};
    let firstSent: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      firstSent = resolve;
    });
    updateEventMutateAsync
      .mockImplementationOnce(() => {
        firstSent();
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      })
      .mockResolvedValueOnce({ id: "google-event-1", revision: '"3"' });

    let second: Promise<unknown> = Promise.resolve();
    await act(async () => {
      const first = rendered().mutateAsync(event(), { title: "Roadmap" });
      second = rendered().mutateAsync(event({ title: "Roadmap" }), {
        location: "Room C",
      });
      await firstStarted;
      expect(updateEventMutateAsync).toHaveBeenCalledTimes(1);
      finishFirst({ id: "google-event-1", revision: '"2"' });
      await first;
      await second;
    });

    expect(updateEventMutateAsync).toHaveBeenCalledTimes(2);
    expect(updateEventMutateAsync).toHaveBeenLastCalledWith({
      id: "google-event-1",
      accountEmail: "agent@example.com",
      location: "Room C",
      expectedRevision: '"2"',
    });
  });

  it("starts a queued edit from a first save that merged on its retry", async () => {
    updateEventMutateAsync
      .mockRejectedValueOnce(
        conflict(event({ location: "Room B", revision: '"2"' })),
      )
      .mockResolvedValueOnce({ id: "google-event-1", revision: '"3"' })
      .mockRejectedValueOnce(
        conflict(
          event({ title: "Roadmap", location: "Room C", revision: '"4"' }),
        ),
      )
      .mockResolvedValueOnce({ id: "google-event-1", revision: '"5"' });

    await act(async () => {
      await rendered().mutateAsync(event(), { title: "Roadmap" });
      await rendered().mutateAsync(event(), { title: "Retro" });
    });

    expect(resolveOverlap).not.toHaveBeenCalled();
    expect(updateEventMutateAsync).toHaveBeenCalledTimes(4);
    expect(updateEventMutateAsync.mock.calls[2]?.[0]).toMatchObject({
      title: "Retro",
      expectedRevision: '"3"',
    });
    expect(updateEventMutateAsync).toHaveBeenLastCalledWith({
      id: "google-event-1",
      accountEmail: "agent@example.com",
      title: "Retro",
      expectedRevision: '"4"',
    });
  });

  it("starts a queued edit of the same field from the first save, so it doesn't ask about the person's own change", async () => {
    updateEventMutateAsync
      .mockResolvedValueOnce({ id: "google-event-1", revision: '"2"' })
      .mockRejectedValueOnce(
        conflict(
          event({ title: "Roadmap", location: "Room B", revision: '"3"' }),
        ),
      )
      .mockResolvedValueOnce({ id: "google-event-1", revision: '"4"' });

    await act(async () => {
      await rendered().mutateAsync(event(), { title: "Roadmap" });
      await rendered().mutateAsync(event(), { title: "Retro" });
    });

    expect(resolveOverlap).not.toHaveBeenCalled();
    expect(updateEventMutateAsync).toHaveBeenCalledTimes(3);
    expect(updateEventMutateAsync.mock.calls[1]?.[0]).toMatchObject({
      title: "Retro",
      expectedRevision: '"2"',
    });
    expect(updateEventMutateAsync).toHaveBeenLastCalledWith({
      id: "google-event-1",
      accountEmail: "agent@example.com",
      title: "Retro",
      expectedRevision: '"3"',
    });
  });

  it("reports a failed save when the caller handles no error", async () => {
    const failure = new Error("offline");
    updateEventMutateAsync.mockRejectedValueOnce(failure);
    const onSuccess = vi.fn();

    await act(async () => {
      await new Promise<void>((resolve) => {
        rendered().mutate(
          event(),
          { title: "Roadmap" },
          { onSuccess, onSettled: resolve },
        );
      });
    });

    expect(reportWriteFailure).toHaveBeenCalledWith(failure);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
