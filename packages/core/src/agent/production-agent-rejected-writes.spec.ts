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

const { runAgentLoop } = await import("./production-agent.js");
import { actionArgumentsHash } from "../action-arguments-identity.js";
import { defineAction, fail, NoWriteError } from "../action.js";
import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
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
  resumed?: { threadId: string },
): Promise<AgentChatEvent[]> {
  const events: AgentChatEvent[] = [];
  await runAgentLoop({
    ...(resumed ? { ...resumed, internalContinuation: true } : {}),
    engine: scriptedEngine(calls),
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [{ role: "user", content: [{ type: "text", text: "Edit." }] }],
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
    expect(toolDones(events)[0]).toMatchObject({ outcomeUnknown: true });
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
    ["rejection", "Error running send: Upstream rejected the request."],
    ["interruption", "Tool call timed out after 20 seconds"],
  ] as const)(
    "names the recorded cause, %s, when a resumed turn repeats the call",
    async (cause, result) => {
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
    });
    expect(toolDones(events)[0]?.errorClass).toBeUndefined();
  });
});
