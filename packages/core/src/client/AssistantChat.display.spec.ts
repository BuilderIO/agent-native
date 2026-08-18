// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMock = vi.hoisted(() => ({
  captureError: vi.fn(),
  trackAgentChatLifecycle: vi.fn(),
}));

vi.mock("./analytics.js", () => ({
  captureError: analyticsMock.captureError,
  trackAgentChatLifecycle: analyticsMock.trackAgentChatLifecycle,
  configureTracking: vi.fn(),
  setSentryUser: vi.fn(),
  trackEvent: vi.fn(),
  trackSessionStatus: vi.fn(),
}));

import { clearActiveRun, getActiveRun } from "./active-run-state.js";
import {
  AssistantMessageListErrorBoundary,
  AssistantUiStaleIndexErrorBoundary,
  assistantMessageRunId,
  assistantChatAutoscrollStatusKey,
  assistantUiMessageListStructureKey,
  assistantUiRecoverableRenderErrorKind,
  createUserMessageRunConfig,
  dedupeReconnectContentAgainstMessages,
  shouldShowReconnectOverlay,
  hoistQueuedMessageToFront,
  displayableUserMessageText,
  isAssistantUiRecoverableRenderError,
  isAssistantUiStaleIndexError,
  installAssistantUiMessageRepositoryRecovery,
  latestNonRecoveryUserMessageText,
  reconnectActivityFallbackContent,
  reconnectProgressTimedOut,
  resolveAssistantChatRunningState,
  resolveAssistantChatRunningStatusLabel,
  resolveAssistantChatComposerPlaceholder,
  shouldShowAssistantChatModelSelector,
  resolveAssistantChatSubmitIntent,
  settleInterruptedAssistantToolCallsInRepo,
  shouldSuppressUnauthenticatedDesktopThreadRestore,
  shouldAcceptRunError,
  shouldShowGlobalRunningStatus,
  queuedMessageImageSources,
  useAutoResumeStatus,
  waitForThreadRunToClear,
} from "./AssistantChat.js";

describe("shouldShowAssistantChatModelSelector", () => {
  it("keeps the framework selector by default and lets hosts replace only its visual control", () => {
    expect(shouldShowAssistantChatModelSelector(undefined)).toBe(true);
    expect(shouldShowAssistantChatModelSelector(true)).toBe(true);
    expect(shouldShowAssistantChatModelSelector(false)).toBe(false);

    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    expect(source).toContain("showModelSelector?: boolean");
    expect(source).toMatch(
      /shouldShowAssistantChatModelSelector\(\s+showModelSelector,/,
    );
  });
});

describe("AssistantChat thread restore and composer recovery", () => {
  it("only suppresses unauthenticated restore failures for desktop chat", () => {
    expect(
      shouldSuppressUnauthenticatedDesktopThreadRestore("desktop", 401),
    ).toBe(true);
    expect(
      shouldSuppressUnauthenticatedDesktopThreadRestore("desktop", 403),
    ).toBe(true);
    expect(
      shouldSuppressUnauthenticatedDesktopThreadRestore("desktop", 404),
    ).toBe(false);
    expect(
      shouldSuppressUnauthenticatedDesktopThreadRestore("desktop", 500),
    ).toBe(false);
    expect(shouldSuppressUnauthenticatedDesktopThreadRestore("app", 401)).toBe(
      false,
    );
  });

  it("keeps failed thread restores visible and retryable", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    expect(source).not.toContain("knownAbsentThreadIds");
    expect(source).toContain('setThreadRestoreError("unavailable")');
    expect(source).toContain("res.status === 404");
    expect(source).toContain('"not-found"');
    expect(source).toContain('t("agentChat.message.threadNotFound")');
    expect(source).toContain("retryThreadRestore");
    expect(source).toContain('t("agentChat.common.retry")');
  });

  it("replays embedded transcript restoration safely under StrictMode", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const restoreStart = source.indexOf(
      "// Restore messages from server on mount",
    );
    const restoreEnd = source.indexOf(
      "  useEffect(() => {\n    if (\n      !loadHistoryRepository",
      restoreStart,
    );
    const restoreSource = source.slice(restoreStart, restoreEnd);

    expect(restoreSource).toContain("React StrictMode replays effects");
    expect(restoreSource).toContain("hasRestoredRef.current = false;");
  });

  it("persists composer text before the toolkit draft debounce can run", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain(
      "writeAssistantChatComposerDraft(composerDraftScope, text)",
    );
    expect(source).toContain("initialTextKey={composerDraftScope}");
    expect(source).toContain("draftScope={composerDraftScope}");
  });

  it("synchronizes app context before a scope-switch paint", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const contextSyncStart = source.indexOf(
      "useBrowserLayoutEffect(() => {\n    if (!isActiveComposer) return;",
    );
    const contextSyncEnd = source.indexOf(
      "  // Tracks the JSON of the last queue",
      contextSyncStart,
    );
    const contextSync = source.slice(contextSyncStart, contextSyncEnd);

    expect(contextSync).toContain(
      "applyVisibleItems(getAgentChatContextState());",
    );
    expect(contextSync).toContain(
      "refreshAgentChatContext().then(applyVisibleItems)",
    );
  });
});

