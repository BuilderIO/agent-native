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

async function drain(iterable: AsyncIterable<unknown>) {
  const results: unknown[] = [];
  for await (const result of iterable) {
    results.push(result);
  }
  return results;
}

describe("createAgentChatAdapter", () => {
  afterEach(() => {
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
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "chat-qa",
      threadId: "thread-qa",
      modelRef,
      engineRef,
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

  it("surfaces loop limit metadata from the SSE stream", async () => {
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
        .mockResolvedValue(
          sseResponse([{ type: "loop_limit", maxIterations: 7 }]),
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
    expect(last.content.at(-1).text).toContain("7-step limit");
    expect(last.metadata.custom.loopLimit).toEqual({ maxIterations: 7 });
    expect(last.metadata.custom.runId).toBe("run-qa");
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-chat:loop-limit",
        detail: { tabId: "chat-limit", maxIterations: 7 },
      }),
    );
  });
});
