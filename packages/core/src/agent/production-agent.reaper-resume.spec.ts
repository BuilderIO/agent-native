import { mockEvent } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ActionContractError,
  AgentConnectionRequiredError,
  defineAction,
} from "../action.js";
import { runWithRequestContext } from "../server/request-context.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import type { AgentChatEvent } from "./types.js";

const ledger = vi.hoisted(() =>
  vi.fn(async (): Promise<AgentChatEvent[]> => []),
);
const threadRead = vi.hoisted(() =>
  vi.fn(async (): Promise<{ id: string; threadData: string } | null> => null),
);
vi.mock("../server/self-dispatch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/self-dispatch.js")>()),
  fireInternalDispatch: vi.fn(async () => {}),
}));
vi.mock("../chat-threads/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat-threads/store.js")>()),
  getThread: threadRead,
}));
vi.mock("./run-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-store.js")>()),
  getCurrentTurnEventsForThread: ledger,
}));

const { createProductionAgentHandler, AGENT_INTERNAL_CONTINUE_PROMPT } =
  await import("./production-agent.js");
const { insertRun, getRunByThread, getRunEventsSince } =
  await import("./run-store.js");
const EMAIL = { to: "customer@example.com", body: "Your refund is approved." };
const START: AgentChatEvent = {
  type: "tool_start",
  id: "email-1",
  tool: "send-email",
  input: EMAIL,
};
const DONE: AgentChatEvent = {
  type: "tool_done",
  id: "email-1",
  tool: "send-email",
  input: EMAIL,
  result: "Sent email receipt-1",
  completedSideEffect: true,
};
let sequence = 0;

beforeEach(() => {
  ledger.mockReset();
  threadRead.mockReset();
});

