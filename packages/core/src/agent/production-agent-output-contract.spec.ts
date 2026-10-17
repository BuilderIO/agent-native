import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentConnectionRequiredError, defineAction } from "../action.js";
import * as journalSeed from "./engine/tool-call-journal-seed.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "./engine/types.js";
import {
  actionsToEngineTools,
  createPlanModeActionRegistry,
  executeAgentToolCall,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import { classifyToolCallJournal } from "./tool-call-journal.js";
import type { AgentChatEvent } from "./types.js";

const notify = vi.hoisted(() => vi.fn());
vi.mock("../server/action-change.js", () => ({
  notifyActionChangeInBackground: notify,
}));
const audit = vi.hoisted(() => vi.fn(async (_input: unknown) => {}));
vi.mock("../audit/record.js", () => ({ recordActionAudit: audit }));

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
  run: () => Promise<unknown> = async () => ({ ok: false }),
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
    run: run as any,
  }) as unknown as ActionEntry;
}

function toolDone(events: AgentChatEvent[]) {
  return events.find((event) => event.type === "tool_done") as
    | Extract<AgentChatEvent, { type: "tool_done" }>
    | undefined;
}

type LoopOptions = Partial<Parameters<typeof runAgentLoop>[0]>;

function runOneCall(
  actions: Record<string, ActionEntry>,
  name: string,
  options: LoopOptions = {},
) {
  return runCalls(actions, [name], options);
}

async function runCalls(
  actions: Record<string, ActionEntry>,
  names: string[],
  options: LoopOptions = {},
) {
  const events: AgentChatEvent[] = [];
  const toolCalls: EngineContentPart[] = names.map((name, index) => ({
    type: "tool-call",
    id: `call-${index + 1}`,
    name,
    input: {},
  }));
  const steps: EngineEvent[][] = [
    [
      { type: "assistant-content", parts: toolCalls },
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
    ...options,
  });
  return events;
}

