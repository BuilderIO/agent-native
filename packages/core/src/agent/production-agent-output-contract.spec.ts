import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { actionArgumentsHash } from "../action-arguments-identity.js";
import {
  AgentActionStopError,
  AgentConnectionRequiredError,
  defineAction,
  runActionWithExecutionOutcome,
  type ActionRunContext,
} from "../action.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import { approvalKeyWithArguments } from "./approval-key.js";
import * as journalSeed from "./engine/tool-call-journal-seed.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import {
  actionsToEngineTools,
  AGENT_INTERNAL_CONTINUE_PROMPT,
  appendAgentLoopContinuation,
  createPlanModeActionRegistry,
  executeAgentToolCall,
  runAgentLoop,
  toolCallCacheKey,
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

/** All `names` called at once, each with the raw input `{}`. */
function runCalls(
  actions: Record<string, ActionEntry>,
  names: string[],
  options: LoopOptions = {},
) {
  return runSteps(actions, [names], options);
}

/** Each call in its own model step, after the one before it returned. */
function runSequentialCalls(
  actions: Record<string, ActionEntry>,
  names: string[],
  options: LoopOptions = {},
) {
  return runSteps(
    actions,
    names.map((name) => [name]),
    options,
  );
}

async function runSteps(
  actions: Record<string, ActionEntry>,
  callSteps: string[][],
  options: LoopOptions = {},
) {
  const events: AgentChatEvent[] = [];
  let callId = 0;
  const steps: EngineEvent[][] = [
    ...callSteps.map((names): EngineEvent[] => [
      {
        type: "assistant-content",
        parts: names.map(
          (name): EngineContentPart => ({
            type: "tool-call",
            id: `call-${++callId}`,
            name,
            input: {},
          }),
        ),
      },
      { type: "stop", reason: "tool_use" },
    ]),
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
    maxIterations: steps.length + 1,
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
        events: prior,
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

describe("runAgentLoop — one prepared invocation", () => {
  // The raw call `{}` asks for nothing; the default it validates to writes.
  function defaultedApprovalPublish(counter: { writes: number }) {
    return defineAction({
      description: "Publish the draft unless asked to preview.",
      schema: z.object({ apply: z.boolean().default(true) }),
      needsApproval: (args) => args.apply === true,
      planMode: {
        effect: (args) => (args.apply === true ? "write" : "read"),
      },
      run: async (args) => {
        if (args.apply) counter.writes += 1;
        return { ok: true };
      },
    }) as unknown as ActionEntry;
  }

  it("asks approval for the arguments that run, defaults applied", async () => {
    const counter = { writes: 0 };
    const events = await runOneCall(
      { "publish-draft": defaultedApprovalPublish(counter) },
      "publish-draft",
    );
    expect(counter.writes).toBe(0);
    const approval = events.find(
      (event) => event.type === "approval_required",
    ) as Extract<AgentChatEvent, { type: "approval_required" }> | undefined;
    // The card still shows the call as the model made it.
    expect(approval).toMatchObject({
      input: {},
      approvalKey: toolCallCacheKey("publish-draft", {}),
      argumentsHash: actionArgumentsHash({ apply: true }),
    });
  });

  it("runs an approval only for the arguments it was bound to", async () => {
    let stamp = 0;
    const ran: unknown[] = [];
    const stamped = defineAction({
      description: "Stamp the draft.",
      schema: z.object({ stamp: z.number().default(() => ++stamp) }),
      needsApproval: true,
      run: async (args) => {
        ran.push(args);
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    const approvalKey = toolCallCacheKey("stamp-draft", {});
    // Approved as `{ stamp: 1 }`; resumed, the default prepares `{ stamp: 2 }`.
    stamp = 1;
    const resumed = await runOneCall(
      { "stamp-draft": stamped },
      "stamp-draft",
      {
        approvedToolCalls: [
          approvalKeyWithArguments(
            approvalKey,
            actionArgumentsHash({ stamp: 1 }),
          ),
        ],
      },
    );
    expect(ran).toEqual([]);
    expect(resumed.some((event) => event.type === "approval_required")).toBe(
      true,
    );

    stamp = 0;
    await runOneCall({ "stamp-draft": stamped }, "stamp-draft", {
      approvedToolCalls: [
        approvalKeyWithArguments(
          approvalKey,
          actionArgumentsHash({ stamp: 1 }),
        ),
      ],
    });
    expect(ran).toEqual([{ stamp: 1 }]);
  });

  it("asks again when a resumed call prepares a different Date", async () => {
    let stamp = 0;
    const ran: string[] = [];
    const schedule = defineAction({
      description: "Schedule the draft.",
      schema: z.object({
        at: z
          .string()
          .default(() => new Date(++stamp * 1000).toISOString())
          .transform((at) => new Date(at)),
      }),
      needsApproval: true,
      run: async (args) => {
        ran.push(args.at.toISOString());
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    // Deriving the tool's JSON Schema read the default once.
    stamp = 0;
    const first = await runOneCall({ schedule }, "schedule");
    const approval = first.find(
      (event) => event.type === "approval_required",
    ) as Extract<AgentChatEvent, { type: "approval_required" }>;
    expect(approval.argumentsHash).toBe(
      actionArgumentsHash({ at: new Date(1000) }),
    );
    const resumed = await runOneCall({ schedule }, "schedule", {
      approvedToolCalls: [
        approvalKeyWithArguments(approval.approvalKey, approval.argumentsHash!),
      ],
      consumeApproval: async (binding) =>
        binding.argumentsHash === approval.argumentsHash,
    });
    expect(ran).toEqual([]);
    expect(resumed.some((event) => event.type === "approval_required")).toBe(
      true,
    );
  });

  it("refuses arguments it cannot snapshot exactly, with or without approval", async () => {
    const ran: unknown[] = [];
    const tag = (needsApproval: boolean) =>
      defineAction({
        description: "Tag the draft.",
        schema: z.object({
          tags: z
            .array(z.string())
            .default(["a"])
            .transform((tags) => new Set(tags)),
        }),
        ...(needsApproval ? { needsApproval: true } : {}),
        run: async (args) => {
          ran.push(args.tags);
          return { ok: true };
        },
      }) as unknown as ActionEntry;
    for (const needsApproval of [true, false]) {
      const refused = await runOneCall({ tag: tag(needsApproval) }, "tag", {
        approvedToolCalls: [toolCallCacheKey("tag", {})],
        consumeApproval: async () => true,
      });
      expect(refused.some((event) => event.type === "approval_required")).toBe(
        false,
      );
      expect(toolDone(refused)).toMatchObject({
        isError: true,
        result: expect.stringContaining(
          'Argument "tags" has no exact encoding (Set).',
        ),
      });
    }
    expect(ran).toEqual([]);
  });

  it("never asks approval for, or runs, arguments read through an accessor", async () => {
    // Read once to bind an approval and again to run, a getter could answer
    // differently each time.
    const ran: unknown[] = [];
    const publish = defineAction({
      description: "Publish the amount.",
      schema: z.object({}).transform(() => {
        let reads = 0;
        return Object.defineProperty({}, "amount", {
          enumerable: true,
          get: () => (++reads === 1 ? 1 : 100),
        });
      }),
      needsApproval: true,
      readOnly: false,
      run: async (args: any) => {
        ran.push(args.amount);
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    const first = await runOneCall({ publish }, "publish");
    expect(first.some((event) => event.type === "approval_required")).toBe(
      false,
    );
    const hash = actionArgumentsHash({ amount: 1 });
    const resumed = await runOneCall({ publish }, "publish", {
      approvedToolCalls: [
        approvalKeyWithArguments(toolCallCacheKey("publish", {}), hash),
      ],
      consumeApproval: async (binding) => binding.argumentsHash === hash,
    });
    expect(ran).toEqual([]);
    expect(toolDone(resumed)).toMatchObject({
      isError: true,
      result: expect.stringContaining(
        'Argument "amount" has no exact encoding (accessor).',
      ),
    });
  });

  it("asks approval for, and runs, the arguments with every gate on its own copy", async () => {
    // Freezing does not freeze a Date's time: a gate sharing the Date the
    // approval predicate reads could change what it decides on.
    const ran: number[] = [];
    const gate: number[] = [];
    const publish = defineAction({
      description: "Publish at a time.",
      schema: z.object({}).transform(() => ({ at: new Date(1000) })),
      readOnly: false,
      planMode: {
        effect: (args) => {
          args.at.setTime(0);
          return "write";
        },
      },
      needsApproval: (args) => {
        gate.push(args.at.getTime());
        return args.at.getTime() > 0;
      },
      run: async (args) => {
        ran.push(args.at.getTime());
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    const hash = actionArgumentsHash({ at: new Date(1000) });

    const first = await runOneCall({ publish }, "publish");
    expect(first).toContainEqual(
      expect.objectContaining({
        type: "approval_required",
        argumentsHash: hash,
      }),
    );
    expect({ gate, ran }).toEqual({ gate: [1000], ran: [] });

    const approved = await runOneCall({ publish }, "publish", {
      approvedToolCalls: [
        approvalKeyWithArguments(toolCallCacheKey("publish", {}), hash),
      ],
    });
    expect(toolDone(approved)).toMatchObject({ argumentsHash: hash });
    expect(toolDone(approved)?.isError).toBeUndefined();
    expect(ran).toEqual([1000]);
  });

  it("reuses a read only for the arguments it was prepared with", async () => {
    let page = 0;
    const ran: number[] = [];
    const read = defineAction({
      description: "Read the next page.",
      schema: z.object({ page: z.number().default(() => ++page) }),
      readOnly: true,
      run: async (args) => {
        ran.push(args.page);
        return `page ${args.page}`;
      },
    }) as unknown as ActionEntry;
    // Deriving the tool's JSON Schema read the default once.
    page = 0;
    await runSequentialCalls({ read }, ["read", "read"]);
    expect(ran).toEqual([1, 2]);

    // Prepared to the same arguments, the second call is the same read.
    const same = defineAction({
      description: "Read the first page.",
      schema: z.object({ page: z.number().default(() => 1) }),
      readOnly: true,
      run: async (args) => {
        ran.push(args.page);
        return `page ${args.page}`;
      },
    }) as unknown as ActionEntry;
    ran.length = 0;
    const events = await runSequentialCalls({ read: same }, ["read", "read"]);
    expect(ran).toEqual([1]);
    expect(
      events.filter((event) => event.type === "tool_done").at(-1),
    ).toMatchObject({
      result: expect.stringContaining("Skipped duplicate read-only call"),
    });
  });

  it("checks a consumed approval against the arguments that run", async () => {
    const counter = { writes: 0 };
    const consumed: Array<{ argumentsHash: string; input: unknown }> = [];
    await runOneCall(
      { "publish-draft": defaultedApprovalPublish(counter) },
      "publish-draft",
      {
        approvedToolCalls: [toolCallCacheKey("publish-draft", {})],
        consumeApproval: async (binding) => {
          consumed.push(binding);
          return true;
        },
      },
    );
    expect(counter.writes).toBe(1);
    expect(consumed).toMatchObject([
      {
        input: { apply: true },
        argumentsHash: actionArgumentsHash({ apply: true }),
      },
    ]);
  });

  it("runs the arguments its gates read, with one parse", async () => {
    let parses = 0;
    let transforms = 0;
    const ran: unknown[] = [];
    const publish = defineAction({
      description: "Publish the draft unless asked to preview.",
      schema: z.object({
        apply: z.boolean().default(() => ++parses > 1),
        note: z
          .string()
          .default("draft")
          .transform((note) => {
            transforms += 1;
            return `${note}!`;
          }),
      }),
      planMode: {
        effect: (args) => (args.apply === true ? "write" : "read"),
      },
      run: async (args) => {
        ran.push(args);
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    // Deriving the tool's JSON Schema read the default once.
    parses = 0;
    await runOneCall({ "publish-draft": publish }, "publish-draft", {
      executionMode: "plan",
    });
    expect({ parses, transforms, ran }).toEqual({
      parses: 1,
      transforms: 1,
      ran: [{ apply: false, note: "draft!" }],
    });

    parses = 0;
    transforms = 0;
    ran.length = 0;
    const planned = createPlanModeActionRegistry({ "publish-draft": publish });
    await runOneCall(planned, "publish-draft", { executionMode: "plan" });
    expect({ parses, transforms, ran }).toEqual({
      parses: 1,
      transforms: 1,
      ran: [{ apply: false, note: "draft!" }],
    });
  });

  it("runs a direct plan-mode registry call as its one preparation", async () => {
    let parses = 0;
    const ran: unknown[] = [];
    const publish = defineAction({
      description: "Publish the draft unless asked to preview.",
      schema: z.object({ apply: z.boolean().default(() => ++parses > 1) }),
      planMode: {
        effect: (args) => (args.apply === true ? "write" : "read"),
      },
      run: async (args) => {
        ran.push(args);
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    parses = 0;
    const planned = createPlanModeActionRegistry({ "publish-draft": publish });
    // No context: the registry still runs the call its gate admitted.
    await expect(planned["publish-draft"]!.run({})).resolves.toEqual({
      ok: true,
    });
    expect({ parses, ran }).toEqual({ parses: 1, ran: [{ apply: false }] });
  });

  it("refuses an invalid plan-mode registry call without dispatching it", async () => {
    let checks = 0;
    let runs = 0;
    const publish = defineAction({
      description: "Publish the draft.",
      // Refuses the first check only: a second check would admit the call.
      schema: z.object({}).refine(() => ++checks > 1, "not yet"),
      planMode: { effect: () => "read" },
      run: async () => {
        runs += 1;
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    const planned = createPlanModeActionRegistry({ "publish-draft": publish });
    await expect(
      planned["publish-draft"]!.run({}, { caller: "tool" }),
    ).rejects.toThrow(/not yet/);
    expect({ checks, runs }).toEqual({ checks: 1, runs: 0 });
  });

  it("dispatches nothing when the run aborts while a call is being prepared", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let ran = false;
    const check = defineAction({
      description: "Check the draft.",
      schema: z.object({}).refine(async () => {
        entered();
        await held;
        return true;
      }),
      readOnly: true,
      run: async () => {
        ran = true;
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    const abort = new AbortController();
    let settled = false;
    const running = runOneCall({ "check-draft": check }, "check-draft", {
      signal: abort.signal,
    }).finally(() => {
      settled = true;
    });
    await started;
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const settledOnAbort = settled;
    release();
    await running;
    expect(settledOnAbort).toBe(true);
    expect(ran).toBe(false);
  });

  it("fails a call whose preparation outlasts its deadline without running it", async () => {
    let ran = false;
    const check = defineAction({
      description: "Check the draft.",
      schema: z.object({}).refine(() => new Promise<boolean>(() => {})),
      readOnly: true,
      timeoutMs: 20,
      run: async () => {
        ran = true;
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    const done = toolDone(
      await runOneCall({ "check-draft": check }, "check-draft"),
    );
    expect(ran).toBe(false);
    expect(done).toMatchObject({ isError: true, completedSideEffect: false });
    expect(done?.result).toContain("timed out before the action started");
  });

  it("audits an invalid call to a discovered action", async () => {
    audit.mockClear();
    const discovered = loadActionsFromStaticRegistry({
      "rename-draft": {
        default: defineAction({
          description: "Rename the draft.",
          schema: z.object({ title: z.string() }),
          run: async () => ({ ok: true }),
        }),
      },
    }) as unknown as Record<string, ActionEntry>;
    await runOneCall(discovered, "rename-draft");
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]![0]).toMatchObject({
      status: "error",
      ctx: { actionName: "rename-draft" },
    });
  });
});

describe("runAgentLoop — continued turns follow recorded effects", () => {
  function nestedWriteCheck(counter: { writes: number }) {
    const save = defineAction({
      description: "Save the draft.",
      schema: z.object({}),
      run: async () => {
        counter.writes += 1;
        return { ok: true };
      },
    });
    return defineAction({
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
  }

  function withJournal<T>(prior: AgentChatEvent[], run: () => Promise<T>) {
    const readJournal = vi
      .spyOn(journalSeed, "loadPriorTurnToolCallJournal")
      .mockResolvedValue({
        status: "read",
        events: prior,
        toolCallJournal: classifyToolCallJournal(prior),
        priorToolCalls: [],
        priorToolCallSequence: [],
        priorToolResults: [],
      });
    return run().finally(() => readJournal.mockRestore());
  }

  it("replays a read whose nested write committed instead of running it again", async () => {
    const counter = { writes: 0 };
    const actions = { "check-draft": nestedWriteCheck(counter) };
    const prior = await runOneCall(actions, "check-draft");
    expect(toolDone(prior)).toMatchObject({
      isError: true,
      completedSideEffect: true,
    });
    const done = toolDone(
      await withJournal(prior, () =>
        runOneCall(actions, "check-draft", { internalContinuation: true }),
      ),
    );
    expect(counter.writes).toBe(1);
    expect(done).toMatchObject({ isError: true, replayed: true });
  });

  it.each([
    [
      "rebuilds the context",
      (read: ActionEntry): ActionEntry => ({
        ...read,
        run: (args, ctx) =>
          read.run(args, { ...ctx, caller: ctx?.caller ?? "tool" }),
      }),
    ],
    [
      "drops the action's key",
      (read: ActionEntry): ActionEntry => ({
        tool: read.tool,
        readOnly: true,
        dedupe: false,
        run: (args, ctx) => read.run(args, { ...ctx }),
      }),
    ],
  ])(
    "replays a nested write run through a wrapper that %s",
    async (_shape, wrap) => {
      notify.mockClear();
      let writes = 0;
      const save = defineAction({
        description: "Save the draft.",
        schema: z.object({}),
        run: async () => {
          writes += 1;
          return "saved";
        },
      });
      const read = defineAction({
        description: "Read the draft, saving it first.",
        schema: z.object({}),
        readOnly: true,
        dedupe: false,
        run: async (_args, ctx) => {
          await save.run({}, ctx);
          return "read and saved";
        },
      });
      const actions = { "read-draft": wrap(read as unknown as ActionEntry) };
      const prior = await runOneCall(actions, "read-draft");
      expect(toolDone(prior)).toMatchObject({ completedSideEffect: true });
      expect(notify).toHaveBeenCalledTimes(1);
      const done = toolDone(
        await withJournal(prior, () =>
          runOneCall(actions, "read-draft", { internalContinuation: true }),
        ),
      );
      expect(done).toMatchObject({ replayed: true });
      expect(writes).toBe(1);
    },
  );

  it("holds an action that left no record as an unknown outcome", async () => {
    notify.mockClear();
    let runs = 0;
    const read = defineAction({
      description: "Read the draft.",
      schema: z.object({}),
      readOnly: true,
      run: async () => "draft",
    });
    // The entry is the action's, but its run is not.
    const elsewhere = {
      ...read,
      run: async () => {
        runs += 1;
        return "draft from elsewhere";
      },
    } as unknown as ActionEntry;
    const actions = { "read-draft": elsewhere };
    const prior = await runSequentialCalls(actions, [
      "read-draft",
      "read-draft",
    ]);
    const [first, second] = prior.filter(
      (event) => event.type === "tool_done",
    ) as Extract<AgentChatEvent, { type: "tool_done" }>[];
    expect(first).toMatchObject({ outcomeUnknown: true });
    expect(first?.completedSideEffect).toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(1);
    // Neither reused nor run again later in the turn.
    expect(second?.result).toContain("could not recover its result");
    expect(runs).toBe(1);
    const done = toolDone(
      await withJournal(prior, () =>
        runOneCall(actions, "read-draft", { internalContinuation: true }),
      ),
    );
    expect(done?.result).toContain("could not recover its result");
    expect(runs).toBe(1);
  });

  it.each(["retrySafe", "a typed failure"])(
    "holds an action that left no record despite %s",
    async (mode) => {
      let writes = 0;
      const save = defineAction({
        description: "Save the draft.",
        schema: z.object({}),
        run: async () => {
          writes += 1;
          return "saved";
        },
      });
      const check = defineAction({
        description: "Check the draft.",
        schema: z.object({}),
        readOnly: true,
        outputSchema: z.literal("valid"),
        outputErrorStrategy: "strict",
        run: async () => "invalid" as any,
      });
      const read = defineAction({
        description: "Read the draft.",
        schema: z.object({}),
        readOnly: true,
        dedupe: false,
        retrySafe: mode === "retrySafe",
        run: async () => "draft",
      });
      const elsewhere = {
        ...read,
        run: async (_args: unknown, ctx?: ActionRunContext) => {
          await save.run({}, ctx);
          if (mode === "retrySafe") throw new Error("failed after saving");
          return check.run({}, ctx);
        },
      } as unknown as ActionEntry;
      const actions = { "read-draft": elsewhere };
      const prior = await runOneCall(actions, "read-draft");
      expect(toolDone(prior)).toMatchObject({ outcomeUnknown: true });
      expect(toolDone(prior)?.result).not.toContain("changed nothing");
      await withJournal(prior, () =>
        runOneCall(actions, "read-draft", { internalContinuation: true }),
      );
      expect(writes).toBe(1);
    },
  );

  it.each(["output contract error", "stop signal"])(
    "does not let a nested read's %s narrow a raw writer's own write",
    async (mode) => {
      notify.mockClear();
      let writes = 0;
      const check = defineAction({
        description: "Check the draft.",
        schema: z.object({}),
        readOnly: true,
        outputSchema:
          mode === "stop signal"
            ? z.string().transform((): string => {
                throw new AgentActionStopError("Stop.");
              })
            : z.literal("valid"),
        outputErrorStrategy: "strict",
        run: async () => "invalid" as any,
      });
      const publish: ActionEntry = {
        tool: {
          description: "Publish the draft.",
          parameters: { type: "object", properties: {} },
        },
        readOnly: false,
        run: async (_args, ctx) => {
          writes += 1;
          return check.run({}, ctx);
        },
      };
      const actions = { publish };
      const prior = await runOneCall(actions, "publish");
      expect(toolDone(prior)).toMatchObject({ completedSideEffect: true });
      expect(toolDone(prior)?.result).not.toContain("changed nothing");
      expect(notify).toHaveBeenCalledTimes(1);
      await withJournal(prior, () =>
        runOneCall(actions, "publish", { internalContinuation: true }),
      );
      expect(writes).toBe(1);
    },
  );

  it.each(["inside the call", "independently"])(
    "keeps a write's own committed failure when another call %s throws it again",
    async (where) => {
      let writes = 0;
      const rethrow = (error: unknown) => {
        const other = {
          readOnly: false,
          run: async () => {
            throw error;
          },
        };
        return runActionWithExecutionOutcome(
          other.run,
          {},
          {},
          { refused: false },
          other,
        ).catch(() => undefined);
      };
      let reuse!: (error: unknown) => void;
      // Chained before the turn starts, so it runs outside the call.
      const independent = new Promise<unknown>((resolve) => {
        reuse = resolve;
      }).then(rethrow);
      const own = defineAction({
        description: "Publish the draft.",
        schema: z.object({}),
        retrySafe: true,
        outputSchema: z.literal("published"),
        outputErrorStrategy: "strict",
        run: async () => {
          writes += 1;
          return "draft" as any;
        },
      });
      const publish = {
        ...own,
        run: async (args: unknown, ctx?: ActionRunContext) => {
          try {
            return await own.run(args as any, ctx);
          } catch (error) {
            if (where === "independently") {
              reuse(error);
              await independent;
            } else {
              await rethrow(error);
            }
            throw error;
          }
        },
      } as unknown as ActionEntry;
      const actions = { publish };
      const prior = await runOneCall(actions, "publish");
      expect(toolDone(prior)).toMatchObject({ completedSideEffect: true });
      const next = await withJournal(prior, () =>
        runOneCall(actions, "publish", { internalContinuation: true }),
      );
      expect(toolDone(next)).toMatchObject({ replayed: true });
      expect(writes).toBe(1);
    },
  );

  it("runs an ordinary read again on a continued turn", async () => {
    let reads = 0;
    const read = defineAction({
      description: "Read the draft.",
      schema: z.object({}),
      readOnly: true,
      run: async () => ({ reads: ++reads }),
    }) as unknown as ActionEntry;
    const prior = await runOneCall({ "read-draft": read }, "read-draft");
    const done = toolDone(
      await withJournal(prior, () =>
        runOneCall({ "read-draft": read }, "read-draft", {
          internalContinuation: true,
        }),
      ),
    );
    expect(reads).toBe(2);
    expect(done?.replayed).toBeUndefined();
  });

  it("runs a call afresh when its earlier run was an ordinary read and it now prepares a write", async () => {
    let parses = 0;
    const ran: string[] = [];
    const publish = defineAction({
      description: "Preview or publish the draft.",
      schema: z.object({ apply: z.boolean().default(() => ++parses > 1) }),
      planMode: { effect: (args) => (args.apply ? "write" : "read") },
      run: async (args) => {
        ran.push(args.apply ? "published" : "preview");
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    parses = 0;
    const prior = await runOneCall({ publish }, "publish");
    const done = toolDone(
      await withJournal(prior, () =>
        runOneCall({ publish }, "publish", { internalContinuation: true }),
      ),
    );
    expect(ran).toEqual(["preview", "published"]);
    expect(done?.replayed).toBeUndefined();
  });

  it("replays a committed write only for the arguments it was prepared with", async () => {
    let stamp = 0;
    const ran: number[] = [];
    const stampDraft = defineAction({
      description: "Stamp the draft.",
      schema: z.object({ stamp: z.number().default(() => ++stamp) }),
      run: async (args) => {
        ran.push(args.stamp);
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    stamp = 0;
    const prior = await runOneCall({ stampDraft }, "stampDraft");
    expect(toolDone(prior)).toMatchObject({ completedSideEffect: true });
    // Prepared again, the default differs: the earlier write is not this one.
    const fresh = toolDone(
      await withJournal(prior, () =>
        runOneCall({ stampDraft }, "stampDraft", {
          internalContinuation: true,
        }),
      ),
    );
    expect(fresh?.replayed).toBeUndefined();
    // Prepared to the same arguments, it is.
    stamp = 0;
    const replayed = toolDone(
      await withJournal(prior, () =>
        runOneCall({ stampDraft }, "stampDraft", {
          internalContinuation: true,
        }),
      ),
    );
    expect(replayed).toMatchObject({
      replayed: true,
      argumentsHash: toolDone(prior)?.argumentsHash,
    });
    expect(ran).toEqual([1, 2]);
  });

  it("holds back a read whose nested write left an unknown outcome", async () => {
    const counter = { writes: 0 };
    const prior: AgentChatEvent[] = [
      { type: "tool_start", id: "old", tool: "check-draft", input: {} },
      {
        type: "tool_done",
        id: "old",
        tool: "check-draft",
        input: {},
        result: "Tool call timed out after 1 seconds",
        isError: true,
        outcomeUnknown: true,
      },
    ];
    const done = toolDone(
      await withJournal(prior, () =>
        runOneCall(
          { "check-draft": nestedWriteCheck(counter) },
          "check-draft",
          {
            internalContinuation: true,
          },
        ),
      ),
    );
    expect(counter.writes).toBe(0);
    expect(done?.result).toContain("could not recover its result");
  });

  it("reuses an earlier read of the turn only for the arguments it ran with", async () => {
    let page = 1;
    const ran: number[] = [];
    const read = defineAction({
      description: "Read a page.",
      schema: z.object({ page: z.number().default(() => page) }),
      readOnly: true,
      run: async (args) => {
        ran.push(args.page);
        return `page ${args.page}`;
      },
    }) as unknown as ActionEntry;
    const prior: AgentChatEvent[] = [
      { type: "tool_start", id: "old", tool: "read", input: {} },
      {
        type: "tool_done",
        id: "old",
        tool: "read",
        input: {},
        result: "page 1",
        argumentsHash: actionArgumentsHash({ page: 1 }),
      },
    ];
    // The loop appends to the history it is given, so each run gets its own.
    const messages = (): EngineMessage[] => [
      { role: "user", content: [{ type: "text", text: "Read." }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", id: "old", name: "read", input: {} }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "old",
            toolName: "read",
            toolInput: "{}",
            content: "page 1",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
      },
    ];
    const continued = () =>
      withJournal(prior, () =>
        runOneCall({ read }, "read", {
          messages: messages(),
          internalContinuation: true,
        }),
      );

    expect(toolDone(await continued())?.result).toContain(
      "Skipped duplicate read-only call",
    );
    expect(ran).toEqual([]);
    // The same call as sent now prepares another page: a different read.
    page = 2;
    await continued();
    expect(ran).toEqual([2]);
  });

  it("reuses no earlier read whose call id another call of the turn used", async () => {
    let page = 2;
    const ran: number[] = [];
    const read = defineAction({
      description: "Read a page.",
      schema: z.object({ page: z.number().default(() => page) }),
      readOnly: true,
      run: async (args) => {
        ran.push(args.page);
        return `page ${args.page}`;
      },
    }) as unknown as ActionEntry;
    // Page 1 read, then page 2 failed, the second under `secondId`.
    const continued = (secondId: string) => {
      const prior: AgentChatEvent[] = [
        { type: "tool_start", id: "old", tool: "read", input: { page: 1 } },
        {
          type: "tool_done",
          id: "old",
          tool: "read",
          input: { page: 1 },
          result: "page 1",
          argumentsHash: actionArgumentsHash({ page: 1 }),
        },
        { type: "tool_start", id: secondId, tool: "read", input: { page: 2 } },
        {
          type: "tool_done",
          id: secondId,
          tool: "read",
          input: { page: 2 },
          result: "Error running read: refused",
          isError: true,
          argumentsHash: actionArgumentsHash({ page: 2 }),
        },
      ];
      const call = (id: string, n: number): EngineMessage[] => [
        {
          role: "assistant",
          content: [
            { type: "tool-call", id, name: "read", input: { page: n } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: id,
              toolName: "read",
              toolInput: JSON.stringify({ page: n }),
              content: n === 1 ? "page 1" : "Error running read: refused",
              ...(n === 1 ? {} : { isError: true }),
            },
          ],
        },
      ];
      const messages: EngineMessage[] = [
        { role: "user", content: [{ type: "text", text: "Read." }] },
        ...call("old", 1),
        ...call(secondId, 2),
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ];
      return withJournal(prior, () =>
        runOneCall({ read }, "read", { messages, internalContinuation: true }),
      );
    };

    // Page 1's result is never taken for page 2, nor, under a shared id, for
    // page 1.
    expect(toolDone(await continued("old"))?.result).toBe("page 2");
    page = 1;
    expect(toolDone(await continued("old"))?.result).toBe("page 1");
    expect(ran).toEqual([2, 1]);
    // Under distinct ids, page 1 is reused.
    expect(toolDone(await continued("other"))?.result).toContain(
      "Skipped duplicate read-only call",
    );
    expect(ran).toEqual([2, 1]);
  });

  it("never replays a committed write for arguments read through an accessor", async () => {
    const ran: unknown[] = [];
    const publish = defineAction({
      description: "Publish the amount.",
      schema: z.object({}).transform(() => {
        let reads = 0;
        return Object.defineProperty({}, "amount", {
          enumerable: true,
          get: () => (++reads === 1 ? 1 : 3),
        });
      }),
      run: async (args: any) => {
        ran.push(args.amount);
        return { ok: true };
      },
    }) as unknown as ActionEntry;
    // What a call that sampled the getter once would have recorded.
    const prior: AgentChatEvent[] = [
      { type: "tool_start", id: "old", tool: "publish", input: {} },
      {
        type: "tool_done",
        id: "old",
        tool: "publish",
        input: {},
        result: "published 1",
        completedSideEffect: true,
        argumentsHash: actionArgumentsHash({ amount: 1 }),
      },
    ];
    const done = toolDone(
      await withJournal(prior, () =>
        runOneCall({ publish }, "publish", { internalContinuation: true }),
      ),
    );
    expect(done?.replayed).toBeUndefined();
    expect(done).toMatchObject({
      isError: true,
      result: expect.stringContaining("(accessor)"),
    });
    expect(ran).toEqual([]);
  });

  it("runs a read again after an interruption that recorded no write", async () => {
    let reads = 0;
    const read = defineAction({
      description: "Read the draft.",
      schema: z.object({}),
      readOnly: true,
      run: async () => ({ reads: ++reads }),
    }) as unknown as ActionEntry;
    const prior: AgentChatEvent[] = [
      { type: "tool_start", id: "old", tool: "read-draft", input: {} },
    ];
    await withJournal(prior, () =>
      runOneCall({ "read-draft": read }, "read-draft", {
        internalContinuation: true,
      }),
    );
    expect(reads).toBe(1);
  });

  it("reads again after a write that failed once its changes were saved", async () => {
    let value = 0;
    let reads = 0;
    const read = defineAction({
      description: "Read the draft.",
      schema: z.object({}),
      readOnly: true,
      run: async () => {
        reads += 1;
        return String(value);
      },
    }) as unknown as ActionEntry;
    const write = defineAction({
      description: "Save the draft.",
      schema: z.object({}),
      outputSchema: z.object({ ok: z.literal(true) }),
      outputErrorStrategy: "strict",
      run: async () => {
        value += 1;
        return { ok: false } as any;
      },
    }) as unknown as ActionEntry;
    const messages: EngineMessage[] = [
      { role: "user", content: [{ type: "text", text: "Update." }] },
      {
        role: "assistant",
        content: [
          { type: "tool-call", id: "old-read", name: "read-draft", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "old-read",
            toolName: "read-draft",
            toolInput: "{}",
            content: "0",
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "tool-call", id: "old-write", name: "save-draft", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "old-write",
            toolName: "save-draft",
            toolInput: "{}",
            content: "Saved, but the result broke its contract.",
            isError: true,
          },
        ],
      },
    ];
    appendAgentLoopContinuation(messages, "loop_limit");
    value = 1;
    const prior: AgentChatEvent[] = [
      { type: "tool_start", id: "old-write", tool: "save-draft", input: {} },
      {
        type: "tool_done",
        id: "old-write",
        tool: "save-draft",
        input: {},
        result: "Saved, but the result broke its contract.",
        isError: true,
        completedSideEffect: true,
      },
    ];
    const done = toolDone(
      await withJournal(prior, () =>
        runOneCall({ "read-draft": read, "save-draft": write }, "read-draft", {
          messages,
          internalContinuation: true,
        }),
      ),
    );
    expect(reads).toBe(1);
    expect(done?.result).toBe("1");
  });
});
