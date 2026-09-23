// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  query: {
    data: {
      designSystems: [
        {
          id: "system-1",
          title: "Brand",
          description: null,
          data: "{}",
          isDefault: true,
          createdAt: "2026-09-18T00:00:00.000Z",
          indexingStatus: "indexing" as "indexing" | "ready" | "unavailable",
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  },
}));

// Only the action transport and the list query are mocked — createPollEngine
// (from @agent-native/core/shared) is the real implementation, so this
// exercises the actual backoff scheduling instead of re-asserting its own
// already-tested guarantees.
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useActionQuery: () => mocks.query,
}));

import { useDesignSystems } from "./use-design-systems";

let latest: ReturnType<typeof useDesignSystems> | null = null;

function Probe() {
  latest = useDesignSystems();
  return null;
}

function callCountFor(id: string): number {
  return mocks.callAction.mock.calls.filter((call) => call[1]?.id === id)
    .length;
}

describe("useDesignSystems indexing poll", () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.callAction.mockReset();
    mocks.callAction.mockResolvedValue({ updated: false, stale: false });
    mocks.query.refetch.mockReset();
    mocks.query.data = {
      designSystems: [
        {
          id: "system-1",
          title: "Brand",
          description: null,
          data: "{}",
          isDefault: true,
          createdAt: "2026-09-18T00:00:00.000Z",
          indexingStatus: "indexing",
        },
      ],
    };
    latest = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("checks an indexing system immediately on mount, once", async () => {
    await act(async () => root.render(<Probe />));
    expect(callCountFor("system-1")).toBe(1);
  });

  it("backs off exponentially instead of polling at a fixed cadence", async () => {
    await act(async () => root.render(<Probe />));
    expect(callCountFor("system-1")).toBe(1);

    // First re-check at +5s.
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(callCountFor("system-1")).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(callCountFor("system-1")).toBe(2);

    // Next gap has doubled to 10s, not another 5s.
    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    expect(callCountFor("system-1")).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(callCountFor("system-1")).toBe(3);

    // And doubles again to 20s.
    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(callCountFor("system-1")).toBe(3);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(callCountFor("system-1")).toBe(4);
  });

  it("refetches the list once a check reports the row changed", async () => {
    await act(async () => root.render(<Probe />));
    mocks.callAction.mockResolvedValueOnce({ updated: true });
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);

    // A confirmed write drops the id's schedule entry immediately. Without
    // that, nextDueAt was left in the past and the engine re-checked the
    // same id again right away, before the refetch above had a chance to
    // land and drop it from the indexing set.
    const callsAfterUpdate = callCountFor("system-1");
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(callCountFor("system-1")).toBe(callsAfterUpdate);
  });

  it("refetches the list and stops polling when another writer already saved a terminal status", async () => {
    await act(async () => root.render(<Probe />));
    // `updated: false` — another tab or agent already persisted this same
    // status — but the row is no longer "indexing".
    mocks.callAction.mockResolvedValueOnce({
      updated: false,
      stale: false,
      indexingStatus: "ready",
    });
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);

    const callsAfterUpdate = callCountFor("system-1");
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(callCountFor("system-1")).toBe(callsAfterUpdate);
  });

  it("stops polling an id once the server reports it stale", async () => {
    await act(async () => root.render(<Probe />));
    expect(callCountFor("system-1")).toBe(1);

    mocks.callAction.mockResolvedValueOnce({ updated: false, stale: true });
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(callCountFor("system-1")).toBe(2);

    // No further checks, however long we wait — never faked as "ready".
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(callCountFor("system-1")).toBe(2);
    expect(latest?.designSystems[0]?.indexingStatus).toBe("indexing");
  });

  it("gives up after the local budget when checks never confirm or go stale", async () => {
    await act(async () => root.render(<Probe />));

    // Walk the backoff all the way to its 5 min cap and past the 30 min
    // budget; the exact call count doesn't matter, only that it stops.
    for (let elapsed = 0; elapsed < 35 * 60_000; ) {
      const step = Math.min(5 * 60_000, 35 * 60_000 - elapsed);
      await act(async () => vi.advanceTimersByTimeAsync(step));
      elapsed += step;
    }
    const callsAtBudget = callCountFor("system-1");
    expect(callsAtBudget).toBeGreaterThan(1);

    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(callCountFor("system-1")).toBe(callsAtBudget);
  });

  it("resets backoff and checks again on window focus", async () => {
    await act(async () => root.render(<Probe />));
    expect(callCountFor("system-1")).toBe(1);

    // Back off past the initial 5s step without triggering it.
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(callCountFor("system-1")).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(callCountFor("system-1")).toBe(2);
  });

  it("stops polling once the list reports a terminal status", async () => {
    await act(async () => root.render(<Probe />));
    mocks.query.data = {
      designSystems: [
        { ...mocks.query.data.designSystems[0], indexingStatus: "ready" },
      ],
    };
    await act(async () => root.render(<Probe />));
    const callCount = callCountFor("system-1");

    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(callCountFor("system-1")).toBe(callCount);
  });

  it("checks a newly-indexing system immediately without waiting on an existing one's backoff", async () => {
    await act(async () => root.render(<Probe />));
    expect(callCountFor("system-1")).toBe(1);
    // Push system-1 deep into backoff.
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(callCountFor("system-1")).toBe(2);

    mocks.query.data = {
      designSystems: [
        ...mocks.query.data.designSystems,
        {
          id: "system-2",
          title: "Second",
          description: null,
          data: "{}",
          isDefault: false,
          createdAt: "2026-09-19T00:00:00.000Z",
          indexingStatus: "indexing",
        },
      ],
    };
    await act(async () => root.render(<Probe />));
    expect(callCountFor("system-2")).toBe(1);
  });
});