describe("assistantUiMessageListStructureKey", () => {
  it("ignores text changes within existing message resources", () => {
    const before = assistantUiMessageListStructureKey([
      {
        id: "message-1",
        content: [{ text: "before", toolCallId: undefined }],
        attachments: [{ id: "attachment-1" }],
      },
    ]);
    const after = assistantUiMessageListStructureKey([
      {
        id: "message-1",
        content: [{ text: "after", toolCallId: undefined }],
        attachments: [{ id: "attachment-1" }],
      },
    ]);

    expect(after).toBe(before);
  });

  it("changes when indexed message resources grow or shrink", () => {
    const onePart = assistantUiMessageListStructureKey([
      {
        id: "message-1",
        content: [{ toolCallId: undefined }],
      },
    ]);
    const twoParts = assistantUiMessageListStructureKey([
      {
        id: "message-1",
        content: [{ toolCallId: undefined }, { toolCallId: "tool-1" }],
      },
    ]);
    const noMessages = assistantUiMessageListStructureKey([]);

    expect(twoParts).not.toBe(onePart);
    expect(noMessages).not.toBe(twoParts);
  });

  it("tracks attachment resource ids", () => {
    const firstAttachment = assistantUiMessageListStructureKey([
      {
        id: "message-1",
        content: [],
        attachments: [{ id: "attachment-1" }],
      },
    ]);
    const secondAttachment = assistantUiMessageListStructureKey([
      {
        id: "message-1",
        content: [],
        attachments: [{ id: "attachment-2" }],
      },
    ]);

    expect(secondAttachment).not.toBe(firstAttachment);
  });
});

describe("queuedMessageImageSources", () => {
  it("renders images serialized into queued attachment content", () => {
    const image = "data:image/png;base64,queued-image";

    expect(
      queuedMessageImageSources({
        images: undefined,
        attachments: [
          {
            id: "attachment-1",
            type: "image",
            name: "screenshot.png",
            content: [{ type: "image", image }],
            status: { type: "complete" },
          },
        ],
      }),
    ).toEqual([image]);
  });

  it("does not duplicate legacy image values also present in attachments", () => {
    const image = "data:image/png;base64,queued-image";

    expect(
      queuedMessageImageSources({
        images: [image],
        attachments: [
          {
            id: "attachment-1",
            type: "image",
            name: "screenshot.png",
            content: [{ type: "image", image }],
            status: { type: "complete" },
          },
        ],
      }),
    ).toEqual([image]);
  });
});

