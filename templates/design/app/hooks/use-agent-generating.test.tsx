// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendToDesignAgentChat: vi.fn(() => "design-tab"),
}));

vi.mock("@/lib/agent-chat", () => mocks);

import { useAgentGenerating } from "./use-agent-generating";

let latest: ReturnType<typeof useAgentGenerating> | null = null;

function Probe({
  onComplete,
  onFailed = () => {},
  onStale = () => {},
  onStopped,
  onRunConfirmed = () => {},
}: {
  onComplete: () => void;
  onFailed?: () => void;
  onStale?: () => void;
  onStopped: () => void;
  onRunConfirmed?: () => void;
}) {
  latest = useAgentGenerating({
    onComplete,
    onFailed,
    onStale,
    onStopped,
    onRunConfirmed,
  });
  return null;
}

describe("useAgentGenerating", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.sendToDesignAgentChat.mockClear();
    latest = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("ends Design generation immediately without scheduling recovery after an explicit stop", async () => {
    const onComplete = vi.fn();
    const onStopped = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Probe onComplete={onComplete} onStopped={onStopped} />);
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            tabId: "design-tab",
            reason: "stopped",
          },
        }),
      );
    });

    expect(latest!.generating).toBe(false);
    expect(onStopped).toHaveBeenCalledWith("design-tab");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("recovers when the chat completion event is lost", async () => {
    const onComplete = vi.fn();
    const onStopped = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: true,
          status: "running",
          runId: "design-run",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ active: false, status: "idle" }),
      });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ active: false, status: "idle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe onComplete={onComplete} onStopped={onStopped} />);
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design-tab");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => root.unmount());
    container.remove();
  });

  it("waits through initial idle snapshots until it observes the submitted run", async () => {
    const onComplete = vi.fn();
    const onRunConfirmed = vi.fn();
    const onStopped = vi.fn();
    const state = (active: boolean, status: string, runId?: string) => ({
      ok: true,
      json: async () => ({ active, status, ...(runId ? { runId } : {}) }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(state(false, "idle"))
      .mockResolvedValueOnce(state(false, "idle"))
      .mockResolvedValueOnce(state(true, "running", "design-run"))
      .mockResolvedValueOnce(state(false, "idle"))
      .mockResolvedValueOnce(state(false, "idle"));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe
          onComplete={onComplete}
          onRunConfirmed={onRunConfirmed}
          onStopped={onStopped}
        />,
      );
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onRunConfirmed).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onRunConfirmed).toHaveBeenCalledWith("design-tab", "design-run");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design-tab");
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await act(async () => root.unmount());
    container.remove();
  });

  it("waits across a continuation handoff and idle gap", async () => {
    const onComplete = vi.fn();
    const onStopped = vi.fn();
    const state = (
      active: boolean,
      status: string,
      runId?: string,
      terminalReason?: string,
    ) => ({
      ok: true,
      json: async () => ({
        active,
        status,
        ...(runId ? { runId } : {}),
        ...(terminalReason ? { terminalReason } : {}),
      }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        state(false, "completed", "design-run-1", "stream_ended"),
      )
      .mockResolvedValueOnce(state(false, "idle"))
      .mockResolvedValueOnce(state(true, "running", "design-run-2"))
      .mockResolvedValueOnce(state(false, "completed", "design-run-2", "done"))
      .mockResolvedValueOnce(state(false, "idle"));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe onComplete={onComplete} onStopped={onStopped} />);
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            tabId: "design-tab",
            runId: "design-run-1",
            reason: "run.completed",
          },
        }),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design-tab");
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await act(async () => root.unmount());
    container.remove();
  });

  it("ignores the previous completed run when a continuation reuses its thread", async () => {
    const onComplete = vi.fn();
    const onFailed = vi.fn();
    const state = (
      active: boolean,
      status: string,
      runId?: string,
      terminalReason?: string,
    ) => ({
      ok: true,
      json: async () => ({
        active,
        status,
        ...(runId ? { runId } : {}),
        ...(terminalReason ? { terminalReason } : {}),
      }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(state(false, "completed", "design-run-1", "done"))
      .mockResolvedValueOnce(state(false, "completed", "design-run-1", "done"))
      .mockResolvedValueOnce(state(true, "running", "design-run-2"))
      .mockResolvedValueOnce(state(false, "completed", "design-run-2", "done"))
      .mockResolvedValueOnce(state(false, "idle"));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe
          onComplete={onComplete}
          onFailed={onFailed}
          onStopped={vi.fn()}
        />,
      );
    });
    await act(async () => {
      latest!.track("design_tab", {
        ignorePreviousRun: true,
        previousRunId: "design-run-1",
      });
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            tabId: "design_tab",
            runId: "design-run-1",
            reason: "run.failed",
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design_tab");
    expect(onFailed).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await act(async () => root.unmount());
    container.remove();
  });

  it("waits for an active successor when a continuation baseline is unverified", async () => {
    const onComplete = vi.fn();
    const state = (
      active: boolean,
      status: string,
      runId?: string,
      terminalReason?: string,
    ) => ({
      ok: true,
      json: async () => ({
        active,
        status,
        ...(runId ? { runId } : {}),
        ...(terminalReason ? { terminalReason } : {}),
      }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        state(false, "completed", "intermediate-run", "done"),
      )
      .mockResolvedValueOnce(state(false, "idle"))
      .mockResolvedValueOnce(state(true, "running", "new-run"))
      .mockResolvedValueOnce(state(false, "completed", "new-run", "done"))
      .mockResolvedValueOnce(state(false, "idle"));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe onComplete={onComplete} onStopped={vi.fn()} />);
    });
    await act(async () => {
      latest!.track("design_tab", {
        ignorePreviousRun: true,
        previousRunId: "old-run",
        previousRunBaselineVerified: false,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(latest!.generating).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design_tab");
    expect(fetchMock).toHaveBeenCalledTimes(5);

    await act(async () => root.unmount());
    container.remove();
  });

  it("accepts a first-poll terminal successor when the server proves its predecessor", async () => {
    const onComplete = vi.fn();
    const state = (runId: string, successorOfRunId: string) => ({
      ok: true,
      json: async () => ({
        active: false,
        status: "completed",
        runId,
        successorOfRunId,
        terminalReason: "done",
      }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(state("successor-run", "previous-run"))
      .mockResolvedValueOnce(state("successor-run", "previous-run"));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe onComplete={onComplete} onStopped={vi.fn()} />);
    });
    await act(async () => {
      latest!.track("design_tab", {
        ignorePreviousRun: true,
        previousRunId: "previous-run",
        previousRunBaselineVerified: false,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design_tab");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
  });

  it.each(["user", "user_stuck_retry"])(
    "treats the requested abort reason %s as a user stop",
    async (reason) => {
      const onFailed = vi.fn();
      const onStopped = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            active: false,
            status: "aborted",
            runId: "design-run",
            terminalReason: `aborted:${reason}`,
          }),
        }),
      );

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <Probe
            onComplete={vi.fn()}
            onFailed={onFailed}
            onStopped={onStopped}
          />,
        );
      });
      await act(async () => {
        latest!.submit("Make a landing page", "Design id: design-1");
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(latest!.generating).toBe(false);
      expect(onStopped).toHaveBeenCalledWith("design-tab");
      expect(onFailed).not.toHaveBeenCalled();

      await act(async () => root.unmount());
      container.remove();
    },
  );

  it("surfaces a server abort as failure instead of treating it as a user stop", async () => {
    const onFailed = vi.fn();
    const onStopped = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          active: false,
          status: "aborted",
          runId: "design-run",
          terminalReason: "aborted:duplicate_submission",
        }),
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe
          onComplete={vi.fn()}
          onFailed={onFailed}
          onStopped={onStopped}
        />,
      );
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(latest!.generating).toBe(false);
    expect(onFailed).toHaveBeenCalledWith("design-tab");
    expect(onStopped).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("fails a start_failed event immediately with retryable generation state", async () => {
    const onFailed = vi.fn();
    const onStale = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ active: false, status: "idle" }),
      }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe
          onComplete={vi.fn()}
          onFailed={onFailed}
          onStale={onStale}
          onStopped={vi.fn()}
        />,
      );
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            tabId: "design-tab",
            reason: "start_failed",
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(latest!.generating).toBe(false);
    expect(onFailed).toHaveBeenCalledOnce();
    expect(onStale).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps tracking when status confirms a run after start_failed", async () => {
    const onFailed = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          active: true,
          status: "running",
          runId: "accepted-run",
        }),
      }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe onComplete={vi.fn()} onFailed={onFailed} onStopped={vi.fn()} />,
      );
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            tabId: "design-tab",
            reason: "start_failed",
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(latest!.generating).toBe(true);
    expect(onFailed).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("bounds a continuation handoff that never produces a successor", async () => {
    const onFailed = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: false,
        status: "truncated",
        runId: "truncated-run",
        terminalReason: "stream_ended",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe onComplete={vi.fn()} onFailed={onFailed} onStopped={vi.fn()} />,
      );
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 3_000);
    });

    expect(latest!.generating).toBe(false);
    expect(onFailed).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("accepts awaitingRedispatch and clears its deadline when the successor runs", async () => {
    const onComplete = vi.fn();
    const onFailed = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: false,
          status: "running",
          runId: "successor-run",
          successorOfRunId: "previous-run",
          awaitingRedispatch: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: true,
          status: "running",
          runId: "successor-run",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: false,
          status: "completed",
          runId: "successor-run",
          terminalReason: "done",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ active: false, status: "idle" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe
          onComplete={onComplete}
          onFailed={onFailed}
          onStopped={vi.fn()}
        />,
      );
    });
    await act(async () => {
      latest!.track("design_tab", {
        ignorePreviousRun: true,
        previousRunId: "previous-run",
        previousRunBaselineVerified: false,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(18_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design_tab");
    expect(onFailed).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(onFailed).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("accepts a terminal successor after a verified idle baseline", async () => {
    const onComplete = vi.fn();
    const state = (
      active: boolean,
      status: string,
      runId?: string,
      terminalReason?: string,
    ) => ({
      ok: true,
      json: async () => ({
        active,
        status,
        ...(runId ? { runId } : {}),
        ...(terminalReason ? { terminalReason } : {}),
      }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(state(false, "completed", "new-run", "done"))
      .mockResolvedValueOnce(state(false, "idle"));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe onComplete={onComplete} onStopped={vi.fn()} />);
    });
    await act(async () => {
      latest!.track("design_tab", {
        ignorePreviousRun: true,
        previousRunBaselineVerified: true,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design_tab");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
  });

  it("clears an unconfirmed generation after the start timeout", async () => {
    const onComplete = vi.fn();
    const onStale = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ active: false, status: "idle" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe onComplete={onComplete} onStale={onStale} onStopped={vi.fn()} />,
      );
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onStale).toHaveBeenCalledWith("design-tab");
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("surfaces an errored run instead of reporting successful completion", async () => {
    const onComplete = vi.fn();
    const onFailed = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: false,
        status: "errored",
        runId: "design-run",
        terminalReason: "error:runtime_error",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Probe
          onComplete={onComplete}
          onFailed={onFailed}
          onStopped={vi.fn()}
        />,
      );
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onFailed).toHaveBeenCalledWith("design-tab");
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("uses a run.failed chat event to check the authoritative run status", async () => {
    const onComplete = vi.fn();
    const onFailed = vi.fn();
    const onStopped = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          active: false,
          status: "errored",
          runId: "design-run",
          terminalReason: "error:runtime_error",
        }),
      }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Probe
          onComplete={onComplete}
          onFailed={onFailed}
          onStopped={onStopped}
        />,
      );
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            tabId: "design-tab",
            runId: "design-run",
            reason: "run.failed",
          },
        }),
      );
    });

    expect(latest!.generating).toBe(true);
    expect(onFailed).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onStopped).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(latest!.generating).toBe(false);
    expect(onFailed).toHaveBeenCalledWith("design-tab");

    await act(async () => root.unmount());
    container.remove();
  });

  it("restarts status polling when a running event reactivates the tracked tab", async () => {
    type RunStateResponse = {
      ok: boolean;
      json: () => Promise<{ active: boolean; status: string }>;
    };
    let resolveFirstFetch!: (response: RunStateResponse) => void;
    const firstFetch = new Promise<RunStateResponse>((resolve) => {
      resolveFirstFetch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          active: true,
          status: "running",
          runId: "design-run",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe onComplete={vi.fn()} onStopped={vi.fn()} />);
    });
    await act(async () => {
      latest!.submit("Make a landing page", "Design id: design-1");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "design-tab" },
        }),
      );
      resolveFirstFetch({
        ok: true,
        json: async () => ({
          active: true,
          status: "running",
          runId: "design-run",
        }),
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
  });
});
