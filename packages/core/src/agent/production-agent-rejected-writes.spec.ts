import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const currentTurnEvents = vi.hoisted(() =>
  vi.fn<() => Promise<unknown[]>>(async () => []),
);

vi.mock("./run-store.js", () => ({
  writeLedgerEntry: vi.fn(async () => {}),
  readLedgerEntry: vi.fn(async () => null),
  clearLedgerForThread: vi.fn(async () => {}),
  getCurrentTurnEventsForThread: currentTurnEvents,
  insertRun: vi.fn(),
  updateRunHeartbeat: vi.fn(),
  getRunAbortState: vi.fn(async () => ({ aborted: false, reason: null })),
  insertRunEvent: vi.fn(),
  updateRunStatusIfRunning: vi.fn(),
  markRunAborted: vi.fn(),
  reapIfStale: vi.fn(async () => false),
  bumpRunProgress: vi.fn(),
  ensureTerminalRunEvent: vi.fn(),
  setRunError: vi.fn(),
  setRunTerminalReason: vi.fn(),
}));

const { runAgentLoop, AGENT_INTERNAL_CONTINUE_PROMPT } =
  await import("./production-agent.js");
import { actionArgumentsHash } from "../action-arguments-identity.js";
import { defineAction, fail, NoWriteError } from "../action.js";
import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import type { ActionEntry } from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

type ToolDone = Extract<AgentChatEvent, { type: "tool_done" }>;

/** One model turn per call, then a closing text. */
function scriptedEngine(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
): AgentEngine {
  let turn = 0;
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
      const call = calls[turn];
      turn++;
      if (call) {
        yield {
          type: "assistant-content",
          parts: [{ type: "tool-call", id: `call-${turn}`, ...call }],
        };
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "Done." }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

async function runCalls(
  actions: Record<string, ActionEntry>,
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  resumed?: { threadId: string; history?: EngineMessage[] },
): Promise<AgentChatEvent[]> {
  const events: AgentChatEvent[] = [];
  await runAgentLoop({
    ...(resumed
      ? { threadId: resumed.threadId, internalContinuation: true }
      : {}),
    engine: scriptedEngine(calls),
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "Edit." }] },
      ...(resumed?.history ?? []),
    ],
    actions,
    send: (event) => {
      events.push(event);
    },
    signal: new AbortController().signal,
  });
  return events;
}

const toolDones = (events: AgentChatEvent[]) =>
  events.filter((event): event is ToolDone => event.type === "tool_done");

function expectNoUnknownStop(events: AgentChatEvent[]) {
  expect(toolDones(events).some((event) => event.outcomeUnknown)).toBe(false);
  expect(
    events.some(
      (event) =>
        event.type === "error" &&
        event.errorCode === "write_tool_outcome_unknown",
    ),
  ).toBe(false);
  expect(JSON.stringify(events)).not.toMatch(/interrupted \d+ time\(s\)/);
}

/** A write that rejects `find` text missing from its slide, the way patch-deck does. */
function patchAction(written: string[]) {
  return defineAction({
    description: "Patch the slide.",
    schema: z.object({ find: z.string(), replace: z.string() }),
    run: async ({ find, replace }) => {
      if (find !== "Hello") {
        throw new NoWriteError(`replace found no matches for "${find}".`, {
          errorCode: "slide_content_edit_failed",
        });
      }
      written.push(replace);
      return { ok: true };
    },
  }) as unknown as ActionEntry;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentTurnEvents.mockResolvedValue([]);
});

