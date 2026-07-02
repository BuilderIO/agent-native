// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMock = vi.hoisted(() => ({
  captureError: vi.fn(),
}));

vi.mock("./analytics.js", () => ({
  captureError: analyticsMock.captureError,
  configureTracking: vi.fn(),
  setSentryUser: vi.fn(),
  trackEvent: vi.fn(),
  trackSessionStatus: vi.fn(),
}));

import {
  AssistantMessageListErrorBoundary,
  AssistantUiStaleIndexErrorBoundary,
  assistantUiRecoverableRenderErrorKind,
  displayableUserMessageText,
  isAssistantUiRecoverableRenderError,
  isAssistantUiStaleIndexError,
  latestNonRecoveryUserMessageText,
  reconnectActivityFallbackContent,
  reconnectProgressTimedOut,
  resolveAssistantChatRunningState,
  resolveAssistantChatRunningStatusLabel,
  resolveAssistantChatSubmitIntent,
} from "./AssistantChat.js";

describe("displayableUserMessageText", () => {
  it("treats context-only messages as empty for user bubble display", () => {
    expect(
      displayableUserMessageText(
        "\n\n<context>\nHidden attachment instructions\n</context>",
      ),
    ).toBe("");
  });
});

describe("latestNonRecoveryUserMessageText", () => {
  it("skips recovery prompts when finding the original user request", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Build a CS operations tool" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I stopped before finishing" }],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Continue from where you stopped. Use the partial work above.",
          },
        ],
        metadata: { custom: { agentNativeRecoveryAction: "continue" } },
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I stopped again" }],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Retry the previous request from a clean approach.\n\nOriginal request:\n\nBuild a CS operations tool",
          },
        ],
      },
    ];

    expect(latestNonRecoveryUserMessageText(messages)).toBe(
      "Build a CS operations tool",
    );
  });
});

describe("resolveAssistantChatSubmitIntent", () => {
  it("queues ordinary submits while a run is active", () => {
    expect(
      resolveAssistantChatSubmitIntent({
        isRunning: true,
        requestedIntent: "immediate",
      }),
    ).toBe("queued");
  });

  it("keeps immediate submits when no run is active", () => {
    expect(
      resolveAssistantChatSubmitIntent({
        isRunning: false,
        requestedIntent: undefined,
      }),
    ).toBe("immediate");
  });
});

describe("resolveAssistantChatRunningState", () => {
  it("keeps UI running during auto-continuation gaps without changing queue gating", () => {
    expect(
      resolveAssistantChatRunningState({
        forceStopped: false,
        isRuntimeRunning: false,
        isReconnecting: false,
        optimisticRunning: false,
        isAutoResuming: true,
      }),
    ).toEqual({ isRunning: false, showRunningInUI: true });
  });

  it("keeps the chat visibly running while the server still has an active run", () => {
    expect(
      resolveAssistantChatRunningState({
        forceStopped: false,
        isRuntimeRunning: false,
        isReconnecting: false,
        optimisticRunning: false,
        isAutoResuming: false,
        hasActiveServerRun: true,
      }),
    ).toEqual({ isRunning: true, showRunningInUI: true });
  });

  it("keeps auto-resume visible through the between-chunk idle gap", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("AUTO_RESUME_STATUS_TIMEOUT_MS");
    expect(source).toContain("autoResumeTimerRef");
    expect(source).toContain("!isRunning && !isAutoResuming");
    expect(source).not.toContain(
      "if (!isRunning) {\n      setIsAutoResuming(false);",
    );
  });

  it("clears both running states after an explicit stop", () => {
    expect(
      resolveAssistantChatRunningState({
        forceStopped: true,
        isRuntimeRunning: true,
        isReconnecting: true,
        optimisticRunning: true,
        isAutoResuming: true,
      }),
    ).toEqual({ isRunning: false, showRunningInUI: false });
  });
});