function countingPublish(counter: { writes: number }, ok = true) {
  return defaultedPublish(true, async () => {
    counter.writes += 1;
    return { ok };
  });
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
        {
          "publish-draft": defaultedPublish(true, async () => ({ ok: true })),
        },
        "publish-draft",
      ),
    );
    expect(done?.isError).toBeUndefined();
    expect(done?.completedSideEffect).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("leaves a handler failure unknown when defaults turn a raw read into a write", async () => {
    const done = toolDone(
      await runOneCall(
        {
          "publish-draft": defaultedPublish(true, async () => {
            throw new Error("Publishing stopped halfway.");
          }),
        },
        "publish-draft",
      ),
    );
    expect(done).toMatchObject({ isError: true, outcomeUnknown: true });
    expect(done?.completedSideEffect).toBeUndefined();
  });

  it("reports a handler failure as no side effect when defaults turn a raw write into a read", async () => {
    const done = toolDone(
      await runOneCall(
        {
          "preview-draft": defaultedPublish(false, async () => {
            throw new Error("Preview failed.");
          }),
        },
        "preview-draft",
      ),
    );
    expect(done).toMatchObject({ isError: true, completedSideEffect: false });
    expect(done?.outcomeUnknown).toBeUndefined();
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

describe("runAgentLoop — gates follow the validated arguments", () => {
  it("blocks a write its defaults make in plan mode", async () => {
    const counter = { writes: 0 };
    const done = toolDone(
      await runOneCall(
        { "publish-draft": countingPublish(counter) },
        "publish-draft",
        { executionMode: "plan" },
      ),
    );
    expect(counter.writes).toBe(0);
    expect(done).toMatchObject({ isError: true, completedSideEffect: false });
    expect(done?.result).toContain("Plan mode blocked");
  });

  it("blocks a write its defaults make in the plan-mode registry", async () => {
    const counter = { writes: 0 };
    const planned = createPlanModeActionRegistry({
      "publish-draft": countingPublish(counter),
    });
    const result = await planned["publish-draft"]!.run({});
    expect(counter.writes).toBe(0);
    expect(result).toContain("Plan mode blocked");
  });

  it("refuses to repeat an unknown write its defaults make", async () => {
    const counter = { writes: 0 };
    const done = toolDone(
      await runOneCall(
        { "publish-draft": countingPublish(counter) },
        "publish-draft",
        { unknownWriteToolNames: new Set(["publish-draft"]) },
      ),
    );
    expect(counter.writes).toBe(0);
    expect(done).toMatchObject({ isError: true });
    expect(done?.result).toContain("could not recover its result");
  });

  it("does not batch writes its defaults make as parallel reads", async () => {
    let running = 0;
    let mostRunning = 0;
    const publish = defaultedPublish(true, async () => {
      running += 1;
      mostRunning = Math.max(mostRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { ok: true };
    });
    await runCalls({ "publish-draft": publish }, [
      "publish-draft",
      "publish-draft",
    ]);
    expect(mostRunning).toBe(1);
  });

  it("fails a call whose arguments are invalid before asking for approval", async () => {
    let ran = false;
    const rename = defineAction({
      description: "Rename the draft.",
      schema: z.object({ title: z.string() }),
      needsApproval: true,
      run: async () => {
        ran = true;
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    const events = await runOneCall({ "rename-draft": rename }, "rename-draft");
    expect(ran).toBe(false);
    expect(events.some((event) => event.type === "approval_required")).toBe(
      false,
    );
    const done = toolDone(events);
    expect(done).toMatchObject({ isError: true, completedSideEffect: false });
    expect(done?.result).toContain("Invalid action parameters");
  });

  it("audits and tracks a call refused for invalid arguments, as its own run would", async () => {
    const tracked: Array<{ properties?: Record<string, unknown> }> = [];
    const { registerTrackingProvider, unregisterTrackingProvider } =
      await import("../tracking/registry.js");
    registerTrackingProvider({
      name: "invalid-call-spec",
      track: (event) => {
        tracked.push(event as { properties?: Record<string, unknown> });
      },
    });
    audit.mockClear();
    try {
      const rename = defineAction({
        description: "Rename the draft.",
        schema: z.object({ title: z.string() }),
        run: async () => ({ ok: true }),
      }) as unknown as ActionEntry;
      await runOneCall({ "rename-draft": rename }, "rename-draft");
      expect(audit).toHaveBeenCalledTimes(1);
      expect(audit.mock.calls[0]![0]).toMatchObject({
        status: "error",
        args: {},
        ctx: { actionName: "rename-draft", caller: "tool" },
        error: expect.objectContaining({
          message: expect.stringMatching(/^Invalid action parameters/),
        }),
      });
      expect(
        tracked
          .filter((event) => event.properties?.action_name === "rename-draft")
          .map((event) => event.properties?.status),
      ).toEqual(["started", "failed"]);
    } finally {
      unregisterTrackingProvider("invalid-call-spec");
    }
  });

  it("replays a committed failure on a continued turn instead of running it again", async () => {
    const counter = { writes: 0 };
    const actions = { "publish-draft": countingPublish(counter, false) };
    const prior = await runOneCall(actions, "publish-draft");
    expect(toolDone(prior)).toMatchObject({
      isError: true,
      completedSideEffect: true,
    });
    const readJournal = vi
      .spyOn(journalSeed, "loadPriorTurnToolCallJournal")
      .mockResolvedValue({
        status: "read",
        toolCallJournal: classifyToolCallJournal(prior),
        priorToolCalls: [],
        priorToolCallSequence: [],
        priorToolResults: [],
      });
    try {
      const done = toolDone(
        await runOneCall(actions, "publish-draft", {
          internalContinuation: true,
        }),
      );
      expect(counter.writes).toBe(1);
      expect(done).toMatchObject({
        isError: true,
        completedSideEffect: true,
        replayed: true,
      });
      expect(done?.result).toContain("do not retry");
    } finally {
      readJournal.mockRestore();
    }
  });

  it("reports a read whose nested write ran as a completed side effect", async () => {
    notify.mockClear();
    let writes = 0;
    const save = defineAction({
      description: "Save the draft.",
      schema: z.object({}),
      run: async () => {
        writes += 1;
        return { ok: true };
      },
    });
    const check = defineAction({
      description: "Check the draft.",
      schema: z.object({}),
      outputSchema: z.object({ ok: z.literal(true) }),
      outputErrorStrategy: "strict",
      readOnly: true,
      run: async (_args, ctx) => {
        await save.run({}, ctx);
        return { ok: false } as any;
      },
    }) as unknown as ActionEntry;
    const done = toolDone(
      await runOneCall({ "check-draft": check }, "check-draft"),
    );
    expect(writes).toBe(1);
    expect(done).toMatchObject({ isError: true, completedSideEffect: true });
    expect(done?.result).toContain("do not retry");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("keeps a committed failure's effect through the single-tool adapter", async () => {
    const result = await executeAgentToolCall({
      actions: { "publish-draft": strictPublish(false) },
      name: "publish-draft",
      input: {},
      callId: "a2a-call",
      caller: "a2a",
      networkProtocol: "a2a",
    });
    expect(result).toMatchObject({
      status: "failed",
      completedSideEffect: true,
    });
  });
});
