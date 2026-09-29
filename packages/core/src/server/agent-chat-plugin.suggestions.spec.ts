import { describe, expect, it, vi } from "vitest";

import { AgentKitClient } from "../../../agentkit/src/client/client.js";
import { selectAgentSuggestions } from "../../../agentkit/src/client/state.js";
import { identifyFollowUpSuggestions } from "../agent/follow-up-suggestions.js";
import {
  buildAssistantMessage,
  buildUserMessage,
  mergeThreadDataForClientSave,
  upsertUserMessage,
  type ThreadSuggestionRun,
} from "../agent/thread-data-builder.js";
import type { AgentChatEvent } from "../agent/types.js";
import { createAgentNativeAgentKitTransport } from "../client/chat/agentkit-agent-native.js";
import { foldAgentChatRunCompletion } from "./agent-chat-plugin.js";

vi.mock("../client/use-agent-chat-running-threads.js", () => ({
  dispatchAgentChatRunning: vi.fn(),
}));

const epoch = Date.parse("2026-09-28T12:00:00.000Z");
function run(id: string, offset = 1_000): ThreadSuggestionRun {
  return {
    runId: id,
    turnId: `turn-${id}`,
    threadId: "thread-1",
    startedAt: epoch + offset,
    status: "completed",
    events: [
      { seq: 0, event: { type: "suggestions", suggestions: [] } },
      { seq: 1, event: { type: "text", text: `Finished ${id}.` } },
      {
        seq: 2,
        event: {
          type: "suggestions",
          suggestions: identifyFollowUpSuggestions(
            [
              {
                label: "Refine the layout",
                prompt: `Refine the design created by ${id}.`,
              },
            ],
            id,
          ),
        },
      },
      { seq: 3, event: { type: "done" } },
    ],
  };
}
function submit(repo: any, current: ThreadSuggestionRun) {
  return upsertUserMessage(
    repo,
    buildUserMessage({
      text: `Create design ${current.runId}.`,
      runId: current.runId,
      turnId: current.turnId,
      createdAt: new Date(current.startedAt - 100),
    }),
  );
}
function complete(repo: any, current: ThreadSuggestionRun) {
  return foldAgentChatRunCompletion(
    repo,
    buildAssistantMessage(current.events, current.runId, {
      turnId: current.turnId,
    }),
    current,
  );
}
async function coldLoad(repo: unknown) {
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      const url = String(input);
      const body = url.endsWith("/threads/thread-1")
        ? {
            id: "thread-1",
            createdAt: new Date(epoch).toISOString(),
            updatedAt: new Date(epoch + 10_000).toISOString(),
            threadData: JSON.stringify(repo),
          }
        : url.endsWith("/runs/active?threadId=thread-1")
          ? { active: false }
          : undefined;
      if (!body) throw new Error(`Unexpected cold-load request: ${url}`);
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  const transport = createAgentNativeAgentKitTransport({
    fetch: fetcher as typeof fetch,
  });
  const client = new AgentKitClient({ transport });
  try {
    await client.loadThread("thread-1");
    const thread = client.getThread("thread-1");
    return {
      thread,
      suggestions: selectAgentSuggestions(thread),
      requests: fetcher.mock.calls,
    };
  } finally {
    await client.dispose();
    await transport.dispose?.();
  }
}