async function recover(
  events: AgentChatEvent[] | Error,
  ignoreContext: boolean | "after-read" | "verify-live" = false,
  isRecovery: boolean | "client" | "continuation" = true,
  failFinalization:
    | boolean
    | "serialization"
    | "action"
    | "validation"
    | "authorization"
    | "nested-authorization"
    | "nested-validation"
    | "access"
    | "precondition"
    | "connection" = false,
  resumeContinue?: "auto" | "manual",
  withAttachment = false,
) {
  sequence++;
  const threadId = `reaper-thread-${sequence}`;
  const turnId = `reaper-turn-${sequence}`;
  const runId = `reaper-run-${sequence}`;
  if (isRecovery !== "client") {
    await insertRun(runId, threadId, turnId, { dispatchMode: "background" });
  }
  if (events instanceof Error) ledger.mockRejectedValue(events);
  else ledger.mockResolvedValue(events);
  const seen: EngineMessage[][] = [];
  const sendEmail = vi.fn(async (_input: Record<string, unknown>) => {
    if (failFinalization === "precondition")
      throw new ActionContractError("Account is not enabled", {
        errorCode: "permanent_precondition",
      });
    if (failFinalization === "connection")
      throw new AgentConnectionRequiredError("Connect the email provider", {
        provider: "test-email",
      });
    if (failFinalization === "action")
      throw new Error("connection reset after send");
    if (failFinalization === "serialization") {
      const result: Record<string, unknown> = {};
      result.self = result;
      return result;
    }
    return "Sent a second email";
  });
  const checkEmail = vi.fn(async () => "Provider receipt is inconclusive");
  const engine: AgentEngine = {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: withAttachment,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(options): AsyncIterable<EngineEvent> {
      seen.push(structuredClone(options.messages));
      const context = JSON.stringify(options.messages);
      if (ignoreContext === "verify-live" && seen.length <= 4) {
        const read = seen.length % 2 === 1;
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call",
              id: `live-${seen.length}`,
              name: read ? "check-email" : "send-email",
              input: read
                ? {}
                : {
                    ...EMAIL,
                    body:
                      seen.length === 2
                        ? EMAIL.body
                        : "Your refund has been approved.",
                  },
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      if (ignoreContext === "after-read" && seen.length === 1) {
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call",
              id: "check-1",
              name: "check-email",
              input: {},
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      if (
        seen.length === (ignoreContext === "after-read" ? 2 : 1) &&
        (ignoreContext || !context.includes("Tool-call journal"))
      ) {
        yield {
          type: "assistant-content",
          parts: [
            {
              type: "tool-call",
              id: "email-2",
              name: "send-email",
              input:
                isRecovery === true || isRecovery === "continuation"
                  ? { ...EMAIL, body: "Your refund has been approved." }
                  : EMAIL,
            },
          ],
        };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      yield {
        type: "assistant-content",
        parts: [
          {
            type: "text",
            text: context.includes("unknown outcome")
              ? "Check the provider receipt before retrying the email."
              : "Reuse the sent email and finish the refund.",
          },
        ],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
  const handler = createProductionAgentHandler({
    systemPrompt: "Test",
    assertAiSetupReady: async () => {},
    engine,
    skipFilesContext: true,
    runSoftTimeoutMs: 60_000,
    actions: {
      "check-email": {
        tool: {
          description: "Check email receipt",
          parameters: { type: "object", properties: {} },
        },
        readOnly: true,
        run: checkEmail,
      },
      "send-email": {
        tool: {
          description: "Send email",
          parameters: { type: "object", properties: {} },
        },
        readOnly: false,
        run: sendEmail,
        ...(failFinalization === "validation"
          ? defineAction({
              description: "Send email",
              readOnly: false,
              schema: z
                .object({ to: z.string(), body: z.string() })
                .refine(() => false, "Recipient is not eligible"),
              run: sendEmail,
            })
          : {}),
        ...(failFinalization === "nested-authorization" ||
        failFinalization === "nested-validation"
          ? defineAction({
              description: "Send then call another action",
              readOnly: false,
              schema: z.object({ to: z.string(), body: z.string() }),
              run: async (input, ctx) => {
                await sendEmail(input);
                const child = defineAction({
                  description: "Refused child",
                  schema: z
                    .object({})
                    .refine(
                      () => failFinalization !== "nested-validation",
                      "Child validation failed",
                    ),
                  authorize: () => false,
                  run: async () => "unreachable",
                });
                return child.run({}, ctx);
              },
            })
          : {}),
        ...(failFinalization === "authorization" ||
        failFinalization === "access"
          ? defineAction({
              description: "Send email",
              readOnly: false,
              schema: z.object({ to: z.string(), body: z.string() }),
              ...(failFinalization === "authorization"
                ? { authorize: () => false }
                : { access: { scope: "app" as const } }),
              run: sendEmail,
            })
          : {}),
        ...(failFinalization === true
          ? {
              fileMutationProof: () => {
                throw new Error("proof unavailable");
              },
            }
          : {}),
      },
    },
  });
  const requestBody = {
    message: resumeContinue
      ? AGENT_INTERNAL_CONTINUE_PROMPT
      : "Send the refund email, then finish the refund.",
    threadId,
    turnId,
    ...(isRecovery === true || isRecovery === "continuation"
      ? { internalContinuation: true }
      : {}),
    ...(isRecovery === true || isRecovery === "client"
      ? { __agentChatRecoveryOfRunId: "dead-worker" }
      : {}),
    ...(isRecovery !== "client"
      ? {
          __backgroundRun: {
            runId,
            turnId,
            payloadRef: true,
            ...(isRecovery === "continuation"
              ? { continuationCount: 1, continuationReason: "run_timeout" }
              : {}),
          },
        }
      : {}),
    ...(withAttachment
      ? {
          attachments: [
            {
              type: "image",
              name: "receipt.png",
              contentType: "image/png",
              data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VEAAAAAASUVORK5CYII=",
            },
          ],
        }
      : {}),
    ...(resumeContinue === "auto"
      ? { autoContinueOfRunId: "stopped-run" }
      : {}),
    ...(resumeContinue === "manual" ? { continueOfRunId: "stopped-run" } : {}),
  };
  if (resumeContinue || isRecovery === "continuation") {
    const { buildUserMessage, buildAssistantMessage } =
      await import("./thread-data-builder.js");
    threadRead.mockResolvedValue({
      id: threadId,
      threadData: JSON.stringify({
        messages: [
          {
            message: buildUserMessage({
              text: "Send the refund email, then finish the refund.",
              turnId,
            }),
          },
          {
            message: buildAssistantMessage(
              (isRecovery === "continuation" && !(events instanceof Error)
                ? events
                : [START, DONE]
              ).map((event, seq) => ({ event, seq })),
              "stopped-run",
            ),
          },
        ],
      }),
    });
  }
  const event = mockEvent(
    new Request("http://app.example.com/_agent-native/agent-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  // The body after the process-run route rehydrates a reaper successor's payloadRef.
  event.context.__agentChatBackgroundBody = requestBody;
  const response = await runWithRequestContext(
    { userEmail: "alice@example.com", orgId: "test-org", run: {} },
    () => handler(event),
  );
  if (response instanceof ReadableStream) await new Response(response).text();
  await vi.waitFor(
    async () => {
      if (failFinalization === "connection") {
        expect(
          (await getRunEventsSince(runId, -1)).some(
            ({ eventData }) => JSON.parse(eventData).type === "tool_done",
          ),
        ).toBe(true);
        return;
      }
      expect(
        (await getRunByThread(threadId, { includeTerminal: true }))?.status,
      ).not.toBe("running");
    },
    { timeout: 15_000 },
  );
  return {
    seen,
    requestBody,
    sendEmail,
    checkEmail,
    response,
    threadId,
    turnId,
    runId,
    run: await getRunByThread(threadId, { includeTerminal: true }),
  };
}

describe("reaper successor resume context", () => {
  it("retains one attachment and keeps a reworded unknown write blocked", async () => {
    const result = await recover([START], true, true, false, undefined, true);
    expect(result.sendEmail).not.toHaveBeenCalled();
    expect(result.run?.terminalReason).toBe("error:write_tool_outcome_unknown");
    const parts = result.seen[0]!.flatMap(({ content }) => content);
    expect(parts.filter((part) => part.type === "image")).toHaveLength(1);
    expect(result.seen[0]!.at(-1)?.content[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining(AGENT_INTERNAL_CONTINUE_PROMPT),
      }),
    );
  });

  it("blocks the same write tool after an ambiguous error at an ordinary continuation boundary", async () => {
    const result = await recover(
      [
        START,
        {
          ...DONE,
          isError: true,
          completedSideEffect: undefined,
          outcomeUnknown: true,
          result: "Connection reset after send",
        },
        { type: "auto_continue", reason: "run_timeout" },
      ],
      true,
      "continuation",
    );
    expect(result.sendEmail).not.toHaveBeenCalled();
    expect(result.run?.terminalReason).toBe("error:write_tool_outcome_unknown");
  });
  it.each([
    "validation",
    "precondition",
    "connection",
    "authorization",
    "access",
  ] as const)(
    "keeps a typed pre-execution refusal distinct from an unknown write (%s)",
    async (failure) => {
      const first = await recover([], false, false, failure);
      if (
        failure === "validation" ||
        failure === "authorization" ||
        failure === "access"
      )
        expect(first.sendEmail).not.toHaveBeenCalled();
      const events = (await getRunEventsSince(first.runId, -1)).map(
        ({ eventData }) => JSON.parse(eventData) as AgentChatEvent,
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool_done",
          completedSideEffect: false,
        }),
      );
      expect(
        events
          .filter((event) => event.type === "tool_done")
          .some((event) => event.outcomeUnknown),
      ).toBe(false);
      const next = await recover(events, true);
      expect(next.sendEmail).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "action",
    "serialization",
    "nested-authorization",
    "nested-validation",
  ] as const)(
    "refreshes verification reads and blocks a reworded retry after a live unknown write (%s)",
    async (failure) => {
      const result = await recover([], "verify-live", false, failure);
      expect(result.sendEmail).toHaveBeenCalledTimes(1);
      expect(result.checkEmail).toHaveBeenCalledTimes(2);
      expect(result.run?.terminalReason).toBe(
        "error:write_tool_outcome_unknown",
      );
    },
  );
  it.each(["auto", "manual"] as const)(
    "recovers a killed %s continuation with its original prompt and unique tool ids",
    async (trigger) => {
      const result = await recover([START, DONE], false, true, false, trigger);
      expect(JSON.stringify(result.seen[0])).toContain(
        "Send the refund email, then finish the refund.",
      );
      const calls = result.seen[0]!.flatMap(({ content }) => content).filter(
        (p) => p.type === "tool-call",
      );
      expect(calls).toHaveLength(1);
      expect(result.sendEmail).not.toHaveBeenCalled();
    },
  );
  it("omits the dead worker's recoverable terminal error while retaining its completed results", async () => {
    const result = await recover([
      START,
      DONE,
      {
        type: "error",
        error: "The agent stopped before it could finish",
        errorCode: "stale_run",
        recoverable: true,
      },
    ]);
    expect(JSON.stringify(result.seen[0])).not.toContain(
      "The agent stopped before it could finish",
    );
    expect(JSON.stringify(result.seen[0])).toContain(DONE.result);
    expect(result.sendEmail).not.toHaveBeenCalled();
  });

  it.each([true, "serialization", "action"] as const)(
    "keeps a write unknown after post-call processing fails (%s) and blocks a reworded recovery",
    async (failure) => {
      const first = await recover([], false, false, failure);
      expect(first.sendEmail).toHaveBeenCalledTimes(1);
      expect(first.sendEmail.mock.calls[0]?.[0]).toEqual(EMAIL);
      const events = (await getRunEventsSince(first.runId, -1)).map(
        ({ eventData }) => JSON.parse(eventData) as AgentChatEvent,
      );
      const next = await recover(events, true);
      expect(next.sendEmail).not.toHaveBeenCalled();
      expect(events).toContainEqual(
        expect.objectContaining({ type: "tool_done", outcomeUnknown: true }),
      );
      expect(JSON.stringify(next.seen[0])).toContain(
        "Interrupted / unknown outcome",
      );
      expect(next.run?.terminalReason).toBe("error:write_tool_outcome_unknown");
    },
  );
  it("strips a client recovery marker before it can become a trusted dispatch payload", async () => {
    const result = await recover([], false, "client");
    expect(result.requestBody).not.toHaveProperty("__agentChatRecoveryOfRunId");
    expect(result.sendEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.seen[0])).not.toContain(
      AGENT_INTERNAL_CONTINUE_PROMPT,
    );
  });
  it("leaves an initial background worker as a fresh request", async () => {
    const result = await recover([], false, false);
    expect(result.sendEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.seen[0])).not.toContain(
      AGENT_INTERNAL_CONTINUE_PROMPT,
    );
  });
  it("reuses ledger-only completions even when a retry would reword the email", async () => {
    const result = await recover([START, DONE]);
    expect(result.sendEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(result.seen[0])).toContain("do NOT re-run these");
    expect(
      result.seen[0]!.some((m) =>
        m.content.some(
          (p) => p.type === "tool-result" && p.content === DONE.result,
        ),
      ),
    ).toBe(true);
    const last = result.seen[0]!.at(-1)!;
    expect(last.content[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining(AGENT_INTERNAL_CONTINUE_PROMPT),
      }),
    );
    expect(ledger).toHaveBeenCalledWith(result.threadId, result.turnId);
  });

  it.each(["single", "stale", "multi-hop", "earlier-stop"])(
    "pairs an unknown email with an interrupted result before recovery (%s)",
    async (boundary) => {
      const events: AgentChatEvent[] = [START];
      if (boundary === "earlier-stop")
        events.unshift({ type: "done", reason: "user" });
      if (boundary === "multi-hop")
        events.unshift({ type: "auto_continue", reason: "run_timeout" });
      if (boundary !== "single")
        events.push({
          type: "error",
          error: "The agent stopped before it could finish",
          errorCode: "stale_run",
          recoverable: true,
        });
      const result = await recover(events);
      expect(result.sendEmail).not.toHaveBeenCalled();
      const context = JSON.stringify(result.seen[0]);
      expect(context).toContain("Interrupted / unknown outcome");
      expect(context).toContain("verify state first");
      expect(context).toContain(
        "Interrupted before this tool returned a result.",
      );
      expect(context).not.toContain("Stopped before this action started.");
      const parts = result.seen[0]!.flatMap(({ content }) => content);
      for (const part of parts) {
        if (part.type === "tool-call")
          expect(parts).toContainEqual(
            expect.objectContaining({
              type: "tool-result",
              toolCallId: part.id,
            }),
          );
      }
    },
  );

  it("fails safely instead of replaying the request when the ledger cannot be read", async () => {
    const result = await recover(new Error("ledger unavailable"));
    expect(result.seen).toEqual([]);
    expect(result.sendEmail).not.toHaveBeenCalled();
    expect(result.response).toEqual(
      expect.objectContaining({ code: "recovery_history_unreadable" }),
    );
    expect(result.run?.terminalReason).toBe("recovery_history_unreadable");
  });

  it("stops a reworded retry of an unknown write even if the model ignores the note", async () => {
    const result = await recover([START], true);
    expect(result.sendEmail).not.toHaveBeenCalled();
    expect(result.run?.terminalReason).toBe("error:write_tool_outcome_unknown");
  });

  it("keeps an unknown write blocked after a verification read", async () => {
    const result = await recover([START], "after-read");
    expect(result.checkEmail).toHaveBeenCalledTimes(1);
    expect(result.sendEmail).not.toHaveBeenCalled();
    expect(result.run?.terminalReason).toBe("error:write_tool_outcome_unknown");
  });

  it("preserves an unknown write across a draft clear and tool-history elision", async () => {
    const largeInput = { query: "x".repeat(80_000) };
    const result = await recover(
      [
        START,
        { type: "clear" },
        {
          type: "tool_start",
          id: "large-read",
          tool: "check-email",
          input: largeInput,
        },
        {
          type: "tool_done",
          id: "large-read",
          tool: "check-email",
          input: largeInput,
          result: "Provider receipt is inconclusive",
        },
      ],
      true,
    );
    expect(
      result.seen[0]!.flatMap((message) => message.content).some(
        (part) => part.type === "tool-result",
      ),
    ).toBe(false);
    expect(result.sendEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(result.seen[0])).toContain(
      "Interrupted / unknown outcome",
    );
    expect(result.run?.terminalReason).toBe("error:write_tool_outcome_unknown");
  });
});
