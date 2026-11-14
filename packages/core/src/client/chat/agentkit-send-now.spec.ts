import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mergeThreadDataForClientSave } from "../../agent/thread-data-builder.js";
import { resetAgentEngineReadinessForTests } from "../agent-engine-readiness.js";
import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";

vi.mock("../use-agent-chat-running-threads.js", () => ({
  dispatchAgentChatRunning: vi.fn(),
}));

const apiUrl = "/_agent-native/agent-chat";
const threadId = "thread-send-now";
const messageId = "queued-send-now";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Server {
  activeRun: Record<string, unknown>;
  abortResult: boolean;
  receipts: Array<Record<string, unknown>>;
  queueWrites: Array<Record<string, unknown>>;
  aborts: Array<{ runId: string; body: unknown }>;
  startRequests: number;
}

function server(overrides: Partial<Server> = {}) {
  const state: Server = {
    activeRun: { active: true, status: "running", runId: "run-active" },
    abortResult: true,
    receipts: [{ state: "submitted", submittedRunId: "run-inbox" }],
    queueWrites: [],
    aborts: [],
    startRequests: 0,
    ...overrides,
  };
  const queuedMessages = [
    {
      id: messageId,
      threadId,
      text: "Use the blue theme",
      createdAt: "2026-10-24T10:00:00.000Z",
    },
  ];
  let receiptReads = 0;
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      if (url.startsWith(`${apiUrl}/runs/active?`))
        return json(state.activeRun);
      const abort = url.match(/\/runs\/([^/]+)\/abort$/);
      if (abort && method === "POST") {
        state.aborts.push({
          runId: decodeURIComponent(abort[1]!),
          body: JSON.parse(String(init?.body)),
        });
        return json({ aborted: state.abortResult });
      }
      if (url.endsWith(`/threads/${threadId}/queue/${messageId}/receipt`)) {
        const receipt =
          state.receipts[Math.min(receiptReads, state.receipts.length - 1)];
        receiptReads += 1;
        return json(receipt);
      }
      if (url.endsWith(`/threads/${threadId}/queued`) && method === "POST") {
        const { mutation } = JSON.parse(String(init?.body));
        state.queueWrites.push(mutation);
        if (mutation.type === "steer") {
          const message = { ...queuedMessages[0]!, delivery: "steering" };
          return json({ queuedMessages: [message], message });
        }
        if (mutation.type === "claim") {
          return json({ queuedMessages, receiptManaged: true });
        }
        return json({ queuedMessages });
      }
      if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
        return json({
          id: threadId,
          threadData: JSON.stringify({ queuedMessages }),
        });
      }
      if (url.endsWith(apiUrl) && method === "POST") state.startRequests += 1;
      return json({ error: `Unexpected request: ${method} ${url}` }, 404);
    },
  );
  const transport = createAgentNativeAgentKitTransport({
    apiUrl,
    fetch: fetcher as typeof fetch,
  });
  return { state, transport };
}

