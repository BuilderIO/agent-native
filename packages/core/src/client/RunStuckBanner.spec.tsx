// @vitest-environment happy-dom

import { trackEvent } from "@agent-native/core/client/analytics";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunStuckBanner } from "../../../toolkit/src/app/chat/RunStuckBanner.js";
import { createToolkitI18nCatalog } from "../../../toolkit/src/app/i18n.js";
import {
  clearActiveRun,
  setActiveRun,
  updateActiveRunSeq,
} from "./active-run-state.js";
import { AgentNativeI18nProvider } from "./i18n.js";
import { useRunStuckDetection } from "./use-run-stuck-detection.js";

const toolkitCatalog = createToolkitI18nCatalog({ messages: {} });

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      "agentChat.common.cancel": "Cancel",
      "agentChat.common.retry": "Retry",
      "agentChat.recovery.stuckNoProgress":
        "No progress. The agent may have hit a server timeout or lost its connection.",
      "agentChat.recovery.stuckRetrying": "Retrying automatically now.",
      "agentChat.recovery.stuckTitle": "This chat looks stuck.",
      "agentChat.recovery.stuckWithDuration":
        "No progress for {{seconds}}s. The agent may have hit a server timeout or lost its connection.",
    };
    return (messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(options?.[name] ?? ""),
    );
  },
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function RunStuckProbe({
  liveBackgroundStuckThresholdMs,
}: {
  liveBackgroundStuckThresholdMs: number;
}) {
  const state = useRunStuckDetection({
    threadId: "thread-1",
    liveBackgroundStuckThresholdMs,
  });
  return <div>{state.isStuck ? "stuck" : "healthy"}</div>;
}

function RunReconcileProbe({
  awaitingResponse,
}: {
  awaitingResponse?: boolean;
}) {
  const state = useRunStuckDetection({
    threadId: "thread-1",
    awaitingResponse,
  });
  return (
    <div>
      {[
        state.serverSettled ? "settled" : "unsettled",
        state.statusUnreadable ? "unreadable" : "readable",
        state.status ?? "no-status",
      ].join(" ")}
    </div>
  );
}

function RunHealthProbe() {
  const state = useRunStuckDetection({ threadId: "thread-1" });
  return (
    <div>
      {[
        state.isStuck ? "stuck" : "healthy",
        state.statusUnreadable ? "unreadable" : "readable",
      ].join(" ")}
    </div>
  );
}

