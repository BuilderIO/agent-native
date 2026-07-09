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
  dedupeReconnectContentAgainstMessages,
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

  it("preserves visible text while stripping hidden context blocks", () => {
    expect(
      displayableUserMessageText(
        "hi\n\n<context>\n## Fusion recap\nHidden selection\n</context>",
      ),
    ).toBe("hi");
  });

  it("strips unfinished context payloads from generated labels", () => {
    expect(
      displayableUserMessageText("hi <context> ## Fusion recap hidden payload"),
    ).toBe("hi");
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

describe("dedupeReconnectContentAgainstMessages", () => {
  it("hides replayed reconnect tool calls already present in thread messages", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_1",
            toolName: "write-file",
            argsText: "{}",
            args: {},
            result: "ok",
          },
        ],
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        [
          {
            type: "tool-call",
            toolCallId: "toolu_1",
            toolName: "write-file",
            argsText: "{}",
            args: {},
            result: "ok",
          },
          { type: "text", text: "Continuing..." },
        ],
        persistedMessages,
      ),
    ).toEqual([{ type: "text", text: "Continuing..." }]);
  });

  it("keeps distinct repeated tool calls with different ids", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_1",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
            result: "1",
          },
        ],
      },
    ];
    const repeatedCall = {
      type: "tool-call" as const,
      toolCallId: "toolu_2",
      toolName: "db-query",
      argsText: '{"sql":"select 1"}',
      args: { sql: "select 1" },
      result: "1",
    };

    expect(
      dedupeReconnectContentAgainstMessages([repeatedCall], persistedMessages),
    ).toEqual([repeatedCall]);
  });

  it("drops stale pending tool-call copies inside the reconnect snapshot", () => {
    const stalePending = {
      type: "tool-call" as const,
      toolCallId: "tc_stale",
      toolName: "edit-screen",
      argsText: '{"screen":"home"}',
      args: { screen: "home" },
    };
    const completed = {
      type: "tool-call" as const,
      toolCallId: "toolu_1",
      toolName: "edit-screen",
      argsText: '{"screen":"home"}',
      args: { screen: "home" },
      result: "done",
    };

    expect(
      dedupeReconnectContentAgainstMessages([stalePending, completed], []),
    ).toEqual([completed]);
  });

  it("drops a pending reconnect duplicate whose call already completed in messages (fingerprint fallback)", () => {
    // Two readers of the same run assign unrelated synthetic ids until the
    // server id converges — a pending copy of an already-completed call is a
    // replay artifact (the "one spinning, one done" duplicate pair).
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_1",
            toolName: "edit-screen",
            argsText: '{"screen":"home"}',
            args: { screen: "home" },
            result: "done",
          },
        ],
      },
    ];
    const pendingDuplicate = {
      type: "tool-call" as const,
      toolCallId: "tc_7",
      toolName: "edit-screen",
      argsText: '{"screen":"home"}',
      args: { screen: "home" },
    };
    const unrelatedPending = {
      type: "tool-call" as const,
      toolCallId: "tc_8",
      toolName: "edit-screen",
      argsText: '{"screen":"settings"}',
      args: { screen: "settings" },
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [pendingDuplicate, unrelatedPending],
        persistedMessages,
      ),
    ).toEqual([unrelatedPending]);
  });

  it("drops a pending reconnect duplicate while the rendered call is still pending", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_1",
            toolName: "update-extension",
            argsText: '{"extensionId":"npm-downloads"}',
            args: { extensionId: "npm-downloads" },
          },
        ],
      },
    ];
    const pendingDuplicate = {
      type: "tool-call" as const,
      toolCallId: "tc_7",
      toolName: "update-extension",
      argsText: '{"extensionId":"npm-downloads"}',
      args: { extensionId: "npm-downloads" },
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [pendingDuplicate],
        persistedMessages,
      ),
    ).toEqual([]);
  });

  it("never fingerprint-drops activity placeholders or completed-vs-completed repeats", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_1",
            toolName: "edit-screen",
            argsText: '{"screen":"home"}',
            args: { screen: "home" },
            result: "done",
          },
        ],
      },
    ];
    // Activity placeholder (no args yet) — an empty-args fingerprint would
    // over-match, so it must be exempt.
    const activityPlaceholder = {
      type: "tool-call" as const,
      toolCallId: "reconnect-activity:edit-screen",
      toolName: "edit-screen",
      argsText: "",
      args: {},
      activity: true as const,
    };
    // Completed-with-different-id stays: a legitimately repeated identical
    // call must not be hidden (strict id match only for completed parts).
    const completedRepeat = {
      type: "tool-call" as const,
      toolCallId: "toolu_2",
      toolName: "edit-screen",
      argsText: '{"screen":"home"}',
      args: { screen: "home" },
      result: "done",
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [activityPlaceholder, completedRepeat],
        persistedMessages,
      ),
    ).toEqual([activityPlaceholder, completedRepeat]);
  });

  it("drops reconnect completions when the rendered tool call is still pending", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_pending",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
          },
        ],
      },
    ];
    const completedCall = {
      type: "tool-call" as const,
      toolCallId: "toolu_pending",
      toolName: "db-query",
      argsText: '{"sql":"select 1"}',
      args: { sql: "select 1" },
      result: "1",
    };

    expect(
      dedupeReconnectContentAgainstMessages([completedCall], persistedMessages),
    ).toEqual([]);
  });

  it("does not fingerprint-drop reconnect tools against older assistant turns", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_old",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
            result: "1",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Run it again" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Starting fresh." }],
      },
    ];
    const repeatedPending = {
      type: "tool-call" as const,
      toolCallId: "toolu_new",
      toolName: "db-query",
      argsText: '{"sql":"select 1"}',
      args: { sql: "select 1" },
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [repeatedPending],
        persistedMessages,
      ),
    ).toEqual([repeatedPending]);
  });

  it("hides reconnect text that is already visible in the latest assistant message", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "The same paragraph is already visible.",
          },
        ],
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        [
          {
            type: "text",
            text: "The same paragraph is already visible.",
          },
        ],
        persistedMessages,
      ),
    ).toEqual([]);
  });

  it("trims only the rendered prefix from reconnect text that keeps streaming", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "The first paragraph is already visible.",
          },
        ],
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        [
          {
            type: "text",
            text: "The first paragraph is already visible.\n\nThe new paragraph is still streaming.",
          },
        ],
        persistedMessages,
      ),
    ).toEqual([
      {
        type: "text",
        text: "\n\nThe new paragraph is still streaming.",
      },
    ]);
  });

  it("does not compare reconnect text against older assistant turns", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "A reusable opening line." }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Start a new turn." }],
      },
    ];
    const reconnectContent = [
      {
        type: "text" as const,
        text: "A reusable opening line. This belongs to the new turn.",
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        reconnectContent,
        persistedMessages,
      ),
    ).toBe(reconnectContent);
  });

  it("does not replace deduped reconnect content with fallback activity", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("visibleReconnectContent.length === 0");
    expect(source).toMatch(
      /reconnectContent\.length === 0 &&\s+reconnectActivityContent\.length > 0/,
    );
  });
});

