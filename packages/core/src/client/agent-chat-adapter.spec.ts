import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
  MAX_FOLLOWED_BACKGROUND_RUNS,
} from "../app-config/run-lifecycle-invariants.js";
import {
  getActiveRun,
  getPendingTurn,
  clearPendingTurnIfMatches,
  clearActiveRun,
  setActiveRun,
  setPendingTurn,
} from "./active-run-state.js";
import {
  activeRunLooksAlive,
  assistantUiMessagesToStructuredHistory,
  BACKGROUND_FOLLOW_ATTACH_WATCHDOG_MS,
  BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS,
  createAgentChatAdapter,
} from "./agent-chat-adapter.js";
import { MAX_REQUEST_BODY_BYTES } from "./chat/attachment-adapters.js";
import {
  claimRunStream,
  createRunStreamToken,
  releaseRunStream,
} from "./run-stream-ownership.js";
import { SSE_NO_PROGRESS_TIMEOUT_MS } from "./sse-event-processor.js";

const analyticsMock = vi.hoisted(() => ({
  captureError: vi.fn(),
}));

vi.mock("./analytics.js", () => analyticsMock);

describe("approval history", () => {
  it("preserves exact pending approval arguments", () => {
    const body = "x".repeat(9_000);
    const history = assistantUiMessagesToStructuredHistory([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "send-email",
            args: { body },
            result: "Awaiting human approval. This action did NOT execute.",
            approval: { approvalKey: "send-email:pending" },
          },
        ],
      },
    ]);

    expect(history[0]?.content[0]).toMatchObject({
      type: "tool-call",
      args: { body },
    });
  });

  it("truncates completed approved-call arguments", () => {
    const body = "x".repeat(9_000);
    const history = assistantUiMessagesToStructuredHistory([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "send-email",
            args: { body },
            result: "Email sent.",
            approval: { approvalKey: "send-email:completed" },
          },
        ],
      },
    ]);

    expect((history[0]?.content[0] as any).args.body).not.toBe(body);
  });

  it("prices preserved approval arguments at their serialized size", async () => {
    const pendingBody = "p".repeat(70_000);
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-approval-budget",
    });

    await drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "prepare it" }] },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-old",
                toolName: "query-rows",
                args: { sql: "x".repeat(8_000) },
                result: "y".repeat(12_000),
              },
            ],
          },
          { role: "user", content: [{ type: "text", text: "send it" }] },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-pending",
                toolName: "send-email",
                args: { body: pendingBody },
                result: "Awaiting human approval. This action did NOT execute.",
                approval: { approvalKey: "send-email:pending" },
              },
            ],
          },
          { role: "user", content: [{ type: "text", text: "approve" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const request = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const toolCalls = request.structuredHistory.flatMap((message: any) =>
      message.content.filter((part: any) => part.type === "tool-call"),
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      toolName: "send-email",
      args: { body: pendingBody },
    });
    const toolResults = request.structuredHistory.flatMap((message: any) =>
      message.content.filter((part: any) => part.type === "tool-result"),
    );
    expect(toolResults[0].toolInput).toBeUndefined();
  });
});

function sseResponse(events: unknown[], runId = "run-qa"): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body.join("")));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Run-Id": runId,
      },
    },
  );
}

function backgroundSseResponse(events: unknown[], runId: string): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body.join("")));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Run-Id": runId,
        "X-Dispatch-Mode": "background",
      },
    },
  );
}

function foregroundSelfChainSseResponse(
  events: unknown[],
  runId: string,
): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body.join("")));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Run-Id": runId,
        "X-Dispatch-Mode": "foreground-self-chain",
      },
    },
  );
}

function emptySseResponse(runId = "run-empty"): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Run-Id": runId,
      },
    },
  );
}

function idleSseResponse(runId = "run-idle", dispatchMode?: string): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setTimeout(() => {
          try {
            controller.enqueue(
              new TextEncoder().encode(`: ping ${Date.now()}\n\n`),
            );
          } catch {
            // The watchdog may have cancelled the stream first.
          }
        }, SSE_NO_PROGRESS_TIMEOUT_MS + 1);
      },
      cancel() {
        if (timer) clearTimeout(timer);
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Run-Id": runId,
        ...(dispatchMode ? { "X-Dispatch-Mode": dispatchMode } : {}),
      },
    },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

async function drain(iterable: AsyncIterable<unknown>) {
  const results: unknown[] = [];
  for await (const result of iterable) {
    results.push(result);
  }
  return results;
}

