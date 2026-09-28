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
  startedTabId: null as string | null,
  generating: false,
  observedRun: false,
  runError: false,
  stopReason: null as "stopped" | null,
  timedOut: false,
}));

vi.mock("@/hooks/use-agent-generating", () => ({
  getStartedGenerationAttemptTabId: vi.fn(() => observerState.startedTabId),
  useAgentGenerating: (options: { tabId: string | null }) => {
    observerState.options = options;
    return {
      ...observerState,
      generating: Boolean(options.tabId) && observerState.generating,
      observedRun: Boolean(options.tabId) && observerState.observedRun,
    };
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
      startedTabId: null,
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

    Object.assign(observerState, { generating: false });
    act(() => root.render(<Harness />));
    expect(state.generating).toBe(false);
    expect(state.generationStarted).toBe(true);
    expect((container.firstChild as HTMLElement).dataset.overlay).toBe("false");
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe("true");
  });

  it("does not infer generation while the target tab is unresolved", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: null,
    };
    observerState.generating = true;

    act(() => root.render(<Harness />));
    expect(state.generating).toBe(false);
    expect(state.generationStarted).toBe(false);
    expect(observerState.options).toEqual({ tabId: null });
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe(
      "false",
    );
  });

  it("attaches to the mapped generation tab after submit resolves", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      outputId: "deck-1",
      tabId: null,
    };

    act(() => root.render(<Harness />));
    observerState.startedTabId = "target-tab";
    Object.assign(observerState, { generating: true, observedRun: true });
    act(() => {
      root.render(<Harness />);
    });

    expect(observerState.options?.tabId).toBe("target-tab");
    expect(state.generating).toBe(true);
    expect(state.attempt.timedOut).toBe(false);
  });

  it("keeps generation active after the scoped observer watchdog expires", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      attemptId: "attempt-1",
      tabId: "target-tab",
    };
    Object.assign(observerState, { generating: true, observedRun: true });

    act(() => root.render(<Harness />));
    Object.assign(observerState, { timedOut: true });
    act(() => root.render(<Harness />));

    expect(state.attempt.timedOut).toBe(true);
    expect(state.generating).toBe(true);
    expect(state.generationStarted).toBe(true);
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe(
      "false",
    );

    observerState.generating = false;
    act(() => root.render(<Harness />));

    expect(state.generating).toBe(false);
    expect((container.firstChild as HTMLElement).dataset.clearUrl).toBe("true");
  });
});