describe("installAssistantUiMessageRepositoryRecovery", () => {
  it("patches replacement repositories exposed by a stable thread binding", () => {
    const duplicateError = new Error(
      "MessageRepository(performOp/link): A message with the same id already exists in the parent tree.",
    );
    const firstRepository = {
      addOrUpdateMessage: vi.fn(() => {
        throw duplicateError;
      }),
    };
    const replacementRepository = {
      addOrUpdateMessage: vi.fn(() => {
        throw duplicateError;
      }),
    };
    let currentRepository = firstRepository;
    let runtimeChanged: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const threadRuntime = {
      __internal_threadBinding: {
        getState: () => ({ repository: currentRepository }),
        outerSubscribe: (callback: () => void) => {
          runtimeChanged = callback;
          return unsubscribe;
        },
      },
    };

    const cleanup = installAssistantUiMessageRepositoryRecovery(threadRuntime);
    expect(() =>
      firstRepository.addOrUpdateMessage("parent", { id: "duplicate" }),
    ).not.toThrow();

    currentRepository = replacementRepository;
    runtimeChanged?.();
    expect(() =>
      replacementRepository.addOrUpdateMessage("parent", { id: "duplicate" }),
    ).not.toThrow();

    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

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

describe("shouldAcceptRunError", () => {
  it("rejects an identified error from an older run", () => {
    expect(
      shouldAcceptRunError({
        errorRunId: "run-old",
        latestAssistantRunId: "run-current",
      }),
    ).toBe(false);
  });

  it("accepts errors from the active run", () => {
    expect(
      shouldAcceptRunError({
        errorRunId: "run-current",
        activeRunId: "run-current",
        latestAssistantRunId: "run-old",
      }),
    ).toBe(true);
  });

  it("accepts errors without a run id", () => {
    expect(shouldAcceptRunError({ latestAssistantRunId: "run-current" })).toBe(
      true,
    );
  });

  it("reads live and persisted assistant run ids", () => {
    expect(
      assistantMessageRunId({ metadata: { custom: { runId: "run-live" } } }),
    ).toBe("run-live");
    expect(assistantMessageRunId({ metadata: { runId: "run-saved" } })).toBe(
      "run-saved",
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

describe("hoistQueuedMessageToFront", () => {
  it("moves the send-now entry ahead of the rest of the queue", () => {
    expect(
      hoistQueuedMessageToFront(
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        "c",
      ).map((message) => message.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("leaves the queue intact when the entry is already gone", () => {
    expect(
      hoistQueuedMessageToFront([{ id: "a" }, { id: "b" }], "missing").map(
        (message) => message.id,
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("createUserMessageRunConfig model snapshot", () => {
  it("preserves approval grants on queued continuation messages", () => {
    const options = createUserMessageRunConfig(
      undefined,
      undefined,
      undefined,
      undefined,
      ["create-builder-branch:{}"],
      "queued-approval",
    );

    expect(options.runConfig?.custom).toMatchObject({
      approvedToolCalls: ["create-builder-branch:{}"],
      agentNativeQueuedMessageId: "queued-approval",
    });
  });

  it("sends the model a queued message was composed with", () => {
    const options = createUserMessageRunConfig(
      undefined,
      "plan",
      undefined,
      undefined,
      undefined,
      "queued-1",
      undefined,
      { model: "claude-opus-4-6", engine: "builder", effort: "high" },
    );

    expect(options.runConfig?.custom).toMatchObject({
      requestMode: "plan",
      agentNativeQueuedMessageId: "queued-1",
      model: "claude-opus-4-6",
      engine: "builder",
      effort: "high",
    });
  });

  it("omits the snapshot for queue entries persisted before it existed", () => {
    const options = createUserMessageRunConfig(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "queued-legacy",
      undefined,
      { model: undefined, engine: undefined, effort: undefined },
    );

    expect(options.runConfig?.custom).toEqual({
      agentNativeQueuedMessageId: "queued-legacy",
    });
  });
});

describe("dedupeReconnectContentAgainstMessages", () => {
  it("hides reasoning already rendered in the latest assistant message", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Inspect the schema." }],
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        [{ type: "reasoning", text: "Inspect the schema." }],
        persistedMessages,
      ),
    ).toEqual([]);
  });

  it("keeps only the new tail of a reconnect reasoning segment", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Inspect the schema." }],
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        [
          {
            type: "reasoning",
            text: "Inspect the schema. Then query it.",
          },
        ],
        persistedMessages,
      ),
    ).toEqual([{ type: "reasoning", text: " Then query it." }]);
  });

  it("preserves a legitimately repeated later reasoning segment", () => {
    const completedTool = {
      type: "tool-call" as const,
      toolCallId: "toolu_1",
      toolName: "read-file",
      argsText: "{}",
      args: {},
      result: "done",
    };
    const persistedMessages = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Check it." }, completedTool],
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        [
          { type: "reasoning", text: "Check it." },
          completedTool,
          { type: "reasoning", text: "Check it." },
        ],
        persistedMessages,
      ),
    ).toEqual([{ type: "reasoning", text: "Check it." }]);
  });

  it("does not fuzzy-dedupe divergent reasoning", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Check schema." }],
      },
    ];
    const reconnectContent = [
      { type: "reasoning" as const, text: "Check docs." },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        reconnectContent,
        persistedMessages,
      ),
    ).toBe(reconnectContent);
  });

  it("dedupes a tail-only reconnect inside the latest reasoning segment", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Earlier thought." },
          {
            type: "tool-call",
            toolCallId: "toolu_1",
            toolName: "read-file",
            args: {},
            result: "done",
          },
          { type: "reasoning", text: "Inspect the schema." },
        ],
      },
    ];
    const reconnectContent = [
      { type: "reasoning" as const, text: " the schema." },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        reconnectContent,
        persistedMessages,
      ),
    ).toBe(reconnectContent);
    expect(
      dedupeReconnectContentAgainstMessages(
        reconnectContent,
        persistedMessages,
        { trimTailTextOverlap: true },
      ),
    ).toEqual([]);
  });

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

  it("drops reconnect tool repeats during adapter handoff", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_live",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
            result: "1",
          },
        ],
      },
    ];
    const handoffDuplicate = {
      type: "tool-call" as const,
      toolCallId: "tc_reconnect",
      toolName: "db-query",
      argsText: '{"sql":"select 1"}',
      args: { sql: "select 1" },
      result: "1",
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [handoffDuplicate],
        persistedMessages,
        { suppressToolRepeats: true },
      ),
    ).toEqual([]);
  });

  it("drops ahead reconnect tool copies during adapter handoff", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_live",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
          },
        ],
      },
    ];
    const completedOverlay = {
      type: "tool-call" as const,
      toolCallId: "tc_reconnect",
      toolName: "db-query",
      argsText: '{"sql":"select 1"}',
      args: { sql: "select 1" },
      result: "1",
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [completedOverlay],
        persistedMessages,
        { suppressToolRepeats: true },
      ),
    ).toEqual([]);
  });

  it("drops a reconnect activity spinner already rendered as a live tool card", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "run123:tc_0",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
          },
        ],
      },
    ];
    // Reconnect overlay spinner: no args yet (no fingerprint) and a reader-local
    // id that never matches the server-scoped id above.
    const spinnerDuplicate = {
      type: "tool-call" as const,
      toolCallId: "tc_0",
      toolName: "db-query",
      argsText: "",
      args: {},
      activity: true,
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [spinnerDuplicate],
        persistedMessages,
      ),
    ).toEqual([]);
  });

  it("keeps a later same-name reconnect spinner with a different local id", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "run123:tc_0",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
          },
        ],
      },
    ];
    const laterSpinner = {
      type: "tool-call" as const,
      toolCallId: "tc_1",
      toolName: "db-query",
      argsText: "",
      args: {},
      activity: true,
    };

    expect(
      dedupeReconnectContentAgainstMessages([laterSpinner], persistedMessages),
    ).toEqual([laterSpinner]);
  });

  it("drops an unrelated-id activity duplicate during adapter handoff", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_live",
            toolName: "generate-design",
            argsText: "",
            args: {},
            activity: true,
          },
        ],
      },
    ];
    const reconnectSpinner = {
      type: "tool-call" as const,
      toolCallId: "tc_7",
      toolName: "generate-design",
      argsText: "",
      args: {},
      activity: true,
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [reconnectSpinner],
        persistedMessages,
        { suppressToolRepeats: true },
      ),
    ).toEqual([]);
    expect(
      dedupeReconnectContentAgainstMessages(
        [reconnectSpinner],
        persistedMessages,
      ),
    ).toEqual([reconnectSpinner]);
  });

  it("keeps distinct stable activity ids during adapter handoff", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "activity-call-1",
            toolName: "generate-design",
            argsText: "",
            args: {},
            activity: true,
          },
        ],
      },
    ];
    const parallelCall = {
      type: "tool-call" as const,
      toolCallId: "activity-call-2",
      toolName: "generate-design",
      argsText: "",
      args: {},
      activity: true,
    };

    expect(
      dedupeReconnectContentAgainstMessages([parallelCall], persistedMessages, {
        suppressToolRepeats: true,
      }),
    ).toEqual([parallelCall]);
  });

  it("drops a same-name reconnect spinner when a matching pending call is rendered beside a completed call", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "run123:tc_0",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
            result: "1",
          },
          {
            type: "tool-call",
            toolCallId: "run123:tc_1",
            toolName: "db-query",
            argsText: '{"sql":"select 2"}',
            args: { sql: "select 2" },
          },
        ],
      },
    ];
    const pendingDuplicate = {
      type: "tool-call" as const,
      toolCallId: "tc_1",
      toolName: "db-query",
      argsText: "",
      args: {},
      activity: true,
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [pendingDuplicate],
        persistedMessages,
      ),
    ).toEqual([]);
  });

  it("keeps a reconnect spinner for a tool not yet rendered", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "run123:tc_0",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
            result: "1",
          },
        ],
      },
    ];
    const newToolSpinner = {
      type: "tool-call" as const,
      toolCallId: "tc_1",
      toolName: "web-search",
      argsText: "",
      args: {},
      activity: true,
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [newToolSpinner],
        persistedMessages,
      ),
    ).toEqual([newToolSpinner]);
  });

  it("keeps a completed reconnect tool copy ahead of a live spinner outside handoff", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "run123:tc_0",
            toolName: "db-query",
            argsText: '{"sql":"select 1"}',
            args: { sql: "select 1" },
          },
        ],
      },
    ];
    // Overlay is strictly ahead (completed) of the rendered spinner and has a
    // fingerprint, so the name fallback must not hide it when not in handoff.
    const completedOverlay = {
      type: "tool-call" as const,
      toolCallId: "tc_0",
      toolName: "db-query",
      argsText: '{"sql":"select 1"}',
      args: { sql: "select 1" },
      result: "1",
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [completedOverlay],
        persistedMessages,
      ),
    ).toEqual([completedOverlay]);
  });

  it("drops stale pending tool-call copies inside the reconnect snapshot", () => {
    const stalePending = {
      type: "tool-call" as const,
      toolCallId: "tc_7",
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

  it("keeps parallel pending calls with distinct stable ids inside one snapshot", () => {
    const parallelCalls = [
      {
        type: "tool-call" as const,
        toolCallId: "activity-call-1",
        toolName: "generate-design",
        argsText: '{"screen":"home"}',
        args: { screen: "home" },
      },
      {
        type: "tool-call" as const,
        toolCallId: "activity-call-2",
        toolName: "generate-design",
        argsText: '{"screen":"home"}',
        args: { screen: "home" },
      },
    ];

    expect(dedupeReconnectContentAgainstMessages(parallelCalls, [])).toBe(
      parallelCalls,
    );
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

  it("keeps reconnect completions when the rendered tool call is still pending", () => {
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
    ).toEqual([completedCall]);
  });

  it("drops a pending reconnect duplicate when the rendered call already completed", () => {
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
    const pendingDuplicate = {
      type: "tool-call" as const,
      toolCallId: "tc_9",
      toolName: "db-query",
      argsText: '{"sql":"select 1"}',
      args: { sql: "select 1" },
    };

    expect(
      dedupeReconnectContentAgainstMessages(
        [pendingDuplicate],
        persistedMessages,
      ),
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

  it("hides a tail reconnect chunk already rendered as the latest text suffix", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "The earlier paragraph. " },
          {
            type: "tool-call",
            toolCallId: "toolu_done",
            toolName: "generate-design",
            argsText: "{}",
            args: {},
            result: "done",
          },
          { type: "text", text: "The final chunk is already visible." },
        ],
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        [{ type: "text", text: "The final chunk is already visible." }],
        persistedMessages,
        { trimTailTextOverlap: true },
      ),
    ).toEqual([]);
  });

  it("trims only a whole-boundary tail overlap before new reconnect text", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "The earlier paragraph. The final chunk",
          },
        ],
      },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        [
          {
            type: "text",
            text: "The final chunk continues with new output.",
          },
        ],
        persistedMessages,
        { trimTailTextOverlap: true },
      ),
    ).toEqual([{ type: "text", text: " continues with new output." }]);
  });

  it("does not trim a matching reconnect substring away from the rendered tail", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "The final chunk appeared earlier, but this tail is different.",
          },
        ],
      },
    ];
    const reconnectContent = [
      { type: "text" as const, text: "The final chunk continues now." },
    ];

    expect(
      dedupeReconnectContentAgainstMessages(
        reconnectContent,
        persistedMessages,
      ),
    ).toBe(reconnectContent);
  });

  it("preserves a legitimately repeated tail when this is not a tail replay", () => {
    const persistedMessages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "First pass: Done." }],
      },
    ];
    const reconnectContent = [{ type: "text" as const, text: "Done." }];

    expect(
      dedupeReconnectContentAgainstMessages(
        reconnectContent,
        persistedMessages,
      ),
    ).toBe(reconnectContent);
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
    expect(source).toContain("Do not memoize this on `messages` identity");
  });
});

