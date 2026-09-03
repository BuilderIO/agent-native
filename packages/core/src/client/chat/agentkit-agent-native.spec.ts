import type { AgentEvent } from "@agent-native/agentkit-protocol";
import { describe, expect, it, vi } from "vitest";

import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";

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
  it("loads durable history and promotes queued work into a real stream", async () => {
    const queueWrites: unknown[] = [];
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
              queuedMessages: [
                {
                  id: "queued-1",
                  text: "Continue after approval",
                  createdAt: "2026-08-29T00:02:00.000Z",
                },
              ],
            }),
          });
        }
        if (url.endsWith("/threads/thread-1/queued")) {
          queueWrites.push(JSON.parse(String(init?.body)));
          return json({ ok: true });
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

    expect(queueWrites).toEqual([{ queuedMessages: [] }]);
    expect(activeRunChecks).toBe(2);
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
    expect(runStateMocks.dispatchAgentChatRunning).toHaveBeenCalledWith({
      isRunning: true,
      phase: "responding",
      threadId: "thread-1",
      tabId: "thread-1",
      runId: "run-2",
      reason: "response_started",
    });
    expect(runStateMocks.dispatchAgentChatRunning).toHaveBeenCalledWith({
      isRunning: false,
      phase: "idle",
      threadId: "thread-1",
      tabId: "thread-1",
      runId: "run-2",
      reason: "run.completed",
    });
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

  it("keeps queued work durable while the runtime owns a continuation", async () => {
    const queueWrites: unknown[] = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/runs/active?threadId=thread-1")) {
          return json({
            active: true,
            status: "running",
            awaitingRedispatch: true,
          });
        }
        if (url.endsWith("/threads/thread-1") && !init?.method) {
          return json({
            id: "thread-1",
            threadData: JSON.stringify({
              queuedMessages: [{ id: "queued-1", text: "Wait for approval" }],
            }),
          });
        }
        if (url.endsWith("/threads/thread-1/queued")) {
          queueWrites.push(JSON.parse(String(init?.body)));
          return json({ ok: true });
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
        threadId: "thread-1",
        messageId: "queued-1",
      }),
    ).rejects.toThrow("runtime owns a continuation");
    expect(queueWrites).toEqual([]);
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
                {
                  id: "assistant-1",
                  role: "assistant",
                  content: [{ type: "text", text: "Ready." }],
                },
                {
                  id: "user-2",
                  role: "user",
                  content: [{ type: "text", text: "Publish it" }],
                },
              ],
            }),
          });
        }
        if (url.endsWith("/threads/thread-1/fork")) {
          const body = JSON.parse(String(init?.body)) as {
            id: string;
            source: { threadData: string };
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
        feedbackType: "thumbs_up",
        value: { messageId: "assistant-1", value: "positive" },
      },
    });
    const forkBody = requests[1]?.body as {
      source?: { threadData?: string; messageCount?: number };
    };
    expect(forkBody.source?.messageCount).toBe(2);
    expect(
      JSON.parse(forkBody.source?.threadData ?? "{}").messages,
    ).toHaveLength(2);
    expect(fork).toMatchObject({
      id: "thread-fork",
      messages: [{ id: "user-1" }, { id: "assistant-1" }],
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
      resumableRuns: false,
      threadForking: true,
      threadHistory: true,
      uploads: false,
    });
  });
});
