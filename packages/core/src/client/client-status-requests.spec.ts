// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchBuilderStatus,
  invalidateClientStatusRequests,
} from "./client-status-requests.js";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("client status requests", () => {
  beforeEach(() => {
    invalidateClientStatusRequests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces concurrent reads", async () => {
    const fetch = vi.fn(async () => jsonResponse({ configured: true }));
    vi.stubGlobal("fetch", fetch);

    const first = fetchBuilderStatus<{ configured: boolean }>();
    const second = fetchBuilderStatus<{ configured: boolean }>();
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(first).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
    await expect(second).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
  });

  it("starts fresh after invalidation and ignores a late stale result", async () => {
    let resolveStale!: (response: Response) => void;
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValue(jsonResponse({ configured: false }));
    vi.stubGlobal("fetch", fetch);

    const stale = fetchBuilderStatus();
    window.dispatchEvent(new Event("agent-engine:configured-changed"));
    await expect(fetchBuilderStatus()).resolves.toEqual({
      state: "available",
      value: { configured: false },
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    resolveStale(jsonResponse({ configured: true }));
    await expect(stale).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
    await expect(fetchBuilderStatus()).resolves.toEqual({
      state: "available",
      value: { configured: false },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("releases a shared request when the transport hangs so a retry is fresh", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValue(jsonResponse({ configured: true }));
    vi.stubGlobal("fetch", fetch);

    const result = fetchBuilderStatus();
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toEqual({ state: "unavailable" });
    await expect(fetchBuilderStatus()).resolves.toEqual({
      state: "available",
      value: { configured: true },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