describe("missing agent engine setup", () => {
  it("renders an attached setup card for page and sidebar composers", () => {
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
    const messageScroller = readFileSync(
      "src/client/components/ui/message-scroller.tsx",
      { encoding: "utf8" },
    );

    expect(source).toContain("hasComposerAccessoryAboveStack");
    expect(source).toContain("data-agent-composer-adjacent-ui");
    expect(source).toContain("<AssistantChatScrollerControls");
    expect(source).toContain(
      "if (!hideUserMessage) resumeFollowingRef.current()",
    );
    expect(messageScroller).toContain('"agentChat.composer.scrollToBottom"');
    expect(source).toContain("<MessageScrollerButton />");
    expect(source).toMatch(/<MessageScrollerProvider[\s\S]*?\bautoScroll\b/);
    expect(source).not.toContain("autoScroll={false}");
    expect(source).not.toContain("useNearBottomAutoscroll<HTMLDivElement>");
    expect(source).not.toContain("scrollAnchor");
    expect(source).toContain("visibleComposerContextItems.length > 0");
    expect(source).toContain('className="agent-composer-stack"');
    expect(messageComponents).toContain("agent-selection-attached-pill");
    expect(source).toContain("modelCatalogConfirmsMissing");
    expect(source).toContain('agentEngineConfigured.state === "missing" &&');
    expect(source).toMatch(
      /willQueue=\{\s*engineSetupRequired \|\| isRunning\s*\}/,
    );
    expect(source).toContain("<BuilderSetupCard");
    expect(source).toContain('"agentChat.setup.connectPlaceholder"');
    expect(source).toContain('missingApiKeySetupLayout === "sidebar"');
    expect(source).toContain("missingKeyBouncePulse");
    expect(source).toContain(
      "attached\n                                bouncePulse={missingKeyBouncePulse}",
    );
    expect(source).toContain('"agent-composer-area--attached-above"');
    expect(source).toContain("layout={missingApiKeySetupLayout}");
    expect(source).toMatch(
      /disabled=\{\s*isComposerDisabled \|\| showMissingKeySetup\s*\}/,
    );
    expect(source).not.toContain("data-agent-composer-setup-position");
    expect(css).toContain(".agent-builder-setup-card--attached");
    expect(css).toContain(".agent-composer-area--attached-above");
  });

  it("keeps a no-provider prompt queued until setup is connected", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const dequeueStart = source.indexOf("// Auto-dequeue:");
    const dequeueEnd = source.indexOf(
      "// Clear frozen reconnect content",
      dequeueStart,
    );
    const dequeueSource = source.slice(dequeueStart, dequeueEnd);
    const submitStart = source.indexOf("const addToQueue = useCallback");
    const submitEnd = source.indexOf("const mcpResumeTimerRef", submitStart);
    const submitSource = source.slice(submitStart, submitEnd);

    expect(dequeueSource).toContain("engineSetupRequired");
    expect(submitSource).toContain(
      'engineSetupRequired || (isRunning && intent === "queued")',
    );
    expect(submitSource).not.toContain(
      'reportAgentChatSubmitResult(submitMessageId, false, "missing-engine");',
    );
  });
});

