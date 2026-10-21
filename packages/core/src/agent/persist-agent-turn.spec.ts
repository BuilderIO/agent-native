import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "pglite:memory";
});
vi.mock("../audit/record.js", () => ({ recordActionAudit: vi.fn() }));

import { createThread, getThread } from "../chat-threads/store.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { persistAgentTurnToThread } from "./persist-agent-turn.js";
import {
  actionsToEngineTools,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

const OWNER = "owner@example.com";
const ORG = "org-1";

const lookup: ActionEntry = {
  tool: {
    description: "Look an item up.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  readOnly: true,
  run: async (args: { id: string }) => ({ found: args.id }),
};

/** One model step that calls `lookup`, then one that answers. */
async function runScriptedTurn(): Promise<AgentChatEvent[]> {
  const steps: EngineEvent[][] = [
    [
      {
        type: "assistant-content",
        parts: [
          {
            type: "tool-call",
            id: "call-1",
            name: "lookup",
            input: { id: "7" },
          },
        ],
      },
      { type: "stop", reason: "tool_use" },
    ],
    [
      {
        type: "assistant-content",
        parts: [{ type: "text", text: "Item 7 is assessed." }],
      },
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
      parallelToolCalls: false,
    },
    async *stream() {
      const next = steps[request++];
      if (!next) throw new Error("Unexpected model request");
      yield* next;
    },
  };
  const events: AgentChatEvent[] = [];
  await runAgentLoop({
    engine,
    model: "test-model",
    systemPrompt: "Test app.",
    tools: actionsToEngineTools({ lookup }),
    actions: { lookup },
    messages: [
      { role: "user", content: [{ type: "text", text: "Assess 7." }] },
    ],
    send: (event) => events.push(event),
    signal: new AbortController().signal,
    maxIterations: steps.length + 1,
    maxOutputTokens: 1024,
    reasoningEffort: "low",
    ownerEmail: OWNER,
    orgId: ORG,
  });
  return events;
}

type StoredMessage = { role: string; content: any[]; status?: any };

async function storedMessages(threadId: string): Promise<StoredMessage[]> {
  const thread = await getThread(threadId);
  const repo = JSON.parse(thread!.threadData);
  return repo.messages.map((entry: any) => entry.message ?? entry);
}

afterAll(async () => {
  await closeDbExec();
});

describe("persistAgentTurnToThread", () => {
  it("saves the prompt, tool call and reply of a turn run straight through the loop", async () => {
    const thread = await createThread(OWNER, { title: "Assess", orgId: ORG });
    const events = await runScriptedTurn();

    const before = await getThread(thread.id);
    expect(before?.messageCount).toBe(0);
    expect(JSON.parse(before!.threadData)).toEqual({});

    await persistAgentTurnToThread({
      threadId: thread.id,
      ownerEmail: OWNER,
      orgId: ORG,
      prompt: "Assess 7.",
      runId: "run-1",
      startedAt: Date.now() - 1_000,
      events,
    });

    const after = await getThread(thread.id);
    expect(after?.messageCount).toBe(2);
    expect(after?.preview).toContain("Assess 7.");
    const [user, assistant] = await storedMessages(thread.id);
    expect(user).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "Assess 7." }],
    });
    expect(assistant).toMatchObject({
      role: "assistant",
      status: { type: "complete" },
    });
    expect(assistant!.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          toolName: "lookup",
          args: { id: "7" },
          result: expect.stringContaining("7"),
        }),
        expect.objectContaining({
          type: "text",
          text: "Item 7 is assessed.",
        }),
      ]),
    );
  });

  it("saves a failure outside the loop as an incomplete reply", async () => {
    const thread = await createThread(OWNER, { orgId: ORG });

    await persistAgentTurnToThread({
      threadId: thread.id,
      ownerEmail: OWNER,
      prompt: "Assess 8.",
      runId: "run-2",
      events: [],
      threadTitle: "Assess 8",
      persistFailure: { message: "Model unavailable", errorCode: "model_down" },
    });

    const [, assistant] = await storedMessages(thread.id);
    expect(assistant!.status).toMatchObject({ type: "incomplete" });
    expect((await getThread(thread.id))?.title).toBe("Assess 8");
  });

  it("throws, saving nothing, when the thread does not exist", async () => {
    await expect(
      persistAgentTurnToThread({
        threadId: "missing-thread",
        ownerEmail: OWNER,
        prompt: "Assess 9.",
        runId: "run-3",
        events: [],
      }),
    ).rejects.toThrow(/missing-thread was not found/);
  });

  it("refuses a thread another user or organization owns", async () => {
    const thread = await createThread(OWNER, { orgId: ORG });
    const input = {
      threadId: thread.id,
      prompt: "Assess 10.",
      runId: "run-4",
      events: [],
    };

    await expect(
      persistAgentTurnToThread({
        ...input,
        ownerEmail: "someone-else@example.com",
      }),
    ).rejects.toThrow(/does not belong to the caller/);
    await expect(
      persistAgentTurnToThread({ ...input, ownerEmail: OWNER, orgId: "org-2" }),
    ).rejects.toThrow(/does not belong to the caller/);
    expect((await getThread(thread.id))?.messageCount).toBe(0);
  });

  it("throws on thread data it cannot read instead of overwriting it", async () => {
    const thread = await createThread(OWNER, { orgId: ORG });
    await getDbExec().execute({
      sql: "UPDATE chat_threads SET thread_data = ? WHERE id = ?",
      args: ["{not json", thread.id],
    });

    await expect(
      persistAgentTurnToThread({
        threadId: thread.id,
        ownerEmail: OWNER,
        prompt: "Assess 11.",
        runId: "run-5",
        events: [],
      }),
    ).rejects.toThrow(/unreadable thread data/);
    expect((await getThread(thread.id))?.threadData).toBe("{not json");
  });
});
