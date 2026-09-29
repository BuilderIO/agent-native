import { describe, expect, it } from "vitest";

import type {
  AgentEvent,
  AgentSuggestion,
  AgentThreadSnapshot,
  AgentTransport,
} from "../protocol/index.js";
import { AgentKitClient } from "./client.js";
import {
  createAgentThreadState,
  reduceAgentEvent,
  selectAgentSuggestions,
} from "./state.js";

const at = "2026-09-29T00:00:00.000Z";
const suggestion = {
  id: "refine",
  label: "Refine",
  prompt: "Refine the selected design using the agreed layout.",
  metadata: { context: "Selected design: example" },
} satisfies AgentSuggestion;
function event(
  sequence: number,
  payload: Record<string, unknown>,
  runId = "run-1",
): AgentEvent {
  return {
    id: `${runId}-${sequence}`,
    threadId: "thread-1",
    runId,
    sequence,
    occurredAt: at,
    ...payload,
  } as AgentEvent;
}
function completed() {
  return [
    event(1, { type: "run.started" }),
    event(2, { type: "suggestions.updated", suggestions: [suggestion] }),
    event(3, { type: "run.completed" }),
  ].reduce(reduceAgentEvent, createAgentThreadState("thread-1"));
}

describe("completed-turn suggestions", () => {
  it.each([false, true])(
    "refreshes chips after consecutive chip submissions and cold history (event replay: %s)",
    async (replay) => {
      let snapshot: AgentThreadSnapshot = {
        id: "thread-1",
        createdAt: at,
        updatedAt: at,
        messages: [],
      };
      let turn = 0;
      const requests: Parameters<AgentTransport["startRun"]>[0][] = [];
      const transport: AgentTransport = {
        getThreadSnapshot: async () => snapshot,
        async persistThreadSnapshot(input) {
          snapshot = structuredClone(input.snapshot);
          if (!replay) delete snapshot.events;
        },
        async startRun(input) {
          requests.push(input);
          return { runId: `run-${++turn}` };
        },
        async *subscribeToRun({ runId }) {
          yield event(1, { type: "run.started" }, runId);
          yield event(
            2,
            {
              type: "message.completed",
              message: {
                id: `assistant-${turn}`,
                role: "assistant",
                parts: [{ type: "text", text: `Completed step ${turn}.` }],
              },
            },
            runId,
          );
          yield event(
            3,
            {
              type: "suggestions.updated",
              suggestions: [
                {
                  ...suggestion,
                  metadata: undefined,
                  id: `${runId}:follow-up:1`,
                  label: `Next step ${turn}`,
                  prompt: `Continue from step ${turn}.`,
                },
              ],
            },
            runId,
          );
          yield event(4, { type: "run.completed" }, runId);
        },
        async cancelRun() {},
      };
      const client = new AgentKitClient({ transport, now: () => at });
      const cold = new AgentKitClient({ transport });
      try {
        await client.loadThread("thread-1");
        let text = "Create a design";
        for (let index = 1; index <= 3; index++) {
          await (
            await client.sendMessage({ threadId: "thread-1", text })
          ).completed;
          const thread = client.getThread("thread-1");
          const fresh = selectAgentSuggestions(thread);
          expect(fresh).toHaveLength(1);
          expect(fresh[0]).toMatchObject({
            id: `run-${index}:follow-up:1`,
            runId: `run-${index}`,
            label: `Next step ${index}`,
          });
          expect(thread.suggestionsUserMessageId).toBe(
            thread.messages.findLast((message) => message.role === "user")?.id,
          );
          expect(requests[index - 1].messages.at(-1)?.parts).toEqual([
            { type: "text", text },
          ]);
          text = fresh[0].prompt;
        }
        await cold.loadThread("thread-1");
        expect(selectAgentSuggestions(cold.getThread("thread-1"))).toEqual(
          selectAgentSuggestions(client.getThread("thread-1")),
        );
      } finally {
        client.dispose();
        cold.dispose();
      }
    },
  );

  it("stages model suggestions until successful completion, preserving the full payload", () => {
    let thread = reduceAgentEvent(
      createAgentThreadState("thread-1"),
      event(1, { type: "run.started" }),
    );
    thread = reduceAgentEvent(
      thread,
      event(2, { type: "suggestions.updated", suggestions: [suggestion] }),
    );
    expect(selectAgentSuggestions(thread)).toEqual([]);
    thread = reduceAgentEvent(thread, event(3, { type: "run.completed" }));
    expect(selectAgentSuggestions(thread)).toEqual([
      { ...suggestion, runId: "run-1" },
    ]);
  });

  it.each(["failed", "cancelled", "awaiting_approval"] as const)(
    "hides suggestions for %s runs",
    (status) => {
      const thread = completed();
      thread.runs["run-1"].status = status;
      expect(selectAgentSuggestions(thread)).toEqual([]);
    },
  );

  it("keeps explicit empty agent output empty", () => {
    let thread = reduceAgentEvent(
      createAgentThreadState("thread-1"),
      event(1, { type: "run.started" }),
    );
    thread = reduceAgentEvent(
      thread,
      event(2, { type: "suggestions.updated", suggestions: [suggestion] }),
    );
    thread = reduceAgentEvent(
      thread,
      event(3, { type: "suggestions.updated", suggestions: [] }),
    );
    thread = reduceAgentEvent(thread, event(4, { type: "run.completed" }));
    expect(selectAgentSuggestions(thread)).toEqual([]);
  });

  it("clears old chips on a new run and ignores an older run's late suggestions", () => {
    let thread = reduceAgentEvent(
      createAgentThreadState("thread-1"),
      event(1, { type: "run.started" }),
    );
    thread = reduceAgentEvent(
      thread,
      event(2, { type: "suggestions.updated", suggestions: [suggestion] }),
    );
    thread = reduceAgentEvent(
      thread,
      event(1, { type: "run.started" }, "run-2"),
    );
    expect(thread.suggestions).toEqual([]);
    thread = reduceAgentEvent(
      thread,
      event(3, { type: "suggestions.updated", suggestions: [suggestion] }),
    );
    expect(thread.suggestions).toEqual([]);
    thread = reduceAgentEvent(thread, event(4, { type: "run.completed" }));
    thread = reduceAgentEvent(
      thread,
      event(2, { type: "run.completed" }, "run-2"),
    );
    expect(selectAgentSuggestions(thread)).toEqual([]);
  });

  it("does not expose old suggestions while a new start or history load is pending", async () => {
    const start = Promise.withResolvers<{ runId: string }>();
    const load = Promise.withResolvers<AgentThreadSnapshot>();
    const thread = completed();
    const snapshot: AgentThreadSnapshot = {
      id: "thread-1",
      createdAt: at,
      updatedAt: at,
      messages: [],
      events: thread.events,
      suggestions: thread.suggestions,
    };
    const transport: AgentTransport = {
      getThreadSnapshot: async () => snapshot,
      startRun: () => start.promise,
      async *subscribeToRun() {
        yield event(1, { type: "run.started" }, "run-2");
        yield event(2, { type: "run.completed" }, "run-2");
      },
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport, now: () => at });
    await client.loadThread("thread-1");
    expect(selectAgentSuggestions(client.getThread("thread-1"))).toHaveLength(
      1,
    );
    transport.getThreadSnapshot = () => load.promise;
    const loading = client.loadThread("thread-1");
    const sending = client.sendMessage({
      threadId: "thread-1",
      text: "New request",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(selectAgentSuggestions(client.getThread("thread-1"))).toEqual([]);
    load.resolve(snapshot);
    await loading;
    expect(selectAgentSuggestions(client.getThread("thread-1"))).toEqual([]);
    start.resolve({ runId: "run-2" });
    await (
      await sending
    ).completed;
    expect(selectAgentSuggestions(client.getThread("thread-1"))).toEqual([]);
    client.dispose();
  });

  it.each([false, true])(
    "restores canonical completed-run suggestions in a fresh client (event replay: %s)",
    async (replay) => {
      const snapshot: AgentThreadSnapshot = {
        id: "thread-1",
        createdAt: at,
        updatedAt: at,
        messages: [
          {
            id: "user-1",
            role: "user",
            parts: [{ type: "text", text: "Create a design" }],
          },
          {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "Created the design" }],
          },
        ],
        ...(replay
          ? { events: completed().events }
          : {
              runs: [
                {
                  id: "run-1",
                  threadId: "thread-1",
                  status: "completed",
                  lastSequence: 3,
                  startedAt: at,
                  completedAt: at,
                },
              ],
              suggestions: [{ ...suggestion, runId: "run-1" }],
            }),
      };
      const client = new AgentKitClient({
        transport: {
          getThreadSnapshot: async () => snapshot,
          async startRun() {
            return { runId: "new" };
          },
          async *subscribeToRun() {},
          async cancelRun() {},
        },
      });
      try {
        await client.loadThread("thread-1");
        expect(selectAgentSuggestions(client.getThread("thread-1"))).toEqual([
          { ...suggestion, runId: "run-1" },
        ]);
      } finally {
        client.dispose();
      }
    },
  );

  it.each(["older-run", "unscoped", "empty"])(
    "does not restore %s suggestions as latest follow-ups",
    async (kind) => {
      const snapshot: AgentThreadSnapshot = {
        id: "thread-1",
        createdAt: at,
        updatedAt: at,
        messages: [],
        runs: [
          {
            id: "old",
            threadId: "thread-1",
            status: "completed",
            lastSequence: 3,
            startedAt: at,
          },
          {
            id: "latest",
            threadId: "thread-1",
            status: "completed",
            lastSequence: 3,
            startedAt: "2026-09-29T00:01:00.000Z",
          },
        ],
        suggestions:
          kind === "empty"
            ? []
            : [
                {
                  ...suggestion,
                  ...(kind === "older-run" ? { runId: "old" } : {}),
                },
              ],
      };
      const client = new AgentKitClient({
        transport: {
          getThreadSnapshot: async () => snapshot,
          async startRun() {
            return { runId: "latest" };
          },
          async *subscribeToRun() {},
          async cancelRun() {},
        },
      });
      await client.loadThread("thread-1");
      expect(selectAgentSuggestions(client.getThread("thread-1"))).toEqual([]);
      client.dispose();
    },
  );
});
