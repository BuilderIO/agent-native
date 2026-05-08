import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentChatAdapter } from "./agent-chat-adapter.js";
import { SSE_NO_PROGRESS_TIMEOUT_MS } from "./sse-event-processor.js";

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

function idleSseResponse(runId = "run-idle"): Response {
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

  it("truncates large outbound text attachments before posting", async () => {
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
      tabId: "chat-large-attachment",
    });

    await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Summarize this" }],
            attachments: [
              {
                name: "gong-transcript.txt",
                contentType: "text/plain",
                content: [{ type: "text", text: "a".repeat(60_010) }],
              },
            ],
          },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.attachments[0].text).toHaveLength(
      60_000 +
        "\n\n[Attachment truncated after 60,000 characters; 10 characters omitted from the submitted attachment.]"
          .length,
    );
    expect(body.attachments[0].text).toContain(
      "10 characters omitted from the submitted attachment",
    );
  });

  it("surfaces missing-credential HTTP responses instead of yielding a blank assistant message", async () => {
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
      expect.objectContaining({ type: "agent-chat:missing-api-key" }),
    );
    expect(results[0]).toEqual({
      content: [{ type: "text", text: "Error: No LLM provider is connected" }],
      status: { type: "incomplete", reason: "error" },
    });
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
        detail: { isRunning: false, tabId: "chat-invalid-token" },
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
        detail: { isRunning: false, tabId: "chat-auth-retry" },
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
    expect(secondBody.internalContinuation).toBe(true);
    expect(secondBody.history).toEqual([
      { role: "user", content: "keep using tools" },
    ]);
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

  it("aborts and continues automatically when an SSE stream stays alive without progress", async () => {
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
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/runs/run-idle/abort")) {
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

    expect(fetchSpy).toHaveBeenCalledWith(
      "/_agent-native/agent-chat/runs/run-idle/abort",
      expect.objectContaining({ method: "POST" }),
    );
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
          errorCode: "connection_error",
          details: expect.stringContaining("stale_run_continuations: 4"),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.content.at(-1).text).toContain(
      "The agent connection kept failing",
    );
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
});