describe("createAgentChatAdapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    analyticsMock.captureError.mockReset();
    clearActiveRun();
  });

  it("publishes the client turn id before dispatch and clears it when the run id arrives", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    let pendingAtDispatch: ReturnType<typeof getPendingTurn> = null;
    const fetchSpy = vi.fn().mockImplementation(async () => {
      pendingAtDispatch = getPendingTurn("thread-pending");
      return sseResponse([{ type: "done" }], "run-pending");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-pending",
      threadId: "thread-pending",
      browserTabId: "browser-pending",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a durable turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(pendingAtDispatch).toMatchObject({ threadId: "thread-pending" });
    expect(pendingAtDispatch?.turnId).toMatch(/^turn-/);
    expect(pendingAtDispatch?.tabId).toBe("chat-pending");
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-agent-native-browser-tab": "browser-pending",
    });
    expect(getPendingTurn("thread-pending")).toBeNull();
  });

  it("clears the pending turn when the request fails before a run id arrives", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/runs/active?")) {
          return new Response(null, { status: 404 });
        }
        return new Response("upstream failure", { status: 400 });
      }),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-pending-failure",
      threadId: "thread-pending-failure",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a failing chat turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(getPendingTurn("thread-pending-failure")).toBeNull();
  });

  it("falls back to the same-origin route when direct streaming cannot start", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat/stream-token") {
        return jsonResponse({ token: "stream-token" });
      }
      if (
        url === "https://stream.example.test/_agent-native/agent-chat-stream" &&
        init?.method === "POST"
      ) {
        throw new TypeError("Failed to fetch");
      }
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        return sseResponse([
          { type: "text", text: "primary route" },
          { type: "done" },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      streamingUrl:
        "https://stream.example.test/_agent-native/agent-chat-stream",
      tabId: "chat-stream-fallback",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Use the primary route" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "/_agent-native/agent-chat/stream-token",
      "https://stream.example.test/_agent-native/agent-chat-stream",
      "/_agent-native/agent-chat",
    ]);
    expect((results.at(-1) as any).content.at(-1).text).toBe("primary route");
  });

  it("consumes a 200 JSON response while checking auth errors", async () => {
    const response = jsonResponse({ error: "Authentication required" });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(
        jsonResponse({ error: "Authentication required" }, 401),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-json-auth",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a chat turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(response.bodyUsed).toBe(true);
    expect(results[0]).toMatchObject({
      status: { type: "incomplete", reason: "error" },
    });
  });

  it("reports primitive JSON responses instead of passing them to SSE parsing", async () => {
    const response = new Response("null", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Run-Id": "run-json",
      },
    });
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-json-success",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a chat turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(response.bodyUsed).toBe(true);
    expect(results[0]).toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "Agent chat endpoint returned JSON instead of an event stream",
          ),
        },
      ],
      status: { type: "incomplete", reason: "error" },
    });
  });

  it("detects a chunked top-level JSON string after leading whitespace", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("\n"));
          setTimeout(() => {
            controller.enqueue(
              encoder.encode(JSON.stringify("Authentication required")),
            );
            controller.close();
          }, 10);
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-json-whitespace",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a chat turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(results[0]).toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "Agent chat endpoint returned JSON instead of an event stream",
          ),
        },
      ],
      status: { type: "incomplete", reason: "error" },
    });
  });

  it("classifies a delayed JSON response after its first body chunk", async () => {
    const encoder = new TextEncoder();
    let finishResponse: (() => void) | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          finishResponse = () => {
            try {
              controller.enqueue(encoder.encode(JSON.stringify({ ok: true })));
              controller.close();
            } catch {
              // The iterator cleanup may have already closed the response body.
            }
          };
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchSpy);
    vi.useFakeTimers();

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-json-delayed",
    });
    const iterator = adapter
      .run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a chat turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any)
      [Symbol.asyncIterator]();

    try {
      const resultPromise = iterator.next();
      await vi.advanceTimersByTimeAsync(1_001);
      finishResponse?.();
      const result = await resultPromise;

      expect(result.done).toBe(false);
      expect(result.value).toMatchObject({
        content: [
          {
            type: "text",
            text: expect.stringContaining(
              "Agent chat endpoint returned JSON instead of an event stream",
            ),
          },
        ],
        status: { type: "incomplete", reason: "error" },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      await iterator.return?.();
    }
  });

  it("stops a silent JSON probe for a custom caller abort reason", async () => {
    let finishResponse: (() => void) | undefined;
    const cancelResponse = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          finishResponse = () => {
            try {
              controller.close();
            } catch {
              // The probe may have already cancelled the response body.
            }
          };
        },
        cancel: cancelResponse,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchSpy);
    const abortController = new AbortController();

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-json-abort",
    });
    const iterator = adapter
      .run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a chat turn" }],
          },
        ],
        abortSignal: abortController.signal,
      } as any)
      [Symbol.asyncIterator]();

    const abortTimer = setTimeout(
      () => abortController.abort(new Error("stop")),
      0,
    );
    try {
      const result = await iterator.next();

      expect(result.done).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(cancelResponse).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(abortTimer);
      finishResponse?.();
      await iterator.return?.();
    }
  });

  it("waits for a slow-starting mislabeled SSE response", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let finishResponse: (() => void) | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", text: "first" })}\n\n`,
              ),
            );
            finishResponse = () => controller.close();
          }, 2_000);
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-mislabeled-sse-delayed",
    });
    const iterator = adapter
      .run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a chat turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any)
      [Symbol.asyncIterator]();

    try {
      const resultPromise = iterator.next();
      await vi.advanceTimersByTimeAsync(2_001);
      const result = await resultPromise;

      expect(result.done).toBe(false);
      expect(result.value).toMatchObject({
        content: [{ type: "text", text: "first" }],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      finishResponse?.();
      await iterator.return?.();
    }
  });

  it("starts parsing a mislabeled SSE response before it closes", async () => {
    const encoder = new TextEncoder();
    let finishResponse: (() => void) | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "text", text: "first" })}\n\n`,
            ),
          );
          finishResponse = () => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
            );
            controller.close();
          };
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-mislabeled-sse",
    });
    const iterator = adapter
      .run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Start a chat turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any)
      [Symbol.asyncIterator]();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const firstResult = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("SSE parsing waited for the body to close")),
            1_000,
          );
        }),
      ]);

      expect(firstResult.done).toBe(false);
      expect(firstResult.value).toMatchObject({
        content: [{ type: "text", text: "first" }],
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      finishResponse?.();
      await iterator.return?.();
    }
  });

  it("posts the latest user message with attachments, references, and model selection", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const modelRef = { current: "claude-sonnet-4-6" };
    const engineRef = { current: "builder" };
    const effortRef = { current: "high" as const };
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-qa",
      threadId: "thread-qa",
      modelRef,
      engineRef,
      effortRef,
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Earlier turn" }],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "Earlier answer" }],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Review @[app.tsx|file]" },
              { type: "image", image: "data:image/jpeg;base64,inline" },
            ],
            attachments: [
              {
                name: "screen.png",
                contentType: "image/png",
                content: [
                  { type: "image", image: "data:image/png;base64,abc" },
                ],
              },
              {
                name: "notes.txt",
                contentType: "text/plain",
                content: [
                  {
                    type: "text",
                    text: "<attachment name=notes.txt>\nAttachment text\n</attachment>",
                  },
                ],
              },
              {
                name: "report.md",
                content: [
                  {
                    type: "file",
                    data: "# Report",
                    mimeType: "text/markdown",
                  },
                ],
              },
              {
                name: "transcript.txt",
                contentType: "text/plain",
                content: [
                  {
                    type: "file",
                    data: "data:text/plain;base64,VHJhbnNjcmlwdCB0ZXh0",
                    mimeType: "text/plain",
                  },
                ],
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: {
            turnId: "turn-qa",
            references: [
              {
                type: "file",
                path: "app.tsx",
                name: "app.tsx",
                source: "codebase",
              },
            ],
          },
        },
      } as any),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/_agent-native/agent-chat");
    expect(init.method).toBe("POST");
    expect(init.headers["x-agent-native-surface"]).toBe("app");

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      message: "Review @app.tsx",
      displayMessage: "Review @[app.tsx|file]",
      threadId: "thread-qa",
      model: "claude-sonnet-4-6",
      engine: "builder",
      effort: "high",
      history: [
        { role: "user", content: "Earlier turn" },
        { role: "assistant", content: "Earlier answer" },
      ],
      references: [
        {
          type: "file",
          path: "app.tsx",
          name: "app.tsx",
          source: "codebase",
        },
      ],
      attachments: [
        {
          type: "image",
          name: "screen.png",
          contentType: "image/png",
          data: "data:image/png;base64,abc",
        },
        {
          type: "file",
          name: "notes.txt",
          contentType: "text/plain",
          text: "Attachment text",
        },
        {
          type: "file",
          name: "report.md",
          contentType: "text/markdown",
          text: "# Report",
        },
        {
          type: "file",
          name: "transcript.txt",
          contentType: "text/plain",
          text: "Transcript text",
        },
        {
          type: "image",
          name: "image",
          contentType: "image/jpeg",
          data: "data:image/jpeg;base64,inline",
        },
      ],
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: { isRunning: true, tabId: "chat-qa", turnId: "turn-qa" },
      }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: { isRunning: false, tabId: "chat-qa", turnId: "turn-qa" },
      }),
    );
  });

  it("sends the assistant-ui parent when regenerating a message", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-regenerate",
    });

    await drain(
      adapter.run({
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "try again" }],
          },
          {
            id: "assistant-original",
            role: "assistant",
            content: [{ type: "text", text: "Original answer." }],
          },
        ],
        unstable_parentId: "user-1",
        abortSignal: new AbortController().signal,
        runConfig: {},
      } as any),
    );

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toMatchObject({
      parentId: "user-1",
      message: "try again",
      threadId: "thread-regenerate",
    });
  });

  it("does not publish terminal cleanup after another run claims active state", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    setActiveRun({
      threadId: "thread-existing",
      runId: "run-existing",
      lastSeq: 3,
    });

    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-terminal-stop",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "stop this turn" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-terminal-stop",
          turnId: expect.any(String),
        },
      }),
    );
  });

  it("prefers a queued turn's snapshotted model over the live picker", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-queue-model",
      threadId: "thread-queue-model",
      modelRef: { current: "claude-sonnet-4-6" },
      engineRef: { current: "builder" },
      effortRef: { current: "low" as const },
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Queued under the old model" }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: {
            agentNativeQueuedMessageId: "queued-model-1",
            model: "claude-opus-4-6",
            engine: "anthropic",
            effort: "high",
          },
        },
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({
      queuedMessageId: "queued-model-1",
      model: "claude-opus-4-6",
      engine: "anthropic",
      effort: "high",
    });
  });

  it("rehydrates persisted object-storage attachments as URL references", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-url-attachments",
      threadId: "thread-url-attachments",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Use these again" }],
            attachments: [
              {
                name: "screenshot.png",
                contentType: "image/png",
                metadata: {
                  uploadUrl: "https://cdn.example.com/screenshot.png",
                  uploadProvider: "builder",
                },
                content: [
                  {
                    type: "image",
                    image: "https://cdn.example.com/screenshot.png",
                  },
                ],
              },
              {
                name: "report.pdf",
                contentType: "application/pdf",
                metadata: {
                  uploadUrl: "https://cdn.example.com/report.pdf",
                  uploadProvider: "builder",
                },
                content: [
                  {
                    type: "file",
                    url: "https://cdn.example.com/report.pdf",
                    mimeType: "application/pdf",
                    filename: "report.pdf",
                  },
                ],
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.attachments).toEqual([
      {
        type: "image",
        name: "screenshot.png",
        contentType: "image/png",
        url: "https://cdn.example.com/screenshot.png",
        uploadProvider: "builder",
      },
      {
        type: "file",
        name: "report.pdf",
        contentType: "application/pdf",
        url: "https://cdn.example.com/report.pdf",
        uploadProvider: "builder",
      },
    ]);
  });

  it("posts approval grants on the continuation turn", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-approval",
      threadId: "thread-approval",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolName: "create-builder-branch",
                toolCallId: "call-1",
                args: {},
                result: "Awaiting human approval.",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: "Approved. Go ahead." }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: { approvedToolCalls: ["create-builder-branch:{}"] },
        },
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.approvedToolCalls).toEqual(["create-builder-branch:{}"]);
  });

  it("falls back to the live picker for queue entries without a model snapshot", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-queue-legacy",
      threadId: "thread-queue-legacy",
      modelRef: { current: "claude-sonnet-4-6" },
      engineRef: { current: "builder" },
      effortRef: { current: "low" as const },
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Queued before snapshots existed" },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: { custom: { agentNativeQueuedMessageId: "queued-legacy" } },
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: "claude-sonnet-4-6",
      engine: "builder",
      effort: "low",
    });
  });

  it("uses an explicit fallback prompt when the user sends only attachments", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-attachments",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "" }],
            attachments: [
              {
                name: "source.txt",
                contentType: "text/plain",
                content: [{ type: "text", text: "Source material" }],
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message).toBe("Use the attached context.");
    expect(body.displayMessage).toBe("Use the attached context.");
    expect(body.attachments).toEqual([
      {
        type: "file",
        name: "source.txt",
        contentType: "text/plain",
        text: "Source material",
      },
    ]);
  });

  it("keeps attachments and references when auto-continuing an interrupted attachment turn", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { type: "text", text: "I found 700 readings." },
          {
            type: "error",
            error: "The worker was interrupted.",
            errorCode: "stale_run",
            recoverable: true,
          },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "text", text: "finished" }, { type: "done" }]),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-attachment-recovery",
      threadId: "thread-attachment-recovery",
    });

    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "" }],
            attachments: [
              {
                name: "readings.csv",
                contentType: "text/csv",
                content: [{ type: "text", text: "time,value\n1,42" }],
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: {
            references: [
              {
                type: "file",
                path: "scripts/import-readings.ts",
                name: "import-readings.ts",
                source: "codebase",
              },
            ],
          },
        },
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(secondBody.message).toContain("Continue from where you left off");
    expect(secondBody.internalContinuation).toBe(true);
    expect(secondBody.attachments).toEqual([
      {
        type: "file",
        name: "readings.csv",
        contentType: "text/csv",
        text: "time,value\n1,42",
      },
    ]);
    expect(secondBody.references).toEqual([
      {
        type: "file",
        path: "scripts/import-readings.ts",
        name: "import-readings.ts",
        source: "codebase",
      },
    ]);
  });

  it("rejects a recovered request that exceeds the serialized body limit", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const prompt = "p".repeat(750_000);
    const pdfData = `data:application/pdf;base64,${"a".repeat(3_000_000)}`;
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/stream-token")) {
        return Promise.resolve(jsonResponse({ token: "test-stream-token" }));
      }
      if (init?.method === "POST") {
        return Promise.resolve(
          sseResponse([
            { type: "text", text: "I am reading the PDF." },
            {
              type: "error",
              error: "The worker was interrupted.",
              errorCode: "stale_run",
              recoverable: true,
            },
          ]),
        );
      }
      return Promise.resolve(
        jsonResponse({ error: "unexpected request" }, 500),
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      streamingUrl: "https://stream.example.com/agent-chat",
      tabId: "chat-oversized-recovery",
      threadId: "thread-oversized-recovery",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
            attachments: [
              {
                name: "report.pdf",
                contentType: "application/pdf",
                content: [
                  {
                    type: "file",
                    data: pdfData,
                    mimeType: "application/pdf",
                  },
                ],
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;
    const posts = fetchSpy.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    const streamTokenRequests = fetchSpy.mock.calls.filter(([url]) =>
      url.endsWith("/stream-token"),
    );

    expect(posts).toHaveLength(1);
    expect(streamTokenRequests).toHaveLength(1);
    expect(
      new TextEncoder().encode(posts[0][1].body as string).byteLength,
    ).toBeLessThan(MAX_REQUEST_BODY_BYTES);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "request_too_large",
          message: "request_too_large",
        }),
      }),
    );
    expect(results.at(-1)).toMatchObject({
      status: { type: "incomplete", reason: "error" },
    });
    expect(
      results
        .at(-1)
        ?.content.some(
          (part: any) =>
            part.type === "text" && part.text.includes("request_too_large"),
        ),
    ).toBe(false);
  });

  it("includes prior-turn text attachments in chat history", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-history-attachments",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "" }],
            attachments: [
              {
                name: "prior-transcript.txt",
                contentType: "text/plain",
                content: [
                  {
                    type: "file",
                    data: "data:text/plain;base64,Q3VzdG9tZXIgY2FsbCBub3Rlcw==",
                    mimeType: "text/plain",
                  },
                ],
              },
            ],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "I read the transcript." }],
          },
          {
            role: "user",
            content: [{ type: "text", text: "What were the next steps?" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.history[0].content).toContain(
      '<attachment name="prior-transcript.txt" contentType="text/plain" type="file">',
    );
    expect(body.history[0].content).toContain("Customer call notes");
    expect(body.structuredHistory[0]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: expect.stringContaining("Customer call notes"),
        },
      ],
    });
  });

  it("summarizes preserved SVG data URL attachments in prior-turn history", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-history-svg-attachments",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Use this logo later" }],
            attachments: [
              {
                name: "logo.svg",
                contentType: "image/svg+xml",
                content: [
                  {
                    type: "file",
                    data: "data:image/svg+xml;base64,PHN2Zz48dGl0bGU+TG9nbzwvdGl0bGU+PC9zdmc+",
                    mimeType: "image/svg+xml",
                  },
                ],
              },
            ],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "I saved the logo context." }],
          },
          {
            role: "user",
            content: [{ type: "text", text: "What was in the logo?" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.history[0].content).toContain(
      "[Attached file: logo.svg (image/svg+xml); SVG reference-only, raw markup omitted from prior chat history.]",
    );
    expect(body.history[0].content).not.toContain("<title>Logo</title>");
    expect(body.structuredHistory[0]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: expect.stringContaining("SVG reference-only"),
        },
      ],
    });
    expect(body.structuredHistory[0].content[0].text).not.toContain(
      "<title>Logo</title>",
    );
  });

  it("summarizes bare successful tool results in structured history", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-success-tool-results",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Sign me up" }],
          },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolName: "signup",
                args: {},
                result: true,
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: "continue" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const serialized = JSON.stringify(body.structuredHistory);
    expect(serialized).not.toContain('"true"');
    expect(body.structuredHistory).toContainEqual({
      role: "user",
      content: [
        expect.objectContaining({
          type: "tool-result",
          toolName: "signup",
          content: "signup completed.",
        }),
      ],
    });
  });

  it("excludes legacy synthetic agent cards from structured history", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-legacy-agent-card-history",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Count signups" }],
          },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-analytics",
                toolName: "call-agent",
                args: { agent: "analytics", message: "Count signups" },
                result: "42 signups",
              },
              {
                type: "tool-call",
                toolCallId: "agent-analytics",
                toolName: "agent:Analytics",
                args: {},
                result: "Done",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: "Use that in my todo" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const serializedHistory = JSON.stringify(body.structuredHistory);
    expect(serializedHistory).toContain('"toolName":"call-agent"');
    expect(serializedHistory).not.toContain("agent:Analytics");
  });

  it("sends the explicit dev-frame surface for outer frame-hosted chat", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      surface: "dev-frame",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Add a feature" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers["x-agent-native-surface"]).toBe("dev-frame");
  });

  function stubLargeAttachmentEnv() {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  async function postOutboundAttachment(
    fetchSpy: any,
    text: string,
    options: { name?: string; contentType?: string } = {},
  ) {
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-large-attachment",
    });
    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Host this as an extension" }],
            attachments: [
              {
                name: options.name ?? "pasted-text-1.txt",
                contentType: options.contentType ?? "text/plain",
                content: [{ type: "text", text }],
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );
    return JSON.parse(fetchSpy.mock.calls[0][1].body);
  }

  it("sends a realistic large pasted attachment intact (above the 60K history cap)", async () => {
    const fetchSpy = stubLargeAttachmentEnv();
    const big = "a".repeat(150_000);
    const body = await postOutboundAttachment(fetchSpy, big);
    expect(body.attachments[0].text).toBe(big);
    expect(body.attachments[0].text).not.toContain(
      "omitted from the submitted",
    );
  });

  it("preserves a current EML attachment beyond the legacy outbound cap", async () => {
    const fetchSpy = stubLargeAttachmentEnv();
    const eml = "a".repeat(200_010);
    const body = await postOutboundAttachment(fetchSpy, eml, {
      name: "message.eml",
      contentType: "message/rfc822",
    });
    expect(body.attachments[0].text).toBe(eml);
  });

  it("routes missing-credential HTTP responses through the run-error card", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: "No LLM provider is connected",
          errorCode: "missing_credentials",
        },
        500,
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-missing-credentials",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "show my upcoming events" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:missing-api-key",
        detail: { tabId: "chat-missing-credentials" },
      }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    expect(results[0]).toEqual({
      content: [],
      status: { type: "incomplete", reason: "error" },
      metadata: {
        custom: {
          runError: {
            message: "No LLM provider is connected",
            errorCode: "missing_credentials",
          },
        },
      },
    });
  });

  it("keeps raw provider-key HTTP failures on the missing-credential path", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "ANTHROPIC_API_KEY is not set" }, 500),
        ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-raw-provider-key",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "run the prompt" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(results[0]).toMatchObject({
      content: [],
      metadata: {
        custom: {
          runError: {
            errorCode: "missing_credentials",
          },
        },
      },
    });
  });

  it("does not replay a turn after a non-retryable database response", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const databaseMessage =
      "The database became unavailable while processing this request. Refresh before deciding whether to retry.";
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: databaseMessage,
          code: "database_unavailable",
          retryable: false,
        },
        503,
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-database-unavailable",
      threadId: "thread-database-unavailable",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "search all calls" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results.at(-1)).toMatchObject({
      content: [
        { type: "text", text: `Something went wrong: ${databaseMessage}` },
      ],
      status: { type: "incomplete", reason: "error" },
      metadata: {
        custom: {
          runError: {
            message: databaseMessage,
            errorCode: "database_unavailable",
            recoverable: false,
          },
        },
      },
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "database_unavailable",
          recoverable: false,
        }),
      }),
    );
    expect(JSON.stringify(results)).not.toContain('"retryable":false');
  });

  it("treats authentication failures as auth errors, not AI setup", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "Authentication required" }, 401),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-auth",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "make a video" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(results[0]).toEqual({
      content: [
        {
          type: "text",
          text: "Error: Authentication required. Sign in again to use chat.",
        },
      ],
      status: { type: "incomplete", reason: "error" },
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:auth-error",
        detail: { reason: "auth-required", tabId: "chat-auth" },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:missing-api-key" }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/_agent-native/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("treats invalid token responses as auth failures", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "Invalid token" }, 401));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-invalid-token",
      threadId: "thread-invalid-token",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "what's on my calendar" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(results[0]).toEqual({
      content: [
        {
          type: "text",
          text: "Error: Authentication required. Sign in again to use chat.",
        },
      ],
      status: { type: "incomplete", reason: "error" },
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:auth-error",
        detail: {
          reason: "auth-required",
          tabId: "chat-invalid-token",
          threadId: "thread-invalid-token",
        },
      }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-invalid-token",
          turnId: expect.any(String),
        },
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/_agent-native/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries the chat request once when the session is still valid after an auth failure", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let chatPostCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/auth/session") {
        return jsonResponse({
          email: "user@example.com",
          token: "still-valid",
        });
      }
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        chatPostCount += 1;
        return chatPostCount === 1
          ? jsonResponse({ error: "Invalid token" }, 403)
          : sseResponse([{ type: "done" }]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-auth-retry",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "resume the task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(chatPostCount).toBe(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/_agent-native/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:auth-error" }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-auth-retry",
          turnId: expect.any(String),
        },
      }),
    );
  });

  it("sends plan mode as request metadata without polluting the message", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const execModeRef: { current: "build" | "plan" | undefined } = {
      current: "plan",
    };
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      execModeRef,
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "make a button blue" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({
      message: "make a button blue",
      mode: "plan",
    });

    execModeRef.current = "build";
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValueOnce(sseResponse([{ type: "done" }]));

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "make a button blue" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body2 = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body2).toMatchObject({
      message: "make a button blue",
      mode: "act",
    });
  });

  it("allows a per-message request mode override", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      execModeRef: { current: "plan" },
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Implement the plan." }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: { requestMode: "act" },
        },
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({
      message: "Implement the plan.",
      mode: "act",
    });
  });

  it("preserves the RunsTray tracking marker on chat requests", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-bg",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Run quietly" }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: { trackInRunsTray: true },
        },
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toMatchObject({
      message: "Run quietly",
      threadId: "thread-bg",
      trackInRunsTray: true,
    });
  });

  it("sends the run config's usage label with the chat request", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-label",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Enrich this record" }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: { usageLabel: "  crm:enrich-record  " },
        },
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.usageLabel).toBe("crm:enrich-record");
  });

  it("sends the run config's action scope with the chat request", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-scoped",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Draft a reply" }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: {
            actionScope: {
              kind: "content-comment-ai",
              requestId: "request-1",
            },
          },
        },
      } as any),
    );

    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).actionScope).toEqual({
      kind: "content-comment-ai",
      requestId: "request-1",
    });
    expect(results.at(-1)?.metadata?.custom).toMatchObject({
      actionScope: {
        kind: "content-comment-ai",
        requestId: "request-1",
      },
    });
  });

  it("keeps recovery prompts from replacing the original user request", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-recovery",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Build a CS operations tool" }],
          },
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "The agent stopped before finishing.",
              },
            ],
          },
          {
            id: "recovery-message-1",
            role: "user",
            content: [
              {
                type: "text",
                text: "Continue from where you left off and finish my last request.",
              },
            ],
            metadata: {
              custom: { agentNativeRecoveryAction: "continue" },
            },
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message).toBe(
      "Continue from where you left off and finish my last request.",
    );
    expect(body.displayMessage).toBe("Build a CS operations tool");
    expect(body.internalContinuation).toBe(true);
    expect(body.history).toEqual([
      { role: "user", content: "Build a CS operations tool" },
      { role: "assistant", content: "The agent stopped before finishing." },
    ]);

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Build a CS operations tool" }],
          },
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "The agent stopped before finishing.",
              },
            ],
          },
          {
            id: "recovery-message-1",
            role: "user",
            content: [
              {
                type: "text",
                text: "Continue from where you left off and finish my last request.",
              },
            ],
            metadata: {
              custom: { agentNativeRecoveryAction: "continue" },
            },
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    expect(chatPosts).toHaveLength(1);
  });

  it("adopts the active run for queued recovery instead of posting again after it finishes", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return jsonResponse({ activeRunId: "run-finishing" }, 409);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-finishing",
          threadId: "thread-recovery-conflict",
          turnId: requestTurnId,
          status: "running",
        });
      }
      if (url.includes("/runs/run-finishing/events")) {
        return sseResponse([
          {
            type: "text",
            text: "Stopped because mutate-dashboard failed 3 times.",
          },
          { type: "done" },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-recovery-conflict",
    });
    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Update the dashboard" }],
          },
          {
            id: "queued-recovery-1",
            role: "user",
            content: [
              { type: "text", text: "Continue from where you stopped." },
            ],
            metadata: {
              custom: { agentNativeRecoveryAction: "continue" },
            },
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    expect(chatPosts).toHaveLength(1);
    expect(JSON.parse(chatPosts[0][1].body as string)).toMatchObject({
      internalContinuation: true,
      message: "Continue from where you stopped.",
    });
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/runs/run-finishing/events"),
      ),
    ).toBe(true);
    expect((results.at(-1) as any).content.at(-1).text).toBe(
      "Stopped because mutate-dashboard failed 3 times.",
    );
  });

  it("auto-continues without surfacing loop limit text", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          sseResponse([{ type: "loop_limit", maxIterations: 7 }]),
        )
        .mockResolvedValueOnce(
          sseResponse([
            { type: "text", text: "finished after continuation" },
            { type: "done" },
          ]),
        ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-limit",
    });
    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "keep using tools" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("finished after continuation");
    expect(last.metadata.custom.runId).toBe("run-qa");
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:loop-limit" }),
    );
    const fetchSpy = vi.mocked(fetch);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(secondBody.message).toContain("Continue from where you left off");
    expect(secondBody.internalContinuation).toBe(true);
    expect(secondBody.history).toEqual([
      { role: "user", content: "keep using tools" },
    ]);
  });

  it("stops a loop_limit chain that keeps producing the same tool calls", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      return sseResponse([
        { type: "tool_start", tool: "list-rows", input: { table: "users" } },
        { type: "tool_done", tool: "list-rows", result: "0 rows" },
        { type: "tool_start", tool: "list-rows", input: { table: "users" } },
        { type: "tool_done", tool: "list-rows", result: "0 rows" },
        { type: "loop_limit", maxIterations: 400 },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-loop-limit-runaway",
      threadId: "thread-loop-limit-runaway",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "count users" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    const results = await promise;

    expect(postCount).toBeLessThanOrEqual(5);
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("keeps continuing a loop_limit chain that completes new work each round", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      if (postCount <= 8) {
        return sseResponse([
          {
            type: "tool_start",
            tool: "read-file",
            input: { path: `src/${postCount}.ts` },
          },
          {
            type: "tool_done",
            tool: "read-file",
            result: `contents of ${postCount}`,
          },
          { type: "loop_limit", maxIterations: 400 },
        ]);
      }
      return sseResponse([
        { type: "text", text: "analysis complete" },
        { type: "done" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-loop-limit-progress",
      threadId: "thread-loop-limit-progress",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "audit the repo" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    const results = await promise;

    expect(postCount).toBe(9);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("analysis complete");
  });

  it("bounds a progressing loop_limit chain at the work-boundary ceiling, not the transient one", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      const tool = `read-file-${postCount}`;
      return sseResponse([
        { type: "tool_start", tool, input: { path: `src/${postCount}.ts` } },
        { type: "tool_done", tool, result: `contents of ${postCount}` },
        { type: "loop_limit", maxIterations: 400 },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-loop-limit-ceiling",
      threadId: "thread-loop-limit-ceiling",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "audit the repo" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(300_000);
    const results = await promise;

    expect(postCount).toBe(26);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          details: expect.stringContaining("loop_limit_continuations: 26"),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain(
      "reached the limit on how many times it can be automatically continued",
    );
  });

  it("keeps a loop_limit chain going when an earlier round left an unresolved Preparing card", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      if (postCount === 1) {
        return sseResponse([
          {
            type: "activity",
            label: "Preparing create-extension action",
            tool: "create-extension",
          },
          { type: "text", text: "Starting the review." },
          { type: "loop_limit", maxIterations: 400 },
        ]);
      }
      if (postCount <= 5) {
        return sseResponse([
          { type: "text", text: `Section ${postCount} of the review.` },
          { type: "loop_limit", maxIterations: 400 },
        ]);
      }
      return sseResponse([
        { type: "text", text: "Review done." },
        { type: "done" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-loop-limit-preparing",
      threadId: "thread-loop-limit-preparing",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "review this" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    const results = await promise;

    expect(postCount).toBe(6);
    const last = results.at(-1) as any;
    const text = JSON.stringify(last.content);
    expect(text).toContain("Review done.");
    expect(text).not.toContain("stuck preparing");
  });

  it("replays a failed prior-turn tool call as a failure, not a success", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-failed-tool-history",
    });

    await drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "send the email" }] },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-send",
                toolName: "send-email",
                args: { to: "a@example.com" },
                result: "Missing RESEND_API_KEY.",
                isError: true,
              },
              {
                type: "tool-call",
                toolCallId: "call-save",
                toolName: "save-draft",
                args: { id: "1" },
                result: "Interrupted before this tool returned a result.",
                outcome: "unknown",
              },
            ],
          },
          { role: "user", content: [{ type: "text", text: "try again" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const results = body.structuredHistory.flatMap((message: any) =>
      message.content.filter((part: any) => part.type === "tool-result"),
    );
    const failed = results.find((part: any) => part.toolName === "send-email");
    expect(failed.isError).toBe(true);
    const interrupted = results.find(
      (part: any) => part.toolName === "save-draft",
    );
    expect(interrupted.isError).toBeUndefined();
    expect(interrupted.content).toContain(
      "Interrupted before this tool returned a result.",
    );
  });

  it("prices tool-heavy assistant turns against the history budget", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-history-cost",
    });

    const bulkyAssistantTurn = (index: number) => ({
      role: "assistant",
      content: Array.from({ length: 6 }, (_, i) => ({
        type: "tool-call",
        toolCallId: `call-${index}-${i}`,
        toolName: "query-rows",
        args: { sql: "x".repeat(7_000) },
        result: "y".repeat(11_000),
      })),
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "the original ask" }],
          },
          bulkyAssistantTurn(1),
          { role: "user", content: [{ type: "text", text: "second ask" }] },
          bulkyAssistantTurn(2),
          { role: "user", content: [{ type: "text", text: "third ask" }] },
          bulkyAssistantTurn(3),
          { role: "user", content: [{ type: "text", text: "now do it" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(JSON.stringify(body.structuredHistory).length).toBeLessThan(400_000);

    const historyText = body.structuredHistory
      .filter((message: any) => message.role === "user")
      .flatMap((message: any) =>
        message.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text),
      )
      .join("\n");
    expect(historyText).toContain("the original ask");
    expect(historyText).toContain("second ask");
    expect(historyText).toContain("third ask");
  });

  it("keeps an over-budget turn's conclusions after dropping its tool results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-history-findings",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "why is it empty" }],
          },
          {
            role: "assistant",
            content: [
              ...Array.from({ length: 8 }, (_, i) => ({
                type: "tool-call",
                toolCallId: `call-${i}`,
                toolName: "read-source",
                args: { query: "x".repeat(7_000) },
                result: "y".repeat(11_000),
              })),
              { type: "text", text: "the rate filter excludes zero-rate rows" },
            ],
          },
          { role: "user", content: [{ type: "text", text: "so change it" }] },
          {
            role: "assistant",
            content: [{ type: "text", text: "confirming the filter" }],
          },
          { role: "user", content: [{ type: "text", text: "now fix it" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = fetchSpy.mock.calls[0][1].body as string;
    expect(body).toContain("why is it empty");
    expect(body).toContain("the rate filter excludes zero-rate rows");
    expect(body).not.toContain("y".repeat(11_000));
  });

  it("prices object tool results by what the request actually carries", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-object-result-cost",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "the original ask" }],
          },
          {
            role: "assistant",
            content: Array.from({ length: 6 }, (_, i) => ({
              type: "tool-call",
              toolCallId: `call-${i}`,
              toolName: "query-rows",
              args: { sql: "select 1" },
              result: { rows: [{ col: "y".repeat(13_000) }] },
            })),
          },
          { role: "user", content: [{ type: "text", text: "now do it" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = fetchSpy.mock.calls[0][1].body as string;
    expect(body).toContain("now do it");
    expect(body).not.toContain("y".repeat(13_000));
    expect(body).toContain("the original ask");
  });

  it("preserves structured tool history when auto-continuing after a transient error", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { type: "tool_start", tool: "get-document", input: { id: "doc-1" } },
          {
            type: "tool_done",
            tool: "get-document",
            result: '{"id":"doc-1","title":"Offsite rambles"}',
          },
          { type: "text", text: "Now I have the document format." },
          {
            type: "error",
            error: "Builder gateway timed out after 45s",
            errorCode: "builder_gateway_timeout",
          },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "text", text: "finished" }, { type: "done" }]),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-structured-continuation",
      threadId: "thread-structured-continuation",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "make another doc like this" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(secondBody.message).toContain("Continue from where you left off");
    expect(JSON.stringify(secondBody.structuredHistory)).not.toContain(
      "Tool: get-document",
    );
    expect(secondBody.structuredHistory).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "make another doc like this" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: expect.stringMatching(/^continuation_tc_/),
            toolName: "get-document",
            args: { id: "doc-1" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: expect.stringMatching(/^continuation_tc_/),
            toolName: "get-document",
            toolInput: '{"id":"doc-1"}',
            content: '{"id":"doc-1","title":"Offsite rambles"}',
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Now I have the document format." }],
      },
    ]);
  });

  it("reconnects to an active run when the initial POST loses its response", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        throw new TypeError("Failed to fetch");
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-existing",
          threadId: "thread-recover",
          turnId: requestTurnId,
          status: "running",
          heartbeatAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-existing/events")) {
        return sseResponse([
          { type: "text", text: "recovered from active run" },
          { type: "done" },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-recover",
      threadId: "thread-recover",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "keep going" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/_agent-native/agent-chat/runs/active?threadId=thread-recover",
      expect.any(Object),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/_agent-native/agent-chat/runs/run-existing/events?after=0",
      expect.any(Object),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("recovered from active run");
  });

  it.each([
    { label: "belongs to a newer turn", activeTurnId: "turn-newer" },
    { label: "has no turn id", activeTurnId: undefined },
  ])(
    "does not splice a never-seen active run that $label into a dangling turn",
    async ({ activeTurnId }) => {
      vi.useFakeTimers();
      vi.stubGlobal("window", { dispatchEvent: vi.fn() });
      vi.stubGlobal(
        "CustomEvent",
        class CustomEvent {
          type: string;
          detail: unknown;
          constructor(type: string, init?: { detail?: unknown }) {
            this.type = type;
            this.detail = init?.detail;
          }
        },
      );

      let postCount = 0;
      const postedTurnIds: string[] = [];
      const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
          postCount += 1;
          postedTurnIds.push(JSON.parse(init.body as string).turnId);
          if (postCount === 1) throw new TypeError("Failed to fetch");
          return sseResponse([
            { type: "text", text: "answer for dangling turn A" },
            { type: "done" },
          ]);
        }
        if (url.includes("/runs/active")) {
          return jsonResponse({
            active: true,
            runId: "run-turn-b",
            threadId: "thread-cross-turn",
            ...(activeTurnId ? { turnId: activeTurnId } : {}),
            status: "running",
            heartbeatAt: Date.now(),
          });
        }
        if (url.includes("/runs/run-turn-b/events")) {
          return sseResponse([
            { type: "text", text: "Not text from newer turn B" },
            { type: "done" },
          ]);
        }
        return jsonResponse({ error: "unexpected" }, 500);
      });
      vi.stubGlobal("fetch", fetchSpy);

      const adapter = createAgentChatAdapter({
        apiUrl: "/_agent-native/agent-chat",
        tabId: "chat-cross-turn",
        threadId: "thread-cross-turn",
      });
      const promise = drain(
        adapter.run({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "dangling turn A" }],
            },
          ],
          abortSignal: new AbortController().signal,
        } as any),
      );

      await vi.runAllTimersAsync();
      const results = await promise;

      expect(postedTurnIds).toHaveLength(2);
      expect(new Set(postedTurnIds).size).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("/runs/run-turn-b/events?after=0"),
        expect.any(Object),
      );
      const combinedText = (results.at(-1) as any).content
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join(" ");
      expect(combinedText).toContain("answer for dangling turn A");
      expect(combinedText).not.toContain("Not text from newer turn B");
    },
  );

  it("preserves the same-run cursor when active-run recovery follows a failed tail reconnect", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let tailReconnects = 0;
    const eventUrls: string[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        return sseResponse(
          [
            {
              type: "tool_start",
              tool: "delete-file",
              id: "call-1",
              input: { fileId: "screen-1" },
              seq: 0,
            },
            {
              type: "tool_done",
              tool: "delete-file",
              id: "call-1",
              result: '{"deleted":true}',
              seq: 1,
            },
          ],
          "run-existing",
        );
      }
      if (url.includes("/runs/run-existing/events")) {
        eventUrls.push(url);
        if (url.includes("after=2")) {
          tailReconnects += 1;
          return tailReconnects === 1
            ? jsonResponse({ error: "temporary failure" }, 503)
            : sseResponse(
                [
                  { type: "text", text: " tail recovered", seq: 2 },
                  { type: "done", seq: 3 },
                ],
                "run-existing",
              );
        }
        return jsonResponse({ error: "replayed from start" }, 500);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-existing",
          threadId: "thread-recover",
          status: "running",
          heartbeatAt: Date.now(),
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-recover-tail",
      threadId: "thread-recover",
    });

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "keep going" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(eventUrls).toEqual([
      "/_agent-native/agent-chat/runs/run-existing/events?after=2",
      "/_agent-native/agent-chat/runs/run-existing/events?after=2",
    ]);
    const last = results.at(-1) as any;
    const toolCalls = last.content.filter(
      (part: any) => part.type === "tool-call",
    );
    expect(toolCalls).toHaveLength(1);
    expect(last.content.at(-1).text).toBe(" tail recovered");
  });

  it("retries queued message conflicts instead of binding the old run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? jsonResponse({ activeRunId: "run-old" }, 409)
          : sseResponse([
              { type: "text", text: "queued answer" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/run-old/events")) {
        return sseResponse([
          { type: "text", text: "old answer" },
          { type: "done" },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-queued-conflict",
      threadId: "thread-queued-conflict",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: { agentNativeQueuedMessageId: "queued-1" },
        },
      } as any),
    );

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(postCount).toBe(2);
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/runs/run-old/events"),
      ),
    ).toBe(false);
    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    expect(
      chatPosts.map(([, init]) => JSON.parse(init.body as string).message),
    ).toEqual(["hello", "hello"]);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("queued answer");
  });

  it("fails a fresh conflicting turn after retry exhaustion instead of binding the old run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return jsonResponse({ activeRunId: "run-old" }, 409);
      }
      if (url.includes("/runs/run-old/events")) {
        return sseResponse([
          { type: "text", text: "old answer" },
          { type: "done" },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-queued-conflict-exhausted",
      threadId: "thread-queued-conflict-exhausted",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: { agentNativeQueuedMessageId: "queued-1" },
        },
      } as any),
    );

    await vi.runAllTimersAsync();
    const results = await promise;

    expect(postCount).toBe(121);
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/runs/run-old/events"),
      ),
    ).toBe(false);
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata.custom.runError.errorCode).toBe("active_run_conflict");
    expect(last.content.at(-1).text).toContain(
      "previous response is still finishing",
    );
  });

  it("fails a normal conflicting send after retry exhaustion instead of replaying the old run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    setActiveRun({
      threadId: "thread-normal-conflict-exhausted",
      runId: "run-old",
      lastSeq: 7,
    });

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return jsonResponse({ activeRunId: "run-old" }, 409);
      }
      if (url.includes("/runs/run-old/events")) {
        return sseResponse([
          { type: "text", text: "old answer" },
          { type: "done" },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-normal-conflict-exhausted",
      threadId: "thread-normal-conflict-exhausted",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.runAllTimersAsync();
    const results = await promise;

    expect(postCount).toBe(121);
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/runs/run-old/events"),
      ),
    ).toBe(false);
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata.custom.runError.errorCode).toBe("active_run_conflict");
    expect(last.content.at(-1).text).toContain(
      "previous response is still finishing",
    );
    expect(getActiveRun()).toEqual({
      threadId: "thread-normal-conflict-exhausted",
      runId: "run-old",
      lastSeq: 7,
    });
  });

  it("settles pending activity when a continuation conflict exhausts retries", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        if (postCount === 1) {
          return sseResponse(
            [
              {
                type: "activity",
                label: "Preparing run-code action",
                tool: "run-code",
              },
              { type: "loop_limit", maxIterations: 1 },
            ],
            "run-old",
          );
        }
        return jsonResponse({ activeRunId: "run-old" }, 409);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-continuation-conflict-exhausted",
      threadId: "thread-continuation-conflict-exhausted",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish the task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.runAllTimersAsync();
    const results = await promise;

    expect(postCount).toBe(122);
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata.custom.runError.errorCode).toBe("active_run_conflict");
    expect(last.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          toolName: "run-code",
          activity: true,
          result: "Stopped before this action started.",
          outcome: "unknown",
        }),
      ]),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity-clear",
        detail: { tabId: "chat-continuation-conflict-exhausted" },
      }),
    );
  });

  it("retries a normal send that conflicts with a just-finished run instead of replaying it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? jsonResponse({ activeRunId: "run-old" }, 409)
          : sseResponse([
              { type: "text", text: "fresh answer" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/run-old/events")) {
        return sseResponse([
          { type: "text", text: "old answer" },
          { type: "done" },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-normal-conflict",
      threadId: "thread-normal-conflict",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "follow up" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(postCount).toBe(2);
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/runs/run-old/events"),
      ),
    ).toBe(false);
    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    expect(
      chatPosts.map(([, init]) => JSON.parse(init.body as string).message),
    ).toEqual(["follow up", "follow up"]);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("fresh answer");
  });

  it("continues automatically when an SSE stream closes before any terminal event", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? emptySseResponse("run-empty")
          : sseResponse([
              { type: "text", text: "finished after empty-stream recovery" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/run-empty/events")) {
        return jsonResponse({ error: "gone" }, 404);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({ error: "missing route" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-empty",
      threadId: "thread-empty",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do the thing" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(postCount).toBe(2);
    expect(analyticsMock.captureError).not.toHaveBeenCalled();
    const secondBody = JSON.parse(fetchSpy.mock.calls[3][1].body);
    expect(secondBody.message).toContain("Continue from where you left off");
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe(
      "finished after empty-stream recovery",
    );
  });

  it("does not capture transient 5xx recovery probe responses", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? emptySseResponse("run-empty-5xx")
          : sseResponse([
              { type: "text", text: "finished after transient recovery" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/run-empty-5xx/events")) {
        return jsonResponse({ error: "temporary failure" }, 500);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({ error: "temporary failure" }, 502);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-empty-5xx",
      threadId: "thread-empty-5xx",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do the thing" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(postCount).toBe(2);
    expect(analyticsMock.captureError).not.toHaveBeenCalled();
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("finished after transient recovery");
  });

  it("ignores recent terminal active runs from a previous turn during recovery", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? emptySseResponse("run-current-empty")
          : sseResponse([
              { type: "text", text: "finished the new turn" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/run-current-empty/events")) {
        return jsonResponse({ error: "gone" }, 404);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-old-completed",
          threadId: "thread-terminal-mismatch",
          turnId: "turn-old",
          status: "completed",
          heartbeatAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-old-completed/events")) {
        return sseResponse([
          { type: "text", text: "old completed turn" },
          { type: "done" },
        ]);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-terminal-mismatch",
      threadId: "thread-terminal-mismatch",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "answer the new request" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(postCount).toBe(2);
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/runs/run-old-completed/events"),
      ),
    ).toBe(false);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("finished the new turn");
  });

  it("reattaches instead of aborting when an SSE stream stays alive without progress", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let chatPostCount = 0;
    let abortCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/runs/run-idle/abort")) {
        abortCount += 1;
        return jsonResponse({ ok: true });
      }
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        chatPostCount += 1;
        return chatPostCount === 1
          ? idleSseResponse("run-idle")
          : sseResponse([
              { type: "text", text: "finished after idle recovery" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/run-idle/events")) {
        return jsonResponse({ error: "gone" }, 404);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({ active: false });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-idle",
      threadId: "thread-idle",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "long running thing" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(SSE_NO_PROGRESS_TIMEOUT_MS + 1);
    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(abortCount).toBe(0);
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes("/runs/run-idle/events"),
      ),
    ).toBe(true);
    expect(chatPostCount).toBe(2);
    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    const secondBody = JSON.parse(chatPosts[1][1].body);
    expect(secondBody.message).toContain("Continue from where you left off");
    expect(secondBody.history).toEqual([
      { role: "user", content: "long running thing" },
    ]);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("finished after idle recovery");
  });

  it("retries silent run timeouts a few times before giving up", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return sseResponse([{ type: "auto_continue", reason: "run_timeout" }]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-no-progress",
      threadId: "thread-no-progress",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "large extension edit" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    const results = await promise;

    expect(postCount).toBe(3);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "connection_error",
          message: expect.stringContaining(
            "did not produce any visible progress",
          ),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.content.at(-1).text).toContain(
      "did not produce any visible progress",
    );
  });

  it("surfaces repeated Builder gateway timeouts while preparing action input", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return sseResponse([
          {
            type: "activity",
            label: "Preparing generate-design action",
            tool: "generate-design",
          },
          {
            type: "error",
            error: "Builder gateway timed out after 45s while streaming.",
            errorCode: "builder_gateway_timeout",
          },
        ]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-design-timeout-loop",
      threadId: "thread-design-timeout-loop",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Generate a todo app design" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    const results = await promise;

    expect(postCount).toBe(4);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "builder_gateway_timeout",
          message: expect.stringContaining("Builder gateway timed out"),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata.custom.runError).toMatchObject({
      errorCode: "builder_gateway_timeout",
      recoverable: true,
    });
    expect(last.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          toolName: "generate-design",
          activity: true,
          result: "Stopped before this action started.",
        }),
      ]),
    );
    expect(last.content.at(-1).text).toContain(
      "Builder gateway timed out after 45s",
    );
  });

  it("recovers when a silent run timeout is followed by real output", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        if (postCount < 3) {
          return sseResponse([
            { type: "auto_continue", reason: "run_timeout" },
          ]);
        }
        return sseResponse([{ type: "text", text: "done" }, { type: "done" }]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-recover",
      threadId: "thread-recover",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "slow analytical question" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(postCount).toBe(3);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("done");
  });

  it("continues once when a run timeout happened during action input streaming", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? sseResponse([
              {
                type: "activity",
                label: "Preparing create-extension action",
                tool: "create-extension",
              },
              { type: "auto_continue", reason: "run_timeout" },
            ])
          : sseResponse([
              {
                type: "text",
                text: "created a compact first version",
              },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-action-input-timeout",
      threadId: "thread-action-input-timeout",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Build a detailed CS operations extension",
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(postCount).toBe(2);
    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    const secondBody = JSON.parse(chatPosts[1][1].body);
    expect(secondBody.message).toContain(
      "If it already gives a coherent answer",
    );
    expect(secondBody.message).toContain("do not call tools");
    expect(secondBody.message).toContain("expand the search");
    expect(secondBody.message).toContain(
      "preparing the `create-extension` action input",
    );
    expect(secondBody.message).toContain("compact working v1");
    expect(secondBody.history).toEqual([
      { role: "user", content: "Build a detailed CS operations extension" },
    ]);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("created a compact first version");
  });

  it("nudges toward incremental edits for non-extension large-payload actions cut off mid-stream", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? sseResponse([
              {
                type: "activity",
                label: "Preparing generate-design action",
                tool: "generate-design",
              },
              { type: "auto_continue", reason: "run_timeout" },
            ])
          : sseResponse([
              { type: "text", text: "saved a minimal first version" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-design-input-timeout",
      threadId: "thread-design-input-timeout",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Generate a full dashboard design" },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(postCount).toBe(2);
    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    const secondBody = JSON.parse(chatPosts[1][1].body);
    expect(secondBody.message).toContain(
      "preparing the `generate-design` action input",
    );
    expect(secondBody.message).toContain("existing design file or snapshot");
    expect(secondBody.message).toContain("edit-design");
    expect(secondBody.message).toContain("same `fileId`");
    expect(secondBody.message).toContain('mode: "replace-file"');
    expect(secondBody.message).toContain(
      "Use `generate-design` only for a brand-new compact first file",
    );
    expect(secondBody.message).not.toContain("compact working v1");
  });

  it("nudges stalled edit-design preparation toward smaller payloads", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? sseResponse([
              {
                type: "activity",
                label: "Preparing edit-design action",
                tool: "edit-design",
              },
              { type: "auto_continue", reason: "no_progress" },
            ])
          : sseResponse([
              { type: "text", text: "saved smaller search/replace edits" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-edit-design-prep-timeout",
      threadId: "thread-edit-design-prep-timeout",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Expand the selected Design variant into a full todo app",
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(postCount).toBe(2);
    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    const secondBody = JSON.parse(chatPosts[1][1].body);
    expect(secondBody.message).toContain(
      "preparing the `edit-design` action input",
    );
    expect(secondBody.message).toContain("smaller `edit-design` payload");
    expect(secondBody.message).toContain("exact search/replace edits");
    expect(secondBody.message).toContain("reuse the existing `fileId`");
    expect(secondBody.message).toContain("do not call `list-files`");
    expect(secondBody.message).toContain("`replacementContent`");
    expect(secondBody.message).toContain("save once");
  });

  it("does not treat completed tool activity as unfinished action preparation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? sseResponse([
              {
                type: "activity",
                label: "Preparing generate-design action",
                tool: "generate-design",
              },
              {
                type: "tool_start",
                tool: "generate-design",
                input: { designId: "design_1" },
              },
              {
                type: "tool_done",
                tool: "generate-design",
                result: '{"designId":"design_1"}',
                completedSideEffect: true,
              },
              { type: "auto_continue", reason: "run_timeout" },
            ])
          : sseResponse([
              { type: "text", text: "saved the design" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-design-completed-tool-timeout",
      threadId: "thread-design-completed-tool-timeout",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Generate a todo app design" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(postCount).toBe(2);
    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    const secondBody = JSON.parse(chatPosts[1][1].body);
    expect(secondBody.message).not.toContain(
      "preparing the `generate-design` action input",
    );
    expect(secondBody.message).not.toContain("before the action could finish");
  });

  it("nudges Design variant generation to save compact screens before refining", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? sseResponse([
              {
                type: "activity",
                label: "Preparing present-design-variants action",
                tool: "present-design-variants",
              },
              { type: "auto_continue", reason: "run_timeout" },
            ])
          : sseResponse([
              { type: "text", text: "saved compact variant screens" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-design-variants-input-timeout",
      threadId: "thread-design-variants-input-timeout",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Generate three todo variants" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(postCount).toBe(2);
    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    const secondBody = JSON.parse(chatPosts[1][1].body);
    expect(secondBody.message).toContain(
      "preparing the `present-design-variants` action input",
    );
    expect(secondBody.message).toContain(
      "concise labels, descriptions, accent colors",
    );
    expect(secondBody.message).toContain(
      "render compact representative screens",
    );
    expect(secondBody.message).toContain("edit-design");
    expect(secondBody.message).toContain("selected `fileId`");
    expect(secondBody.message).toContain("Do not call `generate-design`");
  });

  it("stops when the same action input preparation repeats without starting the tool", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const messages = [
      "I will generate all 3 directions now.",
      "Generating all variants as compact screens.",
      "Let me build the 3 variants now.",
      "Presenting 3 distinct directions now.",
      "Still preparing the variant set.",
    ];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        const text = messages[postCount] ?? "Continuing";
        postCount += 1;
        return sseResponse([
          { type: "text", text },
          {
            type: "activity",
            label: "Preparing present-design-variants action",
            tool: "present-design-variants",
          },
          { type: "auto_continue", reason: "run_timeout" },
        ]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-repeated-prep",
      threadId: "thread-repeated-prep",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Generate three todo variants" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(4);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "connection_error",
          message: expect.stringContaining(
            "got stuck preparing the present design variants action input",
          ),
          details: expect.stringContaining("non_advancing_continuations: 3"),
        }),
      }),
    );
    const dispatchedRunError = dispatchEvent.mock.calls.find(
      ([event]) => event?.type === "agent-chat:run-error",
    )?.[0] as CustomEvent<{ details?: string }> | undefined;
    expect(dispatchedRunError?.detail.details).toContain(
      "api_url: /_agent-native/agent-chat",
    );
    expect(dispatchedRunError?.detail.details).toContain(
      "tab_id: chat-repeated-prep",
    );
    expect(dispatchedRunError?.detail.details).toContain(
      "thread_id: thread-repeated-prep",
    );
    expect(dispatchedRunError?.detail.details).toContain("current_run: run-qa");
    expect(dispatchedRunError?.detail.details).toContain(
      "attempted_runs: run-qa",
    );
    expect(dispatchedRunError?.detail.details).toContain(
      "stalled_on_tool: present-design-variants",
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata.custom.runError.details).toContain(
      "stalled_on_tool: present-design-variants",
    );
    expect(last.content.at(-1).text).toContain(
      "got stuck preparing the present design variants action input",
    );
  });

  it("resets action preparation stalls after durable tool progress", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        if (postCount <= 3) {
          return sseResponse([
            {
              type: "activity",
              label: "Preparing present-design-variants action",
              tool: "present-design-variants",
            },
            { type: "auto_continue", reason: "run_timeout" },
          ]);
        }
        if (postCount === 4) {
          return sseResponse([
            {
              type: "tool_start",
              tool: "inspect-design-state",
              input: { designId: "design_1" },
            },
            {
              type: "tool_done",
              tool: "inspect-design-state",
              result: '{"screenCount":1}',
            },
            {
              type: "activity",
              label: "Preparing present-design-variants action",
              tool: "present-design-variants",
            },
            { type: "auto_continue", reason: "run_timeout" },
          ]);
        }
        if (postCount === 5) {
          return sseResponse([
            {
              type: "activity",
              label: "Preparing present-design-variants action",
              tool: "present-design-variants",
            },
            { type: "auto_continue", reason: "run_timeout" },
          ]);
        }
        return sseResponse([
          { type: "text", text: "saved variants after inspecting state" },
          { type: "done" },
        ]);
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-repeated-prep-reset",
      threadId: "thread-repeated-prep-reset",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Generate three todo variants" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(6);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "complete", reason: "stop" });
    expect(last.content.at(-1).text).toBe(
      "saved variants after inspecting state",
    );
  });

  it("retries a startup timeout before surfacing an error", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/runs/active")) {
        return Promise.resolve(jsonResponse({ active: false, status: "idle" }));
      }
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        if (postCount > 1) {
          return Promise.resolve(
            sseResponse([
              { type: "text", text: "started after retry" },
              { type: "done" },
            ]),
          );
        }
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      }
      return Promise.resolve(jsonResponse({ error: "unexpected" }, 500));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-startup-timeout",
      threadId: "thread-startup-timeout",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "please respond" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(45_001);
    await vi.advanceTimersByTimeAsync(500);
    const results = await promise;

    expect(postCount).toBe(2);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "complete", reason: "stop" });
    expect(last.content.at(-1).text).toBe("started after retry");
  });

  it("surfaces a startup timeout after exhausting startup retries", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/runs/active")) {
        return Promise.resolve(jsonResponse({ active: false, status: "idle" }));
      }
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      }
      return Promise.resolve(jsonResponse({ error: "unexpected" }, 500));
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-startup-timeout-exhausted",
      threadId: "thread-startup-timeout-exhausted",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "please respond" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    for (let i = 0; i < 9; i += 1) {
      await vi.advanceTimersByTimeAsync(45_001);
      await vi.advanceTimersByTimeAsync(8_000);
    }
    const results = await promise;

    expect(postCount).toBe(9);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "startup_timeout",
          message: expect.stringContaining("did not start streaming"),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.content.at(-1).text).toContain("did not start streaming");
  });

  it("retries a transient missing agent-chat route on startup", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const routeMissing = {
      error: true,
      status: 404,
      message:
        "Cannot find any route matching [POST] https://design.agent-native.com/_agent-native/agent-chat",
    };
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount < 3
          ? jsonResponse(routeMissing, 404)
          : sseResponse([
              { type: "text", text: "ready after route registration" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-route-missing",
      threadId: "thread-route-missing",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "please respond" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(3);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("ready after route registration");
  });

  it("keeps partial stream-ended text visible while using it as history", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? sseResponse([{ type: "text", text: "still working..." }])
          : sseResponse([
              { type: "text", text: "finished after stream recovery" },
              { type: "done" },
            ]);
      }
      if (url.includes("/runs/run-qa/events")) {
        return jsonResponse({ error: "gone" }, 404);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-stream-ended",
      threadId: "thread-stream-ended",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish the report" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(postCount).toBe(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[3][1].body);
    expect(secondBody.history).toEqual([
      { role: "user", content: "finish the report" },
      { role: "assistant", content: "still working..." },
    ]);
    expect(secondBody.structuredHistory).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "finish the report" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "still working..." }],
      },
    ]);
    expect(results.some((result: any) => result.content.length === 0)).toBe(
      false,
    );
    const last = results.at(-1) as any;
    const finalText = last.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("");
    expect(finalText).toBe("still working...finished after stream recovery");
  });

  it("continues automatically after a recoverable gateway timeout event", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool_start",
            tool: "search-docs",
            input: { query: "analytics" },
          },
          {
            type: "tool_done",
            tool: "search-docs",
            result: "found relevant dashboard notes",
          },
          { type: "text", text: "checking the dashboard..." },
          {
            type: "error",
            error: "Builder gateway timed out after 45s",
            errorCode: "builder_gateway_timeout",
          },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "text", text: "finished after timeout recovery" },
          { type: "done" },
        ]),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-timeout",
      threadId: "thread-timeout",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "long analytics query" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(secondBody.message).toContain("Continue from where you left off");
    expect(secondBody.history).toEqual([
      { role: "user", content: "long analytics query" },
      {
        role: "assistant",
        content:
          'Tool: search-docs\nInput: {"query":"analytics"}\nResult:\nfound relevant dashboard notes\n\nchecking the dashboard...',
      },
    ]);
    const last = results.at(-1) as any;
    expect(last.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "search-docs",
        result: "found relevant dashboard notes",
      }),
      {
        type: "text",
        text: "checking the dashboard...finished after timeout recovery",
      },
    ]);
    const finalText = last.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("");
    expect(finalText).toContain("checking the dashboard");
  });

  it("keeps text before a tool in order across transient recovery", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { type: "text", text: "I'll check first. " },
          {
            type: "tool_start",
            tool: "search-docs",
            input: { query: "analytics" },
          },
          {
            type: "tool_done",
            tool: "search-docs",
            result: "found relevant dashboard notes",
          },
          {
            type: "error",
            error: "Builder gateway timed out after 45s",
            errorCode: "builder_gateway_timeout",
          },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "text", text: "Done." }, { type: "done" }]),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-timeout-text-before-tool",
      threadId: "thread-timeout-text-before-tool",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "long analytics query" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    const last = results.at(-1) as any;
    expect(last.content).toEqual([
      { type: "text", text: "I'll check first. " },
      expect.objectContaining({
        type: "tool-call",
        toolName: "search-docs",
        result: "found relevant dashboard notes",
      }),
      { type: "text", text: "Done." },
    ]);
  });

  it("stops after repeated stale-run recoveries", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      return sseResponse([
        { type: "text", text: "partial answer" },
        {
          type: "error",
          error:
            "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
          errorCode: "stale_run",
          recoverable: true,
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-stale-run",
      threadId: "thread-stale-run",
    });
    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish the analysis" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    expect(chatPosts).toHaveLength(4);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "stale_run",
          details: expect.stringContaining("non_advancing_continuations: 3"),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.content.at(-1).text).toContain(
      "The agent stopped before it could finish",
    );
  });

  it("does not count prior tool progress against the empty recovery cap", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }

      postCount += 1;
      if (postCount === 1) {
        return sseResponse(
          [
            {
              type: "tool_start",
              tool: "list-extensions",
              input: { search: "GitHub Stars", includeContent: "true" },
            },
            {
              type: "tool_done",
              tool: "list-extensions",
              result: "loaded GitHub Stars extension content",
            },
          ],
          "run-with-tool-progress",
        );
      }
      if (postCount === 2) {
        return emptySseResponse("run-empty-after-progress");
      }
      return sseResponse(
        [
          { type: "text", text: "finished after a quiet retry" },
          { type: "done" },
        ],
        "run-final",
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-empty-after-progress",
      threadId: "thread-empty-after-progress",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "update the extension" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(postCount).toBe(3);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "list-extensions",
        result: "loaded GitHub Stars extension content",
      }),
      { type: "text", text: "finished after a quiet retry" },
    ]);
  });

  it("keeps recovering stale runs when each retry completes a tool", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }

      postCount += 1;
      if (postCount <= 5) {
        const tool = `update-step-${postCount}`;
        return sseResponse(
          [
            { type: "tool_start", tool, input: { step: String(postCount) } },
            { type: "tool_done", tool, result: `saved step ${postCount}` },
            {
              type: "error",
              error:
                "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
              errorCode: "stale_run",
              recoverable: true,
            },
          ],
          `run-stale-progress-${postCount}`,
        );
      }

      return sseResponse(
        [
          { type: "text", text: "finished after stale-run recovery" },
          { type: "done" },
        ],
        "run-stale-final",
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-stale-progress",
      threadId: "thread-stale-progress",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish the extension update" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(3000);
    const results = await promise;

    expect(postCount).toBe(6);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.content).toEqual([
      ...Array.from({ length: 5 }, (_, index) =>
        expect.objectContaining({
          type: "tool-call",
          toolName: `update-step-${index + 1}`,
          result: `saved step ${index + 1}`,
        }),
      ),
      { type: "text", text: "finished after stale-run recovery" },
    ]);
  });

  it("sends protocol-safe structured history for interrupted tool calls", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }

      postCount += 1;
      if (postCount === 1) {
        return sseResponse(
          [
            {
              type: "tool_start",
              tool: "list-extensions",
              input: { search: "GitHub Stars" },
            },
          ],
          "run-interrupted-tool",
        );
      }
      return sseResponse([{ type: "done" }], "run-after-interrupted-tool");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-interrupted-tool",
      threadId: "thread-interrupted-tool",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "inspect extension" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    expect(chatPosts).toHaveLength(2);
    const secondBody = JSON.parse(chatPosts[1][1].body as string);
    expect(secondBody.structuredHistory).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "inspect extension" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "continuation_tc_1",
            toolName: "list-extensions",
            args: { search: "GitHub Stars" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "continuation_tc_1",
            toolName: "list-extensions",
            toolInput: '{"search":"GitHub Stars"}',
            content: "Interrupted before this tool returned a result.",
          },
        ],
      },
    ]);
  });

  it("excludes synthetic agent progress from continuation history", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }

      postCount += 1;
      if (postCount === 1) {
        return sseResponse(
          [
            {
              type: "tool_start",
              id: "call-analytics",
              tool: "call-agent",
              input: { agent: "analytics", message: "Count signups" },
            },
            { type: "agent_call", agent: "Analytics", status: "start" },
          ],
          "run-interrupted-agent-call",
        );
      }
      return sseResponse([{ type: "done" }], "run-after-agent-call");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-interrupted-agent-call",
      threadId: "thread-interrupted-agent-call",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "count signups" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const chatPosts = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        url === "/_agent-native/agent-chat" && init?.method === "POST",
    );
    expect(chatPosts).toHaveLength(2);
    const secondBody = JSON.parse(chatPosts[1][1].body as string);
    const serializedHistory = JSON.stringify(secondBody.structuredHistory);
    expect(serializedHistory).toContain('"toolName":"call-agent"');
    expect(serializedHistory).not.toContain("agent:Analytics");
  });

  it("does not exhaust stalled recovery attempts while each continuation makes progress", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ error: "unexpected" }, 500);
      }

      postCount += 1;
      if (postCount <= 9) {
        const tool = `generate-chart-${postCount}`;
        return sseResponse([
          { type: "tool_start", tool, input: { chart: String(postCount) } },
          { type: "tool_done", tool, result: `chart ${postCount} saved` },
          {
            type: "error",
            error: "Builder gateway timed out after 45s",
            errorCode: "builder_gateway_timeout",
          },
        ]);
      }

      return sseResponse([
        { type: "text", text: "finished after progressive recovery" },
        { type: "done" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-progressive-recovery",
      threadId: "thread-progressive-recovery",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "build a large dashboard" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(10);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.content).toEqual([
      ...Array.from({ length: 9 }, (_, index) =>
        expect.objectContaining({
          type: "tool-call",
          toolName: `generate-chart-${index + 1}`,
          result: `chart ${index + 1} saved`,
        }),
      ),
      { type: "text", text: "finished after progressive recovery" },
    ]);
  });

  it("keeps continuing when a run times out repeatedly with a tool still in flight", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      if (postCount <= 12) {
        return sseResponse([
          {
            type: "tool_start",
            tool: "create-extension",
            input: { name: "Dashboard" },
          },
          { type: "auto_continue", reason: "run_timeout" },
        ]);
      }
      return sseResponse([
        { type: "text", text: "finished after in-flight recovery" },
        { type: "done" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-inflight-timeout",
      threadId: "thread-inflight-timeout",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "build a dashboard extension" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(13);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("finished after in-flight recovery");
  });

  it("bails after MAX_REPEATED_INFLIGHT_TOOL_STALLS stream_ended drops on the same tool", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      return sseResponse([
        {
          type: "text",
          text: "I have the full HTML. Creating the extension now!",
        },
        {
          type: "tool_start",
          tool: "create-extension",
          input: { name: "Dashboard", content: "<html>..." },
        },
        { type: "auto_continue", reason: "stream_ended" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-inflight-streamend",
      threadId: "thread-inflight-streamend",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "create an extension from this HTML" },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBeLessThanOrEqual(8);
    const errorEvent = dispatchEvent.mock.calls.find(
      ([ev]) => ev?.type === "agent-chat:run-error",
    );
    expect(errorEvent).toBeDefined();
    const last = results.at(-1) as any;
    const stalledTools = last.content.filter(
      (part: any) =>
        part.type === "tool-call" && part.toolName === "create-extension",
    );
    expect(stalledTools.length).toBeGreaterThan(0);
    expect(stalledTools.every((part: any) => part.result !== undefined)).toBe(
      true,
    );
  });

  it("does NOT bail when create-extension is retried with a CHANGED payload after stream_ended", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      if (postCount <= 5) {
        return sseResponse([
          {
            type: "text",
            text: `Payload too big, retrying smaller (attempt ${postCount}).`,
          },
          {
            type: "tool_start",
            tool: "create-extension",
            input: {
              name: "Dashboard",
              content: "x".repeat(900 - postCount * 100),
            },
          },
          { type: "auto_continue", reason: "stream_ended" },
        ]);
      }
      return sseResponse([
        { type: "text", text: "extension created after shrinking the payload" },
        { type: "done" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-inflight-changed",
      threadId: "thread-inflight-changed",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "create an extension from this HTML" },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(15_000);
    const results = await promise;

    expect(postCount).toBeGreaterThanOrEqual(6);
    const errorEvent = dispatchEvent.mock.calls.find(
      ([ev]) => ev?.type === "agent-chat:run-error",
    );
    expect(errorEvent).toBeUndefined();
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe(
      "extension created after shrinking the payload",
    );
  });

  it("does NOT bail on run_timeout in-flight stalls (slow legitimate tool)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      if (postCount <= 5) {
        return sseResponse([
          {
            type: "tool_start",
            tool: "create-extension",
            input: { name: "Dashboard" },
          },
          { type: "auto_continue", reason: "run_timeout" },
        ]);
      }
      return sseResponse([{ type: "text", text: "done" }, { type: "done" }]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-timeout-inflight",
      threadId: "thread-timeout-inflight",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "create extension" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(6);
    const last = results.at(-1) as any;
    expect(last?.content?.at(-1)?.text).toBe("done");
  });

  it("bails when the same in-flight tool repeatedly stops producing progress", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let chatPostCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        chatPostCount += 1;
        return sseResponse(
          [
            {
              type: "tool_start",
              tool: "generate-design",
              input: { designId: "design_1" },
            },
            { type: "auto_continue", reason: "no_progress" },
          ],
          `run-no-progress-${chatPostCount}`,
        );
      }
      if (url.includes("/abort") && init?.method === "POST") {
        return jsonResponse({ ok: true });
      }
      if (url.includes("/runs/")) {
        return jsonResponse({ active: false, status: "idle" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-inflight-no-progress",
      threadId: "thread-inflight-no-progress",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "generate design" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(chatPostCount).toBe(5);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "connection_error",
          message: expect.stringContaining("same tool"),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    const toolCards = last.content.filter(
      (part: any) =>
        part.type === "tool-call" && part.toolName === "generate-design",
    );
    expect(toolCards.length).toBeGreaterThan(0);
    expect(toolCards.every((part: any) => part.result !== undefined)).toBe(
      true,
    );
  });

  it("preserves large create-extension input verbatim in continuation history", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const bigHtml = `<div x-data="dashboard()">${"<p>row</p>".repeat(5000)}</div>`;
    expect(bigHtml.length).toBeGreaterThan(40_000);

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      if (postCount === 1) {
        return sseResponse([
          {
            type: "tool_start",
            tool: "create-extension",
            input: { name: "Big dashboard", content: bigHtml },
          },
          {
            type: "tool_done",
            tool: "create-extension",
            result: '{"id":"ext-1"}',
          },
          { type: "text", text: "Created the first version." },
          {
            type: "error",
            error: "Builder gateway timed out after 45s",
            errorCode: "builder_gateway_timeout",
          },
        ]);
      }
      return sseResponse([
        { type: "text", text: "refined it" },
        { type: "done" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-large-input",
      threadId: "thread-large-input",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "build a big dashboard extension" },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(postCount).toBe(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    const serialized = JSON.stringify(secondBody.structuredHistory);
    expect(serialized).not.toContain("__agentNativeTruncated");
    const toolCall = secondBody.structuredHistory
      .flatMap((m: any) => m.content)
      .find((part: any) => part.type === "tool-call");
    expect(toolCall.toolName).toBe("create-extension");
    expect(toolCall.args.content).toBe(bigHtml);
  });

  it("hosts a large pasted file by reference instead of re-emitting it (one shot, no loop)", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const bigHtml = `<div x-data="dashboard()">${"<p>row</p>".repeat(5000)}</div>`;
    expect(bigHtml.length).toBeGreaterThan(40_000);
    const pastedName = "pasted-text-1718000000000-ab12cd.txt";

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      return sseResponse([
        {
          type: "tool_start",
          tool: "create-extension",
          input: {
            name: "Pasted dashboard",
            contentFromAttachment: pastedName,
          },
        },
        {
          type: "tool_done",
          tool: "create-extension",
          result: '{"id":"ext-1"}',
        },
        { type: "text", text: "Hosted your pasted file as an extension." },
        { type: "done" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-paste-by-ref",
      threadId: "thread-paste-by-ref",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "host this as an extension" }],
            attachments: [
              {
                name: pastedName,
                contentType: "text/plain",
                content: [{ type: "text", text: bigHtml }],
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(postCount).toBe(1);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const pasted = body.attachments.find((a: any) => a.name === pastedName);
    expect(pasted?.text).toBe(bigHtml);

    const last = results.at(-1) as any;
    const toolCall = last.content.find(
      (part: any) =>
        part.type === "tool-call" && part.toolName === "create-extension",
    );
    expect(toolCall.result).toBe('{"id":"ext-1"}');
    expect(JSON.stringify(toolCall)).not.toContain("<p>row</p>");
    expect(last.content.at(-1).text).toBe(
      "Hosted your pasted file as an extension.",
    );
  });

  it("does not lossy-truncate large create-extension args in prior-turn structured history", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const bigHtml = `<div x-data="dashboard()">${"<p>row</p>".repeat(5000)}</div>`;
    const bigGenericInput = "x".repeat(40_000);
    expect(bigHtml.length).toBeGreaterThan(40_000);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-prior-large-input",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "make a big dashboard" }],
          },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "tc_1",
                toolName: "create-extension",
                args: { name: "Big dashboard", content: bigHtml },
                result: '{"id":"ext-1"}',
              },
              {
                type: "tool-call",
                toolCallId: "tc_2",
                toolName: "search-codebase",
                args: { query: bigGenericInput },
                result: "ok",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: "now refine it" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const toolCalls = body.structuredHistory
      .flatMap((m: any) => m.content)
      .filter((part: any) => part.type === "tool-call");
    const extensionCall = toolCalls.find(
      (c: any) => c.toolName === "create-extension",
    );
    const genericCall = toolCalls.find(
      (c: any) => c.toolName === "search-codebase",
    );
    expect(extensionCall.args.content).toBe(bigHtml);
    expect(extensionCall.args.__agentNativeTruncated).toBeUndefined();
    expect(genericCall.args.__agentNativeTruncated).toBe(true);
    expect(genericCall.args.query).toBeUndefined();
  });

  it("counts whitespace-only output against the empty recovery cap", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      return sseResponse([
        { type: "text", text: "   " },
        { type: "auto_continue", reason: "run_timeout" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-whitespace",
      threadId: "thread-whitespace",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do the thing" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(3);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({ errorCode: "connection_error" }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("finishes with a saved note when final text times out after a completed side-effect tool", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      return postCount === 1
        ? sseResponse([
            { type: "text", text: "Building it now!" },
            {
              type: "tool_start",
              tool: "generate-design",
              input: { designId: "design_1" },
            },
            {
              type: "tool_done",
              tool: "generate-design",
              result: '{"designId":"design_1","urlPath":"/design/design_1"}',
              completedSideEffect: true,
            },
            { type: "auto_continue", reason: "run_timeout" },
          ])
        : sseResponse([{ type: "auto_continue", reason: "run_timeout" }]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-completed-side-effect",
      threadId: "thread-completed-side-effect",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "create a dark todo app" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(2);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
      }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:activity-clear",
        detail: { tabId: "chat-completed-side-effect" },
      }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:stream-progress",
        detail: { tabId: "chat-completed-side-effect" },
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "complete", reason: "stop" });
    expect(last.metadata.custom.runWarning).toMatchObject({
      errorCode: "final_response_timeout_after_tool",
      recoverable: true,
    });
    expect(last.content.at(-1).text).toContain("The design was saved");
  });

  it("finishes with a completed-tool note when final text times out after a successful tool without side-effect metadata", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      return postCount === 1
        ? sseResponse([
            { type: "text", text: "Building it now!" },
            {
              type: "tool_start",
              tool: "generate-design",
              input: { designId: "design_1" },
            },
            {
              type: "tool_done",
              tool: "generate-design",
              result: '{"designId":"design_1","urlPath":"/design/design_1"}',
            },
            { type: "auto_continue", reason: "run_timeout" },
          ])
        : sseResponse([{ type: "auto_continue", reason: "run_timeout" }]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-completed-tool-no-metadata",
      threadId: "thread-completed-tool-no-metadata",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "create a dark todo app" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(2);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "complete", reason: "stop" });
    expect(last.metadata.custom.runWarning).toMatchObject({
      errorCode: "final_response_timeout_after_tool",
      recoverable: true,
    });
    expect(last.content.at(-1).text).toContain("The design was saved");
  });

  it.each([
    "import-design-tokens",
    "connect-assets-mcp",
    "compose-dashboard",
    "install-dashboard-template",
    "mutate-dashboard",
  ])(
    "finishes with a completed-tool note for recognized mutating tool %s",
    async (toolName) => {
      vi.useFakeTimers();
      const dispatchEvent = vi.fn();
      vi.stubGlobal("window", { dispatchEvent });
      vi.stubGlobal(
        "CustomEvent",
        class CustomEvent {
          type: string;
          detail: unknown;
          constructor(type: string, init?: { detail?: unknown }) {
            this.type = type;
            this.detail = init?.detail;
          }
        },
      );

      let postCount = 0;
      const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return jsonResponse({ active: false, status: "idle" });
        }
        postCount += 1;
        return postCount === 1
          ? sseResponse([
              { type: "text", text: "Importing the tokens now." },
              {
                type: "tool_start",
                tool: toolName,
                input: { designId: "design_1" },
              },
              {
                type: "tool_done",
                tool: toolName,
                result: '{"designId":"design_1","tokenCount":12}',
              },
              { type: "auto_continue", reason: "run_timeout" },
            ])
          : sseResponse([{ type: "auto_continue", reason: "run_timeout" }]);
      });
      vi.stubGlobal("fetch", fetchSpy);

      const adapter = createAgentChatAdapter({
        apiUrl: "/_agent-native/agent-chat",
        tabId: "chat-completed-import-tool-no-metadata",
        threadId: "thread-completed-import-tool-no-metadata",
      });
      const promise = drain(
        adapter.run({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "import these design tokens" }],
            },
          ],
          abortSignal: new AbortController().signal,
        } as any),
      );

      await vi.advanceTimersByTimeAsync(10_000);
      const results = await promise;

      expect(postCount).toBe(2);
      expect(dispatchEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent-chat:run-error",
        }),
      );
      const last = results.at(-1) as any;
      expect(last.status).toEqual({ type: "complete", reason: "stop" });
      expect(last.metadata.custom.runWarning).toMatchObject({
        errorCode: "final_response_timeout_after_tool",
        recoverable: true,
      });
      expect(last.content.at(-1).text).toContain("action completed");
    },
  );

  it("does not synthesize a completed-tool finish for non-timeout transport failures", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      return sseResponse([
        { type: "text", text: "Saving the design." },
        {
          type: "tool_start",
          tool: "generate-design",
          input: { designId: "design_1" },
        },
        {
          type: "tool_done",
          tool: "generate-design",
          result: '{"designId":"design_1","urlPath":"/design/design_1"}',
        },
        {
          type: "error",
          error: "The connection dropped after the tool completed.",
          errorCode: "connection_error",
          recoverable: true,
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-completed-tool-transport-failure",
      threadId: "thread-completed-tool-transport-failure",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "create a dark todo app" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "connection_error",
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata?.custom?.runWarning?.errorCode).not.toBe(
      "final_response_timeout_after_tool",
    );
  });

  it.each([
    "connect-google-calendar",
    "import-calendar-events",
    "index-components",
  ])(
    "does not use the completed-tool note for ambiguous/read-only tool %s without side-effect metadata",
    async (toolName) => {
      vi.useFakeTimers();
      const dispatchEvent = vi.fn();
      vi.stubGlobal("window", { dispatchEvent });
      vi.stubGlobal(
        "CustomEvent",
        class CustomEvent {
          type: string;
          detail: unknown;
          constructor(type: string, init?: { detail?: unknown }) {
            this.type = type;
            this.detail = init?.detail;
          }
        },
      );

      let postCount = 0;
      const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== "POST") {
          return jsonResponse({ active: false, status: "idle" });
        }
        postCount += 1;
        return postCount === 1
          ? sseResponse([
              { type: "text", text: "Indexing what is on the screen." },
              {
                type: "tool_start",
                tool: toolName,
                input: { designId: "design_1" },
              },
              {
                type: "tool_done",
                tool: toolName,
                result: '{"components":["Button"]}',
              },
              { type: "auto_continue", reason: "run_timeout" },
            ])
          : sseResponse([{ type: "auto_continue", reason: "run_timeout" }]);
      });
      vi.stubGlobal("fetch", fetchSpy);

      const adapter = createAgentChatAdapter({
        apiUrl: "/_agent-native/agent-chat",
        tabId: "chat-readonly-tool-no-metadata",
        threadId: "thread-readonly-tool-no-metadata",
      });
      const promise = drain(
        adapter.run({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "inspect the components" }],
            },
          ],
          abortSignal: new AbortController().signal,
        } as any),
      );

      await vi.advanceTimersByTimeAsync(10_000);
      const results = await promise;

      expect(postCount).toBeGreaterThan(2);
      expect(dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent-chat:run-error",
          detail: expect.objectContaining({
            errorCode: "connection_error",
          }),
        }),
      );
      const last = results.at(-1) as any;
      expect(last.status).toEqual({ type: "incomplete", reason: "error" });
      expect(last.metadata?.custom?.runWarning?.errorCode).not.toBe(
        "final_response_timeout_after_tool",
      );
    },
  );

  it("reconnects to a newer background continuation after run_timeout before self-posting", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = JSON.parse(init.body as string).turnId;
        return sseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-first",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-next",
          threadId: "thread-bg-next",
          turnId: requestTurnId,
          status: "running",
          dispatchMode: "background-function",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-bg-next/events")) {
        return sseResponse(
          [{ type: "text", text: " and done" }, { type: "done" }],
          "run-bg-next",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-next",
      threadId: "thread-bg-next",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(postCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/runs/run-bg-next/events"),
      expect.any(Object),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Working and done");
  });

  it("does not adopt a foreground active run after run_timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? sseResponse(
              [
                { type: "text", text: "Working" },
                { type: "auto_continue", reason: "run_timeout" },
              ],
              "run-first",
            )
          : sseResponse(
              [{ type: "text", text: " continued" }, { type: "done" }],
              "run-self-continuation",
            );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-foreground-other",
          threadId: "thread-bg-foreground",
          status: "running",
          dispatchMode: "foreground",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-foreground-other/events")) {
        return jsonResponse({ error: "should not reconnect foreground" }, 500);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-foreground",
      threadId: "thread-bg-foreground",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long foreground task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(postCount).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/runs/run-foreground-other/events"),
      expect.any(Object),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Working continued");
  });

  it("follows a server-chained background continuation without POSTing a synthetic continuation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-bg-chunk-1",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-chunk-2",
          threadId: "thread-bg-follow",
          turnId: requestTurnId,
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-bg-chunk-2/events")) {
        return sseResponse(
          [{ type: "text", text: " and done" }, { type: "done" }],
          "run-bg-chunk-2",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-follow",
      threadId: "thread-bg-follow",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background job" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    expect(postCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/runs/run-bg-chunk-2/events?after=0"),
      expect.any(Object),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Working and done");
  });

  it("deduplicates a replayed tool event when a background response resumes on a new run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = (JSON.parse(init.body as string) as { turnId: string })
          .turnId;
        return backgroundSseResponse(
          [
            {
              type: "tool_start",
              id: "get-deck-1",
              seq: 0,
              eventId: "run-bg-source:0",
              tool: "get-deck",
              input: { deckId: "deck-1" },
            },
          ],
          "run-bg-source",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-replay",
          threadId: "thread-bg-replay",
          turnId: requestTurnId,
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-bg-replay/events")) {
        return backgroundSseResponse(
          [
            {
              type: "tool_start",
              id: "get-deck-1",
              seq: 0,
              eventId: "run-bg-source:0",
              tool: "get-deck",
              input: { deckId: "deck-1" },
            },
            {
              type: "tool_done",
              id: "get-deck-1",
              seq: 1,
              eventId: "run-bg-replay:0",
              tool: "get-deck",
              result: '{"slides":8}',
            },
            {
              type: "text",
              seq: 2,
              eventId: "run-bg-replay:1",
              text: "The deck has 8 slides.",
            },
            {
              type: "done",
              seq: 3,
              eventId: "run-bg-replay:2",
            },
          ],
          "run-bg-replay",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-replay",
      threadId: "thread-bg-replay",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "get the deck" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;
    const last = results.at(-1) as any;
    const toolCalls = last.content.filter(
      (part: any) => part.type === "tool-call",
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/runs/run-bg-replay/events?after=0"),
      expect.any(Object),
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      toolName: "get-deck",
      result: '{"slides":8}',
    });
    expect(last.status).toEqual({ type: "complete", reason: "stop" });
  });

  it("continues a followed background run whose done event follows completed tool work", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = (JSON.parse(init.body as string) as { turnId: string })
          .turnId;
        return postCount === 1
          ? backgroundSseResponse(
              [
                {
                  type: "tool_start",
                  id: "blocks-1",
                  tool: "get-plan-blocks",
                  input: { format: "reference" },
                },
                {
                  type: "tool_done",
                  id: "blocks-1",
                  tool: "get-plan-blocks",
                  result: '{"count":20}',
                },
                { type: "auto_continue", reason: "run_timeout" },
              ],
              "run-follow-tool-only",
            )
          : backgroundSseResponse(
              [{ type: "text", text: "The plan is ready." }, { type: "done" }],
              "run-follow-final",
            );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-follow-tool-only",
          threadId: "thread-bg-follow-tool-only",
          turnId: requestTurnId,
          status: "completed",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-follow-tool-only/events")) {
        return sseResponse([{ type: "done" }], "run-follow-tool-only");
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-follow-tool-only",
      threadId: "thread-bg-follow-tool-only",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "visualize this plan" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    expect(postCount).toBe(2);
    expect((results.at(-1) as any).content.at(-1).text).toBe(
      "The plan is ready.",
    );
    expect(
      (results.at(-1) as any).metadata?.custom?.runWarning,
    ).toBeUndefined();
    expect(getActiveRun()).toBeNull();
  });

  it("stops its tab when another thread owns the active-run pointer", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const body = `${JSON.stringify({ type: "done" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: "));
              },
              pull(controller) {
                setActiveRun({
                  threadId: "other-thread",
                  runId: "other-run",
                  lastSeq: 0,
                });
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-current",
              },
            },
          ),
      ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-current",
      threadId: "current-thread",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const activeRunEvents = dispatchEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === "agent-chat:active-run-state-change");
    expect(activeRunEvents).toContainEqual(
      expect.objectContaining({
        detail: {
          state: {
            threadId: "other-thread",
            runId: "other-run",
            lastSeq: 0,
          },
        },
      }),
    );
    expect(activeRunEvents).not.toContainEqual(
      expect.objectContaining({ detail: { state: null } }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-current",
          turnId: expect.any(String),
        },
      }),
    );
  });

  it("stops its surface in finally when an abort follows another surface claim", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        setActiveRun({
          threadId: "other-thread",
          runId: "other-run",
          tabId: "other-surface",
          lastSeq: 0,
        });
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-current",
      threadId: "current-thread",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "stop this" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-current",
          turnId: expect.any(String),
        },
      }),
    );
    expect(getActiveRun()).toMatchObject({
      threadId: "other-thread",
      runId: "other-run",
      tabId: "other-surface",
    });
  });

  it("does not stop its tab when another thread in the same tab claims the run", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const body = `${JSON.stringify({ type: "done" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: "));
              },
              pull(controller) {
                setActiveRun({
                  threadId: "new-thread-in-same-tab",
                  runId: "new-run-in-same-tab",
                  tabId: "chat-current",
                  lastSeq: 0,
                });
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-current",
              },
            },
          ),
      ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-current",
      threadId: "current-thread",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-current",
          turnId: expect.any(String),
        },
      }),
    );
    expect(getActiveRun()).toMatchObject({
      threadId: "new-thread-in-same-tab",
      runId: "new-run-in-same-tab",
      tabId: "chat-current",
    });
  });

  it("does not suppress terminal cleanup for a pending request on another surface", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const body = `${JSON.stringify({ type: "done" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: "));
              },
              pull(controller) {
                clearActiveRun();
                setPendingTurn({
                  threadId: "successor-thread",
                  turnId: "successor-turn",
                  tabId: "other-surface",
                });
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-current",
              },
            },
          ),
      ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-current",
      threadId: "current-thread",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this" }],
          },
        ],
        runConfig: { custom: { turnId: "current-turn" } },
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-current",
          turnId: expect.any(String),
        },
      }),
    );
    clearPendingTurnIfMatches("successor-thread", "successor-turn");
  });

  it("does not clear a same-run owner on another surface", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const body = `${JSON.stringify({ type: "done" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: "));
              },
              pull(controller) {
                setActiveRun({
                  threadId: "current-thread",
                  runId: "run-current",
                  tabId: "other-surface",
                  lastSeq: 0,
                });
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-current",
              },
            },
          ),
      ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-current",
      threadId: "current-thread",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this" }],
          },
        ],
        runConfig: { custom: { turnId: "current-turn" } },
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-current",
          turnId: expect.any(String),
        },
      }),
    );
    expect(getActiveRun()).toMatchObject({
      threadId: "current-thread",
      runId: "run-current",
      tabId: "other-surface",
    });
  });

  it("does not stop its tab while a successor request is still registering", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    const dispatchEvent = vi.fn();
    const turnId = "current-turn";
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const body = `${JSON.stringify({ type: "done" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: "));
              },
              pull(controller) {
                clearActiveRun();
                setPendingTurn({
                  threadId: "successor-thread",
                  turnId: "successor-turn",
                  tabId: "chat-current",
                });
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-current",
              },
            },
          ),
      ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-current",
      threadId: "current-thread",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this" }],
          },
        ],
        runConfig: { custom: { turnId } },
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-current",
          turnId: expect.any(String),
        },
      }),
    );
    const nextReader = createRunStreamToken("next-reader");
    expect(
      claimRunStream("current-thread", "run-current", nextReader, turnId),
    ).toBe(true);
    releaseRunStream("current-thread", "run-current", nextReader, turnId);
    clearPendingTurnIfMatches("successor-thread", "successor-turn");
  });

  it("recognizes a legacy pending successor for the same thread", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const body = `${JSON.stringify({ type: "done" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: "));
              },
              pull(controller) {
                setPendingTurn({
                  threadId: "current-thread",
                  turnId: "legacy-successor-turn",
                });
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-current",
              },
            },
          ),
      ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-current",
      threadId: "current-thread",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this" }],
          },
        ],
        runConfig: { custom: { turnId: "current-turn" } },
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-current",
          turnId: expect.any(String),
        },
      }),
    );
    clearPendingTurnIfMatches("current-thread", "legacy-successor-turn");
  });

  it("stops its surface when a different run owns another surface", async () => {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const body = `${JSON.stringify({ type: "done" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: "));
              },
              pull(controller) {
                setActiveRun({
                  threadId: "current-thread",
                  runId: "run-new",
                  tabId: "other-surface",
                  lastSeq: 0,
                });
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-current",
              },
            },
          ),
      ),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-current",
      threadId: "current-thread",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this" }],
          },
        ],
        runConfig: { custom: { turnId: "current-turn" } },
        abortSignal: new AbortController().signal,
      } as any),
    );

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: {
          isRunning: false,
          tabId: "chat-current",
          turnId: expect.any(String),
        },
      }),
    );
    expect(getActiveRun()).toMatchObject({
      threadId: "current-thread",
      runId: "run-new",
      tabId: "other-surface",
    });
  });

  it("continues when a terminal followed run contains only completed tool work", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    const postBodies: Array<Record<string, any>> = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as Record<string, any>;
        postBodies.push(body);
        requestTurnId = body.turnId;
        return postBodies.length === 1
          ? backgroundSseResponse(
              [
                {
                  type: "tool_start",
                  id: "sync-1",
                  tool: "sync-source",
                  input: {},
                },
                {
                  type: "tool_done",
                  id: "sync-1",
                  tool: "sync-source",
                  result: '{"synced":4}',
                  completedSideEffect: true,
                },
                { type: "auto_continue", reason: "run_timeout" },
              ],
              "run-bg-tool-only",
            )
          : backgroundSseResponse(
              [
                { type: "text", text: "The source is synced." },
                { type: "done" },
              ],
              "run-bg-tool-final",
            );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-tool-only",
          threadId: "thread-bg-tool-only",
          turnId: requestTurnId,
          status: "completed",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-bg-tool-only/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-tool-only",
      threadId: "thread-bg-tool-only",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "sync the source" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    expect(postBodies).toHaveLength(2);
    expect(postBodies[1]).toMatchObject({ internalContinuation: true });
    expect(postBodies[1].history.at(-1).content).toContain("Tool: sync-source");
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("The source is synced.");
    expect(last.metadata?.custom?.runWarning).toBeUndefined();
  });

  it("recovers a background response whose done event follows completed tool work", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== "/_agent-native/agent-chat" || init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      return postCount === 1
        ? backgroundSseResponse(
            [
              {
                type: "tool_start",
                id: "blocks-1",
                tool: "get-plan-blocks",
                input: { format: "reference" },
              },
              {
                type: "tool_done",
                id: "blocks-1",
                tool: "get-plan-blocks",
                result: '{"count":20}',
              },
              { type: "done" },
            ],
            "run-bg-done-tool-only",
          )
        : backgroundSseResponse(
            [{ type: "text", text: "The plan is ready." }, { type: "done" }],
            "run-bg-done-final",
          );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-done-tool-only",
      threadId: "thread-bg-done-tool-only",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "visualize this plan" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const results = await promise;

    expect(postCount).toBe(2);
    expect((results.at(-1) as any).content.at(-1).text).toBe(
      "The plan is ready.",
    );
  });

  it("keeps a user-stopped background run neutral", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-bg-user-stop",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-user-stop",
          threadId: "thread-bg-user-stop",
          turnId: requestTurnId,
          status: "aborted",
          terminalReason: "aborted:user",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-user-stop",
      threadId: "thread-bg-user-stop",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "stop this" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "complete", reason: "stop" });
    expect(last.metadata?.custom?.userStopped).toBe(true);
    expect(last.metadata?.custom?.runError).toBeUndefined();
    expect(last.metadata?.custom?.runWarning).toBeUndefined();
    expect(last.content.at(-1).text).toBe("Working");
  });

  it("keeps following instead of completing mid-turn when /runs/active re-observes the same chunk-boundary run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let activePollCount = 0;
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "Chunk one " },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-bg-boundary-1",
        );
      }
      if (url.includes("/runs/active")) {
        const isOld = activePollCount < 4;
        activePollCount += 1;
        return jsonResponse(
          isOld
            ? {
                active: true,
                runId: "run-bg-boundary-1",
                threadId: "thread-bg-boundary",
                turnId: requestTurnId,
                status: "completed",
                terminalReason: "run_timeout",
                dispatchMode: "background-processing",
                heartbeatAt: Date.now(),
                lastProgressAt: Date.now(),
              }
            : {
                active: true,
                runId: "run-bg-boundary-2",
                threadId: "thread-bg-boundary",
                turnId: requestTurnId,
                status: "running",
                dispatchMode: "background-processing",
                heartbeatAt: Date.now(),
                lastProgressAt: Date.now(),
              },
        );
      }
      if (url.includes("/runs/run-bg-boundary-1/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      if (url.includes("/runs/run-bg-boundary-2/events")) {
        return sseResponse(
          [{ type: "text", text: "and chunk two done" }, { type: "done" }],
          "run-bg-boundary-2",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-boundary",
      threadId: "thread-bg-boundary",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background job" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(1);
    expect(activePollCount).toBeGreaterThanOrEqual(5);
    results.slice(0, -1).forEach((r: any) => {
      expect(r.status?.type).not.toBe("complete");
      expect(r.status?.type).not.toBe("incomplete");
    });
    const combinedText = (results.at(-1) as any).content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
    expect(combinedText).toContain("Chunk one");
    expect(combinedText).toContain("and chunk two done");
  });

  it("keeps following a re-observed chunk-boundary run whose terminal_reason is rate_limited", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let activePollCount = 0;
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "Chunk one " },
            { type: "auto_continue", reason: "rate_limited" },
          ],
          "run-bg-ratelimit-1",
        );
      }
      if (url.includes("/runs/active")) {
        const isOld = activePollCount < 4;
        activePollCount += 1;
        return jsonResponse(
          isOld
            ? {
                active: true,
                runId: "run-bg-ratelimit-1",
                threadId: "thread-bg-ratelimit",
                turnId: requestTurnId,
                status: "completed",
                terminalReason: "rate_limited",
                dispatchMode: "background-processing",
                heartbeatAt: Date.now(),
                lastProgressAt: Date.now(),
              }
            : {
                active: true,
                runId: "run-bg-ratelimit-2",
                threadId: "thread-bg-ratelimit",
                turnId: requestTurnId,
                status: "running",
                dispatchMode: "background-processing",
                heartbeatAt: Date.now(),
                lastProgressAt: Date.now(),
              },
        );
      }
      if (url.includes("/runs/run-bg-ratelimit-1/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      if (url.includes("/runs/run-bg-ratelimit-2/events")) {
        return sseResponse(
          [{ type: "text", text: "and chunk two done" }, { type: "done" }],
          "run-bg-ratelimit-2",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-ratelimit",
      threadId: "thread-bg-ratelimit",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background job" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(1);
    expect(activePollCount).toBeGreaterThanOrEqual(5);
    results.slice(0, -1).forEach((r: any) => {
      expect(r.status?.type).not.toBe("complete");
      expect(r.status?.type).not.toBe("incomplete");
    });
    const combinedText = (results.at(-1) as any).content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
    expect(combinedText).toContain("Chunk one");
    expect(combinedText).toContain("and chunk two done");
  });

  it("surfaces error:stale_run after the grace window elapses with no successor", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let activePollCount = 0;
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-bg-nograce",
        );
      }
      if (url.includes("/runs/active")) {
        activePollCount += 1;
        return jsonResponse({
          active: true,
          runId: "run-bg-nograce",
          threadId: "thread-bg-nograce",
          turnId: requestTurnId,
          status: "errored",
          terminalReason: "error:stale_run",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-bg-nograce/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-nograce",
      threadId: "thread-bg-nograce",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background job" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(15_000);
    const results = await promise;

    expect(postCount).toBe(1);
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    expect(activePollCount).toBeGreaterThanOrEqual(6);
  });

  it("recovers from error:stale_run when a successor run appears within the grace window", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let activePollCount = 0;
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "Working " },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-bg-recover",
        );
      }
      if (url.includes("/runs/active")) {
        const isOld = activePollCount < 3;
        activePollCount += 1;
        return jsonResponse(
          isOld
            ? {
                active: true,
                runId: "run-bg-recover",
                threadId: "thread-bg-recover",
                turnId: requestTurnId,
                status: "errored",
                terminalReason: "error:stale_run",
                dispatchMode: "background-processing",
                heartbeatAt: Date.now(),
                lastProgressAt: Date.now(),
              }
            : {
                active: true,
                runId: "run-bg-recover-successor",
                threadId: "thread-bg-recover",
                turnId: requestTurnId,
                status: "running",
                dispatchMode: "background-processing",
                heartbeatAt: Date.now(),
                lastProgressAt: Date.now(),
              },
        );
      }
      if (url.includes("/runs/run-bg-recover/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      if (url.includes("/runs/run-bg-recover-successor/events")) {
        return sseResponse(
          [{ type: "text", text: "and now finished" }, { type: "done" }],
          "run-bg-recover-successor",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-recover",
      threadId: "thread-bg-recover",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background job" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(15_000);
    const results = await promise;

    expect(postCount).toBe(1);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const combinedText = (results.at(-1) as any).content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
    expect(combinedText).toContain("Working");
    expect(combinedText).toContain("and now finished");
  });

  it.each([
    {
      terminalReason: "missing_api_key",
      expectedErrorCode: "missing_credentials",
      expectedMessage: "No LLM provider is connected",
      dispatchesMissingKey: true,
      activeRunId: "run-bg-missing-key",
      initialEvents: undefined,
    },
    {
      terminalReason: "error:missing_credentials",
      expectedErrorCode: "missing_credentials",
      expectedMessage: "No LLM provider is connected",
      dispatchesMissingKey: true,
      activeRunId: "run-bg-missing-key",
      initialEvents: undefined,
    },
    {
      terminalReason: "error:provider_failed",
      expectedErrorCode: "provider_failed",
      expectedMessage: "background run failed",
      dispatchesMissingKey: false,
      activeRunId: "run-bg-provider-failure",
      initialEvents: [
        { type: "text", text: "Checking credentials" },
        {
          type: "error",
          error: "An earlier chunk timed out",
          errorCode: "old_chunk_timeout",
          recoverable: true,
        },
      ],
    },
  ])(
    "surfaces $terminalReason from a terminal background run instead of completing successfully",
    async ({
      terminalReason,
      expectedErrorCode,
      expectedMessage,
      dispatchesMissingKey,
      activeRunId,
      initialEvents,
    }) => {
      vi.useFakeTimers();
      const dispatchEvent = vi.fn();
      vi.stubGlobal("window", { dispatchEvent });
      vi.stubGlobal(
        "CustomEvent",
        class CustomEvent {
          type: string;
          detail: unknown;
          constructor(type: string, init?: { detail?: unknown }) {
            this.type = type;
            this.detail = init?.detail;
          }
        },
      );

      let postCount = 0;
      let requestTurnId = "";
      const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
          postCount += 1;
          requestTurnId = JSON.parse(init.body as string).turnId;
          return backgroundSseResponse(
            initialEvents ?? [
              { type: "text", text: "Checking credentials" },
              { type: "auto_continue", reason: "run_timeout" },
            ],
            "run-bg-missing-key",
          );
        }
        if (url.includes("/runs/active")) {
          return jsonResponse({
            active: true,
            runId: activeRunId,
            threadId: "thread-bg-missing-key",
            turnId: requestTurnId,
            status: "completed",
            terminalReason,
            dispatchMode: "background-processing",
            heartbeatAt: Date.now(),
            lastProgressAt: Date.now(),
          });
        }
        return jsonResponse({ error: "unexpected" }, 500);
      });
      vi.stubGlobal("fetch", fetchSpy);

      const adapter = createAgentChatAdapter({
        apiUrl: "/_agent-native/agent-chat",
        tabId: "chat-bg-missing-key",
        threadId: "thread-bg-missing-key",
      });
      const promise = drain(
        adapter.run({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "answer my analytics question" }],
            },
          ],
          abortSignal: new AbortController().signal,
        } as any),
      );

      await vi.advanceTimersByTimeAsync(10_000);
      const results = await promise;

      expect(postCount).toBe(1);
      const missingKeyEvent = expect.objectContaining({
        type: "agent-chat:missing-api-key",
        detail: {
          tabId: "chat-bg-missing-key",
          threadId: "thread-bg-missing-key",
        },
      });
      if (dispatchesMissingKey) {
        expect(dispatchEvent).toHaveBeenCalledWith(missingKeyEvent);
      } else {
        expect(dispatchEvent).not.toHaveBeenCalledWith(missingKeyEvent);
      }
      expect(dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent-chat:run-error",
          detail: expect.objectContaining({
            errorCode: expectedErrorCode,
            message: expect.stringContaining(expectedMessage),
          }),
        }),
      );
      const last = results.at(-1) as any;
      expect(last.status).toEqual({ type: "incomplete", reason: "error" });
      expect(last.metadata?.custom?.runError?.errorCode).toBe(
        expectedErrorCode,
      );
      if (dispatchesMissingKey) {
        expect(last.content).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining(expectedMessage),
            }),
          ]),
        );
      } else {
        expect(last.content.at(-1).text).toContain(expectedMessage);
        expect(last.content.at(-1).text).not.toContain(
          "An earlier chunk timed out",
        );
      }
    },
  );

  it("keeps the terminal event's own message and details when it replays", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const serverDetails =
      "A background-dispatched run was acknowledged (HTTP 202) but its worker never claimed the run, so no progress was produced.";
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [{ type: "auto_continue", reason: "run_timeout" }],
          "run-bg-unclaimed",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-unclaimed",
          threadId: "thread-bg-unclaimed",
          turnId: requestTurnId,
          status: "errored",
          terminalReason: "error:background_worker_never_started",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-bg-unclaimed/events")) {
        return sseResponse(
          [
            {
              type: "error",
              error:
                "The agent run was handed off to a background worker that never started. It was recovered so you can try again.",
              errorCode: "background_worker_never_started",
              recoverable: true,
              details: serverDetails,
            },
          ],
          "run-bg-unclaimed",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-unclaimed",
      threadId: "thread-bg-unclaimed",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "summarize this" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    const results = await promise;

    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata?.custom?.runError?.errorCode).toBe(
      "background_worker_never_started",
    );
    expect(last.metadata?.custom?.runError?.details).toContain(serverDetails);
  });

  // credential must report that, not the stale transient error, or the only
  it("prefers the terminal reason over a stale in-run recoverable error", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    const staleMessage = "The Builder gateway timed out. Retrying.";
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "Checking credentials" },
            {
              type: "error",
              error: staleMessage,
              errorCode: "builder_gateway_timeout",
              recoverable: true,
            },
          ],
          "run-bg-stale",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-stale",
          threadId: "thread-bg-stale",
          turnId: requestTurnId,
          status: "errored",
          terminalReason: "error:missing_credentials",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-stale",
      threadId: "thread-bg-stale",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "do the thing" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    const results = await promise;

    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    const text = last.content
      .filter((part: any) => part?.type === "text")
      .map((part: any) => part.text)
      .join("\n");
    expect(text).not.toContain("No LLM provider is connected");
    expect(text).not.toContain(staleMessage);
    expect(last.metadata?.custom?.runError?.errorCode).toBe(
      "missing_credentials",
    );
    expect(
      dispatchEvent.mock.calls.some(
        (call: any[]) => call[0]?.type === "agent-chat:missing-api-key",
      ),
    ).toBe(true);
  });

  it("gives a visitor the one line when the deployment pays for its own AI", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [{ type: "text", text: "Checking credentials" }],
          "run-bg-visitor",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-visitor",
          threadId: "thread-bg-visitor",
          turnId: requestTurnId,
          status: "errored",
          terminalReason: "error:missing_credentials",
          dispatchMode: "background-processing",
          deploymentPaysForAi: true,
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-visitor",
      threadId: "thread-bg-visitor",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "do the thing" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    const results = await promise;

    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.content.at(-1).text).toBe(
      "Error: AI features aren't available on this site right now.",
    );
    expect(last.content.at(-1).text).not.toContain("Manage agent");
    expect(last.metadata?.custom?.runError?.errorCode).toBe(
      "missing_credentials",
    );
  });

  it("self-POSTs a bounded continuation when a background run is reaped stale", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let activePollCount = 0;
    const staleError = {
      type: "error",
      error:
        "The agent stopped before it could finish. It may have hit a server timeout or the worker may have been interrupted.",
      errorCode: "stale_run",
      recoverable: true,
      details:
        "The run heartbeat stopped while the run was still marked running.",
    };
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? backgroundSseResponse(
              [{ type: "text", text: "Partial " }, staleError],
              "run-bg-stale",
            )
          : sseResponse(
              [{ type: "text", text: "finished" }, { type: "done" }],
              "run-bg-stale-retry",
            );
      }
      if (url.includes("/runs/active")) {
        activePollCount += 1;
        return jsonResponse({
          active: true,
          runId: "run-bg-stale",
          threadId: "thread-bg-stale",
          turnId: "turn-bg-stale",
          status: "errored",
          dispatchMode: "background-processing",
          terminalReason: "stale_run",
          heartbeatAt: Date.now() - 120_000,
          lastProgressAt: Date.now() - 120_000,
        });
      }
      if (url.includes("/runs/run-bg-stale/events")) {
        return sseResponse([staleError], "run-bg-stale");
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-stale",
      threadId: "thread-bg-stale",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "finish the stale background run" },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    expect(activePollCount).toBeGreaterThanOrEqual(2);
    expect(postCount).toBe(2);
    const secondPostBody = JSON.parse(
      fetchSpy.mock.calls.find(
        ([url, init]) =>
          url === "/_agent-native/agent-chat" &&
          init?.method === "POST" &&
          JSON.parse(init.body as string).internalContinuation === true,
      )?.[1]?.body as string,
    );
    expect(secondPostBody.message).toContain("Continue");
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Partial finished");
  });

  it("surfaces a terminal error when a background run goes idle with no successor", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return backgroundSseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-bg-lost",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: false,
          threadId: "thread-bg-lost",
          status: "idle",
          heartbeatAt: null,
          lastProgressAt: null,
        });
      }
      if (url.includes("/runs/run-bg-lost/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-lost",
      threadId: "thread-bg-lost",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background job" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(
      BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS + 15_000,
    );
    const results = await promise;

    expect(postCount).toBe(1);
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata?.custom?.runError?.errorCode).toBe(
      "background_run_lost",
    );
    expect(last.content.at(-1).text).toContain(
      "stopped before finishing and no continuation appeared",
    );
  });

  it("replays a terminal snapshot even when the active flag has already cleared", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "Started " },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-terminal-after-release",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: false,
          runId: "run-terminal-after-release",
          threadId: "thread-terminal-after-release",
          turnId: requestTurnId,
          status: "completed",
          terminalReason: "done",
          dispatchMode: "background-processing",
        });
      }
      if (url.includes("/runs/run-terminal-after-release/events")) {
        return backgroundSseResponse(
          [{ type: "text", text: "finished" }, { type: "done" }],
          "run-terminal-after-release",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-terminal-after-release",
      threadId: "thread-terminal-after-release",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this background task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;
    const last = results.at(-1) as any;

    expect(last.status).toEqual({ type: "complete", reason: "stop" });
    expect(last.content.map((part: any) => part.text).join(" ")).toContain(
      "finished",
    );
    expect(last.content.map((part: any) => part.text).join(" ")).not.toContain(
      "no continuation appeared",
    );
  });

  it("never condemns a run because the /runs/active poll itself failed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let abortCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        return backgroundSseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-poll-flap",
        );
      }
      if (url.includes("/abort")) {
        abortCount += 1;
        return jsonResponse({ ok: true });
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({ error: "upstream unavailable" }, 503);
      }
      if (url.includes("/runs/run-poll-flap/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-poll-flap",
      threadId: "thread-poll-flap",
    });
    let settled = false;
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "long job" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    ).then((r) => {
      settled = true;
      return r;
    });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(
      BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS + 15_000,
    );

    expect(abortCount).toBe(0);
    expect(settled).toBe(false);
  });

  it("does not surface a fatal terminal outcome for a deferred successor still inside its redispatch bound (awaitingRedispatch)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return backgroundSseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-bg-deferred",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-deferred",
          threadId: "thread-bg-deferred",
          status: "running",
          dispatchMode: "background",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
          awaitingRedispatch: true,
        });
      }
      if (url.includes("/runs/run-bg-deferred/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const abortController = new AbortController();
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-deferred",
      threadId: "thread-bg-deferred",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background job" }],
          },
        ],
        abortSignal: abortController.signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS * 1.5);

    const raceResult = await Promise.race([
      promise.then(() => "settled" as const),
      Promise.resolve("pending" as const),
    ]);
    expect(raceResult).toBe("pending");

    abortController.abort();
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;

    expect(postCount).toBe(1);
  });

  it("still surfaces a loud terminal error once a stuck successor is no longer marked awaitingRedispatch (bound exceeded)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const stalledProgressAt = Date.now();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return backgroundSseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-bg-stuck",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-bg-stuck",
          threadId: "thread-bg-stuck",
          status: "running",
          dispatchMode: "background",
          heartbeatAt: Date.now(),
          lastProgressAt: stalledProgressAt,
          awaitingRedispatch: false,
        });
      }
      if (url.includes("/runs/run-bg-stuck/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-bg-stuck",
      threadId: "thread-bg-stuck",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a long background job" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(
      BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS + 5_000,
    );
    const results = await promise;

    expect(postCount).toBe(1);
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS sits comfortably between the server's redispatch budget and its hard bound", async () => {
    const {
      UNCLAIMED_BACKGROUND_RUN_GRACE_MS,
      UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS,
      UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS,
    } = await import("../agent/run-store.js");
    const { RUN_NO_PROGRESS_HARD_TIMEOUT_MS } =
      await import("../app-config/run-lifecycle-invariants.js");

    const worstCaseFirstAttemptMs =
      UNCLAIMED_BACKGROUND_RUN_GRACE_MS +
      UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS;
    expect(
      worstCaseFirstAttemptMs + UNCLAIMED_BACKGROUND_RUN_FAST_SWEEP_MS,
    ).toBeLessThan(RUN_NO_PROGRESS_HARD_TIMEOUT_MS);
    expect(RUN_NO_PROGRESS_HARD_TIMEOUT_MS).toBeLessThan(
      BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS,
    );
    expect(BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS).toBeLessThan(
      UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS,
    );
  });

  it("re-reads server progress before condemning a run the attach outran", async () => {
    const source = readFileSync(
      new URL("./agent-chat-adapter.ts", import.meta.url),
      "utf8",
    );
    const verdictIdx = source.indexOf("const serverProgressAdvanced");
    expect(verdictIdx).toBeGreaterThan(0);
    const window = source.slice(
      source.indexOf("const snapshotSaysStalled"),
      verdictIdx,
    );
    const activeReads = source.split("/runs/active?threadId=").length - 1;
    expect(activeReads).toBeGreaterThanOrEqual(2);
    expect(window.split("/runs/active?threadId=").length - 1).toBe(1);
    expect(/if \(\w*[Ss]talled\w*\)/.test(window)).toBe(true);
  });

  it("per-turn follow budgets stay above the server's own ceilings", async () => {
    const {
      BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
      MAX_BACKGROUND_RUN_CONTINUATIONS,
      MAX_TURN_WALL_CLOCK_MS,
    } = await import("../app-config/run-lifecycle-invariants.js");

    expect(BACKGROUND_SOFT_TIMEOUT_CEILING_MS * 2).toBeLessThan(
      MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
    );
    expect(MAX_TURN_WALL_CLOCK_MS).toBeLessThan(
      MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
    );
    expect(MAX_BACKGROUND_RUN_CONTINUATIONS).toBeLessThan(
      MAX_FOLLOWED_BACKGROUND_RUNS,
    );
  }, 10_000);

  it("still self-POSTs a foreground continuation after run_timeout (foreground behavior pin)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? sseResponse(
              [
                { type: "text", text: "Working" },
                { type: "auto_continue", reason: "run_timeout" },
              ],
              "run-fg-1",
            )
          : sseResponse(
              [{ type: "text", text: " continued" }, { type: "done" }],
              "run-fg-2",
            );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: false,
          threadId: "thread-fg-pin",
          status: "idle",
          heartbeatAt: null,
          lastProgressAt: null,
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-fg-pin",
      threadId: "thread-fg-pin",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a normal foreground task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    expect(postCount).toBe(2);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Working continued");
  });

  it("follows server state instead of self-posting when foreground self-chain is enabled", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let requestTurnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = JSON.parse(init.body as string).turnId;
        return foregroundSelfChainSseResponse(
          [
            { type: "text", text: "Working" },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-fg-self-1",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-fg-self-2",
          threadId: "thread-fg-self",
          turnId: requestTurnId,
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/runs/run-fg-self-2/events")) {
        return backgroundSseResponse(
          [{ type: "text", text: " continued" }, { type: "done" }],
          "run-fg-self-2",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-fg-self",
      threadId: "thread-fg-self",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a self-chained task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    expect(postCount).toBe(1);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Working continued");
  });

  it("falls back to a client continuation when foreground self-chain dispatch fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? foregroundSelfChainSseResponse(
              [
                { type: "text", text: "Working" },
                {
                  type: "error",
                  error:
                    "The agent's foreground continuation could not hand off.",
                  errorCode: "background_continuation_dispatch_failed",
                  recoverable: true,
                },
              ],
              "run-fg-self-failed-1",
            )
          : sseResponse(
              [{ type: "text", text: " fallback continued" }, { type: "done" }],
              "run-client-fallback",
            );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: false,
          threadId: "thread-fg-self-failed",
          status: "idle",
          heartbeatAt: null,
          lastProgressAt: null,
        });
      }
      if (url.includes("/runs/run-fg-self-failed-1/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-fg-self-failed",
      threadId: "thread-fg-self-failed",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a self-chained task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    expect(postCount).toBe(2);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Working fallback continued");
  });

  it("falls back to a client continuation when a durable background handoff fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? backgroundSseResponse(
              [
                { type: "text", text: "Working" },
                {
                  type: "error",
                  error:
                    "The agent's background worker could not hand off the next step.",
                  errorCode: "background_continuation_dispatch_failed",
                  recoverable: true,
                },
              ],
              "run-background-handoff-failed",
            )
          : sseResponse(
              [{ type: "text", text: " fallback continued" }, { type: "done" }],
              "run-background-client-fallback",
            );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: false,
          threadId: "thread-background-handoff-failed",
          status: "idle",
          heartbeatAt: null,
          lastProgressAt: null,
        });
      }
      if (url.includes("/runs/run-background-handoff-failed/events")) {
        return jsonResponse({ error: "Run not found" }, 404);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-background-handoff-failed",
      threadId: "thread-background-handoff-failed",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "do a durable background task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const results = await promise;

    expect(postCount).toBe(2);
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Working fallback continued");
  });

  it("retries an internal continuation when 409 reports the same completed run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let chatPostCount = 0;
    let abortCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        chatPostCount += 1;
        if (chatPostCount === 1) {
          return sseResponse(
            [
              { type: "text", text: "Working" },
              { type: "auto_continue", reason: "no_progress" },
            ],
            "run-first",
          );
        }
        if (chatPostCount === 2) {
          return jsonResponse({ activeRunId: "run-first" }, 409);
        }
        return sseResponse(
          [{ type: "text", text: " continued" }, { type: "done" }],
          "run-self-continuation",
        );
      }
      if (url.includes("/runs/run-first/abort")) {
        abortCount += 1;
        return jsonResponse({ ok: true });
      }
      if (url.includes("/runs/run-first/events")) {
        return jsonResponse({ error: "should not reconnect stale run" }, 500);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-same-run-conflict",
      threadId: "thread-same-run-conflict",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "continue after quiet stream" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(chatPostCount).toBe(3);
    expect(abortCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/runs/run-first/events"),
      expect.any(Object),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("Working continued");
  });

  it("reattaches an internal continuation when 409 confirms the same turn", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let chatPostCount = 0;
    let turnId = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        chatPostCount += 1;
        turnId = JSON.parse(init.body as string).turnId;
        if (chatPostCount === 1) {
          return sseResponse(
            [
              { type: "text", text: "Working" },
              { type: "auto_continue", reason: "no_progress" },
            ],
            "run-first",
          );
        }
        return jsonResponse({ activeRunId: "run-first" }, 409);
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-first",
          threadId: "thread-same-turn-conflict",
          turnId,
          status: "running",
        });
      }
      if (url.includes("/runs/run-first/events")) {
        return sseResponse(
          [{ type: "text", text: " recovered continuation" }, { type: "done" }],
          "run-first",
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-same-turn-conflict",
      threadId: "thread-same-turn-conflict",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "continue after quiet stream" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(chatPostCount).toBe(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/runs/run-first/events"),
      expect.any(Object),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toContain("recovered continuation");
  });

  it("gives up quickly when the model repeats the same narration without finishing", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      return sseResponse([
        {
          type: "text",
          text: "I have the full HTML. Creating the extension now!",
        },
        { type: "auto_continue", reason: "run_timeout" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-repeat",
      threadId: "thread-repeat",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "host my pasted HTML as an extension" },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    expect(postCount).toBe(4);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "connection_error",
          details: expect.stringContaining("non_advancing_continuations: 3"),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.content.at(-1).text).toContain("repeating the same response");
  });

  it("gives a budget message, not a connection-failure message, when a progressing turn exhausts the total continuation cap", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return jsonResponse({ active: false, status: "idle" });
      }
      postCount += 1;
      const tool = `update-step-${postCount}`;
      return sseResponse([
        { type: "tool_start", tool, input: { step: String(postCount) } },
        { type: "tool_done", tool, result: `saved step ${postCount}` },
        { type: "auto_continue", reason: "run_timeout" },
      ]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-total-transient-budget",
      threadId: "thread-total-transient-budget",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "keep applying these updates" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(15_000);
    const results = await promise;

    expect(postCount).toBe(13);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "connection_error",
          message: expect.stringContaining(
            "reached the limit on how many times it can be automatically continued",
          ),
          details: expect.stringContaining("total_transient_continuations: 13"),
        }),
      }),
    );
    const dispatchedRunError = dispatchEvent.mock.calls.find(
      ([event]) => event?.type === "agent-chat:run-error",
    )?.[0] as CustomEvent<{ message?: string }> | undefined;
    expect(dispatchedRunError?.detail.message).not.toContain(
      "connection kept failing",
    );
    expect(dispatchedRunError?.detail.message).not.toContain("connection");

    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.content.at(-1).text).toContain(
      "reached the limit on how many times it can be automatically continued",
    );
    expect(last.content.at(-1).text).not.toContain("connection kept failing");
  });
});