describe("RunStuckBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  function renderWithCatalog(node: ReactNode) {
    root.render(
      <AgentNativeI18nProvider
        catalog={toolkitCatalog}
        persistPreference={false}
      >
        {node}
      </AgentNativeI18nProvider>,
    );
  }

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
    clearActiveRun();
    vi.useRealTimers();
  });

  it("backs off active-run polling after transient failures", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: "database unavailable" }, false),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      renderWithCatalog(
        <RunStuckProbe liveBackgroundStuckThresholdMs={60_000} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not poll when disabled for an inactive tab", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    function InactiveProbe() {
      const state = useRunStuckDetection({
        threadId: "thread-1",
        enabled: false,
      });
      return <div>{state.runId ?? "inactive"}</div>;
    }

    await act(async () => {
      renderWithCatalog(<InactiveProbe />);
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(container.textContent).toBe("inactive");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("trusts fresh real SSE progress while durable progress catches up", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        active: true,
        runId: "run-streaming",
        status: "running",
        heartbeatAt: 390_000,
        lastProgressAt: 10_000,
        serverNow: 400_000,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    setActiveRun({
      threadId: "thread-1",
      runId: "run-streaming",
      lastSeq: 1,
    });

    await act(async () => {
      renderWithCatalog(
        <RunStuckProbe liveBackgroundStuckThresholdMs={60_000} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(container.textContent).toBe("stuck");

    await act(async () => {
      updateActiveRunSeq("thread-1", "run-streaming", 2, true);
    });
    expect(container.textContent).toBe("healthy");
  });

  it("does not trust keepalive-only SSE cursor advancement as real progress", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        active: true,
        runId: "run-keepalive-only",
        status: "running",
        heartbeatAt: 390_000,
        lastProgressAt: 10_000,
        serverNow: 400_000,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    setActiveRun({
      threadId: "thread-1",
      runId: "run-keepalive-only",
      lastSeq: 1,
    });

    await act(async () => {
      renderWithCatalog(
        <RunStuckProbe liveBackgroundStuckThresholdMs={60_000} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(container.textContent).toBe("stuck");

    await act(async () => {
      updateActiveRunSeq(2, false);
    });
    expect(container.textContent).toBe("stuck");
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
      renderWithCatalog(
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

  it("does not warn for a quiet heartbeating durable worker", async () => {
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
      renderWithCatalog(
        <RunStuckBanner threadId="thread-1" autoRetry onRetry={onRetry} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toBe("");
    expect(container.textContent).not.toContain("Retrying automatically now.");
    expect(onRetry).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/runs/run-background/abort") &&
          init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("does not warn for an overdue worker with a fresh heartbeat", async () => {
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
      renderWithCatalog(<RunStuckBanner threadId="thread-1" autoRetry />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toBe("");
  });

  it("recomputes stuck state when a fresh heartbeat expires during failed polls", async () => {
    let activePollCount = 0;
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        activePollCount += 1;
        if (activePollCount > 1) throw new Error("poll unavailable");
        return jsonResponse({
          active: true,
          runId: "run-background-expiring",
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: 295_000,
          lastProgressAt: 121_000,
          serverNow: 300_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      renderWithCatalog(<RunHealthProbe />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toBe("healthy readable");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_001);
    });

    expect(activePollCount).toBeGreaterThan(1);
    expect(container.textContent).toBe("stuck unreadable");
  });

  it("schedules a later stuck transition after heartbeat expiry", async () => {
    let activePollCount = 0;
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        activePollCount += 1;
        if (activePollCount > 1) throw new Error("poll unavailable");
        return jsonResponse({
          active: true,
          runId: "run-background-later-stuck",
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: 99_000,
          lastProgressAt: 10_000,
          serverNow: 100_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      renderWithCatalog(<RunHealthProbe />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toBe("healthy readable");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(89_999);
    });
    // Polls have failed for a while: the status is unreadable, which is neither
    // stuck nor silence.
    expect(container.textContent).toBe("healthy unreadable");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });

    expect(activePollCount).toBeGreaterThan(1);
    expect(container.textContent).toBe("stuck unreadable");
  });

  it("swaps a stuck banner for the unreadable notice once polls fail, and brings it back when they recover", async () => {
    const stuckResponse = () =>
      jsonResponse({
        active: true,
        runId: "run-stuck-then-unreadable",
        status: "running",
        heartbeatAt: 10_000,
        lastProgressAt: 10_000,
        serverNow: 101_000,
      });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(stuckResponse())
      .mockResolvedValueOnce(jsonResponse({ error: "no" }, false, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "no" }, false, 401))
      .mockResolvedValue(stuckResponse());
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      renderWithCatalog(<RunStuckBanner threadId="thread-1" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(container.textContent).toContain("This chat looks stuck.");

    // A stuck verdict the server can no longer confirm offers Retry and Cancel
    // that cannot work either: the notice replaces it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain(
      "agentChat.recovery.statusUnreadable",
    );
    expect(container.textContent).not.toContain("This chat looks stuck.");
    expect(container.querySelectorAll("button")).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(3);
    expect(container.textContent).toContain("This chat looks stuck.");
    expect(container.textContent).not.toContain(
      "agentChat.recovery.statusUnreadable",
    );
  });

  it("allows the live-worker threshold to request an earlier notice", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-background-early-notice",
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: 99_000,
          lastProgressAt: 10_000,
          serverNow: 100_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      renderWithCatalog(
        <RunStuckProbe liveBackgroundStuckThresholdMs={60_000} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toBe("stuck");
  });

  it("never auto-retries a background-dispatched run even with a stale heartbeat", async () => {
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
      renderWithCatalog(
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
      renderWithCatalog(
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
      renderWithCatalog(<RunStuckBanner threadId="thread-1" autoRetry />);
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
      renderWithCatalog(<RunStuckBanner threadId="thread-1" />);
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
      renderWithCatalog(
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
      renderWithCatalog(
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

  it("does not show a stuck warning while a tool/A2A call is in flight", async () => {
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
      renderWithCatalog(
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

    expect(container.textContent).toBe("");

    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/runs/run-inflight-manual/abort") &&
          init?.method === "POST" &&
          init?.body === JSON.stringify({ reason: "user_stuck_cancel" }),
      ),
    ).toBe(false);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("re-checks hasInFlightWork on every render instead of caching the first value", async () => {
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
      renderWithCatalog(
        <RunStuckBanner threadId="thread-1" hasInFlightWork={() => inFlight} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(container.textContent).toBe("");

    inFlight = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(container.textContent).toContain("Retry");
  });

  it("reports a stuck chat once per run, and only while its banner shows", async () => {
    const stuckEvents = () =>
      vi
        .mocked(trackEvent)
        .mock.calls.filter(
          ([name, properties]) =>
            name === "agent_chat_stuck_detected" &&
            (properties as { runId?: string } | undefined)?.runId ===
              "run-reported",
        );
    let inFlight = true;
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-reported",
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
      renderWithCatalog(
        <RunStuckBanner threadId="thread-1" hasInFlightWork={() => inFlight} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(container.textContent).toBe("");
    expect(stuckEvents()).toHaveLength(0);

    inFlight = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(container.textContent).toContain("This chat looks stuck.");
    expect(stuckEvents()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(stuckEvents()).toHaveLength(1);
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
        renderWithCatalog(
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

  it("stays hidden when the chat is not waiting on a reply", async () => {
    const onRetry = vi.fn();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-abandoned",
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
      renderWithCatalog(
        <RunStuckBanner
          threadId="thread-1"
          autoRetry
          onRetry={onRetry}
          isAwaitingResponse={() => false}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toBe("");
    expect(onRetry).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/abort") && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("re-enables controls when an auto-retry leaves the run running", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-wedged",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      if (url.includes("/runs/run-wedged/abort")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      renderWithCatalog(<RunStuckBanner threadId="thread-1" autoRetry />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("Retrying automatically now.");
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Retry",
      "Cancel",
    ]);
    expect(buttons.every((button) => button.disabled)).toBe(false);
  });
  describe("reconciling with the server's run state", () => {
    const idleResponse = () =>
      jsonResponse({
        active: false,
        status: "idle",
        heartbeatAt: null,
        lastProgressAt: null,
      });
    const runningResponse = () =>
      jsonResponse({
        active: true,
        runId: "run-live",
        status: "running",
        heartbeatAt: 99_000,
        lastProgressAt: 99_000,
        serverNow: 100_000,
      });

    it("calls the run settled only after the server twice reports nothing in flight", async () => {
      const fetchSpy = vi.fn(async () => idleResponse());
      vi.stubGlobal("fetch", fetchSpy);

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      // One idle answer could be a run the server has not registered yet.
      expect(container.textContent).toBe("unsettled readable idle");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe("settled readable idle");
    });

    it("keeps a live run unsettled and polls it at a bounded pace", async () => {
      const fetchSpy = vi.fn(async () => runningResponse());
      vi.stubGlobal("fetch", fetchSpy);

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(container.textContent).toBe("unsettled readable running");
      // First poll at 2s, then every 5s: never a tight loop.
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(13);
    });

    it("stops being settled when the server starts a run again", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(idleResponse())
        .mockResolvedValueOnce(idleResponse())
        .mockResolvedValue(runningResponse());
      vi.stubGlobal("fetch", fetchSpy);

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });
      expect(container.textContent).toBe("settled readable idle");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(container.textContent).toBe("unsettled readable running");
    });

    it("drops a settle taken before the chat began waiting and settles again from fresh polls", async () => {
      const fetchSpy = vi.fn(async () => idleResponse());
      vi.stubGlobal("fetch", fetchSpy);

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe awaitingResponse={false} />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });
      expect(container.textContent).toBe("settled readable idle");

      // The user sends: the idle answers above predate this run.
      await act(async () => {
        renderWithCatalog(<RunReconcileProbe awaitingResponse />);
      });
      expect(container.textContent).toBe("unsettled readable no-status");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(container.textContent).toBe("unsettled readable idle");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(container.textContent).toBe("settled readable idle");
    });

    it("neither warns nor reloads when a run starts in a chat that was idle and settled", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(idleResponse())
        .mockResolvedValueOnce(idleResponse())
        .mockResolvedValue(runningResponse());
      vi.stubGlobal("fetch", fetchSpy);
      const onServerSettled = vi.fn(async () => "still_running" as const);
      const renderChat = (awaiting: boolean) =>
        renderWithCatalog(
          <RunStuckBanner
            threadId="thread-1"
            onServerSettled={onServerSettled}
            isAwaitingResponse={() => awaiting}
          />,
        );

      await act(async () => renderChat(false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      await act(async () => renderChat(true));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(onServerSettled).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain(
        "agentChat.recovery.statusMismatch",
      );
    });

    it("still reloads a run the server stopped tracking after the chat began waiting", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => idleResponse()),
      );
      const onServerSettled = vi.fn(async () => "settled" as const);
      const renderChat = (awaiting: boolean) =>
        renderWithCatalog(
          <RunStuckBanner
            threadId="thread-1"
            onServerSettled={onServerSettled}
            isAwaitingResponse={() => awaiting}
          />,
        );

      await act(async () => renderChat(false));
      await act(async () => renderChat(true));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(onServerSettled).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(onServerSettled).toHaveBeenCalledTimes(1);
    });

    it("reports an unreadable status, not a finished run, while polls fail, and recovers", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(runningResponse())
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(jsonResponse({ error: "down" }, false, 503))
        .mockResolvedValue(runningResponse());
      vi.stubGlobal("fetch", fetchSpy);

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(container.textContent).toBe("unsettled readable running");

      // First failure at +5s, the second 10s later.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(container.textContent).toBe("unsettled readable running");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(container.textContent).toBe("unsettled unreadable running");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(container.textContent).toBe("unsettled readable running");
    });

    it("does not settle on two idle answers with a failed poll between them", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(idleResponse())
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(idleResponse());
      vi.stubGlobal("fetch", fetchSpy);

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(container.textContent).toBe("unsettled readable idle");

      // The failed poll at +5s hides whether a run started; the idle answer at
      // +10s after it is the first of a new streak, not the second of the old.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(container.textContent).toBe("unsettled readable idle");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(container.textContent).toBe("settled readable idle");
    });

    it("keeps a settled verdict through a poll outage instead of flipping it off and on", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(idleResponse())
        .mockResolvedValueOnce(idleResponse())
        .mockRejectedValueOnce(new Error("offline"))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(idleResponse());
      vi.stubGlobal("fetch", fetchSpy);
      const advance = async (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe />);
      });
      await advance(2_000);
      expect(container.textContent).toBe("unsettled readable idle");
      await advance(5_000);
      expect(container.textContent).toBe("settled readable idle");

      await advance(15_500);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(container.textContent).toBe("settled readable idle");
      await advance(10_000);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(container.textContent).toBe("settled unreadable idle");

      // The first idle answer after the outage continues the settled streak.
      await advance(20_000);
      expect(fetchSpy).toHaveBeenCalledTimes(5);
      expect(container.textContent).toBe("settled readable idle");
      await advance(15_000);
      expect(fetchSpy).toHaveBeenCalledTimes(6);
      expect(container.textContent).toBe("settled readable idle");
    });

    it("neither reloads twice nor clears the mismatch notice when a poll fails after the run settled", async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(idleResponse())
        .mockResolvedValueOnce(idleResponse())
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(idleResponse());
      vi.stubGlobal("fetch", fetchSpy);
      const onServerSettled = vi.fn(async () => "still_running" as const);

      await act(async () => {
        renderWithCatalog(
          <RunStuckBanner
            threadId="thread-1"
            onServerSettled={onServerSettled}
            isAwaitingResponse={() => true}
          />,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });
      expect(onServerSettled).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain(
        "agentChat.recovery.statusMismatch",
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(25_500);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(container.textContent).toContain(
        "agentChat.recovery.statusMismatch",
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      expect(onServerSettled).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain(
        "agentChat.recovery.statusMismatch",
      );
    });

    it.each([
      ["null", null],
      ["an array", []],
      ["an object without active", {}],
      ["a non-boolean active", { active: "yes" }],
      ["a string", "idle"],
    ])(
      "counts a 200 answer with %s as its body as a failed poll",
      async (_label, body) => {
        const fetchSpy = vi.fn(async () => jsonResponse(body));
        vi.stubGlobal("fetch", fetchSpy);

        await act(async () => {
          renderWithCatalog(<RunReconcileProbe />);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
        });
        expect(container.textContent).toBe("unsettled readable no-status");

        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(container.textContent).toBe("unsettled unreadable no-status");
      },
    );

    it.each([401, 403, 404])(
      "keeps the last run and reports the status unreadable when the poll answers %i",
      async (status) => {
        const fetchSpy = vi
          .fn()
          .mockResolvedValueOnce(runningResponse())
          .mockResolvedValue(jsonResponse({ error: "no" }, false, status));
        vi.stubGlobal("fetch", fetchSpy);

        await act(async () => {
          renderWithCatalog(<RunReconcileProbe />);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
        });
        expect(container.textContent).toBe("unsettled readable running");

        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(container.textContent).toBe("unsettled readable running");

        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(container.textContent).toBe("unsettled unreadable running");
      },
    );

    it("tells a waiting chat the status is unreadable when the poll is rejected", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ error: "unauthorized" }, false, 401)),
      );

      await act(async () => {
        renderWithCatalog(
          <RunStuckBanner
            threadId="thread-1"
            isAwaitingResponse={() => true}
          />,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(container.textContent).toBe("");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(container.textContent).toContain(
        "agentChat.recovery.statusUnreadable",
      );
    });

    it("counts an answer that is not valid JSON as a failed poll", async () => {
      const fetchSpy = vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }) as Response,
      );
      vi.stubGlobal("fetch", fetchSpy);

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(container.textContent).toBe("unsettled readable no-status");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe("unsettled unreadable no-status");
    });

    it("stops polling once the chat unmounts", async () => {
      const fetchSpy = vi.fn(async () => idleResponse());
      vi.stubGlobal("fetch", fetchSpy);

      await act(async () => {
        renderWithCatalog(<RunReconcileProbe />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });
      const callsBeforeUnmount = fetchSpy.mock.calls.length;
      expect(callsBeforeUnmount).toBeGreaterThan(0);

      await act(async () => root.unmount());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(fetchSpy.mock.calls.length).toBe(callsBeforeUnmount);
      root = createRoot(container);
    });
  });
});
