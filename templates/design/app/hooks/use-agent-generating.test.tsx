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
});