describe("resolveAssistantChatRunningStatusLabel", () => {
  it("keeps active tool activity ahead of recovery labels", () => {
    expect(
      resolveAssistantChatRunningStatusLabel({
        runningActivityLabel: "Preparing generate-design action",
        isAutoResuming: false,
        isReconnecting: true,
        hasReconnectContent: true,
      }),
    ).toBe("Preparing generate-design action");
  });

  it("shows replayed recovery as still working instead of reconnecting", () => {
    expect(
      resolveAssistantChatRunningStatusLabel({
        runningActivityLabel: null,
        isAutoResuming: false,
        isReconnecting: true,
        hasReconnectContent: true,
      }),
    ).toBe("Still working");
  });

  it("keeps bare reconnect recovery as thinking", () => {
    expect(
      resolveAssistantChatRunningStatusLabel({
        runningActivityLabel: null,
        isAutoResuming: false,
        isReconnecting: true,
        hasReconnectContent: false,
      }),
    ).toBe("Thinking");
  });
});

describe("waitForThreadRunToClear", () => {
  it("uses server-relative run progress when deciding whether an active run is stale", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("async function waitForThreadRunToClear");
    const end = source.indexOf("// ─── Composer Attachment Preview");
    const helperSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(helperSource).toContain("activeRunLooksStale(info)");
    expect(helperSource).not.toContain("heartbeatAt");
  });

  it("aborts the reconnect on an idle gap, not a fixed total duration", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("const startReconnectToRun = useCallback");
    const end = source.indexOf("const reconnectActiveRunForThread");
    const helperSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // The no-progress decision must be a sliding idle deadline that resets on
    // streamed events — never a one-shot `setTimeout(..., THRESHOLD)` that caps
    // total reconnect duration and falsely fails a healthy long run.
    expect(helperSource).toContain("markReconnectProgress");
    expect(helperSource).toContain("reconnectProgressTimedOut");
    expect(helperSource).not.toContain(
      "setTimeout(() => {\n        reconnectTimedOut = true;",
    );
    expect(helperSource).not.toContain("20_000");
  });

  it("reattaches to the same active run when a hosted reconnect stream ends", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("const startReconnectToRun = useCallback");
    const end = source.indexOf("const reconnectActiveRunForThread");
    const helperSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(helperSource).toContain(
      "const preparingActionState: PreparingActionState = {}",
    );
    expect(helperSource).toContain("sameRunStillActive");
    expect(helperSource).toContain("{ signal: abortCtrl.signal }");
    expect(helperSource).toContain('return "unknown"');
    expect(helperSource).toContain('err.reason === "stream_ended"');
    expect(helperSource).toContain(
      "const reconnectAfterSeq = resolveReconnectAfterSeq(threadId, runId)",
    );
    expect(helperSource).toContain("if (!sseRes.ok || !sseRes.body)");
    expect(helperSource).toContain("{ preparingActionState }");
    expect(helperSource).toContain(
      "reconnectTimedOut && abortCtrl.signal.aborted",
    );
    expect(helperSource).toContain('activeState !== "inactive"');
    expect(helperSource).toContain("continue;");
  });

  it("shows active tool activity before falling back to calm recovery labels", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("const runningStatusLabel =");
    const end = source.indexOf("const lastBroadcastRunningRef");
    const labelSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(labelSource.indexOf("runningActivityLabel")).toBeLessThan(
      labelSource.indexOf("isReconnecting"),
    );
    expect(labelSource).toContain("resolveAssistantChatRunningStatusLabel");
    expect(labelSource).toContain("hasReconnectContent");
  });

  it("clears stale stored active-run state when the server has no usable run", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("const reconnectActiveRunForThread");
    const end = source.indexOf("useEffect(() => {\n    if (!threadId");
    const reconnectSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(reconnectSource).toContain("const storedActiveRun = getActiveRun()");
    expect(reconnectSource).toContain(
      "clearActiveRunIfMatches(threadId, storedActiveRun.runId)",
    );
  });

  it("does not freeze tail-only reconnect snapshots when stopped", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const reconnectStart = source.indexOf("const startReconnectToRun");
    const reconnectEnd = source.indexOf("const reconnectActiveRunForThread");
    const reconnectSource = source.slice(reconnectStart, reconnectEnd);
    const stopStart = source.indexOf("const stopActiveRun = useCallback");
    const stopEnd = source.indexOf("const addToQueue = useCallback");
    const stopSource = source.slice(stopStart, stopEnd);

    expect(reconnectStart).toBeGreaterThan(-1);
    expect(reconnectEnd).toBeGreaterThan(reconnectStart);
    expect(stopStart).toBeGreaterThan(-1);
    expect(stopEnd).toBeGreaterThan(stopStart);
    expect(reconnectSource).toContain(
      "reconnectTailOnlyRef.current = afterSeq > 0",
    );
    expect(stopSource).toContain("!reconnectTailOnlyRef.current");
    expect(stopSource).toContain("reconnectCanMaterializeRef.current");
    expect(stopSource).toContain("reconnectContent.length > 0");
    expect(stopSource).toContain("reconnectTailOnlyRef.current = false");
  });

  it("builds a running tool card for tail-reconnect activity", () => {
    expect(reconnectActivityFallbackContent(" generate-design ")).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "generate-design",
        argsText: "",
        args: {},
        activity: true,
      }),
    ]);
    expect(reconnectActivityFallbackContent("")).toEqual([]);
  });

  it("rehydrates reconnect activity from active-run state", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("const startReconnectToRun = useCallback");
    const end = source.indexOf("const reconnectActiveRunForThread");
    const helperSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(helperSource).toContain("getActiveRunActivityTool(threadId, runId)");
    expect(helperSource).toContain(
      "setRunningActivityTool(storedActivityTool)",
    );
    expect(helperSource).toContain("activityTool: storedActivityTool");
  });

  it("clears stored active-run state when reconnect or stop unwinds the run", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const reconnectStart = source.indexOf(
      "const startReconnectToRun = useCallback",
    );
    const reconnectEnd = source.indexOf("const reconnectActiveRunForThread");
    const reconnectSource = source.slice(reconnectStart, reconnectEnd);
    const stopStart = source.indexOf("const stopActiveRun = useCallback");
    const stopEnd = source.indexOf(
      "// Keep the ref current so addToQueue can call it",
    );
    const stopSource = source.slice(stopStart, stopEnd);

    expect(reconnectStart).toBeGreaterThan(-1);
    expect(reconnectEnd).toBeGreaterThan(reconnectStart);
    expect(stopStart).toBeGreaterThan(-1);
    expect(stopEnd).toBeGreaterThan(stopStart);
    expect(reconnectSource).toContain(
      "clearActiveRunIfMatches(threadId, runId)",
    );
    expect(stopSource).toContain(
      "clearActiveRunIfMatches(threadId, runIdToAbort)",
    );
  });

  it("renders tail-resume reconnect content instead of hiding it behind the fallback", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("{(isReconnecting || reconnectFrozen) &&");
    const end = source.indexOf("{showRunningInUI &&", start);
    const renderSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(renderSource).toContain("reconnectContent.length > 0");
    expect(renderSource).toContain("reconnectContent.length === 0");
    expect(renderSource).not.toContain("reconnectAfterSeq");
  });

  it("keeps tail-resume reconnect content display-only on normal completion", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("setReconnectFrozen(afterSeq === 0)");
    const end = source.indexOf("const reconnectActiveRunForThread");
    const completionSource = source.slice(start, end);
    const materializeStart = source.indexOf(
      "const materializeFrozenReconnectContent = useCallback",
    );
    const materializeEnd = source.indexOf(
      "// Abort the active server run",
      materializeStart,
    );
    const materializeSource = source.slice(materializeStart, materializeEnd);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(materializeStart).toBeGreaterThan(-1);
    expect(materializeEnd).toBeGreaterThan(materializeStart);
    expect(source).toContain(
      "reconnectCanMaterializeRef.current = afterSeq === 0",
    );
    expect(completionSource).toContain("setReconnectFrozen(afterSeq === 0)");
    expect(completionSource).toContain("if (afterSeq > 0)");
    expect(completionSource).toContain("setReconnectContent([])");
    expect(completionSource).toContain("setReconnectFrozen(false)");
    expect(completionSource).toContain(
      "if (loaded || afterSeq > 0 || latestContent.length === 0)",
    );
    expect(completionSource).toContain(
      "afterSeq > 0 || repoHasAssistantMessage(repo)",
    );
    expect(completionSource).not.toContain("setReconnectFrozen(true)");
    expect(materializeSource).toContain("!reconnectCanMaterializeRef.current");
    expect(materializeSource).toContain("setReconnectContent([])");
    expect(materializeSource).toContain("return;");
  });

  it("keeps stopped fresh reconnect content materializable", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const stopStart = source.indexOf("const stopActiveRun = useCallback");
    const stopEnd = source.indexOf(
      "// Keep the ref current so addToQueue can call it",
      stopStart,
    );
    const stopSource = source.slice(stopStart, stopEnd);
    const freezeStart = stopSource.indexOf("if (shouldFreezeReconnectContent)");
    const elseStart = stopSource.indexOf("} else {", freezeStart);
    const freezeBranch = stopSource.slice(freezeStart, elseStart);

    expect(stopStart).toBeGreaterThan(-1);
    expect(stopEnd).toBeGreaterThan(stopStart);
    expect(stopSource).toContain("!reconnectTailOnlyRef.current");
    expect(stopSource).toContain("reconnectCanMaterializeRef.current");
    expect(stopSource).toContain("reconnectContent.length > 0");
    expect(freezeStart).toBeGreaterThan(-1);
    expect(elseStart).toBeGreaterThan(freezeStart);
    expect(freezeBranch).toContain("setReconnectFrozen(true)");
    expect(freezeBranch).not.toContain(
      "reconnectCanMaterializeRef.current = false",
    );
  });

  it("keeps no-progress fresh reconnect content materializable", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf(
      "if (noProgressDuringReconnect && reconnectRunIdRef.current === runId)",
    );
    const end = source.indexOf("setReconnectFrozen(afterSeq === 0)", start);
    const noProgressSource = source.slice(start, end);
    const tailStart = noProgressSource.indexOf("if (afterSeq > 0)");
    const freshStart = noProgressSource.indexOf("} else {", tailStart);
    const freshEnd = noProgressSource.indexOf("setRunErrorInfo", freshStart);
    const freshBranch = noProgressSource.slice(freshStart, freshEnd);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(tailStart).toBeGreaterThan(-1);
    expect(freshStart).toBeGreaterThan(tailStart);
    expect(freshBranch).toContain(
      "reconnectCanMaterializeRef.current = latestContent.length > 0",
    );
    expect(noProgressSource).toContain(
      "if (afterSeq > 0) {\n            reconnectCanMaterializeRef.current = false;\n          }",
    );
  });
});

