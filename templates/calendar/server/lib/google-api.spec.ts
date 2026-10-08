import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calendarGetEvent,
  calendarListEvents,
  calendarPatchEvent,
  googleFetch,
} from "./google-api.js";

describe("googleFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bounds Google requests while preserving caller cancellation", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const caller = new AbortController().signal;

    await googleFetch(
      "https://www.googleapis.com/calendar/v3/events",
      "token",
      {
        signal: caller,
      },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(caller);
  });

  it("forwards cancellation to event list, read, and RSVP requests", async () => {
    fetchMock.mockClear();
    const controller = new AbortController();

    await calendarListEvents("token", "primary", {}, controller.signal);
    await calendarGetEvent("token", "primary", "event-1", controller.signal);
    await calendarPatchEvent(
      "token",
      "primary",
      "event-1",
      { attendees: [] },
      undefined,
      controller.signal,
    );

    const signals = fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit).signal as AbortSignal,
    );
    controller.abort();
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
