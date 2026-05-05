import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentChatAdapter } from "./agent-chat-adapter.js";

function sseResponse(events: unknown[]): Response {
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
        "X-Run-Id": "run-qa",
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
            content: [{ type: "text", text: "Review @[app.tsx|file]" }],
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
                content: [{ type: "text", text: "Attachment text" }],
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
            ],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {
          custom: {
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

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      message: "Review @app.tsx",
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
      ],
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: { isRunning: true, tabId: "chat-qa" },
      }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agentNative.chatRunning",
        detail: { isRunning: false, tabId: "chat-qa" },
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

    // Switching back to build mode sends act metadata
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
    expect(secondBody.history).toEqual([
      { role: "user", content: "keep using tools" },
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

    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        throw new TypeError("Failed to fetch");
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
        return jsonResponse({ active: false, status: "idle" });
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
    const secondBody = JSON.parse(fetchSpy.mock.calls[3][1].body);
    expect(secondBody.message).toContain("Continue from where you left off");
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe(
      "finished after empty-stream recovery",
    );
  });

  it("uses partial stream-ended text as history without keeping it visible", async () => {
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
    expect((results[1] as any).content).toEqual([]);
    const last = results.at(-1) as any;
    const finalText = last.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("");
    expect(finalText).toBe("finished after stream recovery");
    expect(finalText).not.toContain("still working");
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
      { type: "text", text: "finished after timeout recovery" },
    ]);
    const finalText = last.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("");
    expect(finalText).not.toContain("checking the dashboard");
  });
});
