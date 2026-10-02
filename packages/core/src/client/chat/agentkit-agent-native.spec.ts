import { AgentKitClient } from "@agent-native/agentkit/client";
import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { describe, expect, it, vi } from "vitest";

import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";
import {
  createAgentNativeChatRuntime,
  createHttpAgentChatRuntime,
  type AgentChatRuntime,
} from "./runtime.js";

const runStateMocks = vi.hoisted(() => ({
  dispatchAgentChatRunning: vi.fn(),
}));

vi.mock("../use-agent-chat-running-threads.js", () => runStateMocks);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createAgentNativeAgentKitTransport", () => {
  it("creates a missing thread when its first snapshot races the user-message save", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    let created = false;
    let savedThreadData: string | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({
          url,
          method,
          ...(typeof init?.body === "string" ? { body: init.body } : {}),
        });
        if (url.startsWith("/_agent-native/agent-chat/threads/first-save")) {
          if (method === "GET" && !created) {
            return json({ error: "Thread not found" }, 404);
          }
          if (method === "PUT") {
            savedThreadData = JSON.parse(String(init?.body)).threadData;
            return json({ ok: true });
          }
          return json({
            id: "first-save",
            title: "First prompt",
            threadData: JSON.stringify({}),
          });
        }
        if (
          url ===
            "/_agent-native/agent-chat/threads?scopeType=workspace-app&scopeId=app-one" &&
          method === "POST"
        ) {
          created = true;
          expect(JSON.parse(String(init?.body))).toEqual({
            id: "first-save",
            title: "First prompt",
          });
          return json({
            id: "first-save",
            title: "First prompt",
            threadData: JSON.stringify({}),
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      scope: { type: "workspace-app", id: "app-one" },
      isolateHistoryByScope: true,
    });

    await transport.persistThreadSnapshot?.({
      threadId: "first-save",
      snapshot: {
        id: "first-save",
        title: "First prompt",
        createdAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z",
        messages: [
          {
            id: "prompt-1",
            role: "user",
            parts: [{ type: "text", text: "Make a launch deck" }],
          },
        ],
      },
    });

    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "PUT",
    ]);
    expect(requests[1]?.url).toBe(
      "/_agent-native/agent-chat/threads?scopeType=workspace-app&scopeId=app-one",
    );
    expect(JSON.parse(savedThreadData ?? "{}").agentKit.messages).toEqual([
      expect.objectContaining({ id: "prompt-1", role: "user" }),
    ]);
  });

  it("merges the incoming snapshot into a thread after concurrent create returns 409", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    let threadReads = 0;
    let savedThreadData: string | undefined;
    let savedMessageCount: number | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({ url, method });
        if (url.endsWith("/threads/raced-thread")) {
          if (method === "GET") {
            threadReads++;
            if (threadReads === 1) {
              return json({ error: "Thread not found" }, 404);
            }
            return json({
              id: "raced-thread",
              title: "Typed prompt",
              threadData: JSON.stringify({
                messages: [
                  {
                    id: "legacy-only-prompt",
                    role: "user",
                    content: "Keep the legacy prompt",
                  },
                ],
                agentKit: {
                  messages: [
                    {
                      id: "saved-prompt",
                      role: "user",
                      parts: [{ type: "text", text: "Stale prompt text" }],
                    },
                    {
                      id: "stored-only-prompt",
                      role: "user",
                      parts: [{ type: "text", text: "Keep stored history" }],
                    },
                  ],
                  toolCalls: [
                    {
                      id: "shared-tool",
                      name: "old-tool-name",
                      input: { version: "stored" },
                      status: "running",
                      messageId: "saved-prompt",
                    },
                    {
                      id: "stored-only-tool",
                      name: "keep-tool",
                      output: { kept: true },
                      status: "completed",
                    },
                  ],
                  widgets: [
                    {
                      messageId: "saved-prompt",
                      widget: {
                        id: "saved-widget",
                        kind: "test.action",
                        data: {
                          toolCallId: "saved-tool",
                          toolName: "create-release",
                        },
                        title: "Saved action",
                      },
                    },
                  ],
                },
              }),
            });
          }
          if (method === "PUT") {
            const body = JSON.parse(String(init?.body));
            savedThreadData = body.threadData;
            savedMessageCount = body.messageCount;
            return json({ ok: true });
          }
        }
        if (url === "/_agent-native/agent-chat/threads" && method === "POST") {
          return json({ error: "Thread id already in use" }, 409);
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.persistThreadSnapshot?.({
      threadId: "raced-thread",
      snapshot: {
        id: "raced-thread",
        title: "Typed prompt",
        createdAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z",
        messages: [
          {
            id: "saved-prompt",
            role: "user",
            parts: [{ type: "text", text: "Updated prompt text" }],
          },
        ],
        toolCalls: [
          {
            id: "shared-tool",
            name: "new-tool-name",
            input: { version: "incoming" },
            output: { saved: true },
            status: "completed",
            messageId: "saved-prompt",
          },
        ],
        widgets: [
          {
            messageId: "missing-message",
            widget: {
              id: "orphan-widget",
              kind: "test.action",
              data: {
                toolCallId: "orphan-tool",
                toolName: "create-release",
              },
            },
          },
        ],
      },
    });

    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "GET",
      "PUT",
    ]);
    const saved = JSON.parse(savedThreadData ?? "{}");
    expect(saved.messages).toEqual([
      expect.objectContaining({
        id: "legacy-only-prompt",
        role: "user",
        content: "Keep the legacy prompt",
      }),
    ]);
    expect(saved.agentKit.messages).toEqual([
      expect.objectContaining({
        id: "saved-prompt",
        role: "user",
        parts: [
          expect.objectContaining({
            type: "text",
            text: "Updated prompt text",
          }),
        ],
      }),
      expect.objectContaining({
        id: "stored-only-prompt",
        role: "user",
        parts: [
          expect.objectContaining({
            type: "text",
            text: "Keep stored history",
          }),
        ],
      }),
      expect.objectContaining({
        id: "legacy-only-prompt",
        role: "user",
        parts: [
          expect.objectContaining({
            type: "text",
            text: "Keep the legacy prompt",
          }),
        ],
      }),
    ]);
    expect(saved.agentKit.toolCalls).toEqual([
      {
        id: "shared-tool",
        name: "new-tool-name",
        input: { version: "incoming" },
        output: { saved: true },
        status: "completed",
        messageId: "saved-prompt",
      },
      {
        id: "stored-only-tool",
        name: "keep-tool",
        output: { kept: true },
        status: "completed",
      },
    ]);
    expect(saved.agentKit.widgets).toEqual([
      {
        messageId: "saved-prompt",
        widget: {
          id: "saved-widget",
          kind: "test.action",
          data: {
            toolCallId: "saved-tool",
            toolName: "create-release",
          },
          title: "Saved action",
        },
      },
    ]);
    expect(savedMessageCount).toBe(3);
  });

  it("preserves a thread-create failure when no accessible row exists", async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/threads/rejected-thread")) {
          return json({ error: "Thread not found" }, 404);
        }
        if (String(input).endsWith("/threads") && init?.method === "POST") {
          return json({ error: "Unavailable" }, 503);
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.persistThreadSnapshot?.({
        threadId: "rejected-thread",
        snapshot: {
          id: "rejected-thread",
          createdAt: "2026-09-30T00:00:00.000Z",
          updatedAt: "2026-09-30T00:00:00.000Z",
          messages: [],
        },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      isolateHistoryByScope: true,
      expectedQuery: "?scopeType=workspace-app&scopeId=app-one",
    },
    { isolateHistoryByScope: false, expectedQuery: "" },
  ])(
    "scopes thread restore and queue persistence only when history isolation is enabled",
    async ({ isolateHistoryByScope, expectedQuery }) => {
      const apiUrl = "/_agent-native/agent-chat";
      const fetcher = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          if (url.startsWith(`${apiUrl}/threads/thread-scope/queued`)) {
            const mutation = JSON.parse(String(init?.body)).mutation;
            return json({
              queuedMessages: [mutation.message],
              message: mutation.message,
            });
          }
          if (url.startsWith(`${apiUrl}/threads/thread-scope`)) {
            return json({
              id: "thread-scope",
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
              threadData: JSON.stringify({ messages: [], queuedMessages: [] }),
            });
          }
          return json({ error: "Not found" }, 404);
        },
      );
      const transport = createAgentNativeAgentKitTransport({
        apiUrl,
        fetch: fetcher as typeof fetch,
        scope: { type: "workspace-app", id: "app-one" },
        isolateHistoryByScope,
        adapter: { createId: () => "queued-one" },
      });

      await transport.queueMessage?.({
        threadId: "thread-scope",
        text: "Run this next",
      });

      expect(
        fetcher.mock.calls
          .map(([input]) => String(input))
          .filter((url) => url.includes("/threads/thread-scope")),
      ).toEqual([`${apiUrl}/threads/thread-scope/queued${expectedQuery}`]);
      await transport.dispose();
    },
  );

  it("appends queue messages from independent transports without replacing snapshots", async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/threads/thread-cross-tab/queued")) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          if (
            mutation.type === "append" &&
            !persisted.some((message) => message.id === mutation.message.id)
          ) {
            persisted.push(mutation.message);
          }
          return json({
            queuedMessages: persisted,
            message: mutation.message,
          });
        }
        if (url.endsWith("/threads/thread-cross-tab")) {
          return json({
            id: "thread-cross-tab",
            threadData: JSON.stringify({ queuedMessages: persisted }),
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    let nextId = 0;
    const createTransport = () =>
      createAgentNativeAgentKitTransport({
        apiUrl: "/_agent-native/agent-chat",
        fetch: fetcher as typeof fetch,
        adapter: { createId: () => `queued-${++nextId}` },
      });
    const first = createTransport();
    const second = createTransport();

    await Promise.all([
      first.queueMessage?.({ threadId: "thread-cross-tab", text: "First" }),
      second.queueMessage?.({ threadId: "thread-cross-tab", text: "Second" }),
    ]);

    expect(persisted.map((message) => message.text)).toEqual([
      "First",
      "Second",
    ]);
    expect(
      fetcher.mock.calls
        .filter(([input]) => String(input).endsWith("/queued"))
        .map(([, init]) => JSON.parse(String(init?.body))),
    ).toEqual([
      { mutation: expect.objectContaining({ type: "append" }) },
      { mutation: expect.objectContaining({ type: "append" }) },
    ]);
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("restores action widgets from durable assistant tool results", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-1",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-1",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-1",
                    toolName: "apply-ai-filter",
                    args: { mode: "filter" },
                    result: JSON.stringify({ changed: 5 }),
                    chatUIResult: { changed: 5 },
                    chatUI: {
                      renderer: "mail.ai-filter-confirmation",
                      title: "AI filter result",
                    },
                  },
                ],
              },
            ],
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-1",
    });

    expect(snapshot).toMatchObject({
      toolCalls: [
        {
          id: "tool-1",
          name: "apply-ai-filter",
          input: { mode: "filter" },
          output: { changed: 5 },
          status: "completed",
          messageId: "assistant-1",
        },
      ],
      widgets: [
        {
          messageId: "assistant-1",
          widget: {
            id: "tool-1:chat-ui",
            kind: "mail.ai-filter-confirmation",
            title: "AI filter result",
            data: {
              toolCallId: "tool-1",
              toolName: "apply-ai-filter",
            },
          },
        },
      ],
    });
  });

  it("restores widgets already stored in the AgentKit snapshot", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-agentkit-widget",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            agentKit: {
              messages: [
                {
                  id: "assistant-agentkit",
                  role: "assistant",
                  parts: [{ type: "text", text: "Done." }],
                },
              ],
              widgets: [
                {
                  messageId: "assistant-agentkit",
                  widget: {
                    id: "widget-agentkit",
                    kind: "mail.ai-filter-confirmation",
                    data: { changed: 5 },
                  },
                },
              ],
            },
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-agentkit-widget",
    });

    expect(snapshot?.widgets).toEqual([
      {
        messageId: "assistant-agentkit",
        widget: {
          id: "widget-agentkit",
          kind: "mail.ai-filter-confirmation",
          data: { changed: 5 },
        },
      },
    ]);
  });

  it("persists compact completed activity history without replacing messages", async () => {
    const repository = {
      queuedMessages: [{ id: "queued-after-snapshot-read", text: "Later" }],
      messages: [
        {
          id: "assistant-legacy",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-history",
              toolName: "create-release",
              args: {},
              result: { ok: true },
              chatUI: { renderer: "test.action", title: "Release created" },
            },
          ],
        },
      ],
      retained: true,
      agentKit: {
        messages: [
          {
            id: "assistant-stale",
            role: "assistant",
            parts: [{ type: "text", text: "Old response." }],
          },
        ],
      },
    };
    let threadData = JSON.stringify(repository);
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/runs/active?threadId=thread-history")) {
          return json({ active: false });
        }
        if (url.endsWith("/threads/thread-history") && init?.method === "PUT") {
          threadData = JSON.parse(String(init.body)).threadData;
          return json({ ok: true });
        }
        if (url.endsWith("/threads/thread-history")) {
          return json({
            id: "thread-history",
            createdAt: "2026-09-26T00:00:00.000Z",
            updatedAt: "2026-09-26T00:01:00.000Z",
            threadData,
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      fetch: fetcher as typeof fetch,
      adapter: { now: () => "2026-09-26T00:01:00.000Z" },
    });

    await transport.persistThreadSnapshot?.({
      threadId: "thread-history",
      snapshot: {
        id: "thread-history",
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:01:00.000Z",
        messages: [
          {
            id: "user-approval",
            role: "user",
            parts: [
              {
                type: "file",
                name: "durable-upload.txt",
                fileId: "upload-1",
                url: "data:text/plain;base64,c2VjcmV0",
              },
              {
                type: "file",
                name: "inline-secret.txt",
                url: "data:text/plain;base64,c2VjcmV0",
              },
              {
                type: "file",
                name: "remote.txt",
                url: "https://files.example.test/remote.txt",
              },
            ],
            metadata: {
              hideUserMessage: true,
              privatePrompt: "do not persist this metadata",
            },
          },
          {
            id: "assistant-history",
            role: "assistant",
            parts: [
              { type: "text", text: "Release created." },
              { type: "data", data: { private: "do not persist raw data" } },
            ],
          },
        ],
        toolCalls: [
          {
            id: "tool-history",
            name: "create-release",
            input: { release: "agentkit-acceptance" },
            output: { display: { title: "Release created" } },
            status: "completed",
            messageId: "assistant-history",
          },
          {
            id: "tool-string-history",
            name: "string-result",
            input: {},
            output: '{"value":1}',
            status: "completed",
          },
          {
            id: "tool-large-history",
            name: "large-result",
            output: "x".repeat(65_536),
            status: "completed",
            messageId: "assistant-history",
          },
        ],
        widgets: [
          {
            messageId: "assistant-history",
            widget: {
              id: "tool-history:chat-ui",
              kind: "test.action",
              data: {
                toolCallId: "tool-history",
                toolName: "create-release",
                raw: "do not persist widget payloads",
              },
              title: "Release created",
              metadata: { description: "Created one release." },
              actions: [{ id: "raw-action", label: "Discard" }],
            },
          },
          {
            messageId: "assistant-pending",
            widget: {
              id: "pending:chat-ui",
              kind: "test.action",
              data: { toolCallId: "pending", toolName: "create-release" },
            },
          },
        ],
        events: [
          {
            id: "history-1",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 1,
            occurredAt: "2026-09-26T00:00:01.000Z",
            type: "run.started",
          },
          {
            id: "history-2",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 2,
            occurredAt: "2026-09-26T00:00:02.000Z",
            type: "activity.started",
            activity: {
              id: "activity-history",
              kind: "tool",
              label: "Create release",
              status: "running",
            },
          },
          {
            id: "history-3",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 3,
            occurredAt: "2026-09-26T00:00:03.000Z",
            type: "activity.completed",
            activity: {
              id: "activity-history",
              kind: "tool",
              label: "Create release",
              detail: "A long action result",
              status: "completed",
            },
          },
          {
            id: "history-4",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 4,
            occurredAt: "2026-09-26T00:00:04.000Z",
            type: "message.completed",
            message: {
              id: "assistant-history",
              role: "assistant",
              parts: [{ type: "text", text: "Release created." }],
              status: "complete",
            },
          },
          {
            id: "history-5",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 5,
            occurredAt: "2026-09-26T00:00:05.000Z",
            type: "tool.updated",
            toolCall: {
              id: "tool-history",
              name: "create-release",
              output: "Do not persist this duplicate result",
              status: "completed",
            },
          },
          {
            id: "history-6",
            threadId: "thread-history",
            runId: "run-history",
            sequence: 6,
            occurredAt: "2026-09-26T00:00:06.000Z",
            type: "run.completed",
          },
          {
            id: "history-error",
            threadId: "thread-history",
            runId: "run-error",
            sequence: 1,
            occurredAt: "2026-09-26T00:00:07.000Z",
            type: "run.failed",
            error: {
              code: "provider_error",
              message: "Provider failed. ".repeat(200),
              retryable: false,
              correlationId: "provider-trace-1",
              details: { secret: "do not persist error details" },
              metadata: { private: "do not persist error metadata" },
            },
          },
        ],
        runs: [
          {
            id: "run-history",
            threadId: "thread-history",
            status: "completed",
            lastSequence: 6,
            startedAt: "2026-09-26T00:00:01.000Z",
            completedAt: "2026-09-26T00:00:06.000Z",
          },
          {
            id: "run-error",
            threadId: "thread-history",
            status: "failed",
            lastSequence: 1,
            error: {
              code: "provider_error",
              message: "Provider failed. ".repeat(200),
              retryable: false,
              correlationId: "provider-trace-1",
              details: { secret: "do not persist error details" },
              metadata: { private: "do not persist error metadata" },
            },
          },
        ],
        activeRunIds: [],
        suggestions: [
          { id: "release-summary", label: "Summarize this release" },
        ],
        annotations: [
          {
            messageId: "assistant-history",
            annotation: {
              id: "annotation-history",
              kind: "source",
              label: "Release notes",
              url: "https://docs.example.test/release",
              start: 0,
              end: 15,
              metadata: { private: "do not persist annotation metadata" },
            },
          },
          {
            messageId: "missing-message",
            annotation: {
              id: "annotation-orphan",
              kind: "reference",
              label: "Orphan",
            },
          },
        ],
      },
    });

    const restored = await transport.getThreadSnapshot?.({
      threadId: "thread-history",
    });
    const saved = JSON.parse(threadData);

    expect(saved.messages).toEqual(repository.messages);
    expect(saved.retained).toBe(true);
    expect(saved.queuedMessages).toBeUndefined();
    expect(saved.agentKit.messages).toEqual([
      {
        id: "user-approval",
        role: "user",
        parts: [
          {
            type: "file",
            name: "durable-upload.txt",
            fileId: "upload-1",
          },
          {
            type: "file",
            name: "remote.txt",
            url: "https://files.example.test/remote.txt",
          },
        ],
        metadata: { hideUserMessage: true },
      },
      {
        id: "assistant-history",
        role: "assistant",
        parts: [{ type: "text", text: "Release created." }],
      },
    ]);
    expect(JSON.stringify(saved.agentKit.messages)).not.toContain(
      "do not persist raw data",
    );
    expect(JSON.stringify(saved.agentKit.messages)).not.toContain("c2VjcmV0");
    expect(JSON.stringify(saved.agentKit.messages)).not.toContain(
      "do not persist this metadata",
    );
    expect(saved.agentKit.annotations).toEqual([
      {
        messageId: "assistant-history",
        annotation: {
          id: "annotation-history",
          kind: "source",
          label: "Release notes",
          url: "https://docs.example.test/release",
          start: 0,
          end: 15,
        },
      },
    ]);
    expect(saved.agentKit.widgets).toEqual([
      {
        messageId: "assistant-history",
        widget: {
          id: "tool-history:chat-ui",
          kind: "test.action",
          data: { toolCallId: "tool-history", toolName: "create-release" },
          title: "Release created",
          metadata: { description: "Created one release." },
        },
      },
    ]);
    expect(JSON.stringify(saved.agentKit.widgets)).not.toContain(
      "do not persist widget payloads",
    );
    expect(saved.agentKit.toolCalls).toEqual([
      {
        id: "tool-history",
        name: "create-release",
        status: "completed",
        input: { release: "agentkit-acceptance" },
        output: { display: { title: "Release created" } },
        messageId: "assistant-history",
      },
      {
        id: "tool-string-history",
        name: "string-result",
        status: "completed",
        input: {},
        output: '{"value":1}',
      },
      {
        id: "tool-large-history",
        name: "large-result",
        status: "completed",
        messageId: "assistant-history",
        metadata: {
          agentKitSnapshot: {
            toolCallResult: "omitted",
            reason: "size_limit",
          },
        },
      },
    ]);
    expect(
      saved.agentKit.events.map((event: AgentEvent) => event.type),
    ).toEqual([
      "run.started",
      "activity.started",
      "activity.completed",
      "message.completed",
      "run.completed",
      "run.failed",
    ]);
    expect(saved.agentKit.events[2].activity.detail).toBeUndefined();
    expect(saved.agentKit.events.at(-1).error).toMatchObject({
      code: "provider_error",
      retryable: false,
      correlationId: "provider-trace-1",
    });
    expect(saved.agentKit.events.at(-1).error.message).toHaveLength(2_048);
    expect(Object.keys(saved.agentKit.events.at(-1).error).sort()).toEqual([
      "code",
      "correlationId",
      "message",
      "retryable",
    ]);
    expect(
      saved.agentKit.runs.find((run: { id: string }) => run.id === "run-error")
        ?.error,
    ).toEqual(saved.agentKit.events.at(-1).error);
    expect(JSON.stringify(saved.agentKit)).not.toContain(
      "do not persist error details",
    );
    expect(JSON.stringify(saved.agentKit)).not.toContain(
      "do not persist error metadata",
    );
    expect(restored?.events?.map((event) => event.type)).toEqual([
      "run.started",
      "activity.started",
      "activity.completed",
      "message.completed",
      "run.completed",
      "run.failed",
    ]);
    expect(restored?.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "run-history", status: "completed" }),
        expect.objectContaining({
          id: "run-error",
          status: "failed",
          error: saved.agentKit.events.at(-1).error,
        }),
      ]),
    );
    expect(restored?.messages).toEqual([
      {
        id: "user-approval",
        role: "user",
        parts: [
          {
            type: "file",
            name: "durable-upload.txt",
            fileId: "upload-1",
          },
          {
            type: "file",
            name: "remote.txt",
            url: "https://files.example.test/remote.txt",
          },
        ],
        metadata: { hideUserMessage: true },
      },
      {
        id: "assistant-history",
        role: "assistant",
        parts: [{ type: "text", text: "Release created." }],
      },
    ]);
    expect(restored?.annotations).toEqual(saved.agentKit.annotations);
    expect(restored?.widgets).toEqual([
      {
        messageId: "assistant-history",
        widget: {
          id: "tool-history:chat-ui",
          kind: "test.action",
          data: { toolCallId: "tool-history", toolName: "create-release" },
          title: "Release created",
          metadata: { description: "Created one release." },
        },
      },
    ]);
    expect(restored?.toolCalls).toEqual([
      {
        id: "tool-history",
        name: "create-release",
        status: "completed",
        input: { release: "agentkit-acceptance" },
        output: { display: { title: "Release created" } },
        messageId: "assistant-history",
      },
      {
        id: "tool-string-history",
        name: "string-result",
        status: "completed",
        input: {},
        output: '{"value":1}',
      },
      {
        id: "tool-large-history",
        name: "large-result",
        status: "completed",
        messageId: "assistant-history",
        metadata: {
          agentKitSnapshot: {
            toolCallResult: "omitted",
            reason: "size_limit",
          },
        },
      },
    ]);
    expect(restored?.suggestions).toEqual([
      { id: "release-summary", label: "Summarize this release" },
    ]);
    expect(saved.agentKit.suggestions).toEqual([
      { id: "release-summary", label: "Summarize this release" },
    ]);
  });

  it("rejects non-JSON tool results instead of hiding snapshot data loss", async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: "thread-non-json",
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:01:00.000Z",
        threadData: JSON.stringify({}),
      }),
    );
    const transport = createAgentNativeAgentKitTransport({
      fetch: fetcher as typeof fetch,
    });
    const output: { self?: unknown } = {};
    output.self = output;

    await expect(
      transport.persistThreadSnapshot?.({
        threadId: "thread-non-json",
        snapshot: {
          id: "thread-non-json",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          messages: [],
          toolCalls: [
            {
              id: "tool-circular",
              name: "circular-result",
              output,
              status: "completed",
            },
          ],
        },
      }),
    ).rejects.toThrow(/circular|cyclic/i);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("restores the complete durable reply when a same-id AgentKit snapshot is shorter", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({
              id: "thread-short-reply",
              threadData: JSON.stringify({
                messages: [
                  {
                    message: {
                      id: "assistant-1",
                      role: "assistant",
                      status: "complete",
                      content: [
                        { type: "text", text: "Full answer with final lines" },
                      ],
                    },
                  },
                ],
                agentKit: {
                  messages: [
                    {
                      id: "assistant-1",
                      role: "assistant",
                      status: "complete",
                      parts: [{ type: "text", text: "Full answer" }],
                    },
                  ],
                },
              }),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-short-reply",
    });

    expect(snapshot?.messages).toMatchObject([
      {
        id: "assistant-1",
        parts: [{ type: "text", text: "Full answer with final lines" }],
      },
    ]);
    await transport.dispose();
  });

  it("restores the durable reply by run ID when message IDs differ and events are absent", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({
              id: "thread-different-ids",
              threadData: JSON.stringify({
                messages: [
                  {
                    message: {
                      id: "server-run-1",
                      role: "assistant",
                      status: "complete",
                      content: [
                        { type: "text", text: "Full answer with final lines" },
                      ],
                      metadata: { runId: "run-1" },
                    },
                  },
                ],
                agentKit: {
                  messages: [
                    {
                      id: "message-1",
                      role: "assistant",
                      status: "complete",
                      parts: [{ type: "text", text: "Full answer" }],
                      metadata: { runId: "run-1" },
                    },
                  ],
                },
              }),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-different-ids",
    });

    expect(snapshot?.messages).toMatchObject([
      {
        id: "message-1",
        parts: [{ type: "text", text: "Full answer with final lines" }],
      },
    ]);
    await transport.dispose();
  });

  // The shape of a thread whose page was reloaded mid-run: the page saved
  // its snapshot with only the prompt, and the server then finished the run.
  function reloadedMidRunThread(agentKitMessages: unknown[]) {
    return {
      id: "thread-reloaded",
      threadData: JSON.stringify({
        messages: [
          {
            message: {
              id: "user-1",
              role: "user",
              status: "complete",
              content: [{ type: "text", text: "Write forty lines" }],
            },
            parentId: null,
          },
          {
            message: {
              id: "server-run-1",
              role: "assistant",
              status: { type: "complete", reason: "stop" },
              content: [{ type: "text", text: "L1: one\nL40: forty" }],
              metadata: {
                runId: "run-1",
                custom: { turnId: "turn-1", foldedRunIds: ["run-1"] },
              },
            },
            parentId: "user-1",
          },
        ],
        agentKit: {
          messages: agentKitMessages,
          events: [],
          runs: [
            {
              id: "run-1",
              threadId: "thread-reloaded",
              status: "completed",
              startedAt: "2026-10-01T23:54:23.807Z",
              lastSequence: 0,
            },
          ],
          activeRunIds: [],
        },
      }),
    };
  }
  const reloadedPrompt = {
    id: "user-1",
    role: "user",
    status: "complete",
    parts: [{ type: "text", text: "Write forty lines" }],
  };

  it("restores a finished run's reply the reloaded page never saved into the AgentKit snapshot", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: true, status: "completed", runId: "run-1" })
          : json(reloadedMidRunThread([reloadedPrompt])),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-reloaded",
    });

    expect(snapshot?.messages).toMatchObject([
      { id: "user-1", role: "user" },
      {
        id: "server-run-1",
        role: "assistant",
        parts: [{ type: "text", text: "L1: one\nL40: forty" }],
      },
    ]);
    expect(snapshot?.activeRunIds ?? []).toEqual([]);
    await transport.dispose();
  });

  // A continuation run folds into the first run's durable reply. The page saw
  // the first run, then reloaded before the continuation finished.
  function foldedContinuationThread(options: {
    snapshotSawContinuation: boolean;
    endsWithToolPart?: boolean;
  }) {
    const assistantEvent = (runId: string, id: string) => ({
      id: `event-${runId}`,
      type: "message.created",
      threadId: "thread-folded",
      runId,
      sequence: 1,
      occurredAt: "2026-10-01T23:54:00.000Z",
      message: { id, role: "assistant", parts: [] },
    });
    return {
      id: "thread-folded",
      threadData: JSON.stringify({
        messages: [
          {
            message: {
              id: "user-1",
              role: "user",
              status: "complete",
              content: [{ type: "text", text: "Write forty lines" }],
            },
            parentId: null,
          },
          {
            message: {
              id: "server-run-2",
              role: "assistant",
              status: { type: "complete", reason: "stop" },
              content: [{ type: "text", text: "First half. Second half." }],
              metadata: {
                runId: "run-2",
                custom: { foldedRunIds: ["run-1", "run-2"] },
              },
            },
            parentId: "user-1",
          },
        ],
        agentKit: {
          messages: [
            reloadedPrompt,
            {
              id: "message-1",
              role: "assistant",
              status: "complete",
              parts: [
                { type: "text", text: "First half." },
                ...(options.endsWithToolPart
                  ? [{ type: "data", data: { toolCallId: "tool-1" } }]
                  : []),
              ],
            },
            ...(options.snapshotSawContinuation
              ? [
                  {
                    id: "message-2",
                    role: "assistant",
                    status: "complete",
                    parts: [{ type: "text", text: " Second half." }],
                  },
                ]
              : []),
          ],
          events: [
            assistantEvent("run-1", "message-1"),
            ...(options.snapshotSawContinuation
              ? [assistantEvent("run-2", "message-2")]
              : []),
          ],
          runs: ["run-1", "run-2"].map((id) => ({
            id,
            threadId: "thread-folded",
            status: "completed",
            startedAt: "2026-10-01T23:54:00.000Z",
            lastSequence: 0,
          })),
          activeRunIds: [],
        },
      }),
    };
  }

  it("completes the first run's reply with a continuation the reloaded page never saw", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json(foldedContinuationThread({ snapshotSawContinuation: false })),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(snapshot?.messages).toMatchObject([
      { id: "user-1", role: "user" },
      {
        id: "message-1",
        parts: [{ type: "text", text: "First half. Second half." }],
      },
    ]);
    await transport.dispose();
  });

  it("appends the continuation after a tool part the reloaded page already saved", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json(
              foldedContinuationThread({
                snapshotSawContinuation: false,
                endsWithToolPart: true,
              }),
            ),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(snapshot?.messages[1]?.parts).toMatchObject([
      { type: "text", text: "First half." },
      { type: "data" },
      { type: "text", text: " Second half." },
    ]);
    await transport.dispose();
  });

  it("adds only the missing continuation when the page saw some but not all folded runs", async () => {
    const thread = foldedContinuationThread({ snapshotSawContinuation: true });
    const data = JSON.parse(thread.threadData);
    data.messages[1].message.content = [
      { type: "text", text: "First half. Second half. Third half." },
    ];
    data.messages[1].message.metadata = {
      runId: "run-3",
      custom: { foldedRunIds: ["run-1", "run-2", "run-3"] },
    };
    data.agentKit.runs.push({
      id: "run-3",
      threadId: "thread-folded",
      status: "completed",
      startedAt: "2026-10-01T23:54:00.000Z",
      lastSequence: 0,
    });
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({ ...thread, threadData: JSON.stringify(data) }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(
      snapshot?.messages.map((message) => [
        message.id,
        message.parts.map((part) => (part.type === "text" ? part.text : "")),
      ]),
    ).toEqual([
      ["user-1", ["Write forty lines"]],
      ["message-1", ["First half."]],
      ["message-2", [" Second half. Third half."]],
    ]);
    await transport.dispose();
  });

  it("completes a partly streamed terminal continuation from the whole folded reply", async () => {
    const thread = foldedContinuationThread({ snapshotSawContinuation: true });
    const data = JSON.parse(thread.threadData);
    data.agentKit.messages[2].parts = [{ type: "text", text: " Second" }];
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({ ...thread, threadData: JSON.stringify(data) }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(
      snapshot?.messages.map((message) => [
        message.id,
        message.parts.map((part) => (part.type === "text" ? part.text : "")),
      ]),
    ).toEqual([
      ["user-1", ["Write forty lines"]],
      ["message-1", ["First half."]],
      ["message-2", [" Second half."]],
    ]);
    await transport.dispose();
  });

  it("keeps separate messages for continuation runs the page did watch", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json(foldedContinuationThread({ snapshotSawContinuation: true })),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-folded",
    });

    expect(
      snapshot?.messages.map((message) => [
        message.id,
        message.parts.map((part) => (part.type === "text" ? part.text : "")),
      ]),
    ).toEqual([
      ["user-1", ["Write forty lines"]],
      ["message-1", ["First half."]],
      ["message-2", [" Second half."]],
    ]);
    await transport.dispose();
  });

  it("does not replace unrelated or reordered AgentKit content with durable text", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/runs/active")
          ? json({ active: false, status: "complete" })
          : json({
              id: "thread-other-reply",
              threadData: JSON.stringify({
                messages: [
                  {
                    message: {
                      id: "server-other-run",
                      role: "assistant",
                      content: [{ type: "text", text: "Different answer" }],
                      metadata: { runId: "other-run" },
                    },
                  },
                  {
                    message: {
                      id: "message-1",
                      role: "assistant",
                      content: [{ type: "text", text: "Rewritten answer" }],
                    },
                  },
                  {
                    message: {
                      id: "message-2",
                      role: "assistant",
                      content: [
                        { type: "text", text: "Before tool with suffix" },
                      ],
                    },
                  },
                ],
                agentKit: {
                  messages: [
                    {
                      id: "message-1",
                      role: "assistant",
                      parts: [{ type: "text", text: "Original answer" }],
                    },
                    {
                      id: "message-2",
                      role: "assistant",
                      parts: [
                        { type: "text", text: "Before tool" },
                        {
                          type: "data",
                          mediaType: "application/json",
                          data: { tool: "done" },
                        },
                      ],
                    },
                  ],
                },
              }),
            }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-other-reply",
    });

    expect(snapshot?.messages).toMatchObject([
      { id: "message-1", parts: [{ type: "text", text: "Original answer" }] },
      {
        id: "message-2",
        parts: [
          { type: "text", text: "Before tool" },
          {
            type: "data",
            mediaType: "application/json",
            data: { tool: "done" },
          },
        ],
      },
    ]);
    await transport.dispose();
  });

  it("restores failed action calls without success widgets", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-failed-widget",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-1",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-failed",
                    toolName: "manage-draft",
                    args: { action: "create" },
                    result: "Error creating draft",
                    isError: true,
                    chatUI: { renderer: "mail.draft-created" },
                  },
                ],
              },
            ],
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-failed-widget",
    });

    expect(snapshot?.toolCalls).toMatchObject([
      { id: "tool-failed", status: "failed", messageId: "assistant-1" },
    ]);
    expect(snapshot?.widgets).toEqual([]);
  });

  it("keeps legacy chatUI widgets paired with parents missing from AgentKit history", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-divergent-history",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-later",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-later",
                    toolName: "create-release",
                    args: { release: "agentkit-acceptance" },
                    result: { created: true },
                    chatUI: { renderer: "test.action" },
                  },
                ],
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "assistant-earlier",
                  role: "assistant",
                  parts: [{ type: "text", text: "Earlier response." }],
                },
              ],
            },
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-divergent-history",
    });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "assistant-earlier",
      "assistant-later",
    ]);
    expect(snapshot?.messages[1]).toMatchObject({
      id: "assistant-later",
      role: "assistant",
      parts: [],
    });
    expect(snapshot?.widgets).toEqual([
      {
        messageId: "assistant-later",
        widget: {
          id: "tool-later:chat-ui",
          kind: "test.action",
          data: { toolCallId: "tool-later", toolName: "create-release" },
        },
      },
    ]);
  });

  it("does not duplicate a legacy widget already embedded in AgentKit history", async () => {
    const widget = {
      id: "tool-shared:chat-ui",
      kind: "test.action",
      data: { toolCallId: "tool-shared", toolName: "create-release" },
    };
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-embedded-widget",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-legacy",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-shared",
                    toolName: "create-release",
                    args: { release: "agentkit-acceptance" },
                    result: { created: true },
                    chatUI: { renderer: "test.action" },
                  },
                ],
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "assistant-canonical",
                  role: "assistant",
                  parts: [
                    { type: "text", text: "Release created." },
                    { type: "widget", widget },
                  ],
                },
              ],
            },
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-embedded-widget",
    });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "assistant-canonical",
    ]);
    expect(snapshot?.messages[0]?.parts).toContainEqual({
      type: "widget",
      widget,
    });
    expect(snapshot?.widgets).toEqual([]);
    expect(snapshot?.toolCalls).toMatchObject([
      { id: "tool-shared", output: { created: true } },
    ]);
  });

  it("attaches a legacy widget to its canonical tool message after reload", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({
          id: "thread-canonical-tool-message",
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:01:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "assistant-legacy",
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "tool-shared",
                    toolName: "create-release",
                    args: { release: "agentkit-acceptance" },
                    result: { created: true },
                    chatUI: { renderer: "test.action" },
                  },
                ],
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "assistant-canonical",
                  role: "assistant",
                  parts: [{ type: "text", text: "Release created." }],
                },
              ],
              toolCalls: [
                {
                  id: "tool-shared",
                  name: "create-release",
                  status: "completed",
                  messageId: "assistant-canonical",
                  output: { created: true },
                },
              ],
            },
          }),
        }),
      ) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-canonical-tool-message",
    });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "assistant-canonical",
    ]);
    expect(snapshot?.widgets).toEqual([
      {
        messageId: "assistant-canonical",
        widget: {
          id: "tool-shared:chat-ui",
          kind: "test.action",
          data: { toolCallId: "tool-shared", toolName: "create-release" },
        },
      },
    ]);
  });

  it("loads durable history and promotes queued work into a real stream", async () => {
    const queueWrites: unknown[] = [];
    let queuedMessages = [
      {
        id: "queued-1",
        text: "Continue after approval",
        createdAt: "2026-08-29T00:02:00.000Z",
      },
    ];
    let activeRunChecks = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/runs/active?threadId=thread-1")) {
          activeRunChecks += 1;
          return json({ active: false, status: "complete" });
        }
        if (url.endsWith("/threads/thread-1") && !init?.method) {
          return json({
            id: "thread-1",
            title: "Release review",
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:01:00.000Z",
            threadData: JSON.stringify({
              messages: [
                {
                  id: "user-1",
                  role: "user",
                  content: [{ type: "text", text: "Review the release" }],
                },
              ],
              queuedMessages,
            }),
          });
        }
        if (url.endsWith("/threads/thread-1/queued")) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          queueWrites.push(mutation);
          const index = queuedMessages.findIndex(
            (message) => message.id === mutation.messageId,
          );
          const removedMessage = queuedMessages[index];
          queuedMessages = queuedMessages.filter(
            (message) => message.id !== mutation.messageId,
          );
          return json({ queuedMessages, removedMessage, index });
        }
        if (url.endsWith("/_agent-native/agent-chat")) {
          const stream = [
            { type: "text", text: "Release continued." },
            {
              type: "suggestions",
              suggestions: [
                {
                  id: "review-release",
                  label: "Review release",
                  prompt: "Review the release in detail.",
                },
              ],
            },
            { type: "done" },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("");
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream",
              "x-run-id": "run-2",
            },
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      adapter: {
        now: () => "2026-08-29T00:03:00.000Z",
      },
    });

    const thread = await transport.getThreadSnapshot?.({
      threadId: "thread-1",
    });
    expect(thread).toMatchObject({
      title: "Release review",
      messages: [{ id: "user-1", role: "user" }],
      queuedMessages: [{ id: "queued-1", text: "Continue after approval" }],
    });

    const promoted = await transport.steerQueuedMessage?.({
      threadId: "thread-1",
      messageId: "queued-1",
    });
    expect(promoted).toMatchObject({
      runId: "run-2",
      capabilities: {
        feedback: true,
        messageQueue: true,
        suggestions: true,
        threadForking: true,
        threadHistory: true,
      },
    });
    expect(transport.capabilities?.suggestions).toBe(true);
    const events: AgentEvent[] = [];
    if (promoted) {
      for await (const event of transport.subscribeToRun({
        threadId: "thread-1",
        runId: promoted.runId,
      })) {
        events.push(event);
      }
    }

    expect(queueWrites).toEqual([{ type: "claim", messageId: "queued-1" }]);
    expect(activeRunChecks).toBe(3);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.status",
      "message.created",
      "message.delta",
      "suggestions.updated",
      "message.completed",
      "run.status",
      "run.completed",
    ]);
    expect(runStateMocks.dispatchAgentChatRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        isRunning: true,
        phase: "responding",
        threadId: "thread-1",
        tabId: "thread-1",
        runId: "run-2",
        turnId: expect.any(String),
        reason: "response_started",
      }),
    );
    expect(runStateMocks.dispatchAgentChatRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        isRunning: false,
        phase: "idle",
        threadId: "thread-1",
        tabId: "thread-1",
        runId: "run-2",
        turnId: expect.any(String),
        reason: "run.completed",
      }),
    );
    expect(
      events.find((event) => event.type === "suggestions.updated"),
    ).toMatchObject({
      suggestions: [
        {
          id: "review-release",
          label: "Review release",
          prompt: "Review the release in detail.",
        },
      ],
    });
  });

  it("persists a queue reorder as an atomic message mutation", async () => {
    const queueWrites: unknown[] = [];
    let queuedMessages = [
      {
        id: "queued-one",
        text: "First",
        createdAt: "2026-08-29T00:00:00.000Z",
      },
      {
        id: "queued-two",
        text: "Second",
        createdAt: "2026-08-29T00:00:01.000Z",
      },
      {
        id: "queued-three",
        text: "Third",
        createdAt: "2026-08-29T00:00:02.000Z",
      },
    ];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/threads/thread-queue") && !init?.method) {
          return json({
            id: "thread-queue",
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
            threadData: JSON.stringify({
              messages: [],
              queuedMessages,
            }),
          });
        }
        if (url.endsWith("/threads/thread-queue/queued")) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          queueWrites.push(mutation);
          const index = queuedMessages.findIndex(
            (message) => message.id === mutation.messageId,
          );
          if (index > 0) {
            queuedMessages = [
              queuedMessages[index]!,
              ...queuedMessages.filter(
                (message) => message.id !== mutation.messageId,
              ),
            ];
          }
          return json({ queuedMessages });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.listQueuedMessages?.({ threadId: "thread-queue" });
    await transport.moveQueuedMessageToTop?.({
      threadId: "thread-queue",
      messageId: "queued-three",
    });

    expect(queueWrites).toEqual([
      { type: "moveToTop", messageId: "queued-three" },
    ]);
    await transport.dispose();
  });

  it("preserves completed side effects through the real AgentKit transport", async () => {
    const fetcher = vi.fn(async () => {
      const stream = [
        { type: "tool_start", id: "tool-1", tool: "update-slide", input: {} },
        {
          type: "tool_done",
          id: "tool-1",
          tool: "update-slide",
          result: "Updated slide 1",
          completedSideEffect: true,
        },
        { type: "done" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "run-side-effect",
        },
      });
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Update slide 1" }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === "tool.updated")).toMatchObject(
      {
        type: "tool.updated",
        metadata: { completedSideEffect: true },
        toolCall: { metadata: { completedSideEffect: true } },
      },
    );
    await transport.dispose();
  });

  it("preserves structured tool metadata through the runtime and protocol", async () => {
    const fetcher = vi.fn(async () => {
      const stream = [
        {
          type: "tool_start",
          id: "tool-edit",
          tool: "update-file",
          input: { path: "src/app.ts" },
          structuredMeta: { toolKind: "edit", filePath: "src/app.ts" },
        },
        {
          type: "tool_done",
          id: "tool-edit",
          tool: "update-file",
          result: "Updated src/app.ts",
          structuredMeta: {
            toolKind: "edit",
            filePath: "src/app.ts",
            diff: "-old\n+new",
          },
        },
        { type: "done" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "run-tool-meta",
        },
      });
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Update src/app.ts" }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === "tool.updated")).toMatchObject(
      {
        type: "tool.updated",
        metadata: {
          toolKind: "edit",
          filePath: "src/app.ts",
          diff: "-old\n+new",
        },
        toolCall: {
          metadata: {
            toolKind: "edit",
            filePath: "src/app.ts",
            diff: "-old\n+new",
          },
        },
      },
    );
    await transport.dispose();
  });

  it("shows the missing-final-response notice for a completed tool-only turn", async () => {
    const fetcher = vi.fn(async () => {
      const stream = [
        { type: "tool_start", id: "tool-1", tool: "update-slide", input: {} },
        {
          type: "tool_done",
          id: "tool-1",
          tool: "update-slide",
          result: "Updated slide 1",
          completedSideEffect: true,
        },
        { type: "done" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "run-no-final",
        },
      });
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Update slide 1" }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(
      events.find((event) => event.type === "message.completed"),
    ).toMatchObject({
      type: "message.completed",
      message: {
        metadata: {
          custom: {
            runWarning: {
              errorCode: "final_response_missing_after_tool",
              recoverable: true,
            },
          },
        },
        parts: [
          {
            type: "text",
            text: expect.stringContaining(
              "stopped before sending a final message",
            ),
          },
        ],
      },
    });
    await transport.dispose();
  });

  it("preserves the loop-limit error and iteration detail", async () => {
    const fetcher = vi.fn(async () => {
      const stream = [
        { type: "text", text: "I am still working." },
        { type: "loop_limit", maxIterations: 25 },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "x-run-id": "run-loop-limit",
        },
      });
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "Work" }] },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      error: {
        code: "loop_limit",
        retryable: false,
        details: { maxIterations: 25 },
      },
    });
    await transport.dispose();
  });

  it("preserves thread-load authentication errors as typed failures", async () => {
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: vi.fn(async () =>
        json(
          {
            statusMessage: "Your session has expired.",
            data: {
              code: "session_expired",
              details: { loginUrl: "/login" },
            },
          },
          401,
        ),
      ) as typeof fetch,
    });

    await expect(
      transport.getThreadSnapshot?.({ threadId: "thread-expired" }),
    ).rejects.toMatchObject({
      message: "Your session has expired.",
      code: "session_expired",
      status: 401,
      retryable: false,
      details: { loginUrl: "/login" },
    });
    await transport.dispose();
  });

  it("restores an active server run into a fresh transport and resumes its stream", async () => {
    const requestUrls: string[] = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requestUrls.push(url);
        if (url.endsWith("/threads/thread-resume") && !init?.method) {
          return json({
            id: "thread-resume",
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    id: "server-user-run-durable",
                    role: "user",
                    content: [{ type: "text", text: "Continue the report" }],
                    metadata: { custom: { submittedRunId: "run-durable" } },
                  },
                },
              ],
              agentKit: { messages: [] },
            }),
          });
        }
        if (
          url.includes("/runs/latest?threadId=thread-resume&runId=run-durable")
        ) {
          return json({
            runId: "run-durable",
            threadId: "thread-resume",
            turnId: "turn-resume",
            startedAt: Date.now(),
            status: "running",
            dispatchMode: "background-processing",
            terminalReason: null,
          });
        }
        if (url.includes("/runs/active?threadId=thread-resume")) {
          return json({
            active: true,
            status: "running",
            runId: "run-durable",
          });
        }
        if (url.endsWith("/runs/run-durable/events?after=0")) {
          const stream = [
            { type: "text", text: "Recovered response", seq: 1 },
            { type: "done", seq: 2 },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("");
          return new Response(stream, {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      runtime: createAgentNativeChatRuntime({
        apiUrl: "/_agent-native/agent-chat",
        fetch: fetcher as typeof fetch,
      }),
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-resume",
    });
    expect(snapshot?.activeRunIds).toContain("run-durable");
    expect(snapshot?.messages).toMatchObject([
      {
        id: "server-user-run-durable",
        role: "user",
        parts: [{ type: "text", text: "Continue the report" }],
      },
    ]);
    expect(transport.capabilities?.resumableRuns).toBe(true);

    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-resume",
      runId: "run-durable",
    })) {
      events.push(event);
    }

    expect(requestUrls).toContain(
      "/_agent-native/agent-chat/runs/run-durable/events?after=0",
    );
    expect(events[0]?.type).toBe("run.started");
    expect(
      events.find((event) => event.type === "message.completed"),
    ).toMatchObject({
      type: "message.completed",
      message: {
        parts: [{ type: "text", text: "Recovered response" }],
      },
    });
    expect(events.at(-1)?.type).toBe("run.completed");
    await transport.dispose();
  });

  it.each([
    {
      case: "attributed",
      messageStatus: "streaming",
      messageRunId: "run-replay",
    },
    {
      case: "attributed",
      messageStatus: "complete",
      messageRunId: "run-replay",
    },
    {
      case: "unattributed",
      messageStatus: "streaming",
      messageRunId: undefined,
    },
  ] as const)(
    "rebuilds a $messageStatus assistant once during $case active replay",
    async ({ messageStatus, messageRunId }) => {
      const threadId = "thread-partial-assistant-replay";
      const requestUrls: string[] = [];
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestUrls.push(url);
        if (url.endsWith(`/threads/${threadId}`)) {
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: {
                messages: [
                  {
                    id:
                      messageStatus === "complete"
                        ? "server-run-replay"
                        : "assistant-partial",
                    role: "assistant",
                    status: messageStatus,
                    parts: [{ type: "text", text: "Slow stream" }],
                    ...(messageRunId
                      ? { metadata: { runId: messageRunId } }
                      : {}),
                  },
                ],
              },
            }),
          });
        }
        if (url.includes(`/runs/active?threadId=${threadId}`)) {
          return json({ active: true, status: "running", runId: "run-replay" });
        }
        if (url.includes("/runs/latest?") && url.includes("runId=run-replay")) {
          return json({
            runId: "run-replay",
            turnId: "turn-replay",
            status: "running",
          });
        }
        if (url.endsWith("/runs/run-replay/events?after=0")) {
          const stream = [
            { type: "text", text: "Slow stream", seq: 1 },
            { type: "text", text: " resumed after reload.", seq: 2 },
            { type: "done", seq: 3 },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("");
          return new Response(stream, {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return json({ error: "Not found" }, 404);
      }) as typeof fetch;
      const transport = createAgentNativeAgentKitTransport({
        apiUrl: "/_agent-native/agent-chat",
        fetch: fetcher,
        runtime: createAgentNativeChatRuntime({
          apiUrl: "/_agent-native/agent-chat",
          fetch: fetcher,
        }),
      });
      const client = new AgentKitClient({ transport });

      await client.loadThread(threadId);
      await vi.waitFor(() =>
        expect(client.getThread(threadId).runs["run-replay"]?.status).toBe(
          "completed",
        ),
      );
      expect(client.getThread(threadId).runs["run-replay"]).toMatchObject({
        status: "completed",
      });

      expect(requestUrls).toContain(
        "/_agent-native/agent-chat/runs/run-replay/events?after=0",
      );
      const assistantMessages = client
        .getThread(threadId)
        .messages.filter((message) => message.role === "assistant");
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]?.parts).toEqual([
        { type: "text", text: "Slow stream resumed after reload." },
      ]);

      await client.shutdown();
      await transport.dispose();
    },
  );

  it("keeps a prior assistant projection when another run replays from sequence zero", async () => {
    const threadId = "thread-prior-assistant-replay";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: true, status: "running", runId: "run-new" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-prior-assistant",
                  role: "assistant",
                  content: [{ type: "text", text: "Prior answer" }],
                  status: { type: "complete" },
                  metadata: { runId: "run-prior" },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-prior-assistant",
                  role: "assistant",
                  status: "streaming",
                  parts: [{ type: "text", text: "Prior answer" }],
                  metadata: { runId: "run-prior" },
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-prior-assistant",
    ]);
    await transport.dispose();
  });

  it("clears partial projections for paused runs replayed from sequence zero", async () => {
    for (const status of ["awaiting_approval", "awaiting_input"] as const) {
      const threadId = `thread-${status}-replay`;
      const runId = `run-${status}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({ active: true, status, runId });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: {
                messages: [
                  {
                    id: "assistant-partial",
                    role: "assistant",
                    status: "streaming",
                    parts: [
                      { type: "text", text: "Partial approval response" },
                    ],
                    metadata: { runId },
                  },
                ],
              },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.activeRunIds).toContain(runId);
      expect(snapshot?.messages.map((message) => message.id)).not.toContain(
        "assistant-partial",
      );
      await transport.dispose();
    }
  });

  it("preserves run_timeout failures without ending a pending redispatch", async () => {
    for (const awaitingRedispatch of [false, true]) {
      const threadId = `thread-timeout-${awaitingRedispatch}`;
      const runId = `run-timeout-${awaitingRedispatch}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({
              active: true,
              status: "completed",
              runId,
              terminalReason: "run_timeout",
              awaitingRedispatch,
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: awaitingRedispatch
                ? [
                    {
                      message: {
                        id: "assistant-continuation-chunk",
                        role: "assistant",
                        content: [{ type: "text", text: "Partial response" }],
                        status: { type: "complete" },
                        metadata: {
                          runId,
                          custom: {
                            continued: true,
                            foldedRunIds: [runId],
                          },
                        },
                      },
                    },
                  ]
                : [],
              agentKit: { messages: [] },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.runs?.find((run) => run.id === runId)?.status).toBe(
        awaitingRedispatch ? "running" : "failed",
      );
      if (awaitingRedispatch) {
        expect(snapshot?.activeRunIds).toContain(runId);
      } else {
        expect(
          snapshot?.runs?.find((run) => run.id === runId)?.error,
        ).toMatchObject({
          code: "run_timeout",
          retryable: true,
        });
        expect(snapshot?.activeRunIds).not.toContain(runId);
      }
      await transport.dispose();
    }
  });

  it.each(["loop_limit", "max_tokens", "stream_ended"] as const)(
    "restores legacy truncated run status for %s",
    async (terminalReason) => {
      const threadId = `thread-truncated-${terminalReason}`;
      const runId = `run-truncated-${terminalReason}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({
              active: true,
              status: "completed",
              runId,
              terminalReason,
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: { messages: [] },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.runs).toContainEqual(
        expect.objectContaining({
          id: runId,
          status: "failed",
          error: expect.objectContaining({ code: terminalReason }),
        }),
      );
      await transport.dispose();
    },
  );

  it("discovers active runs with the default Agent-Native runtime", async () => {
    const requestUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestUrls.push(url);
      if (url.endsWith("/threads/thread-default-runtime")) {
        return json({
          id: "thread-default-runtime",
          threadData: JSON.stringify({
            messages: [],
            agentKit: { messages: [] },
          }),
        });
      }
      if (url.includes("/runs/active?threadId=thread-default-runtime")) {
        return json({ active: true, status: "running", runId: "run-default" });
      }
      return json({ error: "Not found" }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      fetch: fetcher as typeof fetch,
      runtime: createAgentNativeChatRuntime({
        fetch: fetcher as typeof fetch,
      }),
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-default-runtime",
    });

    expect(requestUrls).toContain(
      "/_agent-native/agent-chat/runs/active?threadId=thread-default-runtime",
    );
    expect(snapshot?.activeRunIds).toContain("run-default");
    await transport.dispose();
  });

  it("does not discover server runs for a custom runtime", async () => {
    const requestUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestUrls.push(url);
      if (url.endsWith("/threads/thread-custom-runtime")) {
        return json({
          id: "thread-custom-runtime",
          threadData: JSON.stringify({
            messages: [],
            agentKit: { messages: [] },
          }),
        });
      }
      return json({ error: "Not found" }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      fetch: fetcher as typeof fetch,
      runtime: createHttpAgentChatRuntime({
        kind: "agent-native",
        endpoint: "/external-agent-chat",
        fetch: fetcher as typeof fetch,
      }),
    });

    await transport.getThreadSnapshot?.({
      threadId: "thread-custom-runtime",
    });

    expect(requestUrls.some((url) => url.includes("/runs/active"))).toBe(false);
    await transport.dispose();
  });

  it("restores completed turns from durable thread messages after the page was away", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({
            active: true,
            status: "completed",
            runId: "run-finished",
          });
        }
        return json({
          id: "thread-finished-while-away",
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-user-run-finished",
                  role: "user",
                  content: [{ type: "text", text: "Finish the report" }],
                  attachments: [
                    {
                      id: "attachment-report",
                      type: "file",
                      name: "report.pdf",
                      content: [
                        {
                          type: "file",
                          url: "https://files.example/report.pdf",
                          mimeType: "application/pdf",
                          filename: "report.pdf",
                        },
                      ],
                    },
                    {
                      id: "attachment-chart",
                      type: "image",
                      name: "chart.png",
                      content: [
                        {
                          type: "image",
                          image: "https://files.example/chart.png",
                          mimeType: "image/png",
                          filename: "chart.png",
                        },
                      ],
                    },
                  ],
                  metadata: { custom: { submittedRunId: "run-finished" } },
                },
              },
              {
                message: {
                  id: "server-assistant-run-finished",
                  role: "assistant",
                  content: [{ type: "text", text: "The report is finished." }],
                  metadata: { runId: "run-finished" },
                },
              },
            ],
            agentKit: { messages: [] },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-finished-while-away",
    });

    expect(snapshot?.messages).toMatchObject([
      {
        id: "server-user-run-finished",
        role: "user",
        parts: [
          { type: "text", text: "Finish the report" },
          {
            type: "file",
            name: "report.pdf",
            url: "https://files.example/report.pdf",
            mediaType: "application/pdf",
          },
          {
            type: "file",
            name: "chart.png",
            url: "https://files.example/chart.png",
            mediaType: "image/png",
          },
        ],
      },
      {
        id: "server-assistant-run-finished",
        role: "assistant",
        parts: [{ type: "text", text: "The report is finished." }],
      },
    ]);
    expect(snapshot?.runs).toContainEqual(
      expect.objectContaining({ id: "run-finished", status: "completed" }),
    );
    expect(snapshot?.activeRunIds).not.toContain("run-finished");
    await transport.dispose();
  });

  it("does not append a second copy of an attachment-bearing prompt", async () => {
    const threadId = "thread-attachment-prompt-reconcile";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-user-attachment-prompt",
                  role: "user",
                  createdAt: "2026-09-01T00:00:00.000Z",
                  content: [{ type: "text", text: "Read this report" }],
                  attachments: [
                    {
                      id: "server-attachment-1",
                      type: "file",
                      name: "report.pdf",
                      contentType: "application/pdf",
                      content: [
                        {
                          type: "file",
                          url: "https://files.example/report.pdf",
                          mimeType: "application/pdf",
                          filename: "report.pdf",
                        },
                      ],
                    },
                  ],
                  metadata: {
                    custom: { submittedRunId: "run-attachment-prompt" },
                  },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-user-attachment-prompt",
                  role: "user",
                  createdAt: "2026-09-01T00:00:00.000Z",
                  parts: [
                    { type: "text", text: "Read this report" },
                    {
                      type: "file",
                      name: "report.pdf",
                      url: "https://files.example/report.pdf",
                      mediaType: "application/pdf",
                    },
                  ],
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-user-attachment-prompt",
    ]);
    await transport.dispose();
  });

  it("keeps text-file attachment bodies out of the transcript projection", async () => {
    const threadId = "thread-text-attachment-projection";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-user-text-attachment",
                  role: "user",
                  content: [{ type: "text", text: "Review this file" }],
                  attachments: [
                    {
                      id: "server-attachment-text",
                      type: "file",
                      name: "notes.txt",
                      contentType: "text/plain",
                      content: [
                        {
                          type: "text",
                          text: '<attachment name="notes.txt">private body</attachment>',
                        },
                      ],
                    },
                  ],
                  metadata: {
                    custom: { submittedRunId: "run-text-attachment" },
                  },
                },
              },
            ],
            agentKit: { messages: [] },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages[0]?.parts).toEqual([
      { type: "text", text: "Review this file" },
      {
        type: "file",
        name: "notes.txt",
        fileId: "server-attachment-text",
        mediaType: "text/plain",
      },
    ]);
    expect(JSON.stringify(snapshot?.messages)).not.toContain("private body");
    await transport.dispose();
  });

  it.each([
    { userStopped: false, expectedStatus: "completed" },
    { userStopped: true, expectedStatus: "cancelled" },
  ] as const)(
    "restores a stale run as $expectedStatus when its durable reply is userStopped=$userStopped",
    async ({ userStopped, expectedStatus }) => {
      const threadId = "thread-stale-run";
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("/runs/active")) {
            return json({ active: false, status: "idle" });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    id: "durable-user-stale",
                    role: "user",
                    content: [{ type: "text", text: "Summarize this" }],
                    createdAt: "2026-09-01T00:00:00.000Z",
                    metadata: { custom: { submittedRunId: "run-stale" } },
                  },
                },
                {
                  message: {
                    id: "durable-assistant-stale",
                    role: "assistant",
                    content: [{ type: "text", text: "The summary." }],
                    createdAt: "2026-09-01T00:00:01.000Z",
                    status: { type: "complete" },
                    metadata: {
                      runId: "run-stale",
                      custom: { ...(userStopped ? { userStopped: true } : {}) },
                    },
                  },
                },
              ],
              agentKit: {
                messages: [],
                activeRunIds: ["run-stale"],
                runs: [
                  {
                    id: "run-stale",
                    threadId,
                    status: "running",
                    lastSequence: 1,
                  },
                ],
              },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.messages.map((message) => message.id)).toEqual([
        "durable-user-stale",
        "durable-assistant-stale",
      ]);
      expect(snapshot?.runs).toContainEqual(
        expect.objectContaining({ id: "run-stale", status: expectedStatus }),
      );
      expect(snapshot?.activeRunIds).not.toContain("run-stale");
      await transport.dispose();
    },
  );

  it.each([
    { status: "awaiting_approval", active: true },
    { status: "awaiting_input", active: true },
    { status: "failed", active: true },
    { status: "cancelled", active: true },
    { status: "awaiting_approval", active: false },
    { status: "awaiting_input", active: false },
  ] as const)(
    "preserves durable assistant run state $status when active=$active",
    async ({ status, active }) => {
      const threadId = `thread-durable-status-${status}-${active}`;
      const runId = `run-${status}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({
              active,
              status: active ? status : "idle",
              runId,
              ...(active && status === "failed"
                ? { terminalReason: "provider_unavailable" }
                : {}),
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [
                {
                  message: {
                    id: `assistant-${runId}`,
                    role: "assistant",
                    content: [{ type: "text", text: "Before the pause" }],
                    status: { type: "complete" },
                    metadata: { runId },
                  },
                },
              ],
              agentKit: {
                messages: [],
                activeRunIds:
                  status === "awaiting_approval" || status === "awaiting_input"
                    ? [runId]
                    : [],
                runs: [
                  {
                    id: runId,
                    threadId,
                    status,
                    lastSequence: 1,
                  },
                ],
              },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.runs).toContainEqual(
        expect.objectContaining({ id: runId, status }),
      );
      if (status === "awaiting_approval" || status === "awaiting_input") {
        expect(snapshot?.activeRunIds).toContain(runId);
      } else {
        expect(snapshot?.activeRunIds).not.toContain(runId);
      }
      if (status === "failed" && active) {
        expect(snapshot?.runs).toContainEqual(
          expect.objectContaining({
            id: runId,
            status: "failed",
            error: expect.objectContaining({
              code: "provider_unavailable",
              metadata: { terminalReason: "provider_unavailable" },
            }),
          }),
        );
      }
      await transport.dispose();
    },
  );

  it("restores a durable failed assistant reply without a saved run snapshot", async () => {
    const threadId = "thread-durable-failed-assistant";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "assistant-failed-durable",
                  role: "assistant",
                  content: [{ type: "text", text: "The request failed." }],
                  status: { type: "incomplete", reason: "error" },
                  metadata: {
                    runId: "run-failed-durable",
                    custom: {
                      runError: {
                        message: "Provider unavailable",
                        errorCode: "provider_unavailable",
                      },
                    },
                  },
                },
              },
            ],
            agentKit: { messages: [] },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages).toContainEqual(
      expect.objectContaining({
        id: "assistant-failed-durable",
        role: "assistant",
        status: "error",
        metadata: {
          runId: "run-failed-durable",
          custom: {
            runError: {
              message: "Provider unavailable",
              errorCode: "provider_unavailable",
            },
          },
        },
      }),
    );
    await transport.dispose();
  });

  it("merges durable assistant failure status and details into stale projections", async () => {
    const threadId = "thread-stale-assistant-failure";
    const runId = "run-stale-assistant-failure";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({
            active: true,
            status: "failed",
            runId,
            terminalReason: "provider_unavailable",
          });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "assistant-stale-failure",
                  role: "assistant",
                  content: [{ type: "text", text: "The request failed." }],
                  status: { type: "incomplete", reason: "error" },
                  metadata: {
                    runId,
                    custom: {
                      runError: {
                        message: "Provider unavailable",
                        errorCode: "provider_unavailable",
                        details: "The provider rejected the request.",
                        recoverable: true,
                      },
                    },
                  },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "assistant-stale-failure",
                  role: "assistant",
                  parts: [{ type: "text", text: "The request failed." }],
                  status: "streaming",
                  metadata: { runId, custom: { snapshotField: true } },
                },
              ],
              runs: [
                { id: runId, threadId, status: "running", lastSequence: 1 },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages).toContainEqual(
      expect.objectContaining({
        id: "assistant-stale-failure",
        status: "error",
        metadata: {
          runId,
          custom: {
            snapshotField: true,
            runError: {
              message: "Provider unavailable",
              errorCode: "provider_unavailable",
              details: "The provider rejected the request.",
              recoverable: true,
            },
          },
        },
      }),
    );
    expect(snapshot?.runs).toContainEqual(
      expect.objectContaining({
        id: runId,
        status: "failed",
        error: {
          code: "provider_unavailable",
          message: "Provider unavailable",
          details: "The provider rejected the request.",
          retryable: true,
          metadata: { terminalReason: "provider_unavailable" },
        },
      }),
    );
    await transport.dispose();
  });

  it("restores each durable assistant message from a multi-message run", async () => {
    const threadId = "thread-multiple-durable-assistant-messages";
    const runId = "run-multiple-durable-assistant-messages";
    const durableMessages = [
      {
        id: "assistant-tool-request",
        text: "Calling the tool.",
        at: "2026-09-01T00:00:01.000Z",
      },
      {
        id: "assistant-final-answer",
        text: "The task is complete.",
        at: "2026-09-01T00:00:02.000Z",
      },
    ];
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: durableMessages.map((message) => ({
              message: {
                id: message.id,
                role: "assistant",
                content: [{ type: "text", text: message.text }],
                createdAt: message.at,
                status: { type: "complete" },
                metadata: { runId },
              },
            })),
            agentKit: {
              messages: [
                {
                  id: "assistant-tool-request",
                  role: "assistant",
                  status: "streaming",
                  parts: [{ type: "text", text: "Calling the tool" }],
                  metadata: { runId },
                },
              ],
              events: durableMessages.map((message, index) => ({
                id: `event-${message.id}`,
                threadId,
                runId,
                sequence: index + 1,
                occurredAt: message.at,
                type: "message.completed",
                message: {
                  id: message.id,
                  role: "assistant",
                  parts: [{ type: "text", text: message.text }],
                  status: "complete",
                },
              })),
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual(
      durableMessages.map((message) => message.id),
    );
    expect(snapshot?.messages[0]).toMatchObject({
      id: "assistant-tool-request",
      status: "complete",
      parts: [{ type: "text", text: "Calling the tool." }],
    });
    await transport.dispose();
  });

  it("orders recovered messages with existing turns by creation time", async () => {
    const threadId = "thread-chronological-recovery";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-user-one",
                  role: "user",
                  content: [{ type: "text", text: "First request" }],
                  createdAt: "2026-09-02T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-one" } },
                },
              },
              {
                message: {
                  id: "durable-assistant-one",
                  role: "assistant",
                  content: [{ type: "text", text: "First response" }],
                  createdAt: "2026-09-02T00:00:01.000Z",
                  status: { type: "complete" },
                  metadata: { runId: "run-one" },
                },
              },
              {
                message: {
                  id: "durable-user-two",
                  role: "user",
                  content: [{ type: "text", text: "Second request" }],
                  createdAt: "2026-09-03T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-two" } },
                },
              },
              {
                message: {
                  id: "durable-assistant-two",
                  role: "assistant",
                  content: [{ type: "text", text: "Second response" }],
                  createdAt: "2026-09-03T00:00:01.000Z",
                  status: { type: "complete" },
                  metadata: { runId: "run-two" },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-user-old",
                  role: "user",
                  parts: [{ type: "text", text: "Older request" }],
                  createdAt: "2026-09-01T00:00:00.000Z",
                },
                {
                  id: "snapshot-assistant-old",
                  role: "assistant",
                  parts: [{ type: "text", text: "Older response" }],
                  createdAt: "2026-09-01T00:00:01.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-user-old",
      "snapshot-assistant-old",
      "durable-user-one",
      "durable-assistant-one",
      "durable-user-two",
      "durable-assistant-two",
    ]);
    await transport.dispose();
  });

  it("keeps same-text durable prompts when snapshot matching is ambiguous", async () => {
    const threadId = "thread-ambiguous-prompt";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-prompt-one",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this" }],
                  createdAt: "2026-09-02T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-one" } },
                },
              },
              {
                message: {
                  id: "durable-prompt-two",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this" }],
                  createdAt: "2026-09-03T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-two" } },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-prompt-unmatched",
                  role: "user",
                  parts: [{ type: "text", text: "Repeat this" }],
                  createdAt: "2026-09-01T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-prompt-unmatched",
      "durable-prompt-one",
      "durable-prompt-two",
    ]);
    await transport.dispose();
  });

  it("reconciles repeated prompts when snapshot and durable timestamps match", async () => {
    const threadId = "thread-repeated-prompt-reconcile";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: ["run-one", "run-two"].map((runId, index) => ({
              message: {
                id: `durable-prompt-${index + 1}`,
                role: "user",
                content: [{ type: "text", text: "Retry this prompt" }],
                createdAt: `2026-09-03T00:00:0${index}.000Z`,
                metadata: { custom: { submittedRunId: runId } },
              },
            })),
            agentKit: {
              messages: [
                {
                  id: "snapshot-prompt-one",
                  role: "user",
                  parts: [{ type: "text", text: "Retry this prompt" }],
                  createdAt: "2026-09-03T00:00:00.000Z",
                },
                {
                  id: "snapshot-prompt-two",
                  role: "user",
                  parts: [{ type: "text", text: "Retry this prompt" }],
                  createdAt: "2026-09-03T00:00:01.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-prompt-one",
      "snapshot-prompt-two",
    ]);
    await transport.dispose();
  });

  it("uses the submitted AgentKit message ID to match differently timed prompts", async () => {
    const threadId = "thread-agentkit-message-id-reconcile";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-prompt",
                  role: "user",
                  content: [{ type: "text", text: "One submitted prompt" }],
                  createdAt: "2026-09-03T00:00:00.500Z",
                  metadata: {
                    custom: {
                      submittedRunId: "run-one",
                      agentKitMessageId: "message-agentkit-one",
                    },
                  },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "message-agentkit-one",
                  role: "user",
                  parts: [{ type: "text", text: "One submitted prompt" }],
                  createdAt: "2026-09-03T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "message-agentkit-one",
    ]);
    await transport.dispose();
  });

  it("keeps equal text from different AgentKit message IDs as separate turns", async () => {
    const threadId = "thread-agentkit-message-id-distinct";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-new-repeat",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                  metadata: {
                    custom: {
                      submittedRunId: "run-new-repeat",
                      agentKitMessageId: "message-new-repeat",
                    },
                  },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "message-old-repeat",
                  role: "user",
                  parts: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "message-old-repeat",
      "durable-new-repeat",
    ]);
    await transport.dispose();
  });

  it("preserves a newer durable prompt that repeats stale snapshot text", async () => {
    const threadId = "thread-identical-prompt-new-turn";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "durable-new-repeat",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-new-repeat" } },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "snapshot-old-repeat",
                  role: "user",
                  parts: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-01T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });

    expect(snapshot?.messages.map((message) => message.id)).toEqual([
      "snapshot-old-repeat",
      "durable-new-repeat",
    ]);
    await transport.dispose();
  });

  it("does not hydrate stale runs as active after an explicit idle result", async () => {
    const threadId = "thread-idle-stale-run";
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "idle" });
        }
        return json({
          id: threadId,
          threadData: JSON.stringify({
            messages: [],
            agentKit: {
              messages: [],
              activeRunIds: ["run-stale"],
              runs: [
                {
                  id: "run-stale",
                  threadId,
                  status: "running",
                  lastSequence: 1,
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });
    const client = new AgentKitClient({ transport });

    const thread = await client.loadThread(threadId);

    expect(thread.activeRunIds).toEqual([]);
    expect(thread.runs["run-stale"]).toMatchObject({
      status: "failed",
      error: { code: "run_state_unavailable", retryable: true },
    });
    await client.shutdown();
    await transport.dispose();
  });

  it.each([
    { serverStatus: "errored", expectedStatus: "failed" },
    { serverStatus: "aborted", expectedStatus: "cancelled" },
    { serverStatus: "truncated", expectedStatus: "failed" },
  ])(
    "maps the terminal server status $serverStatus into a visible run state",
    async ({ serverStatus, expectedStatus }) => {
      const threadId = `thread-status-${serverStatus}`;
      const transport = createAgentNativeAgentKitTransport({
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input).includes("/runs/active")) {
            return json({
              active: true,
              status: serverStatus,
              runId: "run-terminal",
            });
          }
          return json({
            id: threadId,
            threadData: JSON.stringify({
              messages: [],
              agentKit: { messages: [] },
            }),
          });
        }) as typeof fetch,
      });

      const snapshot = await transport.getThreadSnapshot?.({ threadId });

      expect(snapshot?.runs).toContainEqual(
        expect.objectContaining({ id: "run-terminal", status: expectedStatus }),
      );
      expect(snapshot?.activeRunIds).not.toContain("run-terminal");
      if (serverStatus === "truncated") {
        expect(snapshot?.runs).toContainEqual(
          expect.objectContaining({
            id: "run-terminal",
            error: expect.objectContaining({ code: "run_truncated" }),
          }),
        );
      }
      await transport.dispose();
    },
  );

  it("does not duplicate a submitted prompt already in the thread snapshot", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/runs/active")) {
          return json({ active: false, status: "complete" });
        }
        return json({
          id: "thread-deduped-prompt",
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "server-user-run-durable",
                  role: "user",
                  content: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                  metadata: { custom: { submittedRunId: "run-durable" } },
                },
              },
            ],
            agentKit: {
              messages: [
                {
                  id: "client-user-message",
                  role: "user",
                  parts: [{ type: "text", text: "Repeat this prompt" }],
                  createdAt: "2026-09-04T00:00:00.000Z",
                },
              ],
            },
          }),
        });
      }) as typeof fetch,
    });

    const snapshot = await transport.getThreadSnapshot?.({
      threadId: "thread-deduped-prompt",
    });

    expect(snapshot?.messages).toHaveLength(1);
    expect(snapshot?.messages[0]).toMatchObject({
      id: "client-user-message",
      role: "user",
      parts: [{ type: "text", text: "Repeat this prompt" }],
    });
    await transport.dispose();
  });

  it("runs the supplied host runtime through AgentKit", async () => {
    const fetcher = vi.fn(async () =>
      json({ error: "Unexpected request" }, 500),
    );
    const startTurn = vi.fn(async ({ sessionId }: { sessionId?: string }) => ({
      id: "turn-local",
      runId: "run-local",
      sessionId: sessionId ?? "thread-local",
      events: (async function* () {
        yield {
          type: "message-start",
          message: {
            id: "assistant-local",
            role: "assistant",
            content: [],
          },
        } as const;
        yield {
          type: "message-delta",
          messageId: "assistant-local",
          delta: { type: "text", text: "Local runtime reply." },
        } as const;
        yield {
          type: "message-done",
          message: {
            id: "assistant-local",
            role: "assistant",
            content: [{ type: "text", text: "Local runtime reply." }],
          },
        } as const;
        yield { type: "done", reason: "complete" } as const;
      })(),
    }));
    const runtime: AgentChatRuntime = {
      id: "test:local",
      kind: "external-agent",
      label: "Local test runtime",
      capabilities: {
        messages: {
          streaming: true,
          history: true,
          structuredContent: true,
          attachments: true,
        },
        tools: {
          events: true,
          hostTools: true,
          inputStreaming: true,
          resultStreaming: true,
        },
        sessions: { create: true, restore: true, persistent: true },
        cancellation: {
          abortSignal: true,
          explicitCancel: true,
          interrupt: true,
        },
      },
      async createSession(input) {
        const sessionId = input?.id ?? "thread-local";
        return {
          id: sessionId,
          threadId: input?.threadId,
          runtimeId: "test:local",
          startTurn: ({ abortSignal: _abortSignal }) =>
            startTurn({ sessionId }),
        };
      },
    };
    const transport = createAgentNativeAgentKitTransport({
      runtime,
      fetch: fetcher,
    });

    const { runId } = await transport.startRun({
      threadId: "thread-local",
      messages: [
        {
          id: "user-local",
          role: "user",
          parts: [{ type: "text", text: "Use the local runtime." }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-local",
      runId,
    })) {
      events.push(event);
    }

    expect(startTurn).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.completed",
        message: expect.objectContaining({
          id: "assistant-local",
          role: "assistant",
        }),
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "run.completed" });
    expect(fetcher).not.toHaveBeenCalled();
    await transport.dispose();
  });

  it("keeps queued work behind approval and input waits", async () => {
    let activeRunChecks = 0;
    let queueWriteRunCheckCount = 0;
    const queuedMessage = {
      id: "queued-approval",
      text: "Continue after approval",
    };
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/runs/active?threadId=thread-approval")) {
          activeRunChecks += 1;
          if (activeRunChecks === 1) {
            return json({ active: true, status: "awaiting_approval" });
          }
          if (activeRunChecks === 2) {
            return json({ active: true, status: "awaiting_input" });
          }
          return json({ active: false, status: "completed" });
        }
        if (url.endsWith("/threads/thread-approval") && !init?.method) {
          return json({
            id: "thread-approval",
            threadData: JSON.stringify({
              queuedMessages: [queuedMessage],
            }),
          });
        }
        if (url.endsWith("/threads/thread-approval/queued")) {
          queueWriteRunCheckCount = activeRunChecks;
          return json({
            queuedMessages: [],
            removedMessage: queuedMessage,
            index: 0,
          });
        }
        if (url.endsWith("/_agent-native/agent-chat")) {
          return new Response('data: {"type":"done"}\n\n', {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await transport.steerQueuedMessage?.({
      threadId: "thread-approval",
      messageId: "queued-approval",
    });

    expect(activeRunChecks).toBe(4);
    expect(queueWriteRunCheckCount).toBe(4);
    await transport.dispose();
  });

  it.each(["errored", "aborted"] as const)(
    "releases queued work after an active %s run is terminal",
    async (terminalStatus) => {
      const queueWrites: unknown[] = [];
      let queuedMessages = [{ id: "queued-terminal", text: "Try again" }];
      let startRunRequests = 0;
      const fetcher = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/runs/active?threadId=thread-terminal")) {
            return json({ active: true, status: terminalStatus });
          }
          if (url.endsWith("/threads/thread-terminal") && !init?.method) {
            return json({
              id: "thread-terminal",
              threadData: JSON.stringify({
                queuedMessages,
              }),
            });
          }
          if (url.endsWith("/threads/thread-terminal/queued")) {
            const mutation = JSON.parse(String(init?.body)).mutation;
            queueWrites.push(mutation);
            if (mutation.type === "claim") {
              const index = queuedMessages.findIndex(
                (message) => message.id === mutation.messageId,
              );
              const removedMessage = queuedMessages[index];
              queuedMessages = queuedMessages.filter(
                (message) => message.id !== mutation.messageId,
              );
              return json({ queuedMessages, removedMessage, index });
            }
            queuedMessages.splice(mutation.index, 0, mutation.message);
            return json({ queuedMessages });
          }
          if (url.endsWith("/_agent-native/agent-chat")) {
            startRunRequests += 1;
            return json({ error: "Deterministic start rejection" }, 502);
          }
          return json({ error: "Not found" }, 404);
        },
      );
      const transport = createAgentNativeAgentKitTransport({
        apiUrl: "/_agent-native/agent-chat",
        fetch: fetcher as typeof fetch,
      });

      await expect(
        transport.steerQueuedMessage?.({
          threadId: "thread-terminal",
          messageId: "queued-terminal",
        }),
      ).rejects.toThrow("Deterministic start rejection");

      expect(startRunRequests).toBe(1);
      expect(queueWrites).toHaveLength(2);
      expect(queueWrites[0]).toEqual({
        type: "claim",
        messageId: "queued-terminal",
      });
      expect(queueWrites[1]).toMatchObject({
        type: "restore",
        index: 0,
        message: { id: "queued-terminal", text: "Try again" },
      });
      await transport.dispose();
    },
  );

  it("preserves the active run ID when a queued promotion remains blocked", async () => {
    let activeRunChecks = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/runs/active?threadId=thread-busy")) {
        activeRunChecks += 1;
        return json({
          active: true,
          status: "running",
          runId: `run-active-${activeRunChecks}`,
        });
      }
      if (url.endsWith("/threads/thread-busy")) {
        return json({
          id: "thread-busy",
          threadData: JSON.stringify({
            queuedMessages: [
              {
                id: "queued-busy",
                threadId: "thread-busy",
                text: "Wait for the current run",
                createdAt: "2026-09-01T00:00:00.000Z",
              },
            ],
          }),
        });
      }
      return json({ error: "Not found" }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.steerQueuedMessage?.({
        threadId: "thread-busy",
        messageId: "queued-busy",
      }),
    ).rejects.toMatchObject({
      code: "run_slot_busy",
      activeRunId: "run-active-4",
    });

    expect(activeRunChecks).toBe(4);
    await transport.dispose();
  });

  it("hides a locally parked send from active-run snapshots while its waiter owns delivery", async () => {
    const threadId = "thread-parked-snapshot";
    let resolveAppend!: () => void;
    let resolveAppendResponse!: () => void;
    const appendSaved = new Promise<void>((resolve) => {
      resolveAppend = resolve;
    });
    const appendResponse = new Promise<void>((resolve) => {
      resolveAppendResponse = resolve;
    });
    let queuedMessages: Array<Record<string, unknown>> = [];
    let activeRunChecks = 0;
    let startRequests = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/agent-chat") && init?.method === "POST") {
          startRequests += 1;
          return json(
            {
              error: "Run already in progress for this thread",
              code: "run_slot_busy",
              retryable: true,
              activeRunId: "run-existing",
            },
            409,
          );
        }
        if (url.endsWith(`/threads/${threadId}/queued`)) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          if (mutation.type === "append") {
            queuedMessages = [mutation.message];
            resolveAppend();
            await appendResponse;
          }
          return json({ queuedMessages, message: mutation.message });
        }
        if (url.endsWith(`/threads/${threadId}`)) {
          return json({
            id: threadId,
            threadData: JSON.stringify({ queuedMessages }),
          });
        }
        if (url.includes(`/runs/active?threadId=${threadId}`)) {
          activeRunChecks += 1;
          return json({
            active: true,
            status: "running",
            runId: "run-existing",
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });
    const controller = new AbortController();
    const send = transport.startRun(
      {
        threadId,
        messages: [
          {
            id: "parked-send",
            role: "user",
            parts: [{ type: "text", text: "Wait behind the current run" }],
          },
        ],
      },
      { signal: controller.signal },
    );

    await appendSaved;
    const snapshot = await transport.getThreadSnapshot?.({ threadId });
    resolveAppendResponse();
    await vi.waitFor(() => expect(activeRunChecks).toBeGreaterThan(0));

    expect(snapshot?.queuedMessages).not.toContainEqual(
      expect.objectContaining({ id: "parked-send" }),
    );
    controller.abort();
    await expect(send).rejects.toMatchObject({ name: "AbortError" });
    expect(startRequests).toBe(1);
    await transport.dispose();
  });

  it("waits for the runtime continuation to release the thread before promotion", async () => {
    const queueWrites: unknown[] = [];
    let activeRunChecks = 0;
    let queuedMessages = [{ id: "queued-1", text: "Wait for approval" }];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/runs/active?threadId=thread-1")) {
          activeRunChecks += 1;
          return json({
            active: activeRunChecks <= 2,
            status: activeRunChecks <= 2 ? "running" : "completed",
            awaitingRedispatch: activeRunChecks <= 2,
          });
        }
        if (url.endsWith("/threads/thread-1") && !init?.method) {
          return json({
            id: "thread-1",
            threadData: JSON.stringify({ queuedMessages }),
          });
        }
        if (url.endsWith("/threads/thread-1/queued")) {
          const mutation = JSON.parse(String(init?.body)).mutation;
          queueWrites.push(mutation);
          const index = queuedMessages.findIndex(
            (message) => message.id === mutation.messageId,
          );
          const removedMessage = queuedMessages[index];
          queuedMessages = queuedMessages.filter(
            (message) => message.id !== mutation.messageId,
          );
          return json({ queuedMessages, removedMessage, index });
        }
        if (url.endsWith("/_agent-native/agent-chat")) {
          const stream = `data: ${JSON.stringify({ type: "done" })}\n\n`;
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream",
              "x-run-id": "run-promoted",
            },
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
    });

    const promoted = await transport.steerQueuedMessage?.({
      threadId: "thread-1",
      messageId: "queued-1",
    });

    expect(activeRunChecks).toBeGreaterThanOrEqual(4);
    expect(promoted).toMatchObject({ runId: "run-promoted" });
    expect(queueWrites).toEqual([{ type: "claim", messageId: "queued-1" }]);
    expect(queuedMessages).toEqual([]);
  });

  it("distinguishes a missing thread from an empty durable queue", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({ error: "Not found" }, 404),
      ) as typeof fetch,
    });

    await expect(
      transport.listQueuedMessages?.({ threadId: "missing-thread" }),
    ).rejects.toThrow("thread missing-thread does not exist");
  });

  it("preserves an unreadable error response as an explicit request failure", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(
        async () =>
          ({
            ok: false,
            status: 502,
            text: async () => {
              throw new Error("response body unavailable");
            },
          }) as Response,
      ) as typeof fetch,
    });

    await expect(
      transport.submitFeedback?.({
        threadId: "thread-1",
        messageId: "assistant-1",
        value: "negative",
      }),
    ).rejects.toThrow(
      "Agent chat request failed with 502, and its error body could not be read.",
    );
  });

  it("explains an oversized request and marks it non-retryable", async () => {
    const transport = createAgentNativeAgentKitTransport({
      fetch: vi.fn(async () =>
        json({ error: "Payload too large" }, 413),
      ) as typeof fetch,
    });

    await expect(
      transport.submitFeedback?.({
        threadId: "thread-1",
        messageId: "assistant-1",
        value: "negative",
      }),
    ).rejects.toMatchObject({
      message:
        "This request exceeded the server's size limit (HTTP 413). Start a new chat or remove large attachments or references, then retry.",
      code: "http_413",
      status: 413,
      retryable: false,
    });
  });

  it("persists response feedback and forks durable history from a message", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/threads/thread-1") && !init?.method) {
          return json({
            id: "thread-1",
            title: "Release review",
            threadData: JSON.stringify({
              messages: [
                {
                  id: "user-1",
                  role: "user",
                  content: [{ type: "text", text: "Review it" }],
                },
              ],
              agentKit: {
                messages: [
                  {
                    id: "user-1",
                    role: "user",
                    parts: [{ type: "text", text: "Review it" }],
                  },
                  {
                    id: "assistant-1",
                    role: "assistant",
                    parts: [{ type: "text", text: "Ready." }],
                  },
                  {
                    id: "user-2",
                    role: "user",
                    parts: [{ type: "text", text: "Publish it" }],
                  },
                ],
                widgets: [
                  {
                    messageId: "assistant-1",
                    widget: {
                      id: "widget-retained",
                      kind: "test.action",
                      data: {
                        toolCallId: "tool-retained",
                        toolName: "publish",
                      },
                    },
                  },
                  {
                    messageId: "user-2",
                    widget: {
                      id: "widget-later",
                      kind: "test.action",
                      data: { toolCallId: "tool-later", toolName: "publish" },
                    },
                  },
                ],
                toolCalls: [
                  {
                    id: "tool-retained",
                    name: "publish",
                    status: "completed",
                    messageId: "assistant-1",
                  },
                  {
                    id: "tool-later",
                    name: "publish",
                    status: "completed",
                    messageId: "user-2",
                  },
                ],
              },
            }),
          });
        }
        if (url.endsWith("/threads/thread-1/fork")) {
          const body = JSON.parse(String(init?.body)) as {
            id: string;
            source: { threadData: string; fromMessageId?: string };
          };
          requests.push({ url, body });
          return json({
            id: body.id,
            title: "Release review",
            threadData: body.source.threadData,
          });
        }
        if (url.endsWith("/observability/feedback")) {
          requests.push({ url, body: JSON.parse(String(init?.body)) });
          return json({ id: "feedback-1" });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      feedbackUrl: "/_agent-native/observability/feedback",
      fetch: fetcher as typeof fetch,
      adapter: { createId: () => "thread-fork" },
    });

    expect(transport.capabilities).toMatchObject({
      feedback: true,
      threadForking: true,
    });
    await transport.submitFeedback?.({
      threadId: "thread-1",
      messageId: "assistant-1",
      runId: "run-1",
      messageSeq: 2,
      value: "positive",
    });
    const fork = await transport.forkThread?.({
      threadId: "thread-1",
      fromMessageId: "assistant-1",
    });

    expect(requests[0]).toMatchObject({
      url: "/_agent-native/observability/feedback",
      body: {
        threadId: "thread-1",
        runId: "run-1",
        messageSeq: 2,
        feedbackType: "thumbs_up",
        value: { messageId: "assistant-1", value: "positive" },
      },
    });
    const forkBody = requests[1]?.body as {
      source?: {
        threadData?: string;
        messageCount?: number;
        fromMessageId?: string;
      };
    };
    expect(forkBody.source?.messageCount).toBe(2);
    expect(forkBody.source?.fromMessageId).toBe("assistant-1");
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").messages,
    ).toHaveLength(1);
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").agentKit.messages.map(
        (message: { id: string }) => message.id,
      ),
    ).toEqual(["user-1", "assistant-1"]);
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").agentKit.widgets.map(
        (widget: { widget: { id: string } }) => widget.widget.id,
      ),
    ).toEqual(["widget-retained"]);
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").agentKit.toolCalls.map(
        (toolCall: { id: string }) => toolCall.id,
      ),
    ).toEqual(["tool-retained"]);
    expect(fork).toMatchObject({
      id: "thread-fork",
      messages: [{ id: "user-1" }, { id: "assistant-1" }],
      widgets: [
        {
          messageId: "assistant-1",
          widget: { id: "widget-retained" },
        },
      ],
    });
  });

  it("carries first-party screen scope and security references without overstating capabilities", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/_agent-native/agent-chat")) {
          requestBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return new Response(`data: ${JSON.stringify({ type: "done" })}\n\n`, {
            headers: {
              "content-type": "text/event-stream",
              "x-run-id": "run-context-1",
            },
          });
        }
        return json({ error: "Not found" }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetcher as typeof fetch,
      browserTabId: "tab-1",
      surface: "app",
      mode: "plan",
      scope: { type: "issue", id: "issue-42", label: "Issue 42" },
      adapter: {
        capabilities: { actions: true, resumableRuns: true, uploads: true },
        metadata: {
          "x-agent-native": {
            context: {
              route: {
                id: "/issues/42",
                kind: "route",
                label: "Issue 42",
              },
              screen: {
                id: "issue-detail",
                kind: "screen",
                label: "Issue",
              },
            },
            identity: {
              actor: { id: "user-1", kind: "user", label: "Ada" },
              workspace: {
                id: "workspace-1",
                kind: "workspace",
                label: "Core",
              },
              organization: {
                id: "org-1",
                kind: "organization",
                label: "Example",
              },
            },
            access: { decisionId: "access-1" },
            audit: { eventId: "audit-1" },
          },
        },
      },
    });

    const { runId, capabilities } = await transport.startRun({
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Inspect this issue" }],
        },
      ],
    });
    const events: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId,
    })) {
      events.push(event);
    }

    expect(requestBody?.metadata).toMatchObject({
      "x-agent-native": {
        context: {
          browserTabId: "tab-1",
          mode: "plan",
          route: { id: "/issues/42" },
          screen: { id: "issue-detail" },
          scope: { type: "issue", id: "issue-42" },
          focusedObjects: [{ id: "issue-42", kind: "issue" }],
        },
        identity: {
          actor: { id: "user-1" },
          workspace: { id: "workspace-1" },
          organization: { id: "org-1" },
        },
        access: { decisionId: "access-1" },
        audit: { eventId: "audit-1" },
        smartObjects: [{ id: "issue-42", kind: "issue" }],
      },
    });
    expect(events[0]?.metadata).toMatchObject({
      "x-agent-native": {
        context: { browserTabId: "tab-1" },
        identity: { actor: { id: "user-1" } },
        observability: {
          protocolRunId: "run-context-1",
          runtimeRunId: "run-context-1",
        },
      },
    });
    expect(capabilities).toMatchObject({
      actions: false,
      feedback: true,
      messageQueue: true,
      resumableRuns: true,
      threadForking: true,
      threadHistory: true,
      uploads: false,
    });
  });
});