describe("a write rejected before it wrote", () => {
  it("runs the corrected retry after a NoWriteError", async () => {
    const written: string[] = [];
    const events = await runCalls({ patch: patchAction(written) }, [
      { name: "patch", input: { find: "Helo", replace: "Hi" } },
      { name: "patch", input: { find: "Hello", replace: "Hi" } },
    ]);

    expect(written).toEqual(["Hi"]);
    const [rejected, corrected] = toolDones(events);
    expect(rejected).toMatchObject({
      isError: true,
      completedSideEffect: false,
      errorCode: "slide_content_edit_failed",
      errorClass: "rejected",
    });
    expect(corrected).toMatchObject({ completedSideEffect: true });
    expectNoUnknownStop(events);
  });

  it("lets the exact rejected call run again, since it changed nothing", async () => {
    const run = vi.fn(async () => {
      throw new NoWriteError("Nothing was written: the patch is identical.");
    });
    const action = defineAction({
      description: "Patch.",
      schema: z.object({ id: z.string() }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls({ patch: action }, [
      { name: "patch", input: { id: "a" } },
      { name: "patch", input: { id: "a" } },
    ]);

    expect(run).toHaveBeenCalledTimes(2);
    expectNoUnknownStop(events);
  });

  it("runs the corrected retry after the schema rejects the input", async () => {
    const written: string[] = [];
    const base = defineAction({
      description: "Save tweaks.",
      schema: z.object({
        tweaks: z.preprocess(
          (value) => (typeof value === "string" ? JSON.parse(value) : value),
          z.array(z.object({ type: z.enum(["slider", "toggle"]) })),
        ),
      }),
      run: async ({ tweaks }) => {
        written.push(tweaks.map((tweak) => tweak.type).join(","));
        return { ok: true };
      },
    });
    // The shape a template exports to show the model a leaner schema.
    const exported = {
      ...base,
      tool: {
        ...base.tool,
        parameters: {
          type: "object" as const,
          properties: { tweaks: { type: "string" } },
        },
      },
    } as unknown as ActionEntry;
    const events = await runCalls({ save: exported }, [
      { name: "save", input: { tweaks: '[{"type":"color"}]' } },
      { name: "save", input: { tweaks: '[{"type":"slider"}]' } },
    ]);

    expect(written).toEqual(["slider"]);
    expect(toolDones(events)[0]).toMatchObject({
      isError: true,
      completedSideEffect: false,
      errorClass: "input_invalid",
    });
    expectNoUnknownStop(events);
  });

  it("treats an MCP tool's isError result as a known failure", async () => {
    const callTool = vi.fn(async (args: { title: string }) => ({
      [MCP_ACTION_RESULT_MARKER]: true as const,
      text: args.title ? "Created." : "title is required",
      raw: {
        isError: !args.title,
        content: [{ type: "text", text: "..." }],
      },
      serverId: "tickets",
      toolName: "mcp__tickets__create",
      originalToolName: "create",
      input: args,
    }));
    const mcpTool: ActionEntry = {
      tool: {
        description: "Create a ticket.",
        parameters: {
          type: "object",
          properties: { title: { type: "string" } },
        },
      },
      run: callTool,
    };
    const events = await runCalls({ mcp__tickets__create: mcpTool }, [
      { name: "mcp__tickets__create", input: { title: "" } },
      { name: "mcp__tickets__create", input: { title: "Broken export" } },
    ]);

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(toolDones(events)[0]).toMatchObject({
      isError: true,
      completedSideEffect: false,
      errorClass: "rejected",
    });
    expectNoUnknownStop(events);
  });
});

describe("a NoWriteError the framework cannot vouch for", () => {
  it("stays unknown when a nested write entered first", async () => {
    const save = defineAction({
      description: "Save.",
      schema: z.object({}),
      run: async () => "saved",
    });
    const run = vi.fn(async (_args: unknown, ctx: unknown) => {
      await save.run({}, ctx as never);
      throw new NoWriteError("found no matches");
    });
    const parent = defineAction({
      description: "Save, then patch.",
      schema: z.object({ id: z.string() }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls({ parent }, [
      { name: "parent", input: { id: "a" } },
      { name: "parent", input: { id: "a" } },
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(toolDones(events)[0]).toMatchObject({ outcomeUnknown: true });
    expect(toolDones(events)[1]?.result).toContain(
      "The parent action failed 1 time(s) without confirming whether it saved changes",
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        blockedTool: "parent",
        blockedBy: "rejection",
      }),
    );
  });

  it("does not speak for a write it passed up through", async () => {
    const lookup = defineAction({
      description: "Look up.",
      schema: z.object({}),
      readOnly: true,
      run: async () => {
        throw new NoWriteError("not found");
      },
    });
    const run = vi.fn(async (_args: unknown, ctx: unknown) => {
      await lookup.run({}, ctx as never);
      return "unreachable";
    });
    const parent = defineAction({
      description: "Write, then look up.",
      schema: z.object({ id: z.string() }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls({ parent }, [
      { name: "parent", input: { id: "a" } },
    ]);

    expect(toolDones(events)[0]).toMatchObject({ outcomeUnknown: true });
  });
});

describe("a write whose outcome is really unknown", () => {
  function timingOutWrite(run: () => Promise<unknown>): ActionEntry {
    return {
      tool: {
        description: "Send.",
        parameters: {
          type: "object",
          properties: { body: { type: "string" } },
        },
      },
      readOnly: false,
      timeoutMs: 20,
      run,
    };
  }

  it("stops an exact repeat and names the tool and cause", async () => {
    const run = vi.fn(() => new Promise<never>(() => {}));
    const events = await runCalls({ send: timingOutWrite(run) }, [
      { name: "send", input: { body: "Refund sent" } },
      { name: "send", input: { body: "Refund sent" } },
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(toolDones(events)[0]).toMatchObject({
      outcomeUnknown: true,
      unknownCause: "interruption",
    });
    expect(toolDones(events)[1]?.result).toContain(
      "The send action was interrupted 1 time(s)",
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        blockedTool: "send",
        blockedBy: "interruption",
      }),
    );
  });

  it("declines a reworded write without ending the turn", async () => {
    const run = vi.fn(() => new Promise<never>(() => {}));
    const events = await runCalls({ send: timingOutWrite(run) }, [
      { name: "send", input: { body: "Refund sent" } },
      { name: "send", input: { body: "Your refund was sent" } },
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(toolDones(events)[1]).toMatchObject({
      isError: true,
      completedSideEffect: false,
      result: expect.stringContaining(
        "Not run: an earlier send call in this turn may have already applied",
      ),
    });
    expect(
      events.some(
        (event) =>
          event.type === "error" &&
          event.errorCode === "write_tool_outcome_unknown",
      ),
    ).toBe(false);
  });

  it.each([
    [
      "rejection",
      "Error running send: Upstream rejected the request.",
      { unknownCause: "rejection" },
    ],
    [
      "interruption",
      "The send action was interrupted and its result is unknown.",
      {},
    ],
  ] as const)(
    "names the recorded cause, %s, when a resumed turn repeats the call",
    async (cause, result, recorded) => {
      const input = { body: "Refund sent" };
      currentTurnEvents.mockResolvedValue([
        { type: "tool_start", id: "earlier", tool: "send", input },
        {
          type: "tool_done",
          id: "earlier",
          tool: "send",
          input,
          result,
          isError: true,
          outcomeUnknown: true,
          ...recorded,
          argumentsHash: actionArgumentsHash(input),
        },
      ]);
      const run = vi.fn(async () => "sent");
      const action = defineAction({
        description: "Send.",
        schema: z.object({ body: z.string() }),
        run,
      }) as unknown as ActionEntry;
      const events = await runCalls(
        { send: action },
        [{ name: "send", input }],
        { threadId: `thread-${cause}` },
      );

      expect(run).not.toHaveBeenCalled();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "error",
          errorCode: "write_tool_outcome_unknown",
          blockedTool: "send",
          blockedBy: cause,
        }),
      );
    },
  );

  it("keeps the journal's recorded cause when the history repeats the call", async () => {
    const input = { body: "Refund sent" };
    const result = "Error running send: Upstream rejected the request.";
    currentTurnEvents.mockResolvedValue([
      { type: "tool_start", id: "earlier", tool: "send", input },
      {
        type: "tool_done",
        id: "earlier",
        tool: "send",
        input,
        result,
        isError: true,
        outcomeUnknown: true,
        unknownCause: "rejection",
        argumentsHash: actionArgumentsHash(input),
      },
    ]);
    const run = vi.fn(async () => "sent");
    const action = defineAction({
      description: "Send.",
      schema: z.object({ body: z.string() }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls({ send: action }, [{ name: "send", input }], {
      threadId: "thread-both-sources",
      history: [
        {
          role: "assistant",
          content: [{ type: "tool-call", id: "earlier", name: "send", input }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "earlier",
              toolName: "send",
              content: result,
              isError: true,
              outcome: "unknown",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ],
    });

    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        blockedBy: "rejection",
      }),
    );
  });

  it("names the cause of the call it repeats, not another call of its tool", async () => {
    const unknownDone = (
      id: string,
      input: { body: string },
      recorded: { unknownCause?: "rejection" },
    ) => [
      { type: "tool_start", id, tool: "send", input },
      {
        type: "tool_done",
        id,
        tool: "send",
        input,
        result: "Error running send: lost.",
        isError: true,
        outcomeUnknown: true,
        ...recorded,
        argumentsHash: actionArgumentsHash(input),
      },
    ];
    const lost = { body: "Second" };
    currentTurnEvents.mockResolvedValue([
      ...unknownDone("first", { body: "First" }, { unknownCause: "rejection" }),
      ...unknownDone("second", lost, {}),
    ]);
    const run = vi.fn(async () => "sent");
    const action = defineAction({
      description: "Send.",
      schema: z.object({ body: z.string() }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls(
      { send: action },
      [{ name: "send", input: lost }],
      { threadId: "thread-two-unknowns" },
    );

    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        blockedBy: "interruption",
      }),
    );
  });

  async function repeatAfterStoredUnknowns(
    stored: Array<{
      id: string;
      prepared: Record<string, unknown>;
      cause?: unknown;
    }>,
    schema: z.ZodType,
    input: Record<string, unknown>,
  ) {
    currentTurnEvents.mockResolvedValue(
      stored.flatMap(({ id, prepared, cause }) => [
        { type: "tool_start", id, tool: "send", input },
        {
          type: "tool_done",
          id,
          tool: "send",
          input,
          result: "Error running send: lost.",
          isError: true,
          outcomeUnknown: true,
          ...(cause === undefined ? {} : { unknownCause: cause }),
          argumentsHash: actionArgumentsHash(prepared),
        },
      ]),
    );
    const run = vi.fn(async () => "sent");
    const action = defineAction({
      description: "Send.",
      schema,
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls({ send: action }, [{ name: "send", input }], {
      threadId: `thread-${stored.map(({ id }) => id).join("-")}`,
    });
    expect(run).not.toHaveBeenCalled();
    const stop = events.find(
      (event): event is Extract<AgentChatEvent, { type: "error" }> =>
        event.type === "error",
    );
    return stop && { ...stop, held: toolDones(events).at(-1)?.result };
  }

  it("reads a stored cause it does not recognise as an interruption", async () => {
    const stop = await repeatAfterStoredUnknowns(
      [{ id: "garbled", prepared: { body: "a" }, cause: "lost-in-transit" }],
      z.object({ body: z.string() }),
      { body: "a" },
    );
    expect(stop).toMatchObject({
      errorCode: "write_tool_outcome_unknown",
      blockedBy: "interruption",
    });
  });

  it("takes the cause from the call it repeats, not one that shares its sent arguments", async () => {
    // The same `{}` prepared as stamp 1 once, and as stamp 2 now.
    const stop = await repeatAfterStoredUnknowns(
      [
        { id: "stamp-1", prepared: { stamp: 1 }, cause: "rejection" },
        { id: "stamp-2", prepared: { stamp: 2 } },
      ],
      z.object({ stamp: z.number().default(2) }),
      {},
    );
    expect(stop).toMatchObject({
      errorCode: "write_tool_outcome_unknown",
      blockedBy: "interruption",
      // Both earlier calls sent `{}`, and either may have saved changes.
      error: expect.stringContaining("2 earlier attempts may have"),
    });
  });

  it("words a repeat neutrally when the attempts it counts do not share a cause", async () => {
    const stop = await repeatAfterStoredUnknowns(
      [
        { id: "stamp-1", prepared: { stamp: 1 }, cause: "interruption" },
        { id: "stamp-2", prepared: { stamp: 2 }, cause: "rejection" },
      ],
      z.object({ stamp: z.number().default(2) }),
      {},
    );
    expect(stop).toMatchObject({
      blockedBy: "rejection",
      held: expect.stringContaining(
        "The send action has 2 earlier attempt(s) whose outcome is unknown.",
      ),
    });
  });

  it("names no recorded cause when calls sharing its sent arguments disagree", async () => {
    // `{}` prepared as stamp 1 and stamp 2 before, and as stamp 3 now: only
    // the sent arguments match, and the two earlier calls disagree.
    const stop = await repeatAfterStoredUnknowns(
      [
        { id: "stamp-1", prepared: { stamp: 1 }, cause: "rejection" },
        { id: "stamp-2", prepared: { stamp: 2 }, cause: "unattributed" },
      ],
      z.object({ stamp: z.number().default(3) }),
      {},
    );
    expect(stop).toMatchObject({
      errorCode: "write_tool_outcome_unknown",
      blockedBy: "interruption",
    });
  });

  it("keeps the cause of a history result whose call id is ambiguous", async () => {
    const input = { body: "Refund sent" };
    const run = vi.fn(async () => "sent");
    const action = defineAction({
      description: "Send.",
      schema: z.object({ body: z.string() }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls({ send: action }, [{ name: "send", input }], {
      threadId: "thread-ambiguous-history",
      history: [
        {
          role: "assistant",
          content: [{ type: "tool-call", id: "dup", name: "send", input }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "dup",
              name: "send",
              input: { body: "Other" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "dup",
              toolName: "send",
              content: "Error running send: Upstream rejected the request.",
              isError: true,
              outcome: "unknown",
              unknownCause: "rejection",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ],
    });

    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        blockedBy: "rejection",
      }),
    );
  });

  it("names no recorded cause when a call sharing its sent arguments recorded none", async () => {
    const stop = await repeatAfterStoredUnknowns(
      [
        { id: "stamp-1", prepared: { stamp: 1 }, cause: "rejection" },
        { id: "stamp-2", prepared: { stamp: 2 } },
      ],
      z.object({ stamp: z.number().default(3) }),
      {},
    );
    expect(stop).toMatchObject({
      errorCode: "write_tool_outcome_unknown",
      blockedBy: "interruption",
    });
  });

  it("names no recorded cause when a history-only call beside a journal rejection recorded none", async () => {
    currentTurnEvents.mockResolvedValue([
      { type: "tool_start", id: "journaled", tool: "send", input: {} },
      {
        type: "tool_done",
        id: "journaled",
        tool: "send",
        input: {},
        result: "Error running send: rejected.",
        isError: true,
        outcomeUnknown: true,
        unknownCause: "rejection",
        argumentsHash: actionArgumentsHash({ stamp: 1 }),
      },
    ]);
    const run = vi.fn(async () => "sent");
    const action = defineAction({
      description: "Send.",
      schema: z.object({ stamp: z.number().default(3) }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls(
      { send: action },
      [{ name: "send", input: {} }],
      {
        threadId: "thread-cross-source",
        history: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                id: "history-only",
                name: "send",
                input: {},
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool-result",
                toolCallId: "history-only",
                toolName: "send",
                content: "Interrupted before this tool returned a result.",
                isError: true,
                outcome: "unknown",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
          },
        ],
      },
    );

    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        blockedBy: "interruption",
      }),
    );
  });

  it("keeps a rejection recorded only in the resumed history", async () => {
    const input = { body: "Refund sent" };
    const run = vi.fn(async () => "sent");
    const action = defineAction({
      description: "Send.",
      schema: z.object({ body: z.string() }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls({ send: action }, [{ name: "send", input }], {
      threadId: "thread-history-only",
      history: [
        {
          role: "assistant",
          content: [{ type: "tool-call", id: "earlier", name: "send", input }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "earlier",
              toolName: "send",
              content: "Error running send: Upstream rejected the request.",
              isError: true,
              outcome: "unknown",
              unknownCause: "rejection",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
        },
      ],
    });

    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        blockedBy: "rejection",
      }),
    );
  });

  it("names an unattributed cause for a call that returned with an effect it cannot attribute", async () => {
    const action = defineAction({
      description: "Send.",
      schema: z.object({ body: z.string() }),
      run: async () => "sent",
    });
    // An app wrapper that answers without running the action it wraps.
    const wrapped = {
      ...action,
      run: async () => "handled elsewhere",
    } as unknown as ActionEntry;
    const events = await runCalls({ send: wrapped }, [
      { name: "send", input: { body: "a" } },
      { name: "send", input: { body: "a" } },
    ]);

    expect(toolDones(events)[0]).toMatchObject({
      outcomeUnknown: true,
      unknownCause: "unattributed",
    });
    expect(toolDones(events)[0]?.isError).toBeUndefined();
    expect(toolDones(events)[1]?.result).toContain(
      "The send action ran 1 time(s), but I could not confirm what it changed.",
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "write_tool_outcome_unknown",
        blockedBy: "unattributed",
      }),
    );
  });

  it("still reads a plain handler failure as possibly written", async () => {
    const run = vi.fn(async () => {
      fail("Upstream rejected the request.");
    });
    const action = defineAction({
      description: "Send.",
      schema: z.object({ body: z.string() }),
      run,
    }) as unknown as ActionEntry;
    const events = await runCalls({ send: action }, [
      { name: "send", input: { body: "a" } },
    ]);

    expect(toolDones(events)[0]).toMatchObject({
      outcomeUnknown: true,
      unknownCause: "rejection",
    });
    expect(toolDones(events)[0]?.errorClass).toBeUndefined();
  });
});
