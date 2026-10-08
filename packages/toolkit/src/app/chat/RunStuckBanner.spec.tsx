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

const abortRunMock = vi.hoisted(() =>
  vi.fn(
    async (_runId: string, _reason?: string): Promise<string | null> => null,
  ),
);

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useRunStuckDetection: (options: { awaitingResponse?: boolean }) => {
    hookState.awaitingResponse = options.awaitingResponse;
    return hookState.current;
  },
  useAbortRun: () => abortRunMock,
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
    abortRunMock.mockClear();
    window.localStorage.clear();
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

  it("shows the unreadable status, not a stuck banner, when the status is unreadable", async () => {
    hookState.current = { ...STUCK_STATE, statusUnreadable: true };

    await render({ threadId: "thread-1" });

    expect(container.textContent).toContain(
      "agentChat.recovery.statusUnreadable",
    );
    expect(container.textContent).not.toContain(
      "agentChat.recovery.stuckTitle",
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  describe.each([
    { action: "retry", label: "agentChat.common.retry" },
    { action: "cancel", label: "agentChat.common.cancel" },
  ])("when the user clicks $action on a stuck run", ({ action, label }) => {
    const button = () =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === label,
      )!;
    const click = () =>
      act(async () => {
        button().click();
      });
    const bothButtonsEnabled = () =>
      Array.from(container.querySelectorAll("button")).every(
        (candidate) => !candidate.disabled,
      );

    it("keeps both buttons disabled while the abort is in flight", async () => {
      let finishAbort: (runId: string | null) => void = () => {};
      abortRunMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishAbort = resolve;
          }),
      );
      await render({ threadId: "thread-1" });

      await click();

      expect(abortRunMock).toHaveBeenCalledTimes(1);
      expect(button().disabled).toBe(true);
      expect(container.querySelector(".animate-spin")).not.toBeNull();
      await act(async () => finishAbort(null));
    });

    it("re-enables the buttons when the abort fails", async () => {
      await render({ threadId: "thread-1" });

      await click();

      expect(abortRunMock).toHaveBeenCalledWith(
        "run-1",
        `user_stuck_${action}`,
      );
      expect(bothButtonsEnabled()).toBe(true);
      expect(container.querySelector(".animate-spin")).toBeNull();
    });

    it("aborts again on a second click after a failed abort", async () => {
      await render({ threadId: "thread-1" });

      await click();
      await click();

      expect(abortRunMock).toHaveBeenCalledTimes(2);
      expect(bothButtonsEnabled()).toBe(true);
    });

    it("stays busy once the abort succeeds, until the run is replaced", async () => {
      abortRunMock.mockResolvedValueOnce("run-1");
      const onRetry = vi.fn();
      await render({ threadId: "thread-1", onRetry });

      await click();

      expect(onRetry).toHaveBeenCalledTimes(action === "retry" ? 1 : 0);
      expect(button().disabled).toBe(true);
      expect(container.querySelector(".animate-spin")).not.toBeNull();

      hookState.current = { ...STUCK_STATE, runId: "run-2" };
      await render({ threadId: "thread-1", onRetry });
      expect(bothButtonsEnabled()).toBe(true);
    });
  });

  it.each([
    { remount: false, where: "in the same mount" },
    { remount: true, where: "after the chat remounts or reloads" },
  ])(
    "never auto-retries a run the user cancelled, even when the abort failed, $where",
    async ({ remount }) => {
      const onRetry = vi.fn();
      const props = {
        threadId: "thread-cancelled",
        autoRetry: true,
        autoRetryOwnerId: "owner-1",
        onRetry,
      };
      // A server-continued dispatch keeps the banner up but defers auto-retry.
      hookState.current = { ...STUCK_STATE, dispatchMode: "background" };
      await render(props);
      expect(abortRunMock).not.toHaveBeenCalled();

      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find(
            (candidate) => candidate.textContent === "agentChat.common.cancel",
          )!
          .click();
      });
      expect(abortRunMock).toHaveBeenCalledTimes(1);
      expect(abortRunMock).toHaveBeenCalledWith("run-1", "user_stuck_cancel");

      if (remount) {
        // A reload drops component state; only the persisted claim remembers.
        await act(async () => root.unmount());
        root = createRoot(container);
      }

      // The run is still stuck and no longer a continued dispatch: auto-retry is
      // eligible again, but the user already acted on it.
      hookState.current = { ...STUCK_STATE };
      await render(props);
      await act(async () => {});

      expect(abortRunMock).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    },
  );

  it("does not auto-abort a run on a stuck verdict it cannot confirm", async () => {
    const props = {
      threadId: "thread-auto-retry",
      autoRetry: true,
      autoRetryOwnerId: "owner-1",
    };
    hookState.current = { ...STUCK_STATE, statusUnreadable: true };

    await render(props);
    expect(abortRunMock).not.toHaveBeenCalled();

    hookState.current = { ...STUCK_STATE };
    await render(props);
    await act(async () => {});
    expect(abortRunMock).toHaveBeenCalledWith("run-1", "auto_stuck_retry");
  });
});