describe("reconnectProgressTimedOut", () => {
  const threshold = 90_000;

  it("never times out a run that keeps streaming heartbeats", () => {
    // Simulate a long image generation that emits an activity heartbeat every
    // 8s over 5 minutes of reconnect wall-clock. Each event resets the idle
    // deadline, so the gap is always 8s — far under the 90s stuck threshold.
    // A one-shot total-duration cap (the prior behaviour) would have fired at
    // 90s and falsely surfaced `reconnect_no_progress`.
    let lastProgressAt = 0;
    for (let now = 0; now <= 300_000; now += 8_000) {
      expect(
        reconnectProgressTimedOut({
          lastProgressAt,
          now,
          thresholdMs: threshold,
        }),
      ).toBe(false);
      lastProgressAt = now; // event arrived → markReconnectProgress()
    }
  });

  it("times out only after true silence for the full threshold", () => {
    const lastProgressAt = 1_000;
    expect(
      reconnectProgressTimedOut({
        lastProgressAt,
        now: lastProgressAt + threshold - 1,
        thresholdMs: threshold,
      }),
    ).toBe(false);
    expect(
      reconnectProgressTimedOut({
        lastProgressAt,
        now: lastProgressAt + threshold,
        thresholdMs: threshold,
      }),
    ).toBe(true);
  });
});

