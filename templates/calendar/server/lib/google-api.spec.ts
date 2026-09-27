import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { googleFetch } from "./google-api.js";

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
});