describe("background follow per-turn budget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("re-polls a live run after a silent reattach instead of losing its completion", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    let eventRequestCount = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "started " },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-follow-watchdog",
        );
      }
      if (url.includes("/runs/active")) {
        const completed = eventRequestCount > 0;
        return jsonResponse({
          active: true,
          runId: "run-follow-watchdog",
          threadId: "thread-follow-watchdog",
          turnId: requestTurnId,
          status: completed ? "completed" : "running",
          dispatchMode: "background-processing",
          terminalReason: completed ? "done" : null,
          heartbeatAt: Date.now(),
          lastProgressAt: completed ? Date.now() : 1_000,
        });
      }
      if (url.includes("/runs/run-follow-watchdog/events")) {
        eventRequestCount += 1;
        return eventRequestCount === 1
          ? idleSseResponse("run-follow-watchdog", "background-processing")
          : backgroundSseResponse(
              [
                { type: "text", text: "finished after reattach" },
                { type: "done" },
              ],
              "run-follow-watchdog",
            );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-follow-watchdog",
      threadId: "thread-follow-watchdog",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this background task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(
      BACKGROUND_FOLLOW_ATTACH_WATCHDOG_MS + 5_000,
    );
    const results = await promise;

    expect(eventRequestCount).toBe(2);
    expect(
      results.some(
        (result: any) =>
          result.status?.type === "incomplete" &&
          result.status?.reason === "error",
      ),
    ).toBe(false);
    expect((results.at(-1) as any).content.at(-1).text).toContain(
      "finished after reattach",
    );
  });

  it("stops following after too many successor runs in one turn", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    let successorCount = 0;
    let requestTurnId = "";
    const abortRequests: Array<Record<string, unknown>> = [];
    const abortUrls: string[] = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        postCount += 1;
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "text", text: "started " },
            { type: "auto_continue", reason: "run_timeout" },
          ],
          "run-chain-0",
        );
      }
      if (url.includes("/runs/active")) {
        successorCount += 1;
        return jsonResponse({
          active: true,
          runId: `run-chain-${successorCount}`,
          threadId: "thread-chain",
          turnId: requestTurnId,
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: Date.now(),
        });
      }
      if (url.includes("/events")) {
        return emptySseResponse("run-chain");
      }
      if (url.includes("/runs/turn/") && init?.method === "POST") {
        abortUrls.push(url);
        abortRequests.push(JSON.parse(init.body as string));
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-chain",
      threadId: "thread-chain",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "long job" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS);
    const results = await promise;

    expect(postCount).toBe(1);
    expect(successorCount).toBeLessThanOrEqual(
      MAX_FOLLOWED_BACKGROUND_RUNS + 2,
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata.custom.runError).toMatchObject({
      errorCode: "background_follow_run_budget_exhausted",
    });
    expect(abortRequests.at(-1)).toMatchObject({
      threadId: "thread-chain",
      reason: "background_follow_run_budget_exhausted",
    });
    expect(abortUrls.at(-1)).toContain(
      `/runs/turn/${encodeURIComponent(requestTurnId)}/abort`,
    );
  });

  it("does not treat repeated zero-event SSE closures on the same run as progress", async () => {
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    let eventRequestCount = 0;
    const abortRequests: Array<Record<string, unknown>> = [];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "activity", label: "Contacting model" },
            { type: "auto_continue", reason: "stream_ended" },
          ],
          "run-same-empty",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-same-empty",
          threadId: "thread-same-empty",
          turnId: requestTurnId,
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: 1_000,
        });
      }
      if (url.includes("/runs/run-same-empty/events")) {
        eventRequestCount += 1;
        return emptySseResponse("run-same-empty");
      }
      if (url.includes("/runs/turn/") && init?.method === "POST") {
        abortRequests.push(JSON.parse(init.body as string));
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-same-empty",
      threadId: "thread-same-empty",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this background task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(
      BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS + 20_000,
    );
    const results = await promise;

    expect(eventRequestCount).toBeGreaterThan(1);
    expect(eventRequestCount).toBeLessThan(50);
    expect(abortRequests.at(-1)).toMatchObject({
      threadId: "thread-same-empty",
      reason: "background_run_lost",
    });
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.metadata.custom.runError).toMatchObject({
      errorCode: "background_run_lost",
    });
    expect(last.metadata.custom.runError.details).toContain(
      "background_follow_no_progress_detaches:",
    );
    expect(last.metadata.custom.runError.details).toContain(
      "background_follow_last_detach_reason: stream_ended",
    );
    expect(last.metadata.custom.runError.details).toContain(
      "background_follow_last_detach_source: client_watchdog",
    );
  });

  it("does not treat sequenced keepalive and clear noise as background progress", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let requestTurnId = "";
    let eventRequestCount = 0;
    let abortReason = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
        requestTurnId = JSON.parse(init.body as string).turnId;
        return backgroundSseResponse(
          [
            { type: "activity", label: "Contacting model" },
            { type: "auto_continue", reason: "stream_ended" },
          ],
          "run-sequenced-noise",
        );
      }
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-sequenced-noise",
          threadId: "thread-sequenced-noise",
          turnId: requestTurnId,
          status: "running",
          dispatchMode: "background-processing",
          heartbeatAt: Date.now(),
          lastProgressAt: 1_000,
        });
      }
      if (url.includes("/runs/run-sequenced-noise/events")) {
        eventRequestCount += 1;
        return sseResponse(
          [
            eventRequestCount % 2 === 0
              ? { type: "clear", seq: eventRequestCount }
              : { type: "stream_keepalive", seq: eventRequestCount },
          ],
          "run-sequenced-noise",
        );
      }
      if (url.includes("/runs/turn/") && init?.method === "POST") {
        abortReason = JSON.parse(init.body as string).reason;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-sequenced-noise",
      threadId: "thread-sequenced-noise",
    });
    const promise = drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "finish this background task" }],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(
      BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS + 20_000,
    );
    const results = await promise;

    expect(eventRequestCount).toBeGreaterThan(1);
    expect(abortReason).toBe("background_run_lost");
    expect((results.at(-1) as any).metadata.custom.runError.errorCode).toBe(
      "background_run_lost",
    );
  });

  it.each([
    ["a newer server progress timestamp", "server-progress"],
    ["a successor run id", "successor"],
  ] as const)(
    "resets same-turn background idle time after %s",
    async (_label, progressKind) => {
      vi.useFakeTimers();
      vi.stubGlobal("window", { dispatchEvent: vi.fn() });
      vi.stubGlobal(
        "CustomEvent",
        class CustomEvent {
          type: string;
          detail: unknown;
          constructor(type: string, init?: { detail?: unknown }) {
            this.type = type;
            this.detail = init?.detail;
          }
        },
      );

      let requestTurnId = "";
      let activeRunId = "run-progress-0";
      let serverProgressAt = 1_000;
      let finish = false;
      let abortCount = 0;
      const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
          requestTurnId = JSON.parse(init.body as string).turnId;
          return backgroundSseResponse(
            [{ type: "auto_continue", reason: "stream_ended" }],
            "run-progress-0",
          );
        }
        if (url.includes("/runs/active")) {
          return jsonResponse({
            active: true,
            runId: activeRunId,
            threadId: "thread-progress-reset",
            turnId: requestTurnId,
            status: finish ? "completed" : "running",
            dispatchMode: "background-processing",
            terminalReason: finish ? "done" : null,
            heartbeatAt: Date.now(),
            lastProgressAt: serverProgressAt,
          });
        }
        if (url.includes("/events")) {
          if (finish) {
            return sseResponse([{ type: "done", seq: 99 }], activeRunId);
          }
          return emptySseResponse(activeRunId);
        }
        if (url.includes("/runs/turn/") && init?.method === "POST") {
          abortCount += 1;
          return jsonResponse({ ok: true });
        }
        return jsonResponse({ error: "unexpected" }, 500);
      });
      vi.stubGlobal("fetch", fetchSpy);

      const adapter = createAgentChatAdapter({
        apiUrl: "/_agent-native/agent-chat",
        tabId: `chat-progress-${progressKind}`,
        threadId: "thread-progress-reset",
      });
      const promise = drain(
        adapter.run({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "keep working" }],
            },
          ],
          abortSignal: new AbortController().signal,
        } as any),
      );

      await vi.advanceTimersByTimeAsync(
        BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS - 20_000,
      );
      if (progressKind === "server-progress") {
        serverProgressAt += 1_000;
      } else {
        activeRunId = "run-progress-1";
      }
      await vi.advanceTimersByTimeAsync(30_000);

      const raceResult = await Promise.race([
        promise.then(() => "settled" as const),
        Promise.resolve("pending" as const),
      ]);
      expect(raceResult).toBe("pending");

      finish = true;
      await vi.advanceTimersByTimeAsync(10_000);
      const results = await promise;

      expect(abortCount).toBe(0);
      expect(
        results.some(
          (result: any) =>
            result.status?.type === "incomplete" &&
            result.status?.reason === "error",
        ),
      ).toBe(false);
    },
  );
});

