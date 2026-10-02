import { mockEvent } from "h3";
import { describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import { AUTO_CONTINUE_PROMPT } from "./auto-continue.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";

const claimRunSlot = vi.hoisted(() => vi.fn());
const turnLedger = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
const endRun = vi.hoisted(() => vi.fn());
const setTerminalReason = vi.hoisted(() => vi.fn());

const DELEGATION = {
  agent: "analytics",
  message: "Count last week's signups",
};

vi.mock("./run-manager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-manager.js")>()),
  tryClaimRunSlot: claimRunSlot,
  getSlotHoldingRunId: vi.fn(async () => undefined),
}));

vi.mock("./run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-store.js")>();
  endRun.mockImplementation(actual.updateRunStatusIfRunning);
  setTerminalReason.mockImplementation(actual.setRunTerminalReason);
  return {
    ...actual,
    getCurrentTurnEventsForThread: turnLedger,
    updateRunStatusIfRunning: endRun,
    setRunTerminalReason: setTerminalReason,
  };
});

vi.mock("../chat-threads/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat-threads/store.js")>()),
  // The thread as the stopped run left it: the delegation and its result.
  getThread: vi.fn(async (id: string) => ({
    id,
    threadData: JSON.stringify({
      messages: [
        {
          message: {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "How many signups last week?" }],
          },
        },
        {
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [
              { type: "text", text: "Checking." },
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "call-agent",
                args: DELEGATION,
                result: "412 signups",
              },
            ],
          },
        },
      ],
    }),
  })),
}));

const { AGENT_INTERNAL_CONTINUE_PROMPT, createProductionAgentHandler } =
  await import("./production-agent.js");
const { createCallAgentScriptEntry } =
  await import("../server/agent-chat/script-entries.js");
const { getThread } = await import("../chat-threads/store.js");
const actualRunStore =
  await vi.importActual<typeof import("./run-store.js")>("./run-store.js");

const FINISHED_DELEGATION = [
  { type: "tool_start", tool: "call-agent", id: "call-1", input: DELEGATION },
  {
    type: "tool_done",
    tool: "call-agent",
    id: "call-1",
    input: DELEGATION,
    result: "412 signups",
    completedSideEffect: true,
  },
];

function repeatingDelegationEngine(seen: EngineMessage[][]): AgentEngine {
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
    async *stream(options): AsyncIterable<EngineEvent> {
      seen.push(structuredClone(options.messages));
      if (seen.length === 1) {
        // The model asks for the same delegation the stopped run finished.
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call",
              id: "call-again",
              name: "call-agent",
              input: DELEGATION,
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "There were 412 signups." }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

function autoContinueRequest() {
  return mockEvent(
    new Request("http://app.example.com/_agent-native/agent-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: AUTO_CONTINUE_PROMPT,
        threadId: "thread-auto",
        turnId: "turn-auto",
        internalContinuation: true,
        autoContinueOfRunId: "run-stopped",
      }),
    }),
  );
}