describe("Send now", () => {
  beforeEach(() => resetAgentEngineReadinessForTests());
  afterEach(() => vi.useRealTimers());

  it("hands the message to the running turn without stopping it", async () => {
    const { state, transport } = server();

    await expect(
      transport.steerQueuedMessage?.({
        threadId,
        messageId,
        deliverInActiveRun: true,
      }),
    ).resolves.toEqual({ delivery: "steering" });

    expect(state.queueWrites).toEqual([{ type: "steer", messageId }]);
    expect(state.aborts).toEqual([]);
    expect(state.startRequests).toBe(0);
    await transport.dispose();
  });

  it("settles a message another path already took instead of failing", async () => {
    const { transport } = server();
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(`${apiUrl}/runs/active?`)) {
          return json({ active: true, status: "running", runId: "run-active" });
        }
        if (url.endsWith(`/threads/${threadId}/queued`)) {
          return json(
            {
              error: `Unknown queued message: ${messageId}`,
              code: "queued_message_missing",
              retryable: false,
            },
            409,
          );
        }
        // The first read finds it queued; the reread after the conflict does not.
        const reads = fetcher.mock.calls.filter(([candidate]) =>
          String(candidate).endsWith(`/threads/${threadId}`),
        ).length;
        return json({
          id: threadId,
          threadData: JSON.stringify({
            queuedMessages:
              reads > 1
                ? []
                : [{ id: messageId, threadId, text: "Use the blue theme" }],
          }),
        });
      },
    );
    await transport.dispose();
    const missing = createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetcher as typeof fetch,
    });

    await expect(
      missing.steerQueuedMessage?.({
        threadId,
        messageId,
        deliverInActiveRun: true,
      }),
    ).resolves.toEqual({ alreadyRemoved: true });
    await missing.dispose();
  });

  it("puts it first for after the reply when the runtime cannot take it mid-turn", async () => {
    const queueWrites: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(`${apiUrl}/runs/active?`)) {
          return json({ active: true, status: "running", runId: "run-active" });
        }
        if (url.endsWith(`/threads/${threadId}/queued`)) {
          queueWrites.push(JSON.parse(String(init?.body)).mutation);
          return json({ queuedMessages: [] });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            queuedMessages: [
              { id: messageId, threadId, text: "Use the blue theme" },
            ],
          }),
        });
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetcher as typeof fetch,
      runtime: {
        id: "test:external",
        kind: "external-agent",
        label: "External runtime",
        capabilities: {
          messages: { streaming: true, history: true },
          tools: { events: true },
          sessions: { create: true, persistent: true },
        },
        async createSession() {
          throw new Error("No turn should start.");
        },
      },
    });

    await expect(
      transport.steerQueuedMessage?.({
        threadId,
        messageId,
        deliverInActiveRun: true,
      }),
    ).resolves.toEqual({ delivery: "after_reply" });
    expect(queueWrites).toEqual([{ type: "moveToTop", messageId }]);
    await transport.dispose();
  });

  it("sends directly when no run is working", async () => {
    const { state, transport } = server({
      activeRun: { active: false, status: "completed" },
    });

    await expect(
      transport.steerQueuedMessage?.({
        threadId,
        messageId,
        deliverInActiveRun: true,
      }),
    ).resolves.toEqual({ runId: "run-inbox", alreadySubmitted: true });

    expect(state.queueWrites.map(({ type }) => type)).toEqual(["claim"]);
    expect(state.aborts).toEqual([]);
    await transport.dispose();
  });
});

describe("Stop and send for a message the server inbox owns", () => {
  beforeEach(() => resetAgentEngineReadinessForTests());
  afterEach(() => vi.useRealTimers());

  it("moves it to the head, stops the run at a safe boundary, and lets the inbox send it once", async () => {
    const { state, transport } = server({
      receipts: [
        { state: "queued" },
        { state: "queued" },
        { state: "submitted", submittedRunId: "run-inbox" },
      ],
    });

    await expect(
      transport.steerQueuedMessage?.({
        threadId,
        messageId,
        interruptActiveRun: true,
      }),
    ).resolves.toEqual({ runId: "run-inbox", alreadySubmitted: true });

    expect(state.queueWrites.map(({ type }) => type)).toEqual([
      "claim",
      "moveToTop",
    ]);
    expect(state.aborts).toEqual([
      { runId: "run-active", body: { reason: "user", safeBoundary: true } },
    ]);
    expect(state.startRequests).toBe(0);
    await transport.dispose();
  });

  it("leaves it for after the reply when the run refuses to stop", async () => {
    const { state, transport } = server({ abortResult: false });

    await expect(
      transport.steerQueuedMessage?.({
        threadId,
        messageId,
        interruptActiveRun: true,
      }),
    ).resolves.toEqual({ delivery: "after_reply" });

    expect(state.startRequests).toBe(0);
    await transport.dispose();
  });

  it("leaves it for after the reply when the inbox has not sent it in time", async () => {
    vi.useFakeTimers();
    const { state, transport } = server({ receipts: [{ state: "queued" }] });

    const result = transport.steerQueuedMessage?.({
      threadId,
      messageId,
      interruptActiveRun: true,
    });
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(result).resolves.toEqual({ delivery: "after_reply" });
    expect(state.startRequests).toBe(0);
    await transport.dispose();
  });

  it("fails with a typed error when the inbox blocked it", async () => {
    const { transport } = server({ receipts: [{ state: "blocked" }] });

    await expect(
      transport.steerQueuedMessage?.({
        threadId,
        messageId,
        interruptActiveRun: true,
      }),
    ).rejects.toMatchObject({ code: "queue_item_blocked", retryable: false });
    await transport.dispose();
  });
});

