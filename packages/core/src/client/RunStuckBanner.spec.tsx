// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunStuckBanner } from "./RunStuckBanner.js";

vi.mock("./analytics.js", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("./api-path.js", () => ({
  agentNativePath: (path: string) => path,
}));

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe("RunStuckBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("automatically aborts and retries a stuck active run once", async () => {
    const onRetry = vi.fn();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-stuck",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      if (url.includes("/runs/run-stuck/abort")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner threadId="thread-1" autoRetry onRetry={onRetry} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("Retrying automatically now.");
    expect(onRetry).toHaveBeenCalledWith("run-stuck");
    expect(
      fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/runs/run-stuck/abort") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/runs/run-stuck/abort") &&
          init?.method === "POST",
      )?.[1]?.body,
    ).toBe(JSON.stringify({ reason: "auto_stuck_retry" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(
      fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/runs/run-stuck/abort") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("does not flag a heartbeating durable worker during its bounded tool window", async () => {
    const onRetry = vi.fn();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-background",
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: 295_000,
          lastProgressAt: 10_000,
          serverNow: 300_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner threadId="thread-1" autoRetry onRetry={onRetry} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent ?? "").toBe("");
    expect(onRetry).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/runs/run-background/abort") &&
          init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("shows the fallback after a heartbeating durable worker exceeds its recovery window", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-background-overdue",
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: 799_000,
          lastProgressAt: 10_000,
          serverNow: 800_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(<RunStuckBanner threadId="thread-1" autoRetry />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("The agent is still working.");
    expect(container.textContent).toContain(
      "The background worker is still alive",
    );
    expect(container.textContent).toContain("Retry");
  });

  it("never auto-retries a background-dispatched run even with a stale heartbeat", async () => {
    // The server owns recovery for background runs (chained continuations +
    // lost-handoff sweep). Even when the worker heartbeat looks dead, an
    // automatic client abort could kill a live server-chained successor —
    // only the manual controls remain.
    const onRetry = vi.fn();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-background-stale",
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: 100_000,
          lastProgressAt: 10_000,
          serverNow: 300_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner threadId="thread-1" autoRetry onRetry={onRetry} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("This chat looks stuck.");
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).toContain("Cancel");
    expect(container.textContent).not.toContain("Retrying automatically now.");
    expect(onRetry).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/abort") && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("never auto-retries a foreground self-chained run", async () => {
    const onRetry = vi.fn();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-foreground-self-chain",
          status: "running",
          dispatchMode: "foreground-self-chain",
          heartbeatAt: 100_000,
          lastProgressAt: 10_000,
          serverNow: 300_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner threadId="thread-1" autoRetry onRetry={onRetry} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("This chat looks stuck.");
    expect(container.textContent).not.toContain("Retrying automatically now.");
    expect(onRetry).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/abort") && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("uses the wider 180s stuck threshold for server-continued runs", async () => {
    // 120s without progress marks a client-continued foreground run stuck (90s
    // threshold) but must not mark a server-continued run stuck — the server's
    // recovery machinery is still within its own windows.
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-background-quiet",
          status: "running",
          dispatchMode: "foreground-self-chain",
          heartbeatAt: 129_000,
          lastProgressAt: 10_000,
          serverNow: 130_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(<RunStuckBanner threadId="thread-1" autoRetry />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent ?? "").toBe("");
  });

  it("keeps manual retry/cancel controls when auto retry is disabled", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-manual",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(<RunStuckBanner threadId="thread-1" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("This chat looks stuck.");
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).toContain("Cancel");
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/runs/run-manual/abort") &&
          init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("clears retry busy state when recovery moves to a new stuck run", async () => {
    const onRetry = vi.fn();
    let activePollCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/runs/active")) {
        activePollCount += 1;
        const runId = activePollCount === 1 ? "run-first" : "run-next";
        return jsonResponse({
          active: true,
          runId,
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      if (url.includes("/runs/run-first/abort")) {
        return jsonResponse({ ok: true });
      }
      if (url.includes("/runs/run-next/abort")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner
          threadId="thread-1"
          autoRetry
          autoRetryOwnerId="owner-1"
          onRetry={onRetry}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(onRetry).toHaveBeenCalledWith("run-first");
    expect(onRetry).toHaveBeenCalledWith("run-next");
    expect(
      fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/runs/run-first/abort") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/runs/run-next/abort") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("does not auto-abort a run reported to have work in flight", async () => {
    const onRetry = vi.fn();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-inflight",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner
          threadId="thread-1"
          autoRetry
          onRetry={onRetry}
          hasInFlightWork={() => true}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(onRetry).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/abort") && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("hides Retry and only offers Cancel while a tool/A2A call is in flight", async () => {
    const onRetry = vi.fn();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-inflight-manual",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      if (url.includes("/runs/run-inflight-manual/abort")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner
          threadId="thread-1"
          onRetry={onRetry}
          hasInFlightWork={() => true}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("The agent is still working.");
    expect(container.textContent).not.toContain("Retry");
    expect(container.textContent).toContain("Cancel");

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Cancel"),
    );
    expect(cancelButton).toBeTruthy();

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/runs/run-inflight-manual/abort") &&
          init?.method === "POST" &&
          init?.body === JSON.stringify({ reason: "user_stuck_cancel" }),
      ),
    ).toBe(true);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("re-checks hasInFlightWork on every render instead of caching the first value", async () => {
    // The A2A call finishes between two polls — the banner must recompute
    // from the live source (e.g. chatHandle.hasInFlightWork()) rather than
    // freezing whatever it saw when the banner first mounted, or Retry would
    // stay hidden (or shown) forever after work actually changes state.
    let inFlight = true;
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-transitions",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner threadId="thread-1" hasInFlightWork={() => inFlight} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(container.textContent).not.toContain("Retry");

    inFlight = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(container.textContent).toContain("Retry");
  });

  it("claims one automatic retry across multiple mounted chat views", async () => {
    const onRetryOne = vi.fn();
    const onRetryTwo = vi.fn();
    const secondContainer = document.createElement("div");
    document.body.appendChild(secondContainer);
    const secondRoot = createRoot(secondContainer);
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-shared",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      if (url.includes("/runs/run-shared/abort")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await act(async () => {
        root.render(
          <RunStuckBanner
            threadId="thread-1"
            autoRetry
            autoRetryOwnerId="owner-1"
            onRetry={onRetryOne}
          />,
        );
        secondRoot.render(
          <RunStuckBanner
            threadId="thread-1"
            autoRetry
            autoRetryOwnerId="owner-2"
            onRetry={onRetryTwo}
          />,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(
        fetchSpy.mock.calls.filter(
          ([url, init]) =>
            String(url).includes("/runs/run-shared/abort") &&
            init?.method === "POST",
        ),
      ).toHaveLength(1);
      expect(onRetryOne.mock.calls.length + onRetryTwo.mock.calls.length).toBe(
        1,
      );
    } finally {
      act(() => secondRoot.unmount());
      secondContainer.remove();
    }
  });
});