function textOf(message: EngineMessage | undefined): string {
  return (message?.content ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

describe("an automatic continuation request", () => {
  it("is admitted against the stopped run in its own turn, and a refusal is typed", async () => {
    claimRunSlot.mockReset();
    claimRunSlot.mockResolvedValueOnce({
      claimed: false,
      activeRunId: null,
      autoContinueRefused: "auto_continue_cap_reached",
    });
    const seen: EngineMessage[][] = [];
    const handler = createProductionAgentHandler({
      systemPrompt: "Test",
      engine: repeatingDelegationEngine(seen),
      actions: {},
    });
    const event = autoContinueRequest();

    const result = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme", run: {} },
      () => handler(event),
    );

    expect(claimRunSlot).toHaveBeenCalledWith(
      "thread-auto",
      expect.any(String),
      undefined,
      expect.objectContaining({
        turnId: "turn-auto",
        autoContinueOf: "run-stopped",
      }),
    );
    expect(event.res.status).toBe(409);
    expect(result).toEqual({
      error: "This turn will not continue automatically.",
      code: "auto_continue_cap_reached",
      retryable: false,
    });
    expect(seen).toEqual([]);
  });

  it("resumes with the finished delegation in context and never sends it again", async () => {
    claimRunSlot.mockReset();
    claimRunSlot.mockResolvedValue({ claimed: true, activeRunId: null });
    turnLedger.mockResolvedValue(FINISHED_DELEGATION);
    const callAgent = (await createCallAgentScriptEntry())["call-agent"]!;
    const sendAgain = vi.fn(async () => "a second remote task");
    const seen: EngineMessage[][] = [];
    const handler = createProductionAgentHandler({
      systemPrompt: "Test",
      engine: repeatingDelegationEngine(seen),
      actions: { "call-agent": { ...callAgent, run: sendAgain } },
    });

    const response = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme", run: {} },
      () => handler(autoContinueRequest()),
    );
    const stream = await new Response(response as ReadableStream).text();

    expect(turnLedger).toHaveBeenCalledWith("thread-auto", "turn-auto");
    const resumed = seen[0]!;
    const continuePrompt = textOf(resumed.at(-1));
    expect(resumed.at(-1)?.role).toBe("user");
    expect(continuePrompt.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT)).toBe(
      true,
    );
    expect(continuePrompt).toContain("do NOT re-run these");
    expect(continuePrompt).toContain("call-agent");
    expect(continuePrompt).toContain("412 signups");
    expect(
      resumed.some((message) =>
        message.content.some(
          (part) =>
            part.type === "tool-result" &&
            part.toolName === "call-agent" &&
            JSON.stringify(part.content).includes("412 signups"),
        ),
      ),
    ).toBe(true);
    expect(sendAgain).not.toHaveBeenCalled();
    expect(stream).toContain('"replayed":true');
    expect(stream).toContain("There were 412 signups.");
  });

  it.each([
    [
      "thread cannot be read",
      () => {
        turnLedger.mockResolvedValue(FINISHED_DELEGATION);
        vi.mocked(getThread).mockRejectedValueOnce(
          new Error("Connection terminated"),
        );
      },
    ],
    [
      "run journal cannot be read",
      () => turnLedger.mockRejectedValue(new Error("Connection terminated")),
    ],
    // A continuation always follows a stopped run, so its thread must exist.
    [
      "thread is missing",
      () => {
        turnLedger.mockResolvedValue(FINISHED_DELEGATION);
        vi.mocked(getThread).mockResolvedValueOnce(null);
      },
    ],
    [
      "thread has no messages",
      () => {
        turnLedger.mockResolvedValue(FINISHED_DELEGATION);
        vi.mocked(getThread).mockResolvedValueOnce({
          id: "thread-auto",
          threadData: JSON.stringify({ messages: [] }),
        } as Awaited<ReturnType<typeof getThread>>);
      },
    ],
  ])(
    "fails retryably and runs nothing when the stopped turn's %s",
    async (_, breakRead) => {
      claimRunSlot.mockReset();
      claimRunSlot.mockResolvedValue({ claimed: true, activeRunId: null });
      turnLedger.mockReset();
      breakRead();
      // The slot claim is mocked, so there is no row for the real update.
      endRun.mockResolvedValue(true);
      const callAgent = (await createCallAgentScriptEntry())["call-agent"]!;
      const sendAgain = vi.fn(async () => "a second remote task");
      const seen: EngineMessage[][] = [];
      const handler = createProductionAgentHandler({
        systemPrompt: "Test",
        engine: repeatingDelegationEngine(seen),
        actions: { "call-agent": { ...callAgent, run: sendAgain } },
      });
      const event = autoContinueRequest();

      const result = await runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "acme", run: {} },
        () => handler(event),
      );
      endRun.mockImplementation(actualRunStore.updateRunStatusIfRunning);
      turnLedger.mockReset();

      // The browser reads the turn's newest run, so the claimed run carries
      // the reason a reload or a second tab is told too.
      const runId = claimRunSlot.mock.calls[0]![1];
      expect(event.res.status).toBe(503);
      expect(result).toEqual({
        error: expect.any(String),
        code: "auto_continue_history_unreadable",
        retryable: true,
      });
      expect(seen).toEqual([]);
      expect(sendAgain).not.toHaveBeenCalled();
      expect(endRun).toHaveBeenCalledWith(runId, "errored");
      expect(setTerminalReason).toHaveBeenCalledWith(
        runId,
        "auto_continue_history_unreadable",
      );
    },
  );

  it.each([
    [
      "cannot be read",
      "unreadable",
      () =>
        vi
          .mocked(getThread)
          .mockRejectedValueOnce(new Error("Connection terminated")),
    ],
    [
      "is missing",
      "missing",
      () => vi.mocked(getThread).mockResolvedValueOnce(null),
    ],
  ])(
    "still resumes a server successor from the request when the thread %s",
    async (_, id, breakRead) => {
      breakRead();
      const seen: EngineMessage[][] = [];
      const handler = createProductionAgentHandler({
        systemPrompt: "Test",
        engine: {
          ...repeatingDelegationEngine([]),
          async *stream(options): AsyncIterable<EngineEvent> {
            seen.push(structuredClone(options.messages));
            yield {
              type: "assistant-content",
              parts: [{ type: "text", text: "Summarized." }],
            };
            yield { type: "stop", reason: "end_turn" };
          },
        },
        actions: {},
        // A successor's chunk budget; without one it goes straight to the next.
        runSoftTimeoutMs: 60_000,
      });
      const event = mockEvent(
        new Request("http://app.example.com/_agent-native/agent-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      event.context.__agentChatBackgroundBody = {
        message: "Summarize the signups.",
        threadId: `thread-chained-${id}`,
        turnId: `turn-chained-${id}`,
        __backgroundRun: {
          runId: `run-chained-${id}`,
          turnId: `turn-chained-${id}`,
          continuationCount: 1,
        },
      };

      const response = await runWithRequestContext(
        { userEmail: "alice@example.com", orgId: "acme", run: {} },
        () => handler(event),
      );
      if (response instanceof ReadableStream) {
        await new Response(response).text();
      }

      await vi.waitFor(() => expect(seen[0]).toBeDefined());
      expect(textOf(seen[0]!.at(-1))).toMatch(/^Summarize the signups\./);
    },
  );
});
