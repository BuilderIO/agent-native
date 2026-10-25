import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
} from "./engine/types.js";
import { runAgentLoop, type ActionEntry } from "./production-agent.js";

const claimSteeredMock = vi.hoisted(() => vi.fn());
const deferSteeredMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../chat-threads/store.js", () => ({
  claimSteeredQueuedMessages: claimSteeredMock,
  deferSteeredQueuedMessages: deferSteeredMock,
}));

vi.mock("./run-store.js", () => ({
  BACKGROUND_PROCESSING_RUN_STALE_MS: 45_000,
  writeLedgerEntry: vi.fn(),
  readLedgerEntry: vi.fn(async () => null),
  clearLedgerForThread: vi.fn(async () => undefined),
  getCurrentTurnEventsForThread: vi.fn(async () => []),
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
  STALE_RUN_ERROR_EVENT: {
    type: "error",
    error: "stale",
    errorCode: "stale_run",
    recoverable: true,
    details: "",
  },
}));

function delivery(id: string, text: string) {
  return {
    queued: { id, text },
    record: {
      runId: "run-1",
      message: { id, text, createdAt: "2026-10-24T10:00:05.000Z" },
      continuationMessageId: `server-run-1:after:${id}`,
    },
  };
}

/** Calls `read-deck` once per entry in `toolTurns`, then answers. */
function engine(toolTurns: number, requests: EngineMessage[][]): AgentEngine {
  let calls = 0;
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
      parallelToolCalls: true,
    },
    async *stream(opts: { messages: EngineMessage[] }) {
      requests.push(JSON.parse(JSON.stringify(opts.messages)));
      calls += 1;
      if (calls <= toolTurns) {
        yield {
          type: "tool-call",
          id: `call-${calls}`,
          name: "read-deck",
          input: {},
        } as EngineEvent;
        yield { type: "stop", reason: "tool_use" } as EngineEvent;
        return;
      }
      yield { type: "text-delta", text: "All done." } as EngineEvent;
      yield { type: "stop", reason: "end_turn" } as EngineEvent;
    },
  } as unknown as AgentEngine;
}

async function run(toolTurns: number, opts: { threadId?: string } = {}) {
  const requests: EngineMessage[][] = [];
  const events: any[] = [];
  const abort = new AbortController();
  await runAgentLoop({
    engine: engine(toolTurns, requests),
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "Fix the deck" }] },
    ],
    actions: {
      "read-deck": {
        tool: {
          description: "Read the deck",
          parameters: { type: "object", properties: {} },
        },
        readOnly: true,
        run: vi.fn(async () => "3 slides"),
      } as unknown as ActionEntry,
    },
    send: (event) => {
      events.push(event);
    },
    signal: abort.signal,
    runId: "run-1",
    ...("threadId" in opts
      ? opts.threadId
        ? { threadId: opts.threadId }
        : {}
      : { threadId: "thread-1" }),
  });
  return { requests, events, abort };
}

function texts(message: EngineMessage | undefined): string[] {
  return (message?.content ?? []).flatMap((part) =>
    part.type === "text" ? [part.text] : [],
  );
}

describe("Send now at a tool boundary", () => {
  beforeEach(() => {
    claimSteeredMock.mockReset();
    claimSteeredMock.mockResolvedValue([]);
    deferSteeredMock.mockClear();
  });

  it("gives the next model request the message after the tool results", async () => {
    claimSteeredMock
      .mockResolvedValueOnce([delivery("queued-1", "Use the blue theme")])
      .mockResolvedValue([]);

    const { requests, events } = await run(1);

    const afterBoundary = requests[1]!.at(-1)!;
    expect(afterBoundary.role).toBe("user");
    expect(afterBoundary.content.map((part) => part.type)).toEqual([
      "tool-result",
      "text",
    ]);
    expect(texts(afterBoundary)).toEqual(["Use the blue theme"]);
    expect(requests[0]!.flatMap(texts)).not.toContain("Use the blue theme");
    const steerEvents = events.filter((event) => event.type === "user_message");
    expect(steerEvents).toEqual([
      {
        type: "user_message",
        message: {
          id: "queued-1",
          text: "Use the blue theme",
          createdAt: "2026-10-24T10:00:05.000Z",
        },
        continuationMessageId: "server-run-1:after:queued-1",
      },
    ]);
    // The event lands after the results it waited for and before more text.
    const order = events.map((event) => event.type);
    expect(order.lastIndexOf("tool_done")).toBeLessThan(
      order.indexOf("user_message"),
    );
    expect(order.indexOf("user_message")).toBeLessThan(order.indexOf("text"));
    expect(claimSteeredMock).toHaveBeenCalledWith("thread-1", "run-1");
  });

  it("delivers several messages in queue order at one boundary", async () => {
    claimSteeredMock
      .mockResolvedValueOnce([
        delivery("queued-1", "First follow-up"),
        delivery("queued-2", "Second follow-up"),
      ])
      .mockResolvedValue([]);

    const { requests, events } = await run(1);

    expect(texts(requests[1]!.at(-1))).toEqual([
      "First follow-up",
      "Second follow-up",
    ]);
    expect(
      events
        .filter((event) => event.type === "user_message")
        .map((event) => event.message.id),
    ).toEqual(["queued-1", "queued-2"]);
  });

  it("marks a waiting message for after the reply when the model answers without a tool", async () => {
    const { events } = await run(0);

    expect(claimSteeredMock).not.toHaveBeenCalled();
    expect(deferSteeredMock).toHaveBeenCalledWith("thread-1");
    expect(events.some((event) => event.type === "user_message")).toBe(false);
  });

  it("never stops the run to deliver", async () => {
    claimSteeredMock
      .mockResolvedValueOnce([delivery("queued-1", "Use the blue theme")])
      .mockResolvedValue([]);

    const { abort, events } = await run(2);

    expect(abort.signal.aborted).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("keeps running when the claim fails, leaving the message queued", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    claimSteeredMock.mockRejectedValueOnce(new Error("database unavailable"));

    const { events, requests } = await run(1);

    expect(events.some((event) => event.type === "user_message")).toBe(false);
    expect(requests).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      "[agent-chat] Send now delivery skipped at a tool boundary:",
      "database unavailable",
    );
    warn.mockRestore();
  });

  it("does not look for messages outside a thread run", async () => {
    await run(1, { threadId: undefined });

    expect(claimSteeredMock).not.toHaveBeenCalled();
    expect(deferSteeredMock).not.toHaveBeenCalled();
  });
});
