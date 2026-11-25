// @vitest-environment happy-dom
import type { CalendarEvent } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutationOptions = vi.hoisted(() => ({
  current: null as null | {
    onError?: (error: unknown, input: unknown, context: unknown) => void;
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionQuery: vi.fn(),
  useActionMutation: (
    _name: string,
    options: typeof mutationOptions.current,
  ) => {
    mutationOptions.current = options;
    return {};
  },
}));

import { useUpdateEvent } from "./use-events";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const LIST_KEY = ["action", "list-events", { from: "2026-11-23" }];

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness() {
  useUpdateEvent();
  return null;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mutationOptions.current = null;
});

describe("useUpdateEvent", () => {
  it("shows the current event after a save conflict instead of the one the edit started from", () => {
    const queryClient = new QueryClient();
    const before = calendarEvent();
    queryClient.setQueryData(LIST_KEY, [before]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });

    const current = calendarEvent({ title: "Retro", revision: '"2"' });
    const error = Object.assign(new Error("changed"), {
      errorCode: "save_conflict",
      details: { current, currentRevision: '"2"' },
    });
    act(() => {
      mutationOptions.current?.onError?.(
        error,
        {
          id: "google-event-1",
          accountEmail: "agent@example.com",
          title: "Roadmap",
        },
        { previous: [[LIST_KEY, [before]]] },
      );
    });

    expect(queryClient.getQueryData<CalendarEvent[]>(LIST_KEY)).toEqual([
      expect.objectContaining({ title: "Retro", revision: '"2"' }),
    ]);
  });
});
