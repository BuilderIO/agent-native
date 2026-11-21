import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineAction } from "../action.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import { loadPriorTurnToolCallJournal } from "./engine/tool-call-journal-seed.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
  EngineStreamOptions,
} from "./engine/types.js";
import {
  appendAgentLoopContinuation,
  runAgentLoop,
  runAgentLoopWithMainChatInternalContinuations,
} from "./production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "./run-loop-with-resume.js";
import * as runStore from "./run-store.js";
import { buildAssistantMessage } from "./thread-data-builder.js";
import { buildTurnResumeContext } from "./turn-resume-context.js";
import type { AgentChatEvent } from "./types.js";

const PRIVATE_DRAFT_CANARY = "PRIVATE_DRAFT_BODY_SENTINEL_9f3c21";
const PRIVATE_READBACK_CANARY = "PRIVATE_READBACK_BODY_SENTINEL_4b7e12";

function createPrivateMailActions() {
  const manageDraft = vi.fn(async (_args: { to: string; body: string }) =>
    JSON.stringify({
      draftId: "draft-1",
      body: PRIVATE_DRAFT_CANARY,
    }),
  );
  const getDraft = vi.fn(async (_args: { draftId: string }) =>
    JSON.stringify({
      draftId: "draft-1",
      body: PRIVATE_READBACK_CANARY,
    }),
  );
  const actions = loadActionsFromStaticRegistry({
    "manage-gmail-draft": {
      default: defineAction({
        description: "Save a draft message",
        parameters: {
          to: { type: "string" },
          body: { type: "string" },
        },
        readOnly: false,
        persistInChatHistory: false,
        run: manageDraft,
      }),
    },
    "get-gmail-draft": {
      default: defineAction({
        description: "Read a draft message",
        parameters: {
          draftId: { type: "string" },
        },
        readOnly: true,
        persistInChatHistory: false,
        run: getDraft,
      }),
    },
  });
  return { actions, manageDraft, getDraft };
}