describe("tool approval continuation", () => {
  it("keeps the approval acknowledgement out of visible chat history", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("onApprove: (approvalKey: string) => {");
    const end = source.indexOf("...(approvalActions?.onDeny", start);
    const approvalSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(approvalSource).toContain(
      '"Approved. Go ahead and run the requested action."',
    );
    expect(approvalSource).toContain(
      "true, // hideUserMessage: this is a protocol continuation, not a new prompt",
    );
  });
});

describe("chat connection suggestion alignment", () => {
  it("uses the fullscreen composer width contract and removes page-only insets", () => {
    const panelSource = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });
    const suggestionSource = readFileSync(
      "src/client/resources/McpConnectionSuggestion.tsx",
      { encoding: "utf8" },
    );

    expect(panelSource).toContain(
      "[data-agent-fullscreen='true'] .agent-mcp-connection-suggestion--composer,",
    );
    expect(panelSource).toContain(
      ".agent-composer-area:not(.agent-composer-area--compact)",
    );
    expect(panelSource).toContain("const FULLSCREEN_CHAT_COLUMN_MAX_PX = 750;");
    expect(panelSource).toContain("padding-left:0;padding-right:0;");
    expect(suggestionSource).toContain("w-[min(calc(100%_-_1.5rem),750px)]");
    expect(suggestionSource).toContain(
      "agent-mcp-connection-suggestion-error--composer",
    );
  });

  it("keeps response connection cards before collapsible assistant work", () => {
    const messageSource = readFileSync(
      "src/client/chat/message-components.tsx",
      { encoding: "utf8" },
    );
    const cardIndex = messageSource.indexOf(
      "<McpConnectionSuggestion\n            text={responseConnectionText}",
    );
    const workStackIndex = messageSource.indexOf(
      "<ToolCallStackMotion>",
      cardIndex,
    );

    expect(cardIndex).toBeGreaterThan(-1);
    expect(workStackIndex).toBeGreaterThan(cardIndex);
  });
});

