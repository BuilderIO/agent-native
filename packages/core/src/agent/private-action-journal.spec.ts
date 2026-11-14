import { beforeEach, describe, expect, it, vi } from "vitest";

import { defineAction } from "../action.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineStreamOptions,
} from "./engine/types.js";
import { withExecutionFence } from "./execution-fence.js";
import type { AgentChatEvent } from "./types.js";

/**
 * Canary coverage for the private-action journal boundary.
 *
 * The live engine must still receive a private read body and a body-derived
 * follow-up (otherwise the "omission" assertions below would pass on a run
 * that simply dropped the content). The durable writer boundary, however,
 * must only ever see an HMAC-only step input and the fixed
 * "[Private content omitted]" outcome, with no raw error, artifact, receipt,
 * MCP app, file mutation, or chatUI payload.
 */
const writers = vi.hoisted(() => ({
  beginAgentExecutionStep: vi.fn(),
  completeAgentExecutionStep: vi.fn(),
  recordLateAgentExecutionStepOutcome: vi.fn(),
  recordThreadPrivateRun: vi.fn(),
  getCurrentTurnEventsForThread: vi.fn(async () => [] as unknown[]),
  getCompletedAgentExecutionSteps: vi.fn(async () => []),
}));

vi.mock("./run-store.js", async (loadActual) => {
  const actual = await loadActual<typeof import("./run-store.js")>();
  return {
    ...actual,
    beginAgentExecutionStep: writers.beginAgentExecutionStep,
    completeAgentExecutionStep: writers.completeAgentExecutionStep,
    recordLateAgentExecutionStepOutcome:
      writers.recordLateAgentExecutionStepOutcome,
    recordThreadPrivateRun: writers.recordThreadPrivateRun,
    getCurrentTurnEventsForThread: writers.getCurrentTurnEventsForThread,
    getCompletedAgentExecutionSteps: writers.getCompletedAgentExecutionSteps,
    markAgentExecutionStepDispatched: vi.fn(async () => {}),
    resetAgentExecutionStepBeforeInvocation: vi.fn(async () => {}),
    markAgentExecutionStepUnknown: vi.fn(async () => {}),
  };
});

const { runAgentLoop } = await import("./production-agent.js");

const fence = {
  threadId: "thread-canary.test",
  turnId: "turn-canary.test",
  runId: "run-canary.test",
  generation: "3",
};

const PRIVATE_BODY_CANARY = "SYNTHETIC_PRIVATE_BODY_CANARY_7c1f9a";
const DERIVED_CANARY = `DERIVED_FOLLOWUP_CANARY_${PRIVATE_BODY_CANARY}`;
const PUBLIC_PAYLOAD_CANARY = "SYNTHETIC_PUBLIC_PAYLOAD_CANARY_42b8d0";

const HMAC_IDENTITY = /^hmac-v1:[a-f0-9]{64}$/;

function scriptedEngine(
  turns: EngineContentPart[][],
  seenMessages: string[],
): AgentEngine {
  let streamCall = 0;
  return {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(options: EngineStreamOptions): AsyncIterable<EngineEvent> {
      seenMessages.push(JSON.stringify(options.messages));
      const parts = turns[streamCall++] ?? [
        { type: "text" as const, text: "done" },
      ];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: parts.some((part) => part.type === "tool-call")
          ? "tool_use"
          : "end_turn",
      };
    },
  };
}

const toolCall = (
  id: string,
  name: string,
  input: Record<string, unknown>,
): EngineContentPart => ({ type: "tool-call", id, name, input });

const text = (value: string): EngineContentPart => ({
  type: "text",
  text: value,
});

function parseJson(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe("string");
  return JSON.parse(value as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  writers.beginAgentExecutionStep.mockResolvedValue({
    status: "execute",
    wasDispatched: false,
  });
  writers.completeAgentExecutionStep.mockResolvedValue(undefined);
  writers.recordLateAgentExecutionStepOutcome.mockResolvedValue(undefined);
  writers.recordThreadPrivateRun.mockResolvedValue(undefined);
});

