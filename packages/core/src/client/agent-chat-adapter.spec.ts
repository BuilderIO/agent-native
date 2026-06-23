import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentChatAdapter } from "./agent-chat-adapter.js";
import { SSE_NO_PROGRESS_TIMEOUT_MS } from "./sse-event-processor.js";

const analyticsMock = vi.hoisted(() => ({
  captureError: vi.fn(),
}));

vi.mock("./analytics.js", () => analyticsMock);

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
    analyticsMock.captureError.mockReset();
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

  async function postOutboundAttachment(fetchSpy: any, text: string) {
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
                name: "pasted-text-1.txt",
                contentType: "text/plain",
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
    // Regression for the `contentFromAttachment` hosting path: a pasted HTML /
    // Alpine file the user wants hosted verbatim must reach the server whole.
    // Capping the OUTBOUND attachment at the 60K history cap silently truncated
    // exactly the large pastes the feature exists for, so the server hosted a
    // broken extension. 150K is well above 60K and below the 200K outbound cap.
    const fetchSpy = stubLargeAttachmentEnv();
    const big = "a".repeat(150_000);
    const body = await postOutboundAttachment(fetchSpy, big);
    expect(body.attachments[0].text).toBe(big);
    expect(body.attachments[0].text).not.toContain(
      "omitted from the submitted",
    );
  });

  it("caps a pathological multi-hundred-KB outbound attachment at 200K with a visible notice", async () => {
    const fetchSpy = stubLargeAttachmentEnv();
    const body = await postOutboundAttachment(fetchSpy, "a".repeat(200_010));
    expect(body.attachments[0].text).toHaveLength(
      200_000 +
        "\n\n[Attachment truncated after 200,000 characters; 10 characters omitted from the submitted attachment.]"
          .length,
    );
    expect(body.attachments[0].text).toContain(
      "10 characters omitted from the submitted attachment",
    );
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
      expect.objectContaining({ type: "agent-chat:missing-api-key" }),
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    expect(results[0]).toEqual({
      content: [{ type: "text", text: "Error: No LLM provider is connected" }],
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
    expect(body.history).toEqual([
      { role: "user", content: "Build a CS operations tool" },
      { role: "assistant", content: "The agent stopped before finishing." },
    ]);
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

    await vi.advanceTimersByTimeAsync(500);
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
        // First send collides with the previous run, which the server still
        // reports as active for a beat after it finished. No queue marker here:
        // this is an ordinary send fired shortly after the prior turn.
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

    await vi.advanceTimersByTimeAsync(500);
    const results = await promise;

    // It must retry its own prompt, never fetch the old run's events (replay).
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

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    // A run that produces nothing visible no longer gives up on the first
    // soft-timeout (that made heavier prompts feel like they "stop midway").
    // It retries through the empty-continuation budget
    // (MAX_EMPTY_TRANSIENT_CONTINUATIONS = 3) — 1 initial + 3 retries = 4
    // POSTs — then surfaces the "no visible progress" error.
    expect(postCount).toBe(4);
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

  it("recovers when a silent run timeout is followed by real output", async () => {
    // The point of the empty-continuation budget: a transient slow start (the
    // model thinks through the soft-timeout window with no visible output) must
    // recover on a later continuation, not give up. Two empty run_timeouts
    // followed by real text should finish cleanly with no "no visible progress"
    // error. This is the regression that made heavier prompts feel like they
    // "crap out / stop midway".
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

    // 2 empty run_timeouts (within the budget of 3) then a successful run.
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
    // Design gets its own incremental counterpart, not the extension wording.
    expect(secondBody.message).toContain("edit-design");
    expect(secondBody.message).not.toContain("compact working v1");
  });

  it("surfaces a startup timeout when the POST never becomes an SSE stream", async () => {
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

    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/runs/active")) {
        return Promise.resolve(jsonResponse({ active: false, status: "idle" }));
      }
      if (url === "/_agent-native/agent-chat" && init?.method === "POST") {
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
    const results = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
    // The already-streamed text must also survive into structuredHistory — the
    // server prioritizes structuredHistory over the plain history string, so a
    // transient continuation that lost it here would resume blind to text the
    // model already produced.
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
    // A tool_start with no matching tool_done is the server still executing
    // the action. A run_timeout in that window is real progress — the
    // server's foldAssistantTurn already persisted the in-flight call — so it
    // must not count against the stalled/empty continuation budgets. We fire
    // far more in-flight timeouts than MAX_STALLED_TRANSIENT_CONTINUATIONS (8)
    // and MAX_EMPTY_TRANSIENT_CONTINUATIONS (1); the run must still recover.
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
        // tool_start with NO tool_done — the action is still running when the
        // run times out.
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

    // 12 in-flight timeouts + 1 successful run — never gave up despite far
    // exceeding the stalled (8) and empty (1) caps.
    expect(postCount).toBe(13);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );
    const last = results.at(-1) as any;
    expect(last.content.at(-1).text).toBe("finished after in-flight recovery");
  });

  it("bails after MAX_REPEATED_INFLIGHT_TOOL_STALLS stream_ended drops on the same tool", async () => {
    // The motivating bug: user pastes 843 lines of HTML, agent starts
    // create-extension, connection drops (stream_ended), agent retypes the
    // whole thing, connection drops again — repeating until budgets exhaust.
    // The in-flight stall guard should bail after 3 consecutive stream_ended
    // events for the same tool, well before the 32-continuation budget.
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
      // Every run: agent narrates, starts create-extension, connection drops.
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

    // Should bail well before the 32-continuation cap.
    // Initial post + 3 stream_ended stalls = 4 total posts (1 initial + 3 continuations,
    // the 4th continuation is blocked by the guard). At most a few extra.
    expect(postCount).toBeLessThanOrEqual(8);
    // Should have fired the run-error event with the "stuck repeating" message.
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
    // The in-flight stall guard keys on tool name + input signature, so a retry
    // with a different (e.g. smaller) payload — exactly what the cutoff nudge
    // asks the model to do — resets the stall count instead of accumulating
    // toward the bail. Here every stalled round sends a DISTINCT, shrinking
    // create-extension payload, so even past MAX_REPEATED_INFLIGHT_TOOL_STALLS
    // the run keeps going and the eventual smaller payload succeeds.
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
        // Distinct narration + a distinct, smaller payload each round, then a
        // connection drop. 5 stalls is past the 3-stall same-payload bail.
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
      // The shrunk payload finally gets through.
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

    // Went past the 3-stall same-payload bail (each payload differed), never
    // fired the in-flight bail, and completed.
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
    // run_timeout with an in-flight tool = server is still executing the
    // action. This must NOT count toward the stream_ended stall counter.
    // Regression guard for the existing behavior verified at postCount===13.
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

    // 5 run_timeout stalls + 1 success = 6 posts; guard must NOT have fired.
    expect(postCount).toBe(6);
    const last = results.at(-1) as any;
    expect(last?.content?.at(-1)?.text).toBe("done");
  });

  it("preserves large create-extension input verbatim in continuation history", async () => {
    // Large-input tools carry the artifact itself as their input. Lossy
    // truncation to an `{ __agentNativeTruncated }` placeholder would strand
    // the resumed agent — it could no longer refine the extension. The real
    // HTML must survive into the continuation's structuredHistory.
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
    // Root-cause fix for the create-extension-with-a-huge-paste loop. Instead
    // of copying the pasted HTML into the `content` tool argument (which can be
    // cut off mid-stream and force a continuation loop), the model passes a
    // tiny `contentFromAttachment` reference. The big file rides along ONCE as
    // a structured attachment in the request; the server resolves it. The run
    // finishes in a single POST — contrast the verbatim-tool-input path above.
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

    // One shot — no continuation loop.
    expect(postCount).toBe(1);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "agent-chat:run-error" }),
    );

    // The big pasted file travels ONCE, as a structured attachment, so the
    // server can resolve `contentFromAttachment` without the model re-emitting
    // it as a tool argument.
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const pasted = body.attachments.find((a: any) => a.name === pastedName);
    expect(pasted?.text).toBe(bigHtml);

    // The model's create-extension call stays tiny — the reference, not the file.
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
    // When a large create-extension turn becomes prior history on a later
    // request, history truncation runs (truncateForHistory=true). A generic
    // tool would collapse to the `__agentNativeTruncated` placeholder; an
    // extension's input is the artifact itself, so it must survive verbatim
    // so the agent can keep refining it. A generic large tool input still
    // collapses to the placeholder to bound history growth.
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
    // Extension input survives verbatim.
    expect(extensionCall.args.content).toBe(bigHtml);
    expect(extensionCall.args.__agentNativeTruncated).toBeUndefined();
    // A generic large tool input still collapses to the placeholder.
    expect(genericCall.args.__agentNativeTruncated).toBe(true);
    expect(genericCall.args.query).toBeUndefined();
  });

  it("counts whitespace-only output against the empty recovery cap", async () => {
    // Resetting the empty-continuation counter on a non-zero PART count let
    // whitespace-only output keep the run alive indefinitely. The counter must
    // reset only on real content-weight progress, so whitespace-only timeouts
    // exhaust the empty cap (MAX_EMPTY_TRANSIENT_CONTINUATIONS = 3) and give up
    // instead of looping until the much larger stalled cap (8).
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

    // 1 initial + 3 empty retries, then the empty cap (3) is exceeded — no
    // 10-POST runaway up to the stalled cap.
    expect(postCount).toBe(4);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({ errorCode: "connection_error" }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
  });

  it("gives up quickly when the model repeats the same narration without finishing", async () => {
    // A degenerate model loop re-streams the same sentence every continuation
    // and never starts or finishes a tool (the create-extension-with-a-huge-
    // pasted-HTML failure). Each repeat is "new" text, so the stalled/empty
    // budgets keep resetting; only the repetition guard stops it — after a few
    // rounds, not the full 32-continuation transient budget.
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

    // 1 initial + 4 repeated continuations, then the repetition cap (3) is
    // exceeded — far short of MAX_TOTAL_TRANSIENT_CONTINUATIONS (32).
    expect(postCount).toBe(5);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:run-error",
        detail: expect.objectContaining({
          errorCode: "connection_error",
          details: expect.stringContaining(
            "repeated_transient_continuations: 4",
          ),
        }),
      }),
    );
    const last = results.at(-1) as any;
    expect(last.status).toEqual({ type: "incomplete", reason: "error" });
    expect(last.content.at(-1).text).toContain("repeating the same response");
  });
});
