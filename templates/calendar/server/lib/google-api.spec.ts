import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calendarGetEvent,
  calendarListEvents,
  calendarPatchEvent,
  calendarUpdateEvent,
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

  it("sends the revision an event write starts from as If-Match, not in the query", async () => {
    fetchMock.mockClear();

    await calendarPatchEvent(
      "token",
      "primary",
      "event-1",
      { summary: "Mine" },
      { sendUpdates: "none", ifMatch: '"etag-1"' },
    );
    await calendarUpdateEvent(
      "token",
      "primary",
      "event-1",
      { summary: "Mine" },
      { ifMatch: '"etag-2"' },
    );
    await calendarPatchEvent("token", "primary", "event-1", {});

    const requests = fetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      ifMatch: new Headers((init as RequestInit).headers).get("If-Match"),
    }));
    expect(requests).toEqual([
      {
        url: expect.stringMatching(/\/events\/event-1\?sendUpdates=none$/),
        ifMatch: '"etag-1"',
      },
      { url: expect.stringMatching(/\/events\/event-1$/), ifMatch: '"etag-2"' },
      { url: expect.stringMatching(/\/events\/event-1$/), ifMatch: null },
    ]);
  });
});