describe("centered empty chat setup layout", () => {
  it("floats the setup card outside the centered composer stack unless adjacent UI needs space", () => {
    const css = readFileSync("src/styles/agent-native.css", {
      encoding: "utf8",
    });
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const messageComponents = readFileSync(
      "src/client/chat/message-components.tsx",
      { encoding: "utf8" },
    );

    expect(source).toContain("hasComposerAccessoryAboveStack");
    expect(source).toContain("data-agent-composer-adjacent-ui");
    expect(source).toContain("<MessageScrollerButton />");
    expect(source).toContain("composerContextItems.length > 0");
    expect(source).toContain('className="agent-composer-stack"');
    expect(messageComponents).toContain("agent-selection-attached-pill");
    expect(source).toContain('data-agent-composer-setup-position="above"');
    expect(source).toContain('data-agent-composer-setup-position="below"');
    expect(css).toMatch(
      /\[data-agent-empty-state="centered"\]\s*>\s*\.agent-composer-stack:not\(\s*\[data-agent-composer-adjacent-ui="true"\]\s*\):not\(\s*:has\(\.agent-selection-attached-pill\)\s*\)\s*>\s*\.agent-composer-setup-card\s*\{[^}]*position:\s*absolute;/s,
    );
    expect(css).toMatch(
      /\.agent-composer-stack\[data-agent-composer-adjacent-ui="true"\]\s*,\s*\.agent-composer-stack:has\(\.agent-selection-attached-pill\)\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*0\.5rem;/s,
    );
    expect(css).toMatch(
      /data-agent-composer-setup-position="above"\]\s*\{[^}]*bottom:\s*calc\(100% \+ 0\.5rem\);/s,
    );
    expect(css).toMatch(
      /data-agent-composer-setup-position="below"\]\s*\{[^}]*top:\s*calc\(100% \+ 0\.5rem\);/s,
    );
    expect(css).not.toMatch(
      /\[data-agent-empty-state="compact-setup"\]\s*>\s*\.agent-chat-scroll\s*\{[^}]*flex:\s*0\s+0\s+auto;/s,
    );
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

  it("uses the background run budget when deciding whether an active run is stale", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("function activeRunStuckThresholdMs");
    const end = source.indexOf("function activeRunLooksStale");
    const helperSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(helperSource).toContain('dispatchMode.startsWith("background")');
    expect(helperSource).toContain("BACKGROUND_ACTIVE_RUN_STUCK_THRESHOLD_MS");
    expect(helperSource).toContain("ACTIVE_RUN_STUCK_THRESHOLD_MS");
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
    expect(helperSource).toContain("thresholdMs: reconnectStuckThresholdMs");
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
    expect(renderSource).toContain("visibleReconnectContent.length > 0");
    expect(renderSource).toContain("visibleReconnectContent.length === 0");
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

  it("auto-continues reconnect no-progress stalls before showing the recovery card", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf(
      "if (noProgressDuringReconnect && reconnectRunIdRef.current === runId)",
    );
    const end = source.indexOf("setReconnectFrozen(afterSeq === 0)", start);
    const noProgressSource = source.slice(start, end);
    const effectStart = source.indexOf("if (!pendingReconnectRecovery) return");
    const effectEnd = source.indexOf(
      "// Expose imperative handle",
      effectStart,
    );
    const effectSource = source.slice(effectStart, effectEnd);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(noProgressSource).toContain("MAX_RECONNECT_AUTO_RECOVERIES");
    expect(noProgressSource).toContain(
      "reconnectAutoRecoveryCountRef.current += 1",
    );
    expect(noProgressSource).toContain("setPendingReconnectRecovery");
    expect(noProgressSource).toContain("agent-chat:auto-continue");
    const autoRecoverStart = noProgressSource.indexOf(
      "const canAutoRecoverReconnect",
    );
    const autoRecoverEnd = noProgressSource.indexOf(
      "if (canAutoRecoverReconnect)",
      autoRecoverStart,
    );
    const autoRecoverGate = noProgressSource.slice(
      autoRecoverStart,
      autoRecoverEnd,
    );
    expect(autoRecoverGate).not.toContain("reconnectTerminalReason");
    expect(source).toContain("treat that action input as stalled or too large");
    expect(source).toContain("use a smaller bounded input");
    expect(
      noProgressSource.indexOf("setPendingReconnectRecovery"),
    ).toBeLessThan(noProgressSource.indexOf("setRunErrorInfo({"));
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);
    expect(source).toContain("preserveReconnectAutoRecoveryBudget = false");
    expect(source).toContain("if (!preserveReconnectAutoRecoveryBudget)");
    expect(effectSource).toContain("addToQueue(");
    expect(effectSource).toContain('"continue"');
    expect(effectSource).toContain(
      '"continue",\n        false,\n        false,\n        true,\n        true,',
    );
  });
});

describe("server thread snapshot caching", () => {
  it("does not cache an initial server fetch that the runtime rejected as stale", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("if (data.threadData) {");
    const end = source.indexOf(
      "// Also skip title generation if thread already has a title",
    );
    const restoreSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(restoreSource).toContain("shouldCacheServerSnapshot");
    expect(restoreSource).toContain("shouldImportServerThreadData");
    expect(restoreSource).toContain("writeCachedThreadSnapshot");
    expect(restoreSource).toContain("shouldCacheServerSnapshot = false");
  });

  it("does not apply queued messages from a rejected server snapshot", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("const importThreadData = useCallback");
    const end = source.indexOf("const refreshThreadFromServer = useCallback");
    const importSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(importSource).toContain("shouldImport = false");
    expect(importSource).toContain(
      "if (settled && Array.isArray(repo?.queuedMessages))",
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
