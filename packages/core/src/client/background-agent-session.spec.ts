import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openThread = vi.hoisted(() => vi.fn());

vi.mock("./agent-chat.js", () => ({
  requestAgentChatThreadOpen: openThread,
}));

vi.mock("./api-path.js", () => ({
  agentNativePath: (path: string) => path,
}));

import {
  cancelBackgroundAgentSession,
  getBackgroundAgentSessionStatus,
  startBackgroundAgentSession,
} from "./background-agent-session.js";

function streamResponse(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: run_started\n\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("background agent sessions", () => {
  beforeEach(() => {
    openThread.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse()),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts fresh isolated threads without touching the foreground chat UI", async () => {
    const first = startBackgroundAgentSession({ message: "First" });
    const second = startBackgroundAgentSession({ message: "Second" });
    await Promise.all([first.accepted, second.accepted]);
    await Promise.all([first.completion, second.completion]);

    expect(first.threadId).not.toBe(second.threadId);
    expect(first.operationId).not.toBe(second.operationId);
    expect(openThread).not.toHaveBeenCalled();
  });

  it("carries stable identity, scope, model selection, and instructions through the shared route", async () => {
    const fetchMock = vi.mocked(fetch);
    const handle = startBackgroundAgentSession({
      message: "Reply to the comment",
      operationId: "operation-1",
      threadId: "thread-1",
      scope: { type: "content-comment-ai", id: "comment-7" },
      actionScope: {
        kind: "content-comment-ai",
        requestId: "request-7",
        intent: "reply",
      },
      mode: "act",
      model: "gpt-5.6-sol",
      engine: "openai",
      effort: "medium",
      instructions: "Use only the supplied comment context.",
      usageLabel: "content:comment-ai",
    });
    await handle.accepted;

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/_agent-native/agent-chat");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      message:
        "Reply to the comment\n\n<context>\nUse only the supplied comment context.\n</context>",
      displayMessage: "Reply to the comment",
      queuedMessageId: "operation-1",
      turnId: handle.turnId,
      threadId: "thread-1",
      scope: { type: "content-comment-ai", id: "comment-7" },
      actionScope: {
        kind: "content-comment-ai",
        requestId: "request-7",
        intent: "reply",
      },
      mode: "act",
      model: "gpt-5.6-sol",
      engine: "openai",
      effort: "medium",
      usageLabel: "content:comment-ai",
    });
  });

  it("rejects an invalid action scope before dispatch", () => {
    expect(() =>
      startBackgroundAgentSession({
        message: "Reply to the comment",
        actionScope: { invalid: undefined } as never,
      }),
    ).toThrow("actionScope must contain only JSON values");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("atomically opens and prefills the exact background thread", () => {
    const handle = startBackgroundAgentSession({
      message: "Start",
      operationId: "operation-2",
      threadId: "thread-2",
    });
    handle.open({ prefill: "Continue this exact conversation" });

    expect(openThread).toHaveBeenCalledWith({
      threadId: "thread-2",
      prefill: "Continue this exact conversation",
    });
  });

  it("reports terminal status and keeps inaccessible sessions indistinguishable from missing ones", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          status: "completed",
          runId: "run-1",
          terminalReason: null,
        }),
      )
      .mockResolvedValueOnce(Response.json({}, { status: 404 }));
    const receipt = {
      operationId: "operation-3",
      threadId: "thread-3",
      turnId: "background-turn-3",
    };

    await expect(getBackgroundAgentSessionStatus(receipt)).resolves.toEqual({
      ...receipt,
      status: "completed",
      runId: "run-1",
      terminalReason: null,
    });
    await expect(getBackgroundAgentSessionStatus(receipt)).resolves.toEqual({
      ...receipt,
      status: "unavailable",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/_agent-native/agent-chat/runs/latest?threadId=thread-3&turnId=background-turn-3",
      "/_agent-native/agent-chat/runs/latest?threadId=thread-3&turnId=background-turn-3",
    ]);
  });

  it("atomically aborts the logical turn through the shared run manager", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));

    await cancelBackgroundAgentSession({
      threadId: "thread-4",
      turnId: "operation-4",
      reason: "dismissed",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/_agent-native/agent-chat/runs/turn/operation-4/abort",
    ]);
  });

  it("cancels a newly created thread without waiting for route acceptance", async () => {
    let acceptStart!: (response: Response) => void;
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            acceptStart = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const handle = startBackgroundAgentSession({
      message: "Start then stop",
      operationId: "operation-5",
      threadId: "thread-5",
    });
    const cancellation = handle.cancel("dismissed");
    await cancellation;
    expect(fetchMock).toHaveBeenCalledTimes(2);

    acceptStart(streamResponse());
    await handle.accepted;
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/_agent-native/agent-chat",
      `/_agent-native/agent-chat/runs/turn/${handle.turnId}/abort`,
    ]);
  });

  it("reports local queued state only before route acceptance", async () => {
    let acceptStart!: (response: Response) => void;
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            acceptStart = resolve;
          }),
      )
      .mockResolvedValue(Response.json({}, { status: 404 }));

    const handle = startBackgroundAgentSession({
      message: "Start and inspect status",
      operationId: "operation-6",
      threadId: "thread-6",
    });
    await expect(handle.status()).resolves.toEqual({
      operationId: "operation-6",
      threadId: "thread-6",
      turnId: handle.turnId,
      status: "queued",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    acceptStart(streamResponse());
    await handle.accepted;
    await expect(handle.status()).resolves.toEqual({
      operationId: "operation-6",
      threadId: "thread-6",
      turnId: handle.turnId,
      status: "unavailable",
    });
  });

  it("reports a durable run before the start response acknowledges it", async () => {
    let acceptStart!: (response: Response) => void;
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            acceptStart = resolve;
          }),
      )
      .mockResolvedValueOnce(
        Response.json({ status: "running", runId: "run-before-ack" }),
      );
    const handle = startBackgroundAgentSession({
      message: "Inspect before acknowledgement",
      operationId: "operation-before-ack",
      threadId: "thread-before-ack",
    });

    await expect(handle.status()).resolves.toEqual({
      operationId: "operation-before-ack",
      threadId: "thread-before-ack",
      turnId: handle.turnId,
      status: "running",
      runId: "run-before-ack",
    });
    acceptStart(streamResponse());
    await handle.accepted;
  });

  it("stops reporting local queued state when acknowledgement times out", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockImplementationOnce(() => new Promise<Response>(() => {}))
        .mockResolvedValue(Response.json({}, { status: 404 }));
      const handle = startBackgroundAgentSession({
        message: "Start without an acknowledgement",
        operationId: "operation-timeout",
        threadId: "thread-timeout",
      });

      await expect(handle.status()).resolves.toMatchObject({
        status: "queued",
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(handle.accepted).rejects.toThrow(
        "Background agent session acknowledgement timed out",
      );
      await expect(handle.status()).resolves.toMatchObject({
        status: "unavailable",
        transportError: "Background agent session acknowledgement timed out",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a retry without fabricating stream completion for the durable turn", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { error: "Run already in progress for this thread" },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ status: "running", runId: "run-existing" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "completed",
          runId: "run-existing",
          terminalReason: "done",
        }),
      );

    const handle = startBackgroundAgentSession({
      message: "Retry after a lost acknowledgement",
      operationId: "operation-retry",
      threadId: "thread-retry",
    });

    await expect(handle.accepted).resolves.toEqual({
      operationId: "operation-retry",
      threadId: "thread-retry",
      turnId: handle.turnId,
    });
    await expect(handle.completion).rejects.toThrow(
      "reattached to a durable turn without a response stream",
    );
    await expect(handle.status()).resolves.toMatchObject({
      status: "completed",
      runId: "run-existing",
      terminalReason: "done",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/_agent-native/agent-chat",
      `/_agent-native/agent-chat/runs/latest?threadId=thread-retry&turnId=${handle.turnId}`,
      `/_agent-native/agent-chat/runs/latest?threadId=thread-retry&turnId=${handle.turnId}`,
    ]);
  });

  it("rejects a 409 when no matching durable turn exists", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          Response.json(
            { error: "Run already in progress for this thread" },
            { status: 409 },
          ),
        )
        .mockResolvedValue(Response.json({}, { status: 404 }));
      const handle = startBackgroundAgentSession({
        message: "Conflicting delivery",
        operationId: "operation-conflict",
        threadId: "thread-conflict",
      });

      await vi.advanceTimersByTimeAsync(30_000);
      await expect(handle.accepted).rejects.toThrow(
        "Background agent session was rejected (HTTP 409)",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for exact durable identity when a duplicate precedes thread visibility", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockResolvedValueOnce(Response.json({}, { status: 409 }))
        .mockResolvedValueOnce(Response.json({}, { status: 404 }))
        .mockResolvedValueOnce(Response.json({}, { status: 404 }))
        .mockResolvedValueOnce(
          Response.json({ status: "running", runId: "run-late-visible" }),
        );
      const handle = startBackgroundAgentSession({
        message: "Retry during thread creation",
        operationId: "operation-late-visible",
        threadId: "thread-late-visible",
      });

      await vi.advanceTimersByTimeAsync(50);
      await expect(handle.accepted).resolves.toMatchObject({
        operationId: "operation-late-visible",
      });
      await expect(handle.completion).rejects.toThrow(
        "reattached to a durable turn without a response stream",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a durable turn after its start acknowledgement is lost", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error("connection reset after dispatch"))
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ status: "running", runId: "run-lost-ack" }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const handle = startBackgroundAgentSession({
      message: "Start then cancel after a lost acknowledgement",
      operationId: "operation-cancel-lost-ack",
      threadId: "thread-cancel-lost-ack",
    });
    await expect(handle.accepted).rejects.toThrow(
      "connection reset after dispatch",
    );

    await handle.cancel("dismissed");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/_agent-native/agent-chat",
      `/_agent-native/agent-chat/runs/turn/${handle.turnId}/abort`,
      `/_agent-native/agent-chat/runs/latest?threadId=thread-cancel-lost-ack&turnId=${handle.turnId}`,
      `/_agent-native/agent-chat/runs/turn/${handle.turnId}/abort`,
    ]);
  });

  it("reports an already-terminal cancel instead of an older start transport error", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("connection reset after dispatch"))
      .mockResolvedValueOnce(
        Response.json({ error: "Turn is already terminal" }, { status: 409 }),
      );
    const handle = startBackgroundAgentSession({
      message: "Cancel after completion",
      operationId: "operation-late-cancel",
      threadId: "thread-late-cancel",
    });
    await expect(handle.accepted).rejects.toThrow(
      "connection reset after dispatch",
    );

    await expect(handle.cancel("dismissed")).rejects.toThrow(
      "Background agent session was rejected (HTTP 409): Turn is already terminal",
    );
  });

  it("keeps immediate cancellation pending for the full acceptance lifecycle", async () => {
    vi.useFakeTimers();
    try {
      let acknowledgeStart!: () => void;
      let acknowledged = false;
      const fetchMock = vi.mocked(fetch).mockImplementation((input) => {
        const url = String(input);
        if (url === "/_agent-native/agent-chat") {
          return new Promise<Response>((resolve) => {
            acknowledgeStart = () => {
              acknowledged = true;
              resolve(streamResponse());
            };
          });
        }
        if (url.includes("/runs/latest?")) {
          return Promise.resolve(Response.json({}, { status: 404 }));
        }
        return Promise.resolve(
          acknowledged
            ? Response.json({ ok: true })
            : Response.json({}, { status: 404 }),
        );
      });
      const handle = startBackgroundAgentSession({
        message: "Cancel before a delayed acknowledgement",
        operationId: "operation-delayed-cancel",
        threadId: "thread-delayed-cancel",
      });

      const cancellation = handle.cancel("dismissed");
      await vi.advanceTimersByTimeAsync(6_000);
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("/abort")),
      ).toBe(true);
      acknowledgeStart();
      await vi.advanceTimersByTimeAsync(25);
      await expect(cancellation).resolves.toBeUndefined();
      await expect(handle.accepted).resolves.toMatchObject({
        operationId: "operation-delayed-cancel",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: "network rejection",
      response: () => Promise.reject(new Error("network unavailable")),
      message: "network unavailable",
      expected: {
        status: "unavailable",
        transportError: "network unavailable",
      },
    },
    {
      name: "non-OK response",
      response: () =>
        Promise.resolve(
          Response.json({ error: "dispatch unavailable" }, { status: 503 }),
        ),
      message:
        "Background agent session was rejected (HTTP 503): dispatch unavailable",
      expected: {
        status: "unavailable",
        transportError:
          "Background agent session was rejected (HTTP 503): dispatch unavailable",
      },
    },
  ])(
    "reports an honest status after $name",
    async ({ response, message, expected }) => {
      vi.mocked(fetch)
        .mockImplementationOnce(response)
        .mockResolvedValueOnce(Response.json({}, { status: 404 }));
      const handle = startBackgroundAgentSession({
        message: "Start and fail",
        operationId: "operation-failed",
        threadId: "thread-failed",
      });

      await expect(handle.accepted).rejects.toThrow(message);
      await expect(handle.status()).resolves.toEqual({
        operationId: "operation-failed",
        threadId: "thread-failed",
        turnId: handle.turnId,
        ...expected,
      });
    },
  );

  it("prefers late durable completion over an HTTP acknowledgement failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ error: "gateway unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          status: "completed",
          runId: "run-late-completion",
          terminalReason: "done",
        }),
      );
    const handle = startBackgroundAgentSession({
      message: "Recover a late durable completion",
      operationId: "operation-late-completion",
      threadId: "thread-late-completion",
    });
    await expect(handle.accepted).rejects.toThrow(
      "Background agent session was rejected (HTTP 503): gateway unavailable",
    );

    await expect(handle.status()).resolves.toMatchObject({
      status: "unavailable",
      transportError:
        "Background agent session was rejected (HTTP 503): gateway unavailable",
    });
    await expect(handle.status()).resolves.toMatchObject({
      status: "completed",
      runId: "run-late-completion",
      terminalReason: "done",
    });
  });

  it("keeps transport loss indeterminate until durable state appears", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error("connection reset after dispatch"))
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({ status: "running", runId: "run-durable" }),
      );
    const handle = startBackgroundAgentSession({
      message: "Start despite a lost acknowledgement",
      operationId: "operation-lost-ack",
      threadId: "thread-lost-ack",
    });

    await expect(handle.accepted).rejects.toThrow(
      "connection reset after dispatch",
    );
    await expect(handle.status()).resolves.toEqual({
      operationId: "operation-lost-ack",
      threadId: "thread-lost-ack",
      turnId: handle.turnId,
      status: "unavailable",
      transportError: "connection reset after dispatch",
    });
    await expect(handle.status()).resolves.toEqual({
      operationId: "operation-lost-ack",
      threadId: "thread-lost-ack",
      turnId: handle.turnId,
      status: "running",
      runId: "run-durable",
    });
  });

  it("derives different retry-stable turn ids for one operation across threads", () => {
    const first = startBackgroundAgentSession({
      message: "First",
      operationId: "shared-operation",
      threadId: "thread-a",
    });
    const retry = startBackgroundAgentSession({
      message: "First retry",
      operationId: "shared-operation",
      threadId: "thread-a",
    });
    const second = startBackgroundAgentSession({
      message: "Second",
      operationId: "shared-operation",
      threadId: "thread-b",
    });

    expect(first.turnId).toBe(retry.turnId);
    expect(first.turnId).not.toBe(second.turnId);
    expect(first.turnId).toMatch(/^background-turn-[a-f0-9]{32}$/);
  });
});