describe("isAssistantUiStaleIndexError", () => {
  it("matches assistant-ui stale message index crashes", () => {
    expect(
      isAssistantUiStaleIndexError(
        new Error("tapClientLookup: Index 79 out of bounds (length: 78)"),
      ),
    ).toBe(true);
  });

  it("does not match other assistant-ui recoverable errors", () => {
    expect(
      isAssistantUiStaleIndexError(
        new Error("Duplicate key toolCallId-tc_1 in tapResources"),
      ),
    ).toBe(false);
  });

  it("ignores unrelated errors", () => {
    expect(isAssistantUiStaleIndexError(new Error("boom"))).toBe(false);
  });
});

describe("assistantUiRecoverableRenderErrorKind", () => {
  it("matches assistant-ui stale message index crashes", () => {
    expect(
      assistantUiRecoverableRenderErrorKind(
        new Error("tapClientLookup: Index 79 out of bounds (length: 78)"),
      ),
    ).toBe("assistant-ui-stale-message-index");
  });

  it("matches React fiber unmount crashes from assistant-ui composer teardown", () => {
    expect(
      assistantUiRecoverableRenderErrorKind(
        new Error(
          "Tried to unmount a fiber that is already unmounted. This is a React internal error.",
        ),
      ),
    ).toBe("assistant-ui-react-fiber-unmount");
  });

  it("matches duplicate resource-key crashes from assistant-ui composer state", () => {
    expect(
      assistantUiRecoverableRenderErrorKind(
        new Error("Duplicate key toolCallId-tc_1 in tapResources"),
      ),
    ).toBe("assistant-ui-duplicate-resource-key");
  });

  it("ignores unrelated errors", () => {
    expect(assistantUiRecoverableRenderErrorKind(new Error("boom"))).toBeNull();
  });
});