describe("centered chat loading fallback", () => {
  it("keeps the loading composer in the same ordered stack as the real composer", () => {
    const source = readFileSync("src/client/AgentPanel.tsx", {
      encoding: "utf8",
    });

    expect(source).toMatch(
      /<div className="agent-composer-stack">\s*<div\s+className=\{cn\(\s*"agent-composer-area shrink-0 px-3 py-2"/s,
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

  it("hides the running presentation after a terminal run error", () => {
    expect(
      resolveAssistantChatRunningState({
        forceStopped: false,
        isRuntimeRunning: false,
        isReconnecting: false,
        optimisticRunning: false,
        isAutoResuming: false,
        hasActiveServerRun: true,
        hasTerminalRunError: true,
      }),
    ).toEqual({ isRunning: true, showRunningInUI: false });
  });

  it("keeps auto-resume visible through the between-chunk idle gap", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain("AUTO_RESUME_STATUS_TIMEOUT_MS");
    expect(source).toContain("autoResumeTimerRef");
    expect(source).toContain("!isRunning && !isAutoResuming");
    expect(source).toContain("if (forceStopped) {");
    expect(source).not.toContain("if (isRunning || forceStopped) {");
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

describe("useAutoResumeStatus", () => {
  let container: HTMLDivElement;
  let root: Root;

  interface AutoResumeApi {
    isAutoResuming: boolean;
    clearAutoResume: () => void;
  }

  function AutoResumeHarness({
    apiRef,
    tabId,
    forceStopped = false,
  }: {
    apiRef: React.RefObject<AutoResumeApi | null>;
    tabId: string | undefined;
    forceStopped?: boolean;
  }) {
    const api = useAutoResumeStatus(tabId, forceStopped);
    React.useLayoutEffect(() => {
      apiRef.current = api;
    });
    return React.createElement(
      "output",
      { "data-testid": "auto-resume-state" },
      api.isAutoResuming ? "resuming" : "idle",
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
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

  function renderHarness(tabId: string | undefined, forceStopped = false) {
    const apiRef = React.createRef<AutoResumeApi>();
    act(() => {
      root.render(
        React.createElement(AutoResumeHarness, {
          apiRef,
          tabId,
          forceStopped,
        }),
      );
    });
    return apiRef;
  }

  function dispatchAutoContinue(tabId?: string) {
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:auto-continue", { detail: { tabId } }),
      );
    });
  }

  function dispatchStreamProgress(tabId?: string) {
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:stream-progress", { detail: { tabId } }),
      );
    });
  }

  it("sets resuming on auto-continue and clears it on a matching-tab stream-progress event", () => {
    const apiRef = renderHarness("tab-1");

    dispatchAutoContinue("tab-1");
    expect(apiRef.current?.isAutoResuming).toBe(true);

    dispatchStreamProgress("tab-1");
    expect(apiRef.current?.isAutoResuming).toBe(false);
  });

  it("ignores a stream-progress event for a different tab", () => {
    const apiRef = renderHarness("tab-1");

    dispatchAutoContinue("tab-1");
    expect(apiRef.current?.isAutoResuming).toBe(true);

    dispatchStreamProgress("tab-2");
    expect(apiRef.current?.isAutoResuming).toBe(true);

    // The matching tab still clears it.
    dispatchStreamProgress("tab-1");
    expect(apiRef.current?.isAutoResuming).toBe(false);
  });

  it("does not let the 30s failsafe re-trigger after stream-progress already cleared it", () => {
    const apiRef = renderHarness("tab-1");

    dispatchAutoContinue("tab-1");
    expect(apiRef.current?.isAutoResuming).toBe(true);

    dispatchStreamProgress("tab-1");
    expect(apiRef.current?.isAutoResuming).toBe(false);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(apiRef.current?.isAutoResuming).toBe(false);
  });

  it("clears resuming when the run is force-stopped", () => {
    const apiRef = renderHarness("tab-1", false);

    dispatchAutoContinue("tab-1");
    expect(apiRef.current?.isAutoResuming).toBe(true);

    act(() => {
      root.render(
        React.createElement(AutoResumeHarness, {
          apiRef,
          tabId: "tab-1",
          forceStopped: true,
        }),
      );
    });
    expect(apiRef.current?.isAutoResuming).toBe(false);
  });
});

describe("settleInterruptedAssistantToolCallsInRepo", () => {
  it("settles active tool activity so stopped tool cards do not keep spinning", () => {
    const repo = {
      messages: [
        {
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "tool-1",
                toolName: "query",
                args: {},
                activity: true,
              },
            ],
            status: { type: "running" },
          },
        },
      ],
    };

    const settled = settleInterruptedAssistantToolCallsInRepo(repo);
    const tool = settled.repo.messages[0].message.content[0] as {
      result?: unknown;
      isError?: boolean;
      outcome?: string;
      activity?: boolean;
    };

    expect(settled.changed).toBe(true);
    expect(tool.result).toBe("Stopped before this action started.");
    expect(tool.outcome).toBe("unknown");
    expect(tool.isError).toBeUndefined();
    expect(tool.activity).toBe(true);
    expect(settled.repo.messages[0].message.status).toEqual({
      type: "incomplete",
      reason: "error",
    });
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

  it("localizes Core-owned activity labels while preserving the tool name", () => {
    expect(
      resolveAssistantChatRunningStatusLabel({
        runningActivityLabel: "Preparing generate-design...",
        isAutoResuming: false,
        isReconnecting: false,
        hasReconnectContent: false,
        labels: {
          thinking: "Denkt nach",
          resuming: "Wird fortgesetzt",
          stillWorking: "Arbeitet weiter",
          working: "Arbeitet",
          contactingModel: "Modell wird kontaktiert",
          starting: (activity) => `${activity} wird gestartet...`,
          preparing: (activity) => `${activity} wird vorbereitet...`,
          writing: (activity) => `${activity} wird geschrieben...`,
          stillGenerating: (activity) => `${activity} wird weiterhin generiert`,
        },
      }),
    ).toBe("generate-design wird vorbereitet...");
  });

  it("shows replayed recovery as still working instead of reconnecting", () => {
    expect(
      resolveAssistantChatRunningStatusLabel({
        runningActivityLabel: null,
        isAutoResuming: false,
        isReconnecting: true,
        hasReconnectContent: true,
        labels: {
          thinking: "Denkt nach",
          resuming: "Wird fortgesetzt",
          stillWorking: "Arbeitet weiter",
        },
      }),
    ).toBe("Arbeitet weiter");
  });

  it("keeps bare reconnect recovery as thinking", () => {
    expect(
      resolveAssistantChatRunningStatusLabel({
        runningActivityLabel: null,
        isAutoResuming: false,
        isReconnecting: true,
        hasReconnectContent: false,
        labels: {
          thinking: "Denkt nach",
          resuming: "Wird fortgesetzt",
          stillWorking: "Arbeitet weiter",
        },
      }),
    ).toBe("Denkt nach");
  });
});

describe("resolveAssistantChatComposerPlaceholder", () => {
  it("provides a clear default for shared chat composers", () => {
    expect(resolveAssistantChatComposerPlaceholder(undefined)).toBe(
      "Write a message...",
    );
  });

  it("preserves host-provided composer copy", () => {
    expect(
      resolveAssistantChatComposerPlaceholder("Ask about your data..."),
    ).toBe("Ask about your data...");
  });
});

describe("shouldShowGlobalRunningStatus", () => {
  it("hides the duplicate generic status while reasoning is visibly streaming", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: null,
        latestMessage: {
          role: "assistant",
          content: [{ type: "reasoning", text: "Checking the schema." }],
        },
        reconnectContent: [],
      }),
    ).toBe(false);
  });

  it("hides a generic activity status while reasoning is visibly streaming", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: "Thinking",
        latestMessage: {
          role: "assistant",
          content: [{ type: "reasoning", text: "Checking the schema." }],
        },
        reconnectContent: [],
      }),
    ).toBe(false);
  });

  it("keeps a specific tool activity ahead of visible reasoning", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: "Querying submissions",
        latestMessage: {
          role: "assistant",
          content: [{ type: "reasoning", text: "Checking the schema." }],
        },
        reconnectContent: [],
      }),
    ).toBe(true);
  });

  it("hides a specific activity status when its pending tool card is visible", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: "Writing generate design...",
        runningActivityTool: "generate-design",
        latestMessage: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Checking the layout structure." },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "generate-design",
              argsText: "",
              args: {},
              activity: true,
            },
          ],
        },
        reconnectContent: [],
      }),
    ).toBe(false);
  });

  it("hides the global status when reconnect fallback already shows a tool card", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: "Writing generate design...",
        runningActivityTool: "generate-design",
        latestMessage: null,
        reconnectContent: reconnectActivityFallbackContent("generate-design"),
      }),
    ).toBe(false);
  });

  it("keeps active status visible after a completed tool call", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: null,
        latestMessage: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Checked the schema." },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "db-query",
              argsText: "{}",
              args: {},
              result: "done",
            },
          ],
        },
        reconnectContent: [],
      }),
    ).toBe(true);
  });

  it("hides generic status while a pending tool card is visible", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: null,
        latestMessage: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "db-query",
              argsText: "{}",
              args: {},
            },
          ],
        },
        reconnectContent: [],
      }),
    ).toBe(false);
  });

  it("shows Thinking after completed reasoning when no tool carries the active state", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: null,
        latestMessage: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Checked the schema." },
            { type: "text", text: "Interim update." },
          ],
        },
        reconnectContent: [],
      }),
    ).toBe(true);
  });

  it("keeps a specific activity status when only a different tool card is visible", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: "Writing generate design...",
        runningActivityTool: "generate-design",
        latestMessage: {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "db-query",
              argsText: "{}",
              args: {},
            },
          ],
        },
        reconnectContent: [],
      }),
    ).toBe(true);
  });

  it("hides the duplicate status while reconnect reasoning is visible", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: null,
        latestMessage: null,
        reconnectContent: [
          { type: "reasoning", text: "Resuming the same thought." },
        ],
      }),
    ).toBe(false);
  });

  it("keeps the generic status before any visible reasoning arrives", () => {
    expect(
      shouldShowGlobalRunningStatus({
        showRunningInUI: true,
        runningActivityLabel: null,
        latestMessage: null,
        reconnectContent: [],
      }),
    ).toBe(true);
  });
});