describe("server-authored follow-up snapshot", () => {
  it.each([
    {
      event: {
        type: "approval_required",
        tool: "save",
        input: {},
        approvalKey: "approval-1",
      } as AgentChatEvent,
      status: "awaiting_approval",
    },
    {
      event: {
        type: "connection_required",
        requestId: "connect-1",
        provider: "example",
        reason: "connect",
      } as AgentChatEvent,
      status: "awaiting_input",
    },
    {
      event: { type: "auto_continue", reason: "run_timeout" } as AgentChatEvent,
      status: "failed",
    },
  ])(
    "does not mark $status completion as a successful suggestion source",
    async ({ event, status }) => {
      const current = run("run-1");
      current.events.push({ seq: 4, event });
      const saved = complete(submit({ messages: [] }, current), current);
      const restored = await coldLoad(saved);
      expect(restored.thread.runs[current.runId].status).toBe(status);
      expect(restored.suggestions).toEqual([]);
    },
  );

  it("clears chips on a repeated-text new user turn", async () => {
    const current = run("run-1");
    const saved = complete(submit({ messages: [] }, current), current);
    const repeated = structuredClone(saved.messages[0]);
    repeated.message.id = "user-repeat";
    repeated.message.metadata = {};
    repeated.message.createdAt = new Date(epoch + 5_000).toISOString();
    const merged = mergeThreadDataForClientSave(saved, {
      ...saved,
      messages: [...saved.messages, repeated],
    });
    expect((await coldLoad(merged)).suggestions).toEqual([]);
  });
  it("accepts compatible runtime ids and optional protocol fields without native id formatting", async () => {
    const current = run("run-compatible");
    const suggestions = [
      {
        id: "refine-design",
        label: "Refine layout",
        runId: current.runId,
        metadata: { source: "compatible-runtime" },
      },
    ];
    current.events[2] = { seq: 2, event: { type: "suggestions", suggestions } };
    const saved = complete(submit({ messages: [] }, current), current);
    expect((await coldLoad(saved)).suggestions).toEqual(suggestions);
  });

  it("preserves richer client progress while keeping the server terminal status", () => {
    const current = run("run-1");
    const saved = complete(submit({ messages: [] }, current), current);
    saved.agentKit.runs[0].metadata = { retained: true };
    const enriched = {
      ...saved,
      agentKit: {
        ...saved.agentKit,
        runs: [
          {
            ...saved.agentKit.runs[0],
            lastSequence: 43,
            completedAt: new Date(epoch + 2_000).toISOString(),
            usage: { inputTokens: 100, outputTokens: 20 },
            metadata: { client: true },
          },
        ],
      },
    };
    const merged = mergeThreadDataForClientSave(saved, enriched);
    expect(merged.agentKit.runs[0]).toMatchObject({
      status: "completed",
      lastSequence: 43,
      completedAt: enriched.agentKit.runs[0].completedAt,
      usage: enriched.agentKit.runs[0].usage,
      metadata: { retained: true, client: true },
    });
    expect(
      mergeThreadDataForClientSave(merged, saved).agentKit.runs[0],
    ).toEqual(merged.agentKit.runs[0]);
  });

  it("preserves unrelated user metadata while retaining server-submitted run identity", () => {
    const current = run("run-1");
    const saved = submit({ messages: [] }, current);
    saved.messages[0].message.metadata.retained = true;
    saved.messages[0].message.metadata.custom.retained = true;
    const incoming = structuredClone(saved);
    incoming.messages[0].message.metadata = {
      client: true,
      custom: { selection: "canvas" },
    };
    const merged = mergeThreadDataForClientSave(saved, incoming);
    expect(merged.messages[0].message.metadata).toEqual({
      retained: true,
      client: true,
      custom: {
        retained: true,
        selection: "canvas",
        submittedRunId: current.runId,
        submittedTurnId: current.turnId,
      },
    });
  });
  it("hydrates completed suggestions without a client saver or run replay", async () => {
    const current = run("run-1");
    const saved = complete(submit({ messages: [] }, current), current);
    const restored = await coldLoad(saved);
    expect(restored.suggestions).toEqual(
      current.events[2].event.type === "suggestions"
        ? current.events[2].event.suggestions
        : [],
    );
    expect(restored.thread.runs["run-1"]).toMatchObject({
      status: "completed",
      startedAt: new Date(current.startedAt).toISOString(),
    });
    expect(restored.thread.messages.at(-1)?.parts).toContainEqual({
      type: "text",
      text: "Finished run-1.",
    });
    expect(restored.requests).toHaveLength(2);
  });

  it("keeps only the latest run's chips and preserves unrelated thread metadata", async () => {
    const first = run("run-1");
    const second = run("run-2", 2_000);
    const initial = {
      messages: [],
      queuedMessages: [
        {
          id: "queued-1",
          text: "Later",
          createdAt: new Date(epoch).toISOString(),
        },
      ],
      retained: { value: true },
      agentKit: { annotations: [], widgets: [], custom: "keep" },
    };
    const savedFirst = complete(submit(initial, first), first);
    const saved = complete(submit(savedFirst, second), second);
    const restored = await coldLoad(saved);
    expect(restored.suggestions.map((suggestion) => suggestion.runId)).toEqual([
      "run-2",
    ]);
    expect(saved.retained).toEqual(initial.retained);
    expect(saved.queuedMessages).toEqual(initial.queuedMessages);
    expect(saved.agentKit).toMatchObject(initial.agentKit);
    expect(
      saved.agentKit.runs.map((entry: any) => [entry.id, entry.status]),
    ).toEqual([
      ["run-1", "completed"],
      ["run-2", "completed"],
    ]);
  });

  it.each(["errored", "aborted"] as const)(
    "does not revive older chips after an unattended %s run",
    async (status) => {
      const first = run("run-1");
      const second = { ...run("run-2", 2_000), status };
      const old = complete(submit({ messages: [] }, first), first);
      const saved = complete(submit(old, second), second);
      const restored = await coldLoad(saved);
      expect(restored.suggestions).toEqual([]);
      expect(restored.thread.runs["run-2"].status).toBe(
        status === "aborted" ? "cancelled" : "failed",
      );
      const staleSave = mergeThreadDataForClientSave(saved, old);
      expect((await coldLoad(staleSave)).suggestions).toEqual([]);
    },
  );

  it("clears chips for a cancelled run without any assistant message", async () => {
    const first = run("run-1");
    const second = {
      ...run("run-2", 2_000),
      status: "aborted" as const,
      events: [],
    };
    const old = complete(submit({ messages: [] }, first), first);
    const saved = complete(submit(old, second), second);
    expect((await coldLoad(saved)).suggestions).toEqual([]);
    expect(saved.agentKit.runs.at(-1).status).toBe("cancelled");
  });

  it("clears chips on submission and rejects a late completion of the previous turn", async () => {
    const first = run("run-1");
    const second = run("run-2", 2_000);
    const old = complete(submit({ messages: [] }, first), first);
    const submitted = submit(old, second);
    expect((await coldLoad(submitted)).suggestions).toEqual([]);
    const lateCompletion = complete(submitted, first);
    expect((await coldLoad(lateCompletion)).suggestions).toEqual([]);
    expect(
      (await coldLoad(mergeThreadDataForClientSave(lateCompletion, old)))
        .suggestions,
    ).toEqual([]);
  });

  it("does not let a stale same-run client save erase completed suggestions or downgrade its status", async () => {
    const current = run("run-1");
    const submitted = submit({ messages: [] }, current);
    const stale = {
      ...submitted,
      agentKit: {
        runs: [
          {
            id: current.runId,
            threadId: current.threadId,
            status: "running",
            lastSequence: 2,
            startedAt: new Date(current.startedAt).toISOString(),
          },
        ],
        activeRunIds: [current.runId],
        suggestions: [],
      },
    };
    const saved = complete(submitted, current);
    const merged = mergeThreadDataForClientSave(saved, stale);
    const restored = await coldLoad(merged);
    expect(restored.suggestions.map((suggestion) => suggestion.runId)).toEqual([
      current.runId,
    ]);
    expect(restored.thread.runs[current.runId].status).toBe("completed");
    expect(restored.thread.activeRunIds).toEqual([]);
  });

  it("clears chips when a client saves a new user message before the run is prepared", async () => {
    const current = run("run-1");
    const old = complete(submit({ messages: [] }, current), current);
    const incoming = {
      ...old,
      messages: [
        ...old.messages,
        {
          message: {
            id: "user-new",
            role: "user",
            content: [{ type: "text", text: "New request" }],
            createdAt: new Date(epoch + 5_000).toISOString(),
          },
        },
      ],
    };
    expect(
      (await coldLoad(mergeThreadDataForClientSave(old, incoming))).suggestions,
    ).toEqual([]);
  });

  it("binds a continued run to the original submitted turn", async () => {
    const original = run("run-1");
    const continuation = {
      ...run("run-continued", 2_000),
      turnId: original.turnId,
    };
    const saved = complete(submit({ messages: [] }, original), continuation);
    expect(
      (await coldLoad(saved)).suggestions.map((suggestion) => suggestion.runId),
    ).toEqual(["run-continued"]);
  });

  it.each(["missing", "empty"] as const)(
    "keeps %s publication empty rather than retaining previous chips",
    async (kind) => {
      const first = run("run-1");
      const second = run("run-2", 2_000);
      if (kind === "missing")
        second.events = second.events.filter(
          ({ event }) => event.type !== "suggestions",
        );
      else
        second.events[2] = {
          seq: 2,
          event: { type: "suggestions", suggestions: [] },
        };
      const old = complete(submit({ messages: [] }, first), first);
      expect(
        (await coldLoad(complete(submit(old, second), second))).suggestions,
      ).toEqual([]);
    },
  );

  it.each(["identity", "overflow", "malformed"])(
    "rejects %s canonical suggestions instead of silently dropping them",
    (kind) => {
      const current = run("run-1");
      const event = current.events[2].event;
      if (event.type !== "suggestions")
        throw new Error("Missing fixture suggestions");
      if (kind === "identity") event.suggestions[0].runId = "other-run";
      if (kind === "overflow")
        event.suggestions = Array(4).fill(event.suggestions[0]);
      if (kind === "malformed") event.suggestions[0].prompt = "";
      expect(() =>
        complete(submit({ messages: [] }, current), current),
      ).toThrow("Invalid canonical follow-up suggestions");
    },
  );
});
