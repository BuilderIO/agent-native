import { mockEvent } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./run-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-store.js")>()),
  getCurrentTurnEventsForThread: ledger,
}));

const { createProductionAgentHandler, AGENT_INTERNAL_CONTINUE_PROMPT } =
  await import("./production-agent.js");
const { insertRun, getRunByThread } = await import("./run-store.js");
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
});

async function recover(
  events: AgentChatEvent[] | Error,
  ignoreContext: boolean | "after-read" = false,
  isRecovery: boolean | "client" = true,
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
  const sendEmail = vi.fn(async () => "Sent a second email");
  const checkEmail = vi.fn(async () => "Provider receipt is inconclusive");
  const engine: AgentEngine = {
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
      const context = JSON.stringify(options.messages);
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
              input: { ...EMAIL, body: "Your refund has been approved." },
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
      },
    },
  });
  const requestBody = {
    message: "Send the refund email, then finish the refund.",
    threadId,
    turnId,
    ...(isRecovery === true ? { internalContinuation: true } : {}),
    ...(isRecovery ? { __agentChatRecoveryOfRunId: "dead-worker" } : {}),
    ...(isRecovery !== "client"
      ? { __backgroundRun: { runId, turnId, payloadRef: true } }
      : {}),
  };
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
    async () =>
      expect(
        (await getRunByThread(threadId, { includeTerminal: true }))?.status,
      ).not.toBe("running"),
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
    run: await getRunByThread(threadId, { includeTerminal: true }),
  };
}

describe("reaper successor resume context", () => {
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

  it("tells the successor that a started email has an unknown outcome and must be checked", async () => {
    const result = await recover([START]);
    expect(result.sendEmail).not.toHaveBeenCalled();
    const context = JSON.stringify(result.seen[0]);
    expect(context).toContain("Interrupted / unknown outcome");
    expect(context).toContain("verify state first");
    expect(context).toContain(
      "Interrupted before this tool returned a result.",
    );
    expect(context).not.toContain("Stopped before this action started.");
  });

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
