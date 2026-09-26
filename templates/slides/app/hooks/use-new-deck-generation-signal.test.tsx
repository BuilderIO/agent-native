// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  shouldClearNewDeckGeneratingState,
  shouldShowNewDeckGeneratingOverlay,
} from "@/lib/generation-state";

import { useNewDeckGenerationSignal } from "./use-new-deck-generation-signal";

const observerState = vi.hoisted(() => ({
  options: null as { tabId: string | null } | null,
  generating: false,
  observedRun: false,
  runError: false,
  stopReason: null as "stopped" | null,
  timedOut: false,
}));

vi.mock("@/hooks/use-agent-generating", () => ({
  MAX_GENERATING_MS: 30 * 60 * 1000,
  useAgentGenerating: (options: { tabId: string | null }) => {
    observerState.options = options;
    return { ...observerState };
  },
}));

describe("useNewDeckGenerationSignal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: Parameters<typeof useNewDeckGenerationSignal>[0];
  let state: ReturnType<typeof useNewDeckGenerationSignal>;

  function Harness() {
    state = useNewDeckGenerationSignal(props);
    const phase = state.generationStarted ? "started" : "pending";
    const overlay = shouldShowNewDeckGeneratingOverlay({
      generating: state.generating,
      isNewDeckCreation: true,
      slideCount: 0,
      phase,
    });
    const clearUrl = shouldClearNewDeckGeneratingState({
      generating: state.generating,
      waitingOnQuestions: false,
      phase,
    });
    return (
      <div
        data-generating={String(state.generating)}
        data-overlay={String(overlay)}
        data-clear-url={String(clearUrl)}
      />
    );
  }

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    Object.assign(observerState, {
      options: null,
      generating: false,
      observedRun: false,
      runError: false,
      stopReason: null,
      timedOut: false,
    });
  });

  it("renders overlay and URL state from the matched run, not another tab", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: "target-tab",
      broadGenerating: true,
      submitStarted: true,
    };

    act(() => root.render(<Harness />));
    expect(observerState.options).toEqual({ tabId: "target-tab" });
    expect(state.generating).toBe(false);
    expect(state.generationStarted).toBe(false);
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).dataset.overlay).toBe("true");
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe(
      "false",
    );

    Object.assign(observerState, { generating: true, observedRun: true });
    act(() => root.render(<Harness />));
    expect(state.generating).toBe(true);
    expect(state.generationStarted).toBe(true);
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe(
      "false",
    );

    props = {
      ...props,
      broadGenerating: true,
    };
    Object.assign(observerState, { generating: false });
    act(() => root.render(<Harness />));
    expect(state.generating).toBe(false);
    expect(state.generationStarted).toBe(true);
    expect((container.firstChild as HTMLElement).dataset.overlay).toBe("false");
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe("true");
  });

  it("does not treat broad activity as this run before submit", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: null,
      broadGenerating: true,
      submitStarted: false,
    };

    act(() => root.render(<Harness />));
    expect(state.generating).toBe(false);
    expect(state.generationStarted).toBe(false);
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe(
      "false",
    );
  });

  it("surfaces only the correlated pre-running start failure", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: "target-tab",
      broadGenerating: false,
      submitStarted: true,
    };

    act(() => root.render(<Harness />));
    expect(state.attempt.runError).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            reason: "start_failed",
            tabId: "other-tab",
          },
        }),
      );
    });
    expect(state.attempt.runError).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: false,
            reason: "start_failed",
            tabId: "target-tab",
          },
        }),
      );
    });
    expect(state.attempt.runError).toBe(true);
  });

  it("matches action runs to producer tabId and validates optional runId independently", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: "browser-tab-id",
      threadId: "agent-thread-id",
      runId: "agent-run-id",
      actionOwned: true,
      broadGenerating: false,
      submitStarted: true,
    };

    act(() => root.render(<Harness />));
    expect(observerState.options).toEqual({ tabId: "browser-tab-id" });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: true,
            tabId: "another-browser-tab",
          },
        }),
      );
    });
    expect(state.generating).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: {
            isRunning: true,
            tabId: "browser-tab-id",
          },
        }),
      );
    });
    expect(state.generating).toBe(true);
    expect(state.generationStarted).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: {
            tabId: "browser-tab-id",
            runId: "another-agent-run",
          },
        }),
      );
    });
    expect(state.attempt.runError).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:run-error", {
          detail: {
            tabId: "browser-tab-id",
            runId: "agent-run-id",
          },
        }),
      );
    });
    expect(state.attempt.runError).toBe(true);
  });

  it("uses the broad signal only after this component submitted before tab resolution", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: null,
      broadGenerating: true,
      submitStarted: true,
    };

    act(() => root.render(<Harness />));

    expect(observerState.options).toEqual({ tabId: null });
    expect(state.generating).toBe(true);
  });

  it("settles when the scoped observer watchdog expires", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: "target-tab",
      broadGenerating: true,
      submitStarted: true,
    };
    Object.assign(observerState, { generating: true, observedRun: true });

    act(() => root.render(<Harness />));
    Object.assign(observerState, { timedOut: true });
    act(() => root.render(<Harness />));

    expect(state.attempt.timedOut).toBe(true);
    expect(state.generating).toBe(false);
    expect(state.generationStarted).toBe(true);
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe("true");
  });

  it("keeps a watchdog while the submitted run's tab is unresolved", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: null,
      broadGenerating: true,
      submitStarted: true,
    };

    act(() => root.render(<Harness />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    });

    expect(state.attempt.timedOut).toBe(true);
    expect(state.generating).toBe(false);
    expect(state.generationStarted).toBe(true);
  });
});
