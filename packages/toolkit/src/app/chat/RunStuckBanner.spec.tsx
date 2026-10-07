// @vitest-environment happy-dom

import type { RunStuckState } from "@agent-native/core/client/agent-chat";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunStuckBanner } from "./RunStuckBanner.js";

const trackEventMock = vi.hoisted(() => vi.fn());

const STUCK_STATE: RunStuckState = {
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
  serverSettled: false,
  statusUnreadable: false,
};

const SETTLED_STATE: RunStuckState = {
  ...STUCK_STATE,
  isStuck: false,
  status: "idle",
  stuckSinceMs: null,
  serverSettled: true,
};

const hookState = vi.hoisted(() => ({
  current: null as RunStuckState | null,
  awaitingResponse: undefined as boolean | undefined,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useRunStuckDetection: (options: { awaitingResponse?: boolean }) => {
    hookState.awaitingResponse = options.awaitingResponse;
    return hookState.current;
  },
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    trackEventMock.mockClear();
    hookState.current = STUCK_STATE;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render(props: Parameters<typeof RunStuckBanner>[0]) {
    await act(async () => {
      root.render(<RunStuckBanner {...props} />);
    });
  }

  it("reports a stuck run once, even when the chat view remounts", async () => {
    for (let mount = 0; mount < 2; mount += 1) {
      const remounted = createRoot(document.createElement("div"));
      await act(async () => {
        remounted.render(<RunStuckBanner threadId="thread-1" />);
      });
      await act(async () => remounted.unmount());
    }

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(
      "agent_chat_stuck_detected",
      expect.objectContaining({
        runId: "run-1",
        threadId: "thread-1",
        reason: "no_progress",
        dispatchMode: null,
        hasInFlightWork: false,
      }),
    );
  });

  const isAwaitingResponse = () => true;

  describe("when the server stops tracking a run the chat shows as running", () => {
    beforeEach(() => {
      hookState.current = SETTLED_STATE;
    });

    it("reloads the thread once and says nothing when that settles the chat", async () => {
      const onServerSettled = vi.fn(async () => "settled" as const);

      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse,
      });
      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse,
      });

      expect(onServerSettled).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe("");
    });

    it("does not reconcile a host that cannot say whether the chat is waiting", async () => {
      const onServerSettled = vi.fn(async () => "settled" as const);

      await render({ threadId: "thread-1", onServerSettled });

      expect(onServerSettled).not.toHaveBeenCalled();
    });

    it("does nothing for a chat that is not waiting on a response", async () => {
      const onServerSettled = vi.fn(async () => "settled" as const);

      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse: () => false,
      });

      expect(onServerSettled).not.toHaveBeenCalled();
      expect(container.textContent).toBe("");
    });

    it("tells the user when the reload could not settle the chat, and retries at a bounded pace", async () => {
      const onServerSettled = vi.fn(async () => "still_running" as const);

      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse,
      });
      expect(container.textContent).toContain(
        "agentChat.recovery.statusMismatch",
      );
      expect(container.textContent).toContain("agentChat.recovery.reload");
      expect(container.textContent).not.toContain("recovery.stuckTitle");

      // Every poll hands the banner a fresh state object.
      vi.setSystemTime(1_015_000);
      hookState.current = { ...SETTLED_STATE };
      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse,
      });
      expect(onServerSettled).toHaveBeenCalledTimes(1);

      vi.setSystemTime(1_031_000);
      hookState.current = { ...SETTLED_STATE };
      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse,
      });
      expect(onServerSettled).toHaveBeenCalledTimes(2);
    });

    it("tells the detector whether the chat is waiting, so a settle predating the wait is dropped", async () => {
      await render({ threadId: "thread-1", isAwaitingResponse: () => true });
      expect(hookState.awaitingResponse).toBe(true);

      await render({ threadId: "thread-1", isAwaitingResponse: () => false });
      expect(hookState.awaitingResponse).toBe(false);

      await render({ threadId: "thread-1" });
      expect(hookState.awaitingResponse).toBeUndefined();
    });

    it("ignores a reload that finishes after the server started a run again", async () => {
      let finishReload: (outcome: "still_running") => void = () => {};
      const onServerSettled = vi.fn(
        () =>
          new Promise<"still_running">((resolve) => {
            finishReload = resolve;
          }),
      );

      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse,
      });
      expect(onServerSettled).toHaveBeenCalledTimes(1);

      hookState.current = {
        ...STUCK_STATE,
        isStuck: false,
        serverSettled: false,
      };
      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse,
      });
      await act(async () => finishReload("still_running"));

      expect(container.textContent).toBe("");
    });

    it("shows an unreadable status, not a finished chat, when the reload itself fails", async () => {
      const onServerSettled = vi.fn(async () => {
        throw new Error("thread unavailable");
      });

      await render({
        threadId: "thread-1",
        onServerSettled,
        isAwaitingResponse,
      });

      expect(container.textContent).toContain(
        "agentChat.recovery.statusUnreadable",
      );
      expect(container.textContent).not.toContain(
        "agentChat.recovery.statusMismatch",
      );
    });
  });

  it("shows an unreadable status when the run's status cannot be fetched", async () => {
    hookState.current = {
      ...STUCK_STATE,
      isStuck: false,
      stuckSinceMs: null,
      statusUnreadable: true,
    };

    await render({ threadId: "thread-1" });
    expect(container.textContent).toContain(
      "agentChat.recovery.statusUnreadable",
    );
    expect(container.textContent).not.toContain("recovery.stuckTitle");
    expect(container.textContent).not.toContain("agentChat.recovery.reload");

    await render({ threadId: "thread-1", isAwaitingResponse: () => false });
    expect(container.textContent).toBe("");

    // A host that cannot say whether the chat waits only doubts a run it saw.
    hookState.current = { ...hookState.current!, status: "idle", runId: null };
    await render({ threadId: "thread-1" });
    expect(container.textContent).toBe("");
  });

  it("keeps the stuck banner when the status is also unreadable", async () => {
    hookState.current = { ...STUCK_STATE, statusUnreadable: true };

    await render({ threadId: "thread-1" });

    expect(container.textContent).toContain("agentChat.recovery.stuckTitle");
    expect(container.textContent).not.toContain(
      "agentChat.recovery.statusUnreadable",
    );
  });
});