describe("assistantChatAutoscrollStatusKey", () => {
  it("ignores activity labels that are not rendered", () => {
    expect(
      assistantChatAutoscrollStatusKey({
        showGlobalRunningStatus: false,
        runningStatusLabel: "Thinking",
      }),
    ).toBe("idle");
  });

  it("tracks a visible activity label", () => {
    expect(
      assistantChatAutoscrollStatusKey({
        showGlobalRunningStatus: true,
        runningStatusLabel: "Querying submissions",
      }),
    ).toBe("Querying submissions");
  });
});

describe("chat submit and stop hardening", () => {
  it("wires reconnect ownership into the inner chat and rejects stale callbacks", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    expect(source).toContain(
      "useReconnectReaderOwner(\n    reconnectRunIdRef,\n    reconnectAbortRef,\n  )",
    );
    expect(source).toContain("!reconnectOwnerMountedRef.current ||");
    expect(source).toContain(
      "if (reconnectRunIdRef.current !== runId) return;",
    );
  });

  it("keeps chat composer readiness passive and eager", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    expect(source).not.toContain(
      "onBeforeSubmit={ensureAgentEngineReadyForSubmit}",
    );
    expect(source).not.toContain("fetchAgentEngineConfiguredState(");
    expect(source).not.toContain("ensureAgentEngineReadyForSubmit");
    expect(source).not.toContain("await ensureAgentEngineReadyForSubmit()");
    expect(source).not.toContain("isProviderStatusChecking");
    expect(source).not.toContain("checkingAiConnection");
  });

  it("never disables the chat composer on an unresolved provider status check", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    // A readiness check that timed out is not evidence that no provider is
    // configured; disabling on it left an inert box that swallowed keystrokes.
    expect(source).toContain("const isComposerDisabled = composerDisabled;");
    expect(source).not.toContain("isProviderStatusUnavailable");
  });

  it("clears queued follow-ups and settles stopped tool calls by default", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("const stopActiveRun = useCallback");
    const end = source.indexOf("// Keep the ref current");
    const helperSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(helperSource).toContain("preserveQueuedMessages");
    expect(helperSource).toContain("queueStopVersionRef.current += 1");
    expect(helperSource).toContain("dequeueInFlightRef.current = false");
    expect(helperSource).toContain("applyLocalQueuedMessages(() => [])");
    expect(helperSource).toContain("setPendingReconnectRecovery(null)");
    expect(helperSource).toContain("resetRunningActivity()");
    expect(helperSource).toContain("includeActivity: true");
    expect(helperSource).toContain("settleVisibleInterruptedTools()");
    expect(helperSource).toContain("markVisibleRunStopped()");
    expect(
      helperSource.indexOf("settleVisibleInterruptedTools()"),
    ).toBeLessThan(helperSource.indexOf("threadRuntime.cancelRun()"));
    expect(helperSource.indexOf("markVisibleRunStopped()")).toBeLessThan(
      helperSource.indexOf("threadRuntime.cancelRun()"),
    );
    expect(helperSource).toContain("getPendingTurn(threadId)");
    expect(helperSource).toContain("clearPendingTurnIfMatches(");
    expect(helperSource).toContain("/runs/turn/${encodeURIComponent(");
  });

  it("keeps queued follow-ups when the Stop response button is pressed", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });

    expect(source).toMatch(
      /stopActiveRun\(\{\s*preserveQueuedMessages: true,\s*\}\)/,
    );
  });

  it("wakes the dequeue loop after its startup guard expires", () => {
    const source = readFileSync("src/client/AssistantChat.tsx", {
      encoding: "utf8",
    });
    const start = source.indexOf("// Auto-dequeue:");
    const end = source.indexOf(
      "// Clear frozen reconnect content + forceStopped",
    );
    const dequeueSource = source.slice(start, end);

    expect(source).toContain(
      "const [queueWakeVersion, setQueueWakeVersion] = useState(0);",
    );
    expect(dequeueSource).toContain(
      "setQueueWakeVersion((version) => version + 1);",
    );
    expect(dequeueSource).toContain("queueWakeVersion,");
  });
});

