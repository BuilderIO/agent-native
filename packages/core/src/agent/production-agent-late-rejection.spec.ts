import { expect, it, vi } from "vitest";

import * as errorCapture from "../server/capture-error.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { runAgentLoop, type ActionEntry } from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

const writeLedger = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("./run-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-store.js")>()),
  writeLedgerEntry: writeLedger,
  readLedgerEntry: vi.fn(async () => null),
  getCurrentTurnEventsForThread: vi.fn(async () => []),
}));

function singleToolEngine(): AgentEngine {
  let calls = 0;
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
    async *stream(): AsyncIterable<EngineEvent> {
      if (calls++ === 0) {
        yield {
          type: "assistant-content",
          parts: [
            { type: "tool-call", id: "tc-1", name: "save-data", input: {} },
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
}

it("captures an interrupted write's late rejection without a success ledger entry", async () => {
  const capture = vi
    .spyOn(errorCapture, "captureError")
    .mockImplementation(() => {});
  const started = Promise.withResolvers<void>();
  const result = Promise.withResolvers<string>();
  const action: ActionEntry = {
    tool: {
      description: "Save data",
      parameters: { type: "object", properties: {} },
    },
    readOnly: false,
    run: () => {
      started.resolve();
      return result.promise;
    },
  };
  const controller = new AbortController();
  const events: AgentChatEvent[] = [];
  const failure = new Error("The save failed after interruption");

  try {
    const request = runAgentLoop({
      engine: singleToolEngine(),
      model: "test-model",
      systemPrompt: "system",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "save" }] }],
      actions: { "save-data": action },
      send: (event) => events.push(event),
      signal: controller.signal,
      threadId: "thread-late-rejection-proof",
    });
    await started.promise;
    controller.abort();
    await request;
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        tool: "save-data",
        isError: true,
        result: "Interrupted before this tool returned a result.",
        outcomeUnknown: true,
      }),
    );
    result.reject(failure);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
    expect(capture).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        route: "/_agent-native/agent-chat",
        tags: expect.objectContaining({
          component: "agent-execution-step",
          phase: "late-action-rejection",
          tool: "save-data",
        }),
      }),
    );
    expect(capture).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({ phase: "late-outcome-persistence" }),
      }),
    );
    expect(writeLedger).not.toHaveBeenCalled();
  } finally {
    capture.mockRestore();
  }
});
