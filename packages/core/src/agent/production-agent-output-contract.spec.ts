import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAction } from "../action.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "./engine/types.js";
import {
  actionsToEngineTools,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

const notify = vi.hoisted(() => vi.fn());
vi.mock("../server/action-change.js", () => ({
  notifyActionChangeInBackground: notify,
}));

function strictPublish(readOnly: boolean): ActionEntry {
  return defineAction({
    description: "Publish the draft.",
    schema: z.object({}),
    outputSchema: z.object({ ok: z.literal(true) }),
    outputErrorStrategy: "strict",
    readOnly,
    run: async () => ({ ok: false }) as any,
  }) as unknown as ActionEntry;
}

async function runOneCall(actions: Record<string, ActionEntry>, name: string) {
  const events: AgentChatEvent[] = [];
  const toolCall: EngineContentPart = {
    type: "tool-call",
    id: "call-1",
    name,
    input: {},
  };
  const steps: EngineEvent[][] = [
    [
      { type: "assistant-content", parts: [toolCall] },
      { type: "stop", reason: "tool_use" },
    ],
    [
      { type: "assistant-content", parts: [{ type: "text", text: "Done." }] },
      { type: "stop", reason: "end_turn" },
    ],
  ];
  let request = 0;
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
      parallelToolCalls: true,
    },
    async *stream() {
      const next = steps[request++];
      if (!next) throw new Error("Unexpected model request");
      yield* next;
    },
  };
  await runAgentLoop({
    engine,
    model: "test-model",
    systemPrompt: "Test app.",
    tools: actionsToEngineTools(actions),
    actions,
    messages: [{ role: "user", content: [{ type: "text", text: "Publish." }] }],
    send: (event) => events.push(event),
    signal: new AbortController().signal,
    maxIterations: 3,
    maxOutputTokens: 1024,
    reasoningEffort: "low",
  });
  return events;
}

describe("runAgentLoop — output-contract failures", () => {
  it("refreshes other sessions after a committed write whose result broke its contract", async () => {
    notify.mockClear();
    const events = await runOneCall(
      { "publish-draft": strictPublish(false) },
      "publish-draft",
    );
    const done = events.find((event) => event.type === "tool_done") as
      | { result: string; isError?: boolean }
      | undefined;
    expect(done?.isError).toBe(true);
    expect(done?.result).toContain("do not retry");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      actionName: "publish-draft",
    });
  });

  it("publishes nothing when a read-only call's result broke its contract", async () => {
    notify.mockClear();
    await runOneCall({ "read-draft": strictPublish(true) }, "read-draft");
    expect(notify).not.toHaveBeenCalled();
  });
});