describe("waitForThreadRunToClear", () => {
  afterEach(() => {
    clearActiveRun();
    vi.unstubAllGlobals();
  });

  it("reattaches to a deferred successor instead of clearing its queued follow-up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          active: true,
          runId: "run-deferred-successor",
          threadId: "thread-deferred-successor",
          status: "running",
          dispatchMode: "background",
          awaitingRedispatch: true,
          lastProgressAt: Date.now(),
          serverNow: Date.now(),
        }),
      })),
    );

    await expect(
      waitForThreadRunToClear(
        "/_agent-native/agent-chat",
        "thread-deferred-successor",
      ),
    ).resolves.toBe(false);
    expect(getActiveRun()).toEqual({
      threadId: "thread-deferred-successor",
      runId: "run-deferred-successor",
      lastSeq: -1,
    });
  });

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
    expect(reconnectActivityFallbackContent("call-agent")).toEqual([]);
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
    const start = source.indexOf("visibleReconnectContent.length > 0");
    const end = source.indexOf("{showGlobalRunningStatus &&", start);
    const renderSource = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(renderSource).toContain("visibleReconnectContent.length > 0");
    expect(renderSource).toContain("visibleReconnectContent.length === 0");
    expect(renderSource).toContain("reconnectContent.length === 0");
    // The overlay is a second fold of the run; it may only render while no
    // adapter runtime owns the turn. See the showReconnectOverlay tests below.
    expect(renderSource).toContain("showReconnectOverlay");
    expect(renderSource.replace(/\s+/g, "")).toContain(
      "allowActivitySpinner={!reconnectFrozen}",
    );
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
    expect(materializeSource).toContain("includeActivity: true");
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
      "isRuntimeRunningRef.current || isAutoResumingRef.current",
    );
    expect(importSource).toContain(
      "if (settled && Array.isArray(repo?.queuedMessages))",
    );
  });
});

describe("shouldShowReconnectOverlay", () => {
  // The reconnect overlay is a second, independent fold of the same run. Every
  // duplicate-render report traces back to it being on screen at the same time
  // as the adapter's own message. Ownership decides visibility here, so these
  // assert behavior rather than grepping the render source.
  it("hides the overlay whenever a runtime owns the turn", () => {
    expect(
      shouldShowReconnectOverlay({
        isRuntimeRunning: true,
        isReconnecting: true,
        reconnectFrozen: false,
      }),
    ).toBe(false);
    expect(
      shouldShowReconnectOverlay({
        isRuntimeRunning: true,
        isReconnecting: false,
        reconnectFrozen: true,
      }),
    ).toBe(false);
    // Both readers claiming the turn at once is the exact duplicate-render case.
    expect(
      shouldShowReconnectOverlay({
        isRuntimeRunning: true,
        isReconnecting: true,
        reconnectFrozen: true,
      }),
    ).toBe(false);
  });

  it("shows the overlay only when no runtime is streaming", () => {
    expect(
      shouldShowReconnectOverlay({
        isRuntimeRunning: false,
        isReconnecting: true,
        reconnectFrozen: false,
      }),
    ).toBe(true);
    expect(
      shouldShowReconnectOverlay({
        isRuntimeRunning: false,
        isReconnecting: false,
        reconnectFrozen: true,
      }),
    ).toBe(true);
  });

  it("stays hidden when there is nothing to reconnect", () => {
    expect(
      shouldShowReconnectOverlay({
        isRuntimeRunning: false,
        isReconnecting: false,
        reconnectFrozen: false,
      }),
    ).toBe(false);
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

  it("matches React maximum update depth crashes from assistant-ui streaming", () => {
    expect(
      assistantUiRecoverableRenderErrorKind(
        new Error(
          "Minified React error #185; visit https://react.dev/errors/185",
        ),
      ),
    ).toBe("assistant-ui-react-update-depth");
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

  it("keeps the message list visibly updating during recovery", async () => {
    let shouldFail = false;
    function FlakyMessageList() {
      if (shouldFail) {
        throw new Error("tapClientLookup: Index 79 out of bounds (length: 78)");
      }
      return React.createElement("div", null, "Current messages");
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

    shouldFail = true;
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
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    shouldFail = false;
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(container.textContent).toContain("Current messages");
  });

  it("preserves message disclosure state when the message reset key changes", () => {
    function StatefulMessageList() {
      const [expanded, setExpanded] = React.useState(false);
      return React.createElement(
        "button",
        {
          type: "button",
          "aria-expanded": expanded,
          onClick: () => setExpanded((value) => !value),
        },
        expanded ? "open" : "closed",
      );
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantMessageListErrorBoundary,
          { resetKey: "messages:1" },
          React.createElement(StatefulMessageList),
        ),
      );
    });

    act(() => {
      container.querySelector("button")?.click();
    });
    expect(
      container.querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("true");

    act(() => {
      root.render(
        React.createElement(
          AssistantMessageListErrorBoundary,
          { resetKey: "messages:2" },
          React.createElement(StatefulMessageList),
        ),
      );
    });

    expect(
      container.querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("true");
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

  it("keeps a visible recovery state when no fallback is provided", () => {
    function BrokenComposer() {
      throw new Error("tapClientLookup: Index 4 out of bounds (length: 3)");
    }

    act(() => {
      root.render(
        React.createElement(
          AssistantUiStaleIndexErrorBoundary,
          { resetKey: "thread-1", componentName: "AssistantChat" },
          React.createElement(BrokenComposer),
        ),
      );
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("Updating chat...");
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
