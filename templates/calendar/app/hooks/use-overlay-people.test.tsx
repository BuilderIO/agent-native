// @vitest-environment happy-dom
import type { CalendarEvent } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  useActionQuery: vi.fn(),
  useActionMutation: vi.fn(),
}));

import {
  OVERLAY_CALENDAR_STATUS_KEY,
  useOverlayCalendarStatus,
} from "./use-events";
import {
  useAddOverlayPerson,
  useRemoveOverlayPerson,
} from "./use-overlay-people";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const LOGAN = "logan@builder.io";
const OVERLAY_STATUS = {
  sourceCoverage: [{ source: "overlay", id: LOGAN, status: "ok" }],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let addPerson: ReturnType<typeof useAddOverlayPerson> | null = null;
let removePerson: ReturnType<typeof useRemoveOverlayPerson> | null = null;

function Harness() {
  useOverlayCalendarStatus([LOGAN]);
  const add = useAddOverlayPerson();
  const remove = useRemoveOverlayPerson();
  useEffect(() => {
    addPerson = add;
    removePerson = remove;
  }, [add, remove]);
  return null;
}

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Launch vid standup",
    description: "",
    start: "2026-09-30T16:00:00.000Z",
    end: "2026-09-30T16:30:00.000Z",
    location: "",
    allDay: false,
    source: "google",
    createdAt: "2026-09-30T15:00:00.000Z",
    updatedAt: "2026-09-30T15:00:00.000Z",
    ...overrides,
  };
}

function statusProbeCalls() {
  return callAction.mock.calls.filter(
    ([name, params]) =>
      name === "list-events" && params?.format === "inventory",
  ).length;
}

async function renderHarness(queryClient: QueryClient) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => {
    expect(callAction).toHaveBeenCalledWith(
      "list-events",
      expect.objectContaining({ format: "inventory" }),
      { method: "GET" },
    );
    expect(queryClient.isFetching()).toBe(0);
  });
}

describe("overlay person mutations", () => {
  beforeEach(() => {
    addPerson = null;
    removePerson = null;
    callAction.mockImplementation(async (name: string) => {
      if (name === "list-events") return OVERLAY_STATUS;
      if (name === "add-overlay-person") {
        return [{ email: LOGAN, color: "#E07C4F" }];
      }
      if (name === "remove-overlay-person") return [];
      throw new Error(`Unexpected action ${name}`);
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    callAction.mockReset();
  });

  it("keeps the overlay status probe out of the list-events cache", async () => {
    const queryClient = new QueryClient();
    await renderHarness(queryClient);

    expect(
      queryClient.getQueriesData({ queryKey: OVERLAY_CALENDAR_STATUS_KEY }),
    ).toEqual([[expect.anything(), OVERLAY_STATUS]]);
    expect(
      queryClient.getQueriesData({ queryKey: ["action", "list-events"] }),
    ).toEqual([]);
  });

  it("removes the person on the server while their overlay status is cached", async () => {
    const queryClient = new QueryClient();
    const eventsKey = [
      "action",
      "list-events",
      { from: "2026-09-27", to: "2026-10-04", overlayEmails: LOGAN },
    ];
    const ownEvent = calendarEvent({ id: "own" });
    queryClient.setQueryData(eventsKey, [
      ownEvent,
      calendarEvent({ id: "overlay", overlayEmail: LOGAN }),
    ]);
    queryClient.setQueryData(
      ["action", "get-overlay-people", undefined],
      [{ email: LOGAN, color: "#E07C4F" }],
    );
    await renderHarness(queryClient);

    await act(async () => {
      await removePerson!.mutateAsync(LOGAN);
    });

    expect(callAction).toHaveBeenCalledWith(
      "remove-overlay-person",
      { email: LOGAN },
      { method: "PUT" },
    );
    expect(queryClient.getQueryData(eventsKey)).toEqual([ownEvent]);
    expect(
      queryClient.getQueryData(["action", "get-overlay-people", undefined]),
    ).toEqual([]);
  });

  it("refreshes the cached overlay status after adding or removing a person", async () => {
    const queryClient = new QueryClient();
    await renderHarness(queryClient);
    expect(statusProbeCalls()).toBe(1);

    await act(async () => {
      await removePerson!.mutateAsync(LOGAN);
    });
    await vi.waitFor(() => expect(statusProbeCalls()).toBe(2));

    await act(async () => {
      await addPerson!.mutateAsync({ email: LOGAN });
    });
    await vi.waitFor(() => expect(statusProbeCalls()).toBe(3));
  });
});