describe("private action journal canary", () => {
  it("writes HMAC-only intent and a fixed omitted outcome for a private read and its body-derived follow-up", async () => {
    const readRun = vi.fn(
      async (_args: { threadId: string }) => PRIVATE_BODY_CANARY,
    );
    const followupRun = vi.fn(
      async (_args: { bodyText: string }) => DERIVED_CANARY,
    );
    const failRun = vi.fn(async (_args: { reason: string }) => {
      throw new Error(DERIVED_CANARY);
    });

    const privateRead = defineAction({
      description: "Synthetic private read",
      parameters: { threadId: { type: "string" } },
      readOnly: true,
      persistInChatHistory: false,
      chatUI: {
        renderer: "synthetic-private-read-renderer",
        projectResult: (_args, result) => result,
      },
      run: readRun,
    });
    const followup = defineAction({
      description: "Synthetic follow-up draft",
      parameters: { bodyText: { type: "string" } },
      chatUI: {
        renderer: "synthetic-followup-renderer",
        projectResult: (_args, result) => result,
      },
      run: followupRun,
    });
    const privateFail = defineAction({
      description: "Synthetic private failure",
      parameters: { reason: { type: "string" } },
      readOnly: true,
      persistInChatHistory: false,
      run: failRun,
    });

    const actions = loadActionsFromStaticRegistry({
      "synthetic-private-read": { default: privateRead },
      "synthetic-followup-draft": { default: followup },
      "synthetic-private-fail": { default: privateFail },
    });

    const seenMessages: string[] = [];
    const engine = scriptedEngine(
      [
        [
          toolCall("read-1", "synthetic-private-read", {
            threadId: "thread-canary.test",
          }),
        ],
        [
          toolCall("draft-1", "synthetic-followup-draft", {
            bodyText: PRIVATE_BODY_CANARY,
          }),
        ],
        [
          toolCall("fail-1", "synthetic-private-fail", {
            reason: DERIVED_CANARY,
          }),
        ],
        [text("done")],
      ],
      seenMessages,
    );

    const events: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions,
        threadId: fence.threadId,
        turnId: fence.turnId,
        runId: fence.runId,
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      }),
    );

    // Provenance proof resolved successfully (no private-history failure).
    expect(writers.recordThreadPrivateRun).toHaveBeenCalledWith(
      fence.threadId,
      fence.runId,
    );

    // The live engine genuinely saw the body and the follow-up ran with it.
    expect(readRun.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-canary.test",
    });
    expect(followupRun.mock.calls[0]?.[0]).toEqual({
      bodyText: PRIVATE_BODY_CANARY,
    });
    expect(JSON.stringify(seenMessages)).toContain(PRIVATE_BODY_CANARY);
    expect(seenMessages.length).toBeGreaterThanOrEqual(4);

    // Durable writer boundary: begin gets an HMAC-only step input.
    const beginCalls = writers.beginAgentExecutionStep.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(beginCalls).toHaveLength(3);
    for (const [intent] of beginCalls) {
      const input = parseJson(intent.inputJson);
      expect(Object.keys(input).sort()).toEqual([
        "identity",
        "omitFromPersistedHistory",
      ]);
      expect(input.omitFromPersistedHistory).toBe(true);
      expect(input.identity).toMatch(HMAC_IDENTITY);
      expect(input).not.toHaveProperty("input");
      expect(typeof intent.stepId).toBe("string");
      expect((intent.stepId as string).length).toBeGreaterThan(0);
    }

    // Durable writer boundary: complete gets the fixed omitted outcome and no raw error.
    const completeCalls = writers.completeAgentExecutionStep.mock
      .calls as Array<[Record<string, unknown>, string, string | undefined]>;
    expect(completeCalls).toHaveLength(3);
    let sawError = false;
    for (const [, resultJson, errorJson] of completeCalls) {
      const outcome = parseJson(resultJson);
      expect(outcome.result).toBe("[Private content omitted]");
      expect(outcome).not.toHaveProperty("chatUI");
      expect(outcome).not.toHaveProperty("chatUIResult");
      expect(outcome).not.toHaveProperty("artifacts");
      expect(outcome).not.toHaveProperty("receipt");
      expect(outcome).not.toHaveProperty("mcpApp");
      expect(outcome).not.toHaveProperty("fileMutation");
      expect(outcome).not.toHaveProperty("errorCode");
      expect(errorJson).toBeUndefined();
      if (outcome.isError === true) sawError = true;
    }
    expect(sawError).toBe(true);

    // No private body or derived text crosses the durable writer boundary.
    const journalWrites = JSON.stringify([
      writers.beginAgentExecutionStep.mock.calls,
      writers.completeAgentExecutionStep.mock.calls,
      writers.recordLateAgentExecutionStepOutcome.mock.calls,
      writers.recordThreadPrivateRun.mock.calls,
    ]);
    expect(journalWrites).not.toContain(PRIVATE_BODY_CANARY);
    expect(journalWrites).not.toContain(DERIVED_CANARY);

    expect(writers.recordLateAgentExecutionStepOutcome).not.toHaveBeenCalled();
  });

  it("keeps the intended payload at the durable writer boundary for a public action", async () => {
    const publicRun = vi.fn(async () =>
      JSON.stringify({ marker: PUBLIC_PAYLOAD_CANARY }),
    );
    const publicAction = defineAction({
      description: "Synthetic public read",
      parameters: { value: { type: "string" } },
      readOnly: true,
      chatUI: {
        renderer: "synthetic-public-renderer",
        projectResult: () => ({ projected: PUBLIC_PAYLOAD_CANARY }),
      },
      run: publicRun,
    });
    const actions = loadActionsFromStaticRegistry({
      "synthetic-public-read": { default: publicAction },
    });

    const engine = scriptedEngine(
      [
        [
          toolCall("public-1", "synthetic-public-read", {
            value: PUBLIC_PAYLOAD_CANARY,
          }),
        ],
        [text("done")],
      ],
      [],
    );

    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
        actions,
        threadId: fence.threadId,
        turnId: fence.turnId,
        runId: fence.runId,
        send: () => {},
        signal: new AbortController().signal,
      }),
    );

    expect(writers.recordThreadPrivateRun).not.toHaveBeenCalled();

    const [[intent]] = writers.beginAgentExecutionStep.mock.calls as Array<
      [Record<string, unknown>]
    >;
    const input = parseJson(intent.inputJson);
    expect(input.omitFromPersistedHistory).toBeUndefined();
    expect(input).toHaveProperty("input");
    expect(JSON.stringify(input.input)).toContain(PUBLIC_PAYLOAD_CANARY);

    const [[, resultJson]] = writers.completeAgentExecutionStep.mock
      .calls as Array<[Record<string, unknown>, string]>;
    const outcome = parseJson(resultJson);
    expect(JSON.stringify(outcome.result)).toContain(PUBLIC_PAYLOAD_CANARY);
    expect(outcome.chatUI).toBeDefined();
    expect(JSON.stringify(outcome.chatUIResult)).toContain(
      PUBLIC_PAYLOAD_CANARY,
    );
  });
});
