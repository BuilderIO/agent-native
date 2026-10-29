import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { actionArgumentsHash } from "../action-arguments-identity.js";
import { defineAction } from "../action.js";
import * as journalSeed from "./engine/tool-call-journal-seed.js";
import { EngineError } from "./engine/types.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { runAgentLoop, type ActionEntry } from "./production-agent.js";
import * as runStore from "./run-store.js";
import { classifyToolCallJournal } from "./tool-call-journal.js";
import type { AgentChatEvent } from "./types.js";

describe("failed tool attempts", () => {
  it.each(["mutation", "continuation"])(
    "keeps colon-prefixed tool names separate across a %s boundary",
    async (boundary) => {
      const lookup = vi.fn(async () => {
        throw new Error("Service busy");
      });
      const save = vi.fn(async () => "Saved the view");
      const lookupAction = defineAction({
        description: "Look up a view",
        readOnly: true,
        schema: z.object({ attempt: z.number() }),
        run: lookup,
      });
      const saveAction = defineAction({
        description: "Save a view",
        readOnly: false,
        schema: z.object({}),
        run: save,
      });
      const calls =
        boundary === "continuation"
          ? [{ name: "view", input: {} }]
          : [
              { name: "view:lookup", input: { attempt: 0 } },
              { name: "view:lookup", input: { attempt: 1 } },
              { name: "view", input: {} },
              { name: "view:lookup", input: { attempt: 2 } },
              { name: "view:lookup", input: { attempt: 3 } },
              { name: "view:lookup", input: { attempt: 4 } },
            ];
      let step = 0;
      const engine: AgentEngine = {
        name: "test",
        label: "Test",
        defaultModel: "test",
        supportedModels: ["test"],
        capabilities: {
          thinking: false,
          promptCaching: false,
          vision: false,
          computerUse: false,
          parallelToolCalls: false,
        },
        async *stream(): AsyncIterable<EngineEvent> {
          const call = calls[step++];
          if (call) {
            yield { type: "tool-call", id: `call-${step}`, ...call };
            yield { type: "stop", reason: "tool_use" };
          } else {
            yield {
              type: "assistant-content",
              parts: [{ type: "text", text: "Finished checking the views." }],
            };
            yield { type: "stop", reason: "end_turn" };
          }
        },
      };
      const priorEvents: AgentChatEvent[] = Array.from(
        { length: 3 },
        (_, attempt): AgentChatEvent[] => [
          {
            type: "tool_start",
            id: `prior-${attempt}`,
            tool: "view:lookup",
            input: { attempt },
          },
          {
            type: "tool_done",
            id: `prior-${attempt}`,
            tool: "view:lookup",
            input: { attempt },
            result: "Error running view:lookup: Service busy",
            isError: true,
            completedSideEffect: false,
          },
        ],
      ).flat();
      const read =
        boundary === "continuation"
          ? vi
              .spyOn(runStore, "getCurrentTurnEventsForThread")
              .mockResolvedValue(priorEvents)
          : undefined;
      const events: AgentChatEvent[] = [];
      try {
        await runAgentLoop({
          engine,
          model: "test",
          systemPrompt: "Test",
          tools: [],
          messages: [
            { role: "user", content: [{ type: "text", text: "Check views" }] },
          ],
          actions: {
            "view:lookup": lookupAction as unknown as ActionEntry,
            view: saveAction as unknown as ActionEntry,
          },
          ...(read
            ? { threadId: "fixture-thread", turnId: "fixture-turn" }
            : {}),
          send: (event) => events.push(event),
          signal: new AbortController().signal,
        });
      } finally {
        read?.mockRestore();
      }
      expect(save).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledTimes(boundary === "mutation" ? 5 : 0);
      if (boundary === "continuation") {
        expect(events.filter((event) => event.type === "error")).toEqual([]);
      }
    },
  );

  it("stops plan-mode write rejections with a visible approval remedy", async () => {
    const run = vi.fn(async () => "saved");
    const action = defineAction({
      description: "Update a view",
      readOnly: false,
      schema: z.object({ attempt: z.number() }),
      run,
    });
    let attempt = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test",
      supportedModels: ["test"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        if (attempt === 8) {
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        attempt += 1;
        yield {
          type: "tool-call",
          id: `call-${attempt}`,
          name: "update-view",
          input: { attempt },
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: AgentChatEvent[] = [];
    await runAgentLoop({
      engine,
      model: "test",
      systemPrompt: "Test",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "Update a view" }] },
      ],
      actions: { "update-view": action as unknown as ActionEntry },
      executionMode: "plan",
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });
    expect(run).not.toHaveBeenCalled();
    expect(
      events.filter((event) => event.type === "tool_done" && event.isError),
    ).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "permanent_precondition",
        error: expect.stringContaining("Switch to Act mode"),
      }),
    );
  });

  it("resets a tool's failure streak after a fresh successful execution", async () => {
    const run = vi.fn(async ({ attempt }: { attempt: number }) => {
      if (attempt % 5 !== 0) throw new Error(`Failure variant ${attempt}`);
      return "found";
    });
    const action = defineAction({
      description: "Check a view",
      readOnly: true,
      schema: z.object({ attempt: z.number() }),
      run,
    });
    let attempt = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test",
      supportedModels: ["test"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        if (attempt === 10) {
          yield {
            type: "assistant-content",
            parts: [{ type: "text", text: "Checks complete." }],
          };
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        attempt += 1;
        yield {
          type: "tool-call",
          id: `call-${attempt}`,
          name: "check-view",
          input: { attempt },
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: AgentChatEvent[] = [];
    await runAgentLoop({
      engine,
      model: "test",
      systemPrompt: "Test",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "Check views" }] },
      ],
      actions: { "check-view": action as unknown as ActionEntry },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });
    expect(run).toHaveBeenCalledTimes(10);
    const results = events.filter((event) => event.type === "tool_done");
    expect(results.filter((event) => event.isError)).toHaveLength(8);
    expect(
      results.filter(
        (event) => !event.isError && !event.replayed && !event.notExecuted,
      ),
    ).toHaveLength(2);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
  });

  it.each([false, true])(
    "preserves failed attempts when a cached read returns (continued: %s)",
    async (continued) => {
      const run = vi.fn(async ({ attempt }: { attempt: number }) => {
        if (attempt !== 0) throw new Error(`Failure variant ${attempt}`);
        return "Found the view";
      });
      const action = defineAction({
        description: "Check a view",
        readOnly: true,
        schema: z.object({ attempt: z.number() }),
        run,
      });
      let nextCall = 0;
      const runInputs = async (
        inputs: number[],
        events: AgentChatEvent[],
        priorEvents?: AgentChatEvent[],
      ) => {
        let step = 0;
        const engine: AgentEngine = {
          name: "test",
          label: "Test",
          defaultModel: "test",
          supportedModels: ["test"],
          capabilities: {
            thinking: false,
            promptCaching: false,
            vision: false,
            computerUse: false,
            parallelToolCalls: false,
          },
          async *stream(): AsyncIterable<EngineEvent> {
            if (step === inputs.length) {
              yield { type: "stop", reason: "end_turn" };
              return;
            }
            yield {
              type: "tool-call",
              id: `call-${nextCall++}`,
              name: "check-view",
              input: { attempt: inputs[step++] },
            };
            yield { type: "stop", reason: "tool_use" };
          },
        };
        const read = priorEvents
          ? vi
              .spyOn(runStore, "getCurrentTurnEventsForThread")
              .mockResolvedValue(priorEvents)
          : undefined;
        try {
          await runAgentLoop({
            engine,
            model: "test",
            systemPrompt: "Test",
            tools: [],
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "Check views" }],
              },
            ],
            actions: { "check-view": action as unknown as ActionEntry },
            ...(priorEvents
              ? { threadId: "fixture-thread", turnId: "fixture-turn" }
              : {}),
            send: (event) => events.push(event),
            signal: new AbortController().signal,
          });
        } finally {
          read?.mockRestore();
        }
      };
      const events: AgentChatEvent[] = [];
      if (continued) {
        const priorEvents: AgentChatEvent[] = [];
        await runInputs([0, 1, 2, 3, 4, 0], priorEvents);
        await runInputs([5, 6, 7, 8], events, priorEvents);
      } else {
        await runInputs([0, 1, 2, 3, 4, 0, 5, 6, 7, 8], events);
      }
      expect(run).toHaveBeenCalledTimes(6);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "error",
          errorCode: "repeated_tool_failure",
          error: expect.stringContaining("Failure variant 5"),
        }),
      );
    },
  );

  it.each([
    { previousFailures: 0, equivalent: false },
    { previousFailures: 4, equivalent: false },
    { previousFailures: 5, equivalent: false },
    { previousFailures: 0, equivalent: true },
    { previousFailures: 2, equivalent: true },
    { previousFailures: 3, equivalent: true },
  ])(
    "bounds parallel dispatch after $previousFailures failures (equivalent: $equivalent)",
    async ({ previousFailures, equivalent }) => {
      const limit = equivalent ? 3 : 5;
      const priorEvents: AgentChatEvent[] = Array.from(
        { length: previousFailures },
        (_, attempt): AgentChatEvent[] => [
          {
            type: "tool_start",
            id: `prior-${attempt}`,
            tool: "check-view",
            input: { attempt: -attempt - 1 },
          },
          {
            type: "tool_done",
            id: `prior-${attempt}`,
            tool: "check-view",
            input: { attempt: -attempt - 1 },
            result: equivalent
              ? "Error running check-view: Transient provider failure"
              : `Earlier failure ${attempt}`,
            isError: true,
            completedSideEffect: false,
          },
        ],
      ).flat();
      const read = vi
        .spyOn(runStore, "getCurrentTurnEventsForThread")
        .mockResolvedValue(priorEvents);
      const run = vi.fn(async ({ attempt }: { attempt: number }) => {
        throw new Error(
          equivalent
            ? "Transient provider failure"
            : `Failure variant ${attempt}`,
        );
      });
      const action = defineAction({
        description: "Check a view",
        readOnly: true,
        schema: z.object({ attempt: z.number() }),
        run,
      });
      let step = 0;
      const engine: AgentEngine = {
        name: "test",
        label: "Test",
        defaultModel: "test",
        supportedModels: ["test"],
        capabilities: {
          thinking: false,
          promptCaching: false,
          vision: false,
          computerUse: false,
          parallelToolCalls: true,
        },
        async *stream(): AsyncIterable<EngineEvent> {
          if (step++ === 0) {
            for (let attempt = 0; attempt < 30; attempt++) {
              yield {
                type: "tool-call",
                id: `batch-${attempt}`,
                name: "check-view",
                input: { attempt },
              };
            }
            yield { type: "stop", reason: "tool_use" };
          } else {
            yield { type: "stop", reason: "end_turn" };
          }
        },
      };
      const events: AgentChatEvent[] = [];
      try {
        await runAgentLoop({
          engine,
          model: "test",
          systemPrompt: "Test",
          tools: [],
          messages: [
            { role: "user", content: [{ type: "text", text: "Check views" }] },
          ],
          actions: { "check-view": action as unknown as ActionEntry },
          threadId: "fixture-thread",
          turnId: "fixture-turn",
          send: (event) => events.push(event),
          signal: new AbortController().signal,
        });
      } finally {
        read.mockRestore();
      }
      expect(run).toHaveBeenCalledTimes(limit - previousFailures);
      if (!equivalent) {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "error",
            errorCode: "repeated_tool_failure",
          }),
        );
      }
      const visible = events.reduce((text, event) => {
        if (event.type === "clear") return "";
        if (event.type === "error") return text + event.error;
        return event.type === "text" ? text + event.text : text;
      }, "");
      expect(visible).toContain(
        equivalent
          ? "Transient provider failure"
          : previousFailures === 5
            ? "Earlier failure 4"
            : "Failure variant",
      );
      expect(visible).toMatch(/stopped/i);
      expect(
        events.filter(
          (event) => event.type === "tool_done" && event.notExecuted,
        ),
      ).toHaveLength(30 - limit + previousFailures);
    },
  );

  it.each([
    { varied: false, limit: 3, interruptedCloseout: false },
    { varied: false, limit: 3, interruptedCloseout: true },
    { varied: true, limit: 5, interruptedCloseout: false },
  ])(
    "stops despite changing arguments (varied errors: $varied)",
    async ({ varied, limit, interruptedCloseout }) => {
      const run = vi.fn(async () => "saved");
      const action = defineAction({
        description: "Update a view",
        schema: z
          .object({ attempt: z.number(), payload: z.string() })
          .superRefine((input, context) => {
            context.addIssue({
              code: "custom",
              message: varied
                ? `Invalid variant ${input.attempt}`
                : "Invalid patch",
            });
          }),
        run,
      });
      let steps = 0;
      const engine: AgentEngine = {
        name: "test",
        label: "Test",
        defaultModel: "test",
        supportedModels: ["test"],
        capabilities: {
          thinking: false,
          promptCaching: false,
          vision: false,
          computerUse: false,
          parallelToolCalls: false,
        },
        async *stream(): AsyncIterable<EngineEvent> {
          steps += 1;
          if (interruptedCloseout && steps === limit + 1) {
            throw new EngineError("Connection interrupted", {
              errorCode: "provider_network_error",
            });
          }
          if (steps > 8) {
            yield { type: "stop", reason: "end_turn" };
            return;
          }
          yield {
            type: "tool-call",
            name: "update-view",
            id: `attempt-${steps}`,
            input: { attempt: steps, payload: "x".repeat(1000) },
          };
          yield { type: "stop", reason: "tool_use" };
        },
      };
      const events: AgentChatEvent[] = [];
      await runAgentLoop({
        engine,
        model: "test",
        systemPrompt: "Test",
        tools: [],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Match three views to a fourth." }],
          },
        ],
        actions: { "update-view": action as unknown as ActionEntry },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
      expect(run).not.toHaveBeenCalled();
      const failures = events.filter(
        (event) => event.type === "tool_done" && event.isError,
      );
      expect(failures).toHaveLength(limit);
      expect(steps).toBeLessThanOrEqual(limit + (interruptedCloseout ? 2 : 1));
      const visible = events.reduce((text, event) => {
        if (event.type === "clear") return "";
        if (event.type === "error") return text + event.error;
        return event.type === "text" ? text + event.text : text;
      }, "");
      expect(visible).toContain("Invalid");
      expect(visible).toMatch(/stopped/i);
      expect(visible).toContain("update-view");
      if (varied) {
        expect(events.filter((event) => event.type === "text")).toHaveLength(0);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "error",
            errorCode: "repeated_tool_failure",
          }),
        );
      }
    },
  );

  it("does not reset continued failures when an earlier success is replayed", async () => {
    const priorToolCallSequence: journalSeed.PriorTurnToolCallSequenceEntry[] =
      Array.from({ length: 5 }, (_, attempt) => ({
        event: "done",
        name: "update-view",
        input: { attempt },
        result: attempt === 0 ? "saved" : `Earlier failure ${attempt}`,
        isError: attempt > 0,
        completedSideEffect: attempt === 0,
        matchedStart: true,
      }));
    const priorEvents: AgentChatEvent[] = priorToolCallSequence.flatMap(
      (call, index) => {
        if (call.event !== "done") throw new Error("Expected a completed call");
        return [
          {
            type: "tool_start",
            id: `prior-${index}`,
            tool: call.name,
            input: { attempt: index },
          },
          {
            type: "tool_done",
            id: `prior-${index}`,
            tool: call.name,
            input: { attempt: index },
            result: call.result,
            isError: call.isError,
            completedSideEffect: call.completedSideEffect === true,
            argumentsHash: actionArgumentsHash({ attempt: index }),
          },
        ];
      },
    );
    const read = vi
      .spyOn(journalSeed, "loadPriorTurnToolCallJournal")
      .mockResolvedValue({
        status: "read",
        events: priorEvents,
        toolCallJournal: classifyToolCallJournal(priorEvents),
        priorToolCalls: [],
        priorToolResults: [],
        priorToolCallSequence,
      });
    const run = vi.fn(async () => "saved");
    const action = defineAction({
      description: "Update a view",
      readOnly: false,
      schema: z.object({ attempt: z.number().max(0) }),
      run,
    });
    let step = 0;
    const engine: AgentEngine = {
      name: "test",
      label: "Test",
      defaultModel: "test",
      supportedModels: ["test"],
      capabilities: {
        thinking: false,
        promptCaching: false,
        vision: false,
        computerUse: false,
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        step += 1;
        if (step > 2) {
          yield { type: "stop", reason: "end_turn" };
          return;
        }
        yield {
          type: "tool-call",
          id: `call-${step}`,
          name: "update-view",
          input: { attempt: step === 1 ? 0 : 5 },
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    const events: AgentChatEvent[] = [];
    try {
      await runAgentLoop({
        engine,
        model: "test",
        systemPrompt: "Test",
        tools: [],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Continue updating the view." }],
          },
        ],
        threadId: "fixture-thread",
        turnId: "fixture-turn",
        actions: { "update-view": action as unknown as ActionEntry },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      });
    } finally {
      read.mockRestore();
    }
    expect(run).not.toHaveBeenCalled();
    expect(
      events.some((event) => event.type === "tool_done" && event.replayed),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "error" && event.error.includes("failed 5 times"),
      ),
    ).toBe(true);
  });
});
