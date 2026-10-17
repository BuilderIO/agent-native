import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentConnectionRequiredError, defineAction } from "../action.js";
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

// The raw call `{}` reads as a read; the validated `{ apply: true }` is a write.
// With `defaultApply: false` it is the other way round.
function defaultedPublish(
  defaultApply: boolean,
  result: unknown = { ok: false },
): ActionEntry {
  return defineAction({
    description: "Publish the draft unless asked to preview.",
    schema: z.object({ apply: z.boolean().default(defaultApply) }),
    outputSchema: z.object({ ok: z.literal(true) }),
    outputErrorStrategy: "strict",
    // Only the defaulted value decides; an absent one reads the other way.
    planMode: {
      effect: (args) =>
        defaultApply
          ? args.apply === true
            ? "write"
            : "read"
          : args.apply === false
            ? "read"
            : "write",
    },
    run: async () => result as any,
  }) as unknown as ActionEntry;
}

function toolDone(events: AgentChatEvent[]) {
  return events.find((event) => event.type === "tool_done") as
    | Extract<AgentChatEvent, { type: "tool_done" }>
    | undefined;
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

  it("reports a committed output failure as a completed side effect, not an unknown outcome", async () => {
    const done = toolDone(
      await runOneCall(
        { "publish-draft": strictPublish(false) },
        "publish-draft",
      ),
    );
    expect(done).toMatchObject({ isError: true, completedSideEffect: true });
    expect(done?.outcomeUnknown).toBeUndefined();
  });

  it("follows the validated arguments when defaults turn a raw read into a write", async () => {
    notify.mockClear();
    const done = toolDone(
      await runOneCall(
        { "publish-draft": defaultedPublish(true) },
        "publish-draft",
      ),
    );
    expect(done?.result).toContain("do not retry");
    expect(done).toMatchObject({ isError: true, completedSideEffect: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("follows the validated arguments when defaults turn a raw write into a read", async () => {
    notify.mockClear();
    const done = toolDone(
      await runOneCall(
        { "preview-draft": defaultedPublish(false) },
        "preview-draft",
      ),
    );
    expect(done?.result).toContain("changed nothing");
    expect(done).toMatchObject({ isError: true, completedSideEffect: false });
    expect(done?.outcomeUnknown).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("classifies a successful call from the arguments it ran with", async () => {
    notify.mockClear();
    const done = toolDone(
      await runOneCall(
        { "publish-draft": defaultedPublish(true, { ok: true }) },
        "publish-draft",
      ),
    );
    expect(done?.isError).toBeUndefined();
    expect(done?.completedSideEffect).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("keeps a write's effect on a connection request raised while checking its result", async () => {
    notify.mockClear();
    const action = defineAction({
      description: "Assign an owner.",
      schema: z.object({}),
      outputSchema: z.object({ owner: z.string() }).transform((value) => {
        throw new AgentConnectionRequiredError(`Connect for ${value.owner}`, {
          provider: "slack",
        });
      }),
      run: async () => ({ owner: "mo@example.com" }),
    }) as unknown as ActionEntry;
    const events = await runOneCall({ "assign-owner": action }, "assign-owner");
    const done = toolDone(events);
    expect(done).toMatchObject({ isError: true, completedSideEffect: true });
    expect(JSON.stringify(events)).not.toContain("mo@example.com");
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
