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
  onStopped,
}: {
  onComplete: () => void;
  onStopped: () => void;
}) {
  latest = useAgentGenerating({ onComplete, onStopped });
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
        json: async () => ({ active: true, status: "running" }),
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

  it.each(["completed", "errored", "aborted", "truncated"])(
    "recovers after two terminal %s snapshots without an active snapshot",
    async (status) => {
      const onComplete = vi.fn();
      const onStopped = vi.fn();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ active: true, status }),
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
      expect(latest!.generating).toBe(false);
      expect(onComplete).toHaveBeenCalledWith("design-tab");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await act(async () => root.unmount());
      container.remove();
    },
  );

  it("recovers after two idle snapshots before observing an active run", async () => {
    const onComplete = vi.fn();
    const onStopped = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
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
    expect(latest!.generating).toBe(false);
    expect(onComplete).toHaveBeenCalledWith("design-tab");
    expect(fetchMock).toHaveBeenCalledTimes(2);

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
        json: async () => ({ active: true, status: "running" }),
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
        json: async () => ({ active: true, status: "running" }),
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