describe("isAssistantUiRecoverableRenderError", () => {
  it("matches assistant-ui duplicate resource key crashes", () => {
    expect(
      isAssistantUiRecoverableRenderError(
        new Error("Duplicate key toolCallId-tc_1 in tapResources"),
      ),
    ).toBe(true);
  });
});

describe("AssistantMessageListErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    analyticsMock.captureError.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("remounts the message list after assistant-ui renders a stale index", async () => {
    let renders = 0;
    function FlakyMessageList() {
      renders += 1;
      if (renders === 1) {
        throw new Error("tapClientLookup: Index 79 out of bounds (length: 78)");
      }
      return React.createElement("div", null, "Recovered messages");
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantMessageListErrorBoundary,
          { resetKey: "messages" },
          React.createElement(FlakyMessageList),
        ),
      );
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Recovered messages");
    expect(analyticsMock.captureError).not.toHaveBeenCalled();
  });
});

describe("AssistantUiStaleIndexErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  class ParentErrorBoundary extends React.Component<
    {
      children: React.ReactNode;
      onError: (error: Error) => void;
    },
    { error: Error | null }
  > {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: unknown) {
      return {
        error: error instanceof Error ? error : new Error(String(error ?? "")),
      };
    }

    componentDidCatch(error: unknown) {
      this.props.onError(
        error instanceof Error ? error : new Error(String(error ?? "")),
      );
    }

    render() {
      if (this.state.error) {
        return React.createElement("div", null, "Parent caught");
      }
      return this.props.children;
    }
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    analyticsMock.captureError.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("remounts any assistant-ui subtree after a stale index render error", async () => {
    let renders = 0;
    function FlakyComposer() {
      renders += 1;
      if (renders === 1) {
        throw new Error("tapClientLookup: Index 4 out of bounds (length: 3)");
      }
      return React.createElement("div", null, "Recovered composer");
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantUiStaleIndexErrorBoundary,
          { resetKey: "thread-1", componentName: "AssistantChat" },
          React.createElement(FlakyComposer),
        ),
      );
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Recovered composer");
    expect(analyticsMock.captureError).not.toHaveBeenCalled();
  });

  it("remounts any assistant-ui subtree after a React fiber unmount error", async () => {
    let renders = 0;
    function FlakyComposer() {
      renders += 1;
      if (renders === 1) {
        throw new Error(
          "Tried to unmount a fiber that is already unmounted. This is a React internal error.",
        );
      }
      return React.createElement("div", null, "Recovered composer");
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantUiStaleIndexErrorBoundary,
          { resetKey: "thread-1", componentName: "AssistantChat" },
          React.createElement(FlakyComposer),
        ),
      );
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Recovered composer");
  });

  it("remounts any assistant-ui subtree after a duplicate resource key error", async () => {
    let renders = 0;
    function FlakyComposer() {
      renders += 1;
      if (renders === 1) {
        throw new Error("Duplicate key toolCallId-tc_1 in tapResources");
      }
      return React.createElement("div", null, "Recovered resources");
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantUiStaleIndexErrorBoundary,
          { resetKey: "thread-1", componentName: "PromptComposer" },
          React.createElement(FlakyComposer),
        ),
      );
    });

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Recovered resources");
  });

  it("escalates persistent recoverable render errors after a retry budget", async () => {
    const caught: Error[] = [];
    function BrokenComposer() {
      throw new Error("Duplicate key toolCallId-tc_1 in tapResources");
    }

    act(() => {
      root.render(
        React.createElement(
          ParentErrorBoundary,
          { onError: (error) => caught.push(error) },
          React.createElement(
            AssistantUiStaleIndexErrorBoundary,
            { resetKey: "thread-1", componentName: "PromptComposer" },
            React.createElement(BrokenComposer),
          ),
        ),
      );
    });

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
    }

    expect(caught).toHaveLength(1);
    expect(caught[0].message).toContain("Duplicate key");
    expect(container.textContent).toContain("Parent caught");
    expect(vi.getTimerCount()).toBe(0);
    expect(analyticsMock.captureError).toHaveBeenCalledTimes(1);
    expect(analyticsMock.captureError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Duplicate key toolCallId-tc_1 in tapResources",
      }),
      expect.objectContaining({
        tags: expect.objectContaining({
          component: "PromptComposer",
          recoverable: "assistant-ui-duplicate-resource-key",
        }),
        extra: expect.objectContaining({
          resetKey: "thread-1",
          retryCount: 3,
        }),
      }),
    );
  });

  it("resets the recoverable retry budget after a successful remount", async () => {
    const caught: Error[] = [];
    let failuresRemaining = 2;
    function FlakyComposer({ cycle }: { cycle: number }) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error("Duplicate key toolCallId-tc_1 in tapResources");
      }
      return React.createElement("div", null, `Recovered resources ${cycle}`);
    }

    function renderCycle(cycle: number) {
      root.render(
        React.createElement(
          ParentErrorBoundary,
          { onError: (error) => caught.push(error) },
          React.createElement(
            AssistantUiStaleIndexErrorBoundary,
            { resetKey: "thread-1", componentName: "PromptComposer" },
            React.createElement(FlakyComposer, { cycle }),
          ),
        ),
      );
    }

    act(() => renderCycle(1));
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
    }
    expect(container.textContent).toContain("Recovered resources 1");

    failuresRemaining = 2;
    act(() => renderCycle(2));
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
    }

    expect(caught).toHaveLength(0);
    expect(container.textContent).toContain("Recovered resources 2");
  });
});