describe("a delivered message in a saved thread", () => {
  beforeEach(() => resetAgentEngineReadinessForTests());

  function thread(agentKit?: Record<string, unknown>) {
    const repository = {
      messages: [
        {
          parentId: null,
          message: {
            id: "server-user-run-1",
            role: "user",
            createdAt: "2026-10-24T10:00:00.000Z",
            content: [{ type: "text", text: "Fix the deck" }],
            metadata: {
              custom: {
                submittedRunId: "run-1",
                submittedTurnId: "turn-1",
                agentKitMessageId: "client-user",
              },
            },
          },
        },
        {
          parentId: "server-user-run-1",
          message: {
            id: "server-run-1",
            role: "assistant",
            createdAt: "2026-10-24T10:00:02.000Z",
            content: [{ type: "text", text: "Checking the deck." }],
            status: { type: "complete", reason: "stop" },
            metadata: {
              runId: "run-1",
              custom: { turnId: "turn-1", foldedRunIds: ["run-1"] },
            },
          },
        },
        {
          parentId: "server-run-1",
          message: {
            id: messageId,
            role: "user",
            createdAt: "2026-10-24T10:00:05.000Z",
            content: [{ type: "text", text: "Use the blue theme" }],
            metadata: {
              custom: {
                agentNativeQueuedMessageId: messageId,
                deliveredInRunId: "run-1",
              },
            },
          },
        },
        {
          parentId: messageId,
          message: {
            id: `server-run-1:after:${messageId}`,
            role: "assistant",
            createdAt: "2026-10-24T10:00:06.000Z",
            content: [{ type: "text", text: "Switching to blue." }],
            status: { type: "complete", reason: "stop" },
            metadata: {
              runId: "run-1",
              custom: { turnId: "turn-1", foldedRunIds: ["run-1"] },
            },
          },
        },
      ],
      headId: `server-run-1:after:${messageId}`,
      ...(agentKit ? { agentKit } : {}),
    };
    let threadData = JSON.stringify(repository);
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(`${apiUrl}/runs/active?`)) {
          return json({ active: false, status: "idle" });
        }
        if (url.endsWith(`/threads/${threadId}`) && init?.method === "PUT") {
          const incoming = JSON.parse(JSON.parse(String(init.body)).threadData);
          threadData = JSON.stringify(
            mergeThreadDataForClientSave(JSON.parse(threadData), incoming),
          );
          return json({ ok: true });
        }
        if (url.endsWith(`/threads/${threadId}`)) {
          return json({
            id: threadId,
            createdAt: "2026-10-24T10:00:00.000Z",
            updatedAt: "2026-10-24T10:00:07.000Z",
            threadData,
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    return createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetcher as typeof fetch,
    });
  }

  const transcript = (
    messages: Array<{ id: string; role: string; parts: any[] }>,
  ) =>
    messages.map((message) => [
      message.role,
      message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join(""),
    ]);

  it("shows the message between the replies before and after it", async () => {
    const transport = thread();

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(transcript(snapshot!.messages)).toEqual([
      ["user", "Fix the deck"],
      ["assistant", "Checking the deck."],
      ["user", "Use the blue theme"],
      ["assistant", "Switching to blue."],
    ]);
    await transport.dispose();
  });

  it("keeps where the message reached the run across a reload", async () => {
    const transport = thread();
    const event = (
      sequence: number,
      fields: Record<string, unknown>,
    ): Record<string, unknown> => ({
      id: `event-${sequence}`,
      threadId,
      runId: "run-1",
      sequence,
      occurredAt: `2026-10-24T10:00:0${sequence}.000Z`,
      ...fields,
    });

    await transport.persistThreadSnapshot?.({
      threadId,
      snapshot: {
        id: threadId,
        createdAt: "2026-10-24T10:00:00.000Z",
        updatedAt: "2026-10-24T10:00:07.000Z",
        messages: [
          {
            id: messageId,
            role: "user",
            status: "complete",
            parts: [{ type: "text", text: "Use the blue theme" }],
          },
        ],
        events: [
          event(1, { type: "run.started" }),
          event(2, {
            type: "activity.started",
            activity: {
              id: "activity-read",
              kind: "tool",
              label: "Reading the deck",
              status: "running",
            },
          }),
          event(3, {
            type: "message.created",
            message: {
              id: messageId,
              role: "user",
              parts: [{ type: "text", text: "Use the blue theme" }],
            },
          }),
          event(4, { type: "run.completed" }),
        ] as never,
        runs: [{ id: "run-1", threadId, status: "completed", lastSequence: 4 }],
        activeRunIds: [],
      },
    });
    const restored = await transport.getThreadSnapshot?.({ threadId });

    expect(
      restored?.events?.find(
        (candidate) =>
          candidate.type === "message.created" &&
          candidate.message.id === messageId,
      ),
    ).toMatchObject({
      runId: "run-1",
      sequence: 3,
      message: { role: "user" },
    });
    await transport.dispose();
  });

  it("adds the message when the page closed before it was delivered", async () => {
    const transport = thread({
      messages: [
        {
          id: "client-user",
          role: "user",
          parts: [{ type: "text", text: "Fix the deck" }],
        },
        {
          id: "client-reply",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Checking the deck." }],
        },
      ],
      events: [
        {
          id: "event-1",
          type: "message.created",
          threadId,
          runId: "run-1",
          sequence: 1,
          occurredAt: "2026-10-24T10:00:02.000Z",
          message: { id: "client-reply", role: "assistant", parts: [] },
        },
      ],
      runs: [{ id: "run-1", threadId, status: "completed", lastSequence: 1 }],
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(transcript(snapshot!.messages)).toEqual([
      ["user", "Fix the deck"],
      ["assistant", "Checking the deck."],
      ["user", "Use the blue theme"],
      ["assistant", "Switching to blue."],
    ]);
    await transport.dispose();
  });

  it("keeps one copy of each message when the page saved the streamed turn", async () => {
    const transport = thread({
      messages: [
        {
          id: "client-user",
          role: "user",
          parts: [{ type: "text", text: "Fix the deck" }],
        },
        {
          id: "client-reply",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Checking the deck." }],
        },
        {
          id: messageId,
          role: "user",
          status: "complete",
          parts: [{ type: "text", text: "Use the blue theme" }],
        },
        {
          id: `server-run-1:after:${messageId}`,
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Switching to blue." }],
        },
      ],
      events: [
        {
          id: "event-1",
          type: "message.created",
          threadId,
          runId: "run-1",
          sequence: 1,
          occurredAt: "2026-10-24T10:00:02.000Z",
          message: { id: "client-reply", role: "assistant", parts: [] },
        },
        {
          id: "event-2",
          type: "message.created",
          threadId,
          runId: "run-1",
          sequence: 2,
          occurredAt: "2026-10-24T10:00:05.000Z",
          message: { id: messageId, role: "user", parts: [] },
        },
        {
          id: "event-3",
          type: "message.created",
          threadId,
          runId: "run-1",
          sequence: 3,
          occurredAt: "2026-10-24T10:00:06.000Z",
          message: {
            id: `server-run-1:after:${messageId}`,
            role: "assistant",
            parts: [],
          },
        },
      ],
      runs: [{ id: "run-1", threadId, status: "completed", lastSequence: 3 }],
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(transcript(snapshot!.messages)).toEqual([
      ["user", "Fix the deck"],
      ["assistant", "Checking the deck."],
      ["user", "Use the blue theme"],
      ["assistant", "Switching to blue."],
    ]);
    await transport.dispose();
  });
});
