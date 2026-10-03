// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunStuckBanner } from "./RunStuckBanner.js";

const trackEventMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useRunStuckDetection: () => ({
    isStuck: true,
    runId: "run-1",
    status: "running",
    lastProgressAt: 0,
    stuckSinceMs: 90_000,
    lastProgressSeq: 1,
    heartbeatAt: null,
    heartbeatSinceMs: null,
    dispatchMode: null,
    hasInFlightWork: false,
  }),
  useAbortRun: () => vi.fn(),
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: trackEventMock,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("RunStuckBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it("reports a stuck run once, even when the chat view remounts", async () => {
    for (let mount = 0; mount < 2; mount += 1) {
      root = createRoot(container);
      await act(async () => {
        root.render(<RunStuckBanner threadId="thread-1" />);
      });
      await act(async () => root.unmount());
    }

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "agent_chat_stuck_detected",
      expect.objectContaining({ runId: "run-1", threadId: "thread-1" }),
    );
  });
});