describe("activeRunLooksAlive", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats an unresolved local tool call as alive without asking the server", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      activeRunLooksAlive({
        apiUrl: "/_agent-native/agent-chat",
        threadId: "thread-1",
        runId: "run-1",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc_1",
            toolName: "slow-report",
            argsText: "",
            args: {},
          },
        ] as any,
      }),
    ).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires server in-flight work and fails safe on lookup errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ active: true, runId: "run-1", status: "running" }),
      ),
    );
    await expect(
      activeRunLooksAlive({
        apiUrl: "/_agent-native/agent-chat",
        threadId: "thread-1",
        runId: "run-1",
      }),
    ).resolves.toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          active: true,
          runId: "run-1",
          status: "running",
          hasInFlightWork: true,
        }),
      ),
    );
    await expect(
      activeRunLooksAlive({
        apiUrl: "/_agent-native/agent-chat",
        threadId: "thread-1",
        runId: "run-1",
      }),
    ).resolves.toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ active: false })),
    );
    await expect(
      activeRunLooksAlive({
        apiUrl: "/_agent-native/agent-chat",
        threadId: "thread-1",
        runId: "run-1",
      }),
    ).resolves.toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(
      activeRunLooksAlive({
        apiUrl: "/_agent-native/agent-chat",
        threadId: "thread-1",
        runId: "run-1",
      }),
    ).resolves.toBe(true);
  });

  it("does not treat an activity-only tool placeholder as in-flight work", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        active: true,
        runId: "run-1",
        status: "running",
        hasInFlightWork: false,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      activeRunLooksAlive({
        apiUrl: "/_agent-native/agent-chat",
        threadId: "thread-1",
        runId: "run-1",
        content: [
          {
            type: "tool-call",
            toolCallId: "activity-only",
            toolName: "patch-deck",
            argsText: "",
            args: {},
            activity: true,
          },
        ] as any,
      }),
    ).resolves.toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats an unresolved delegated-agent activity card as in-flight work", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        active: true,
        runId: "run-1",
        status: "running",
        hasInFlightWork: false,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      activeRunLooksAlive({
        apiUrl: "/_agent-native/agent-chat",
        threadId: "thread-1",
        runId: "run-1",
        content: [
          {
            type: "tool-call",
            toolCallId: "agent-call",
            toolName: "agent:Analytics",
            argsText: "",
            args: {},
            activity: true,
          },
        ] as any,
      }),
    ).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("empty-run continuation backoff", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits before re-POSTing a run that produced nothing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
    );

    let postCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          postCount += 1;
          return postCount === 1
            ? emptySseResponse("run-nothing")
            : sseResponse([
                { type: "text", text: "recovered" },
                { type: "done" },
              ]);
        }
        return jsonResponse({ error: "gone" }, 404);
      }),
    );

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-empty-backoff",
      threadId: "thread-empty-backoff",
    });
    const promise = drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: "do it" }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    await vi.advanceTimersByTimeAsync(300);
    expect(postCount).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(postCount).toBe(2);
  });
});