function createPersistedLedgerRecorder() {
  const persistedEvents: AgentChatEvent[] = [];
  const rawEvents: AgentChatEvent[] = [];
  const record = (event: AgentChatEvent) => {
    rawEvents.push(event);
    const stored = JSON.parse(
      runStore.persistedRunEventData(JSON.stringify(event)),
    ) as AgentChatEvent;
    persistedEvents.push(stored);
  };
  return { persistedEvents, rawEvents, record };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("private turn continuation paths", () => {
  it("completes without error when a private turn hits unfinished tool input (stream_ended)", async () => {
    const { actions, manageDraft } = createPrivateMailActions();
    const ledger = createPersistedLedgerRecorder();
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockImplementation(
      async () => [...ledger.persistedEvents],
    );
    vi.spyOn(runStore, "recordThreadPrivateRun").mockResolvedValue(undefined);

    let streamCall = 0;
    const engine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "draft-call-1",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (streamCall === 2) {
          yield {
            type: "tool-input-start",
            id: "readback-call-interrupted",
            name: "get-gmail-draft",
          };
          return;
        }
        yield {
          type: "text-delta",
          text: `Saved draft: ${PRIVATE_DRAFT_CANARY}`,
        };
        yield {
          type: "assistant-content",
          parts: [
            { type: "text", text: `Saved draft: ${PRIVATE_DRAFT_CANARY}` },
          ],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "Save the draft" }] },
    ];

    await runAgentLoopWithMainChatInternalContinuations({
      engine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages,
      actions,
      threadId: "thread-private-unfinished-input",
      turnId: "turn-private-unfinished-input",
      runId: "run-private-unfinished-input",
      send: ledger.record,
      signal: new AbortController().signal,
    });

    expect(streamCall).toBe(3);
    expect(manageDraft).toHaveBeenCalledTimes(1);
    expect(ledger.rawEvents.some((event) => event.type === "error")).toBe(
      false,
    );
    expect(ledger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: `Saved draft: ${PRIVATE_DRAFT_CANARY}`,
        omitFromPersistedHistory: true,
      }),
    );
    expect(JSON.stringify(ledger.persistedEvents)).not.toContain(
      PRIVATE_DRAFT_CANARY,
    );
  });

  it("completes without error when a private turn hits an empty model stream without stop reason (stream_ended)", async () => {
    const { actions, manageDraft } = createPrivateMailActions();
    const ledger = createPersistedLedgerRecorder();
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockImplementation(
      async () => [...ledger.persistedEvents],
    );
    vi.spyOn(runStore, "recordThreadPrivateRun").mockResolvedValue(undefined);

    let streamCall = 0;
    const engine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "draft-call-1",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (streamCall === 2) {
          return;
        }
        yield { type: "text-delta", text: "Draft saved and confirmed." };
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "Draft saved and confirmed." }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "Save the draft" }] },
    ];

    await runAgentLoopWithMainChatInternalContinuations({
      engine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages,
      actions,
      threadId: "thread-private-empty-stream",
      turnId: "turn-private-empty-stream",
      runId: "run-private-empty-stream",
      send: ledger.record,
      signal: new AbortController().signal,
    });

    expect(streamCall).toBe(3);
    expect(manageDraft).toHaveBeenCalledTimes(1);
    expect(ledger.rawEvents.some((event) => event.type === "error")).toBe(
      false,
    );
    expect(ledger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Draft saved and confirmed.",
        omitFromPersistedHistory: true,
      }),
    );
    expect(JSON.stringify(ledger.persistedEvents)).not.toContain(
      PRIVATE_DRAFT_CANARY,
    );
  });

  it("completes without error across a chunk boundary recovery with persisted private ledger events", async () => {
    const { actions, manageDraft } = createPrivateMailActions();
    const ledger = createPersistedLedgerRecorder();
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockImplementation(
      async () => [...ledger.persistedEvents],
    );
    vi.spyOn(runStore, "recordThreadPrivateRun").mockResolvedValue(undefined);

    const turn = new AbortController();
    let chunk = new AbortController();
    let boundary: string | null = null;
    let streamCall = 0;

    const engine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "draft-call-chunk-1",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "text-delta",
          text: `Chunk resumed: ${PRIVATE_DRAFT_CANARY}`,
        };
        yield {
          type: "assistant-content",
          parts: [
            { type: "text", text: `Chunk resumed: ${PRIVATE_DRAFT_CANARY}` },
          ],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const control = {
      turnSignal: turn.signal,
      get chunkSignal() {
        return chunk.signal;
      },
      chunkBoundaryReason: () => boundary,
      beginChunk: () => {
        boundary = null;
        chunk = new AbortController();
        return chunk.signal;
      },
      flushEvents: async () => {},
    };

    await runAgentLoopDirectWithSoftTimeout(
      {
        engine,
        model: "synthetic",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Save the draft" }] },
        ],
        actions,
        threadId: "thread-private-chunk",
        turnId: "turn-private-chunk",
        runId: "run-private-chunk",
        signal: turn.signal,
        send: (event) => {
          ledger.record(event);
          if (
            event.type === "tool_done" &&
            boundary === null &&
            streamCall === 1
          ) {
            boundary = "run_timeout";
            chunk.abort("run_timeout");
          }
        },
      },
      0,
      undefined,
      control,
    );

    expect(streamCall).toBe(2);
    expect(manageDraft).toHaveBeenCalledTimes(1);
    expect(ledger.rawEvents.some((event) => event.type === "error")).toBe(
      false,
    );
    expect(ledger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: `Chunk resumed: ${PRIVATE_DRAFT_CANARY}`,
        omitFromPersistedHistory: true,
      }),
    );
    expect(JSON.stringify(ledger.persistedEvents)).not.toContain(
      PRIVATE_DRAFT_CANARY,
    );
  });

  it("resumes a cross-process continuation after a completed private tool without leaking private content", async () => {
    const { actions, manageDraft, getDraft } = createPrivateMailActions();
    const run1Ledger = createPersistedLedgerRecorder();
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockImplementation(
      async () => [...run1Ledger.persistedEvents],
    );
    vi.spyOn(runStore, "recordThreadPrivateRun").mockResolvedValue(undefined);

    let run1Calls = 0;
    const run1Engine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        run1Calls += 1;
        if (run1Calls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "draft-call-prior",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        return;
      },
    };

    await runAgentLoop({
      engine: run1Engine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Save the draft and read it back" }],
        },
      ],
      actions,
      threadId: "thread-private-cross-process",
      turnId: "turn-private-cross-process",
      runId: "run-private-cross-process-1",
      send: run1Ledger.record,
      signal: new AbortController().signal,
    });
    expect(manageDraft).toHaveBeenCalledTimes(1);
    const persistedPriorEvents = [...run1Ledger.persistedEvents];
    const ledger = createPersistedLedgerRecorder();

    const journalRead = await loadPriorTurnToolCallJournal(
      "thread-private-cross-process",
      "turn-private-cross-process",
    );
    expect(journalRead.status).toBe("read");
    if (journalRead.status !== "read") return;

    const resumedContext = buildTurnResumeContext({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Save the draft and read it back" }],
        },
      ],
      journal: journalRead.toolCallJournal,
    });
    expect(resumedContext.journalNote).toContain("manage-gmail-draft");
    expect(resumedContext.journalNote).not.toContain(PRIVATE_DRAFT_CANARY);

    appendAgentLoopContinuation(resumedContext.messages, "stream_ended", {
      ...(resumedContext.journalNote
        ? { journalNote: resumedContext.journalNote }
        : {}),
    });

    const UPDATED_DRAFT_CANARY = "PRIVATE_UPDATED_DRAFT_BODY_SENTINEL_2e8d44";
    let streamCall = 0;
    const engine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "draft-call-reissued",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (streamCall === 2) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "draft-call-new-args",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: UPDATED_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (streamCall === 3) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "readback-call-1",
                name: "get-gmail-draft",
                input: { draftId: "draft-1" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "text-delta",
          text: `Read back draft: ${PRIVATE_READBACK_CANARY}`,
        };
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "text",
              text: `Read back draft: ${PRIVATE_READBACK_CANARY}`,
            },
          ],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages: resumedContext.messages,
      actions,
      internalContinuation: true,
      threadId: "thread-private-cross-process",
      turnId: "turn-private-cross-process",
      runId: "run-private-cross-process-2",
      send: ledger.record,
      signal: new AbortController().signal,
    });

    expect(manageDraft).toHaveBeenCalledTimes(2);
    expect(manageDraft).toHaveBeenNthCalledWith(
      1,
      { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
      expect.anything(),
    );
    expect(manageDraft).toHaveBeenNthCalledWith(
      2,
      { to: "alice@example.com", body: UPDATED_DRAFT_CANARY },
      expect.anything(),
    );
    expect(ledger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "draft-call-reissued",
        tool: "manage-gmail-draft",
        replayed: true,
        completedSideEffect: true,
        omitFromPersistedHistory: true,
      }),
    );
    expect(getDraft).toHaveBeenCalledTimes(1);
    expect(ledger.rawEvents.some((event) => event.type === "error")).toBe(
      false,
    );
    expect(ledger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: `Read back draft: ${PRIVATE_READBACK_CANARY}`,
        omitFromPersistedHistory: true,
      }),
    );
    expect(JSON.stringify(ledger.persistedEvents)).not.toContain(
      PRIVATE_READBACK_CANARY,
    );
    expect(JSON.stringify(ledger.persistedEvents)).not.toContain(
      PRIVATE_DRAFT_CANARY,
    );
    expect(JSON.stringify(ledger.persistedEvents)).not.toContain(
      UPDATED_DRAFT_CANARY,
    );
    expect(JSON.stringify(persistedPriorEvents)).not.toContain(
      PRIVATE_DRAFT_CANARY,
    );
  });

  it("resumes reaper recovery (recoverCompletedExecutionSteps) past a completed private tool with HMAC-only step storage", async () => {
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockResolvedValue([
      {
        type: "tool_start",
        id: "private-step-1",
        tool: "manage-gmail-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "private-step-1",
        tool: "manage-gmail-draft",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        privateReplayIdentity: `hmac-v1:${"a".repeat(64)}`,
        omitFromPersistedHistory: true,
      },
    ]);
    const getSteps = vi
      .spyOn(runStore, "getCompletedAgentExecutionSteps")
      .mockResolvedValue([
        {
          stepId: "private-step-1",
          operationId: "private-step-1",
          toolName: "manage-gmail-draft",
          inputJson: JSON.stringify({
            identity: `hmac-v1:${"a".repeat(64)}`,
            omitFromPersistedHistory: true,
          }),
          resultJson: JSON.stringify({
            result: "[Private content omitted]",
            isError: false,
            completedSideEffect: true,
          }),
        },
      ]);

    const journalRead = await loadPriorTurnToolCallJournal(
      "thread-private-reaper",
      "turn-private-reaper",
      { recoverCompletedExecutionSteps: true },
    );
    expect(journalRead.status).toBe("read");
    expect(getSteps).not.toHaveBeenCalled();
  });

  it("keeps safe user messages for allowlisted private error codes in persisted events and thread messages", () => {
    const privateSentinel = "SECRET_PRIVATE_ERROR_PAYLOAD_8a11c";
    const safePersisted = JSON.parse(
      runStore.persistedRunEventData(
        JSON.stringify({
          type: "error",
          error: privateSentinel,
          errorCode: "tool_call_journal_unreadable",
          omitFromPersistedHistory: true,
        }),
      ),
    ) as AgentChatEvent;

    expect(safePersisted).toMatchObject({
      type: "error",
      errorCode: "tool_call_journal_unreadable",
      error: expect.stringContaining("send the request again"),
      omitFromPersistedHistory: true,
    });
    expect(JSON.stringify(safePersisted)).not.toContain(privateSentinel);
    expect(JSON.stringify(safePersisted)).not.toContain(
      "Private content omitted",
    );

    const message = buildAssistantMessage(
      [{ seq: 0, event: safePersisted }],
      "run-safe-private-error",
    );
    const runError = message?.metadata.custom?.runError as
      | { errorCode?: string; message?: string }
      | undefined;
    expect(runError).toMatchObject({
      errorCode: "tool_call_journal_unreadable",
    });
    expect(runError?.message).not.toBe("Private content omitted");
    expect(runError?.message).toContain("send the request again");
    expect(JSON.stringify(message)).not.toContain(privateSentinel);

    const unknownPersisted = JSON.parse(
      runStore.persistedRunEventData(
        JSON.stringify({
          type: "error",
          error: privateSentinel,
          errorCode: privateSentinel,
          omitFromPersistedHistory: true,
        }),
      ),
    ) as AgentChatEvent;
    expect(unknownPersisted).toEqual({
      type: "error",
      omitFromPersistedHistory: true,
      error: "Private content omitted",
    });
  });

  it("resumes a private turn cleanly after a run-manager checkpoint boundary (run_timeout)", async () => {
    const { actions, manageDraft, getDraft } = createPrivateMailActions();
    const { startRun } = await import("./run-manager.js");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const threadId = `thread-private-checkpoint-${suffix}`;
    const turnId = `turn-private-checkpoint-${suffix}`;
    const run1Id = `run-private-checkpoint-1-${suffix}`;
    const run2Id = `run-private-checkpoint-2-${suffix}`;
    const setRunErrorSpy = vi.spyOn(runStore, "setRunError");

    let run1StreamCalls = 0;
    const run1Engine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        run1StreamCalls += 1;
        if (run1StreamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "draft-call-checkpoint-1",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        await new Promise<void>((resolve) => {
          if (_options.abortSignal.aborted) {
            resolve();
            return;
          }
          _options.abortSignal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      },
    };

    const run1 = startRun(
      run1Id,
      threadId,
      async (send, signal) => {
        await runAgentLoop({
          engine: run1Engine,
          model: "synthetic",
          systemPrompt: "system",
          tools: [],
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Save the draft and read it back" },
              ],
            },
          ],
          actions,
          threadId,
          turnId,
          runId: run1Id,
          send,
          signal,
        });
      },
      undefined,
      {
        turnId,
        softTimeoutMs: 50,
      },
    );
    await run1.finalized;

    expect(manageDraft).toHaveBeenCalledTimes(1);
    const persistedRun1 = await runStore.getRunById(run1Id);
    expect(persistedRun1?.status).toBe("truncated");
    expect(persistedRun1?.terminalReason).toBe("run_timeout");
    const persistedAfterRun1 = await runStore.getCurrentTurnEventsForThread(
      threadId,
      turnId,
    );
    expect(
      persistedAfterRun1.some(
        (event) =>
          event.type === "auto_continue" && event.reason === "run_timeout",
      ),
    ).toBe(true);
    expect(JSON.stringify(persistedAfterRun1)).not.toContain(
      PRIVATE_DRAFT_CANARY,
    );

    const journalRead = await loadPriorTurnToolCallJournal(threadId, turnId);
    expect(journalRead.status).toBe("read");
    if (journalRead.status !== "read") return;

    const resumed = buildTurnResumeContext({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Save the draft and read it back" }],
        },
      ],
      journal: journalRead.toolCallJournal,
    });
    appendAgentLoopContinuation(resumed.messages, "run_timeout", {
      ...(resumed.journalNote ? { journalNote: resumed.journalNote } : {}),
    });

    let run2StreamCalls = 0;
    const run2Engine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        run2StreamCalls += 1;
        if (run2StreamCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "readback-call-checkpoint-2",
                name: "get-gmail-draft",
                input: { draftId: "draft-1" },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "text-delta",
          text: `Confirmed: ${PRIVATE_READBACK_CANARY}`,
        };
        yield {
          type: "assistant-content",
          parts: [
            { type: "text", text: `Confirmed: ${PRIVATE_READBACK_CANARY}` },
          ],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const run2LiveEvents: AgentChatEvent[] = [];
    const run2 = startRun(
      run2Id,
      threadId,
      async (send, signal) => {
        await runAgentLoop({
          engine: run2Engine,
          model: "synthetic",
          systemPrompt: "system",
          tools: [],
          messages: resumed.messages,
          actions,
          internalContinuation: true,
          threadId,
          turnId,
          runId: run2Id,
          send: (event) => {
            run2LiveEvents.push(event);
            return send(event);
          },
          signal,
        });
      },
      undefined,
      {
        turnId,
        softTimeoutMs: 0,
      },
    );
    await run2.finalized;

    expect(run2.status).toBe("completed");
    expect(getDraft).toHaveBeenCalledTimes(1);
    expect(setRunErrorSpy).not.toHaveBeenCalled();
    expect(run2LiveEvents.some((event) => event.type === "error")).toBe(false);
    expect(run2LiveEvents).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: `Confirmed: ${PRIVATE_READBACK_CANARY}`,
        omitFromPersistedHistory: true,
      }),
    );
    const persistedAfterRun2 = await runStore.getCurrentTurnEventsForThread(
      threadId,
      turnId,
    );
    expect(JSON.stringify(persistedAfterRun2)).not.toContain(
      PRIVATE_READBACK_CANARY,
    );
    expect(JSON.stringify(persistedAfterRun2)).not.toContain(
      PRIVATE_DRAFT_CANARY,
    );
  });

  it("blocks execution instead of falling through when private replay identity has conflicting outcomes", async () => {
    const { actions, manageDraft } = createPrivateMailActions();
    const threadId = "thread-private-ambiguous-replay";
    const turnId = "turn-private-ambiguous-replay";
    const run1Ledger = createPersistedLedgerRecorder();
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockImplementation(
      async () => [],
    );
    vi.spyOn(runStore, "recordThreadPrivateRun").mockResolvedValue(undefined);

    let seedCalls = 0;
    const seedEngine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        seedCalls += 1;
        if (seedCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "seed-call-1",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "ok" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    await runAgentLoop({
      engine: seedEngine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "draft" }] }],
      actions,
      threadId,
      turnId,
      runId: "run-ambiguous-seed",
      send: run1Ledger.record,
      signal: new AbortController().signal,
    });
    expect(manageDraft).toHaveBeenCalledTimes(1);
    manageDraft.mockClear();

    const persistedDone = run1Ledger.persistedEvents.find(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done" && event.tool === "manage-gmail-draft",
    );
    expect(persistedDone?.privateReplayIdentity).toMatch(
      /^hmac-v1:[a-f0-9]{64}$/,
    );
    const replayIdentity = persistedDone?.privateReplayIdentity;

    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockResolvedValue([
      {
        type: "tool_start",
        id: "prior-ok",
        tool: "manage-gmail-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "prior-ok",
        tool: "manage-gmail-draft",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        privateReplayIdentity: replayIdentity,
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_start",
        id: "prior-err",
        tool: "manage-gmail-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "prior-err",
        tool: "manage-gmail-draft",
        input: {},
        result: "[Private content omitted]",
        isError: true,
        completedSideEffect: true,
        privateReplayIdentity: replayIdentity,
        omitFromPersistedHistory: true,
      },
    ]);

    const resumeLedger = createPersistedLedgerRecorder();
    let resumeCalls = 0;
    const resumeEngine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        resumeCalls += 1;
        if (resumeCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "reissued-ambiguous",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "stopped" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine: resumeEngine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "continue draft" }] },
      ],
      actions,
      internalContinuation: true,
      threadId,
      turnId,
      runId: "run-ambiguous-resume",
      send: resumeLedger.record,
      signal: new AbortController().signal,
    });

    expect(manageDraft).not.toHaveBeenCalled();
    expect(resumeLedger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "reissued-ambiguous",
        tool: "manage-gmail-draft",
        isError: true,
        omitFromPersistedHistory: true,
      }),
    );
    expect(resumeLedger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        omitFromPersistedHistory: true,
      }),
    );
    expect(resumeLedger.persistedEvents).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        error: expect.stringContaining(
          "earlier attempt may have already saved",
        ),
        omitFromPersistedHistory: true,
      }),
    );
    expect(JSON.stringify(resumeLedger.persistedEvents)).not.toContain(
      PRIVATE_DRAFT_CANARY,
    );
  });

  it("replays cleanly when multiple committed private calls share the same HMAC identity and outcome", async () => {
    const { actions, manageDraft } = createPrivateMailActions();
    const threadId = "thread-private-matching-repeat";
    const turnId = "turn-private-matching-repeat";
    const seedLedger = createPersistedLedgerRecorder();
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockResolvedValue([]);
    vi.spyOn(runStore, "recordThreadPrivateRun").mockResolvedValue(undefined);

    let seedCalls = 0;
    const seedEngine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        seedCalls += 1;
        if (seedCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "seed-match-1",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "ok" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    await runAgentLoop({
      engine: seedEngine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "draft" }] }],
      actions,
      threadId,
      turnId,
      runId: "run-matching-seed",
      send: seedLedger.record,
      signal: new AbortController().signal,
    });
    manageDraft.mockClear();

    const replayIdentity = seedLedger.persistedEvents.find(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done" && event.tool === "manage-gmail-draft",
    )?.privateReplayIdentity;
    expect(replayIdentity).toMatch(/^hmac-v1:[a-f0-9]{64}$/);

    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockResolvedValue([
      {
        type: "tool_start",
        id: "prior-ok-1",
        tool: "manage-gmail-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "prior-ok-1",
        tool: "manage-gmail-draft",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        privateReplayIdentity: replayIdentity,
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_start",
        id: "prior-ok-2",
        tool: "manage-gmail-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "prior-ok-2",
        tool: "manage-gmail-draft",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        privateReplayIdentity: replayIdentity,
        omitFromPersistedHistory: true,
      },
    ]);

    const resumeLedger = createPersistedLedgerRecorder();
    let resumeCalls = 0;
    const resumeEngine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        resumeCalls += 1;
        if (resumeCalls === 1) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "reissued-matching",
                name: "manage-gmail-draft",
                input: { to: "alice@example.com", body: PRIVATE_DRAFT_CANARY },
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "done" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine: resumeEngine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "continue draft" }] },
      ],
      actions,
      internalContinuation: true,
      threadId,
      turnId,
      runId: "run-matching-resume",
      send: resumeLedger.record,
      signal: new AbortController().signal,
    });

    expect(manageDraft).not.toHaveBeenCalled();
    expect(resumeLedger.rawEvents.some((event) => event.type === "error")).toBe(
      false,
    );
    expect(resumeLedger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "reissued-matching",
        tool: "manage-gmail-draft",
        replayed: true,
        completedSideEffect: true,
        omitFromPersistedHistory: true,
      }),
    );
  });

  it("marks the resumed run private when an unreadable private journal stops the turn", async () => {
    const { actions } = createPrivateMailActions();
    vi.spyOn(runStore, "getCurrentTurnEventsForThread").mockResolvedValue([
      {
        type: "tool_start",
        id: "interrupted-private-call",
        tool: "manage-gmail-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
    ]);
    const recordPrivateSpy = vi
      .spyOn(runStore, "recordThreadPrivateRun")
      .mockResolvedValue(undefined);
    const ledger = createPersistedLedgerRecorder();

    const engine: AgentEngine = {
      name: "synthetic",
      label: "Synthetic",
      defaultModel: "synthetic",
      supportedModels: ["synthetic"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(_options: EngineStreamOptions): AsyncIterable<EngineEvent> {
        yield {
          type: "assistant-content",
          parts: [{ type: "text", text: "unreachable" }],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runAgentLoop({
      engine,
      model: "synthetic",
      systemPrompt: "system",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "continue" }] },
      ],
      actions,
      internalContinuation: true,
      threadId: "thread-unreadable-private",
      turnId: "turn-unreadable-private",
      runId: "run-unreadable-private",
      send: ledger.record,
      signal: new AbortController().signal,
    });

    expect(recordPrivateSpy).toHaveBeenCalledWith(
      "thread-unreadable-private",
      "run-unreadable-private",
    );
    expect(ledger.rawEvents).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "tool_call_journal_unreadable",
        omitFromPersistedHistory: true,
      }),
    );
    expect(ledger.persistedEvents).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "tool_call_journal_unreadable",
        error: expect.stringContaining("send the request again"),
        omitFromPersistedHistory: true,
      }),
    );
  });
});
