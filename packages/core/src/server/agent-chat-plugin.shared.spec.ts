import { describe, expect, it, vi } from "vitest";

import type { AgentRunSummary } from "../agent/run-store.js";
import type { ChatThread } from "../chat-threads/store.js";
import { handleSharedThreadRequest } from "./agent-chat-plugin.js";

function createSharedThreadEvent(
  path: string,
  options: { method?: string; accept?: string } = {},
) {
  const headers = new Headers();
  if (options.accept) headers.set("accept", options.accept);
  return {
    path,
    req: {
      method: options.method ?? "GET",
      headers,
    },
    res: {
      status: 200,
      headers: new Headers(),
    },
    node: {
      req: {
        url: path,
        headers: options.accept ? { accept: options.accept } : {},
      },
    },
    context: {},
  } as any;
}

function sharedThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "thread-1",
    ownerEmail: "owner@example.com",
    title: "Deploy recap",
    preview: "Two messages",
    threadData: JSON.stringify({
      messages: [
        {
          message: {
            id: "m1",
            role: "user",
            content: "<script>alert('x')</script>",
            createdAt: 10,
          },
        },
        {
          message: {
            id: "m2",
            role: "assistant",
            content: [{ type: "text", text: "Done & shipped" }],
            createdAt: 20,
          },
          privateScratch: "do not leak",
        },
        {
          message: {
            id: "tool-1",
            role: "tool",
            content: "private tool result",
          },
        },
      ],
      _share: { tokenHash: "secret-token-hash" },
      queuedMessages: ["private queued message"],
    }),
    messageCount: 2,
    createdAt: 1,
    updatedAt: 2,
    scope: { type: "deck", id: "deck-1", label: "Launch" },
    pinnedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

const run: AgentRunSummary = {
  id: "run-1",
  threadId: "thread-1",
  turnId: "turn-1",
  status: "completed",
  startedAt: 100,
  heartbeatAt: null,
  completedAt: 200,
  lastProgressAt: 150,
  errorCode: null,
  abortReason: null,
};

describe("shared thread route", () => {
  it("returns sanitized JSON for API callers", async () => {
    const event = createSharedThreadEvent(
      "/_agent-native/agent-chat/shared/token-1",
      { accept: "application/json" },
    );
    const getThreadByShareToken = vi.fn(async () => sharedThread());
    const listRunsForThread = vi.fn(async () => [run]);

    const result = await handleSharedThreadRequest(event, {
      routePath: "/_agent-native/agent-chat",
      getThreadByShareToken,
      listRunsForThread,
    });

    expect(getThreadByShareToken).toHaveBeenCalledWith("token-1");
    expect(listRunsForThread).toHaveBeenCalledWith("thread-1", { limit: 10 });
    expect(event.res.headers.get("content-type")).toBe("application/json");
    expect(result).toMatchObject({
      thread: {
        id: "thread-1",
        title: "Deploy recap",
        scope: { type: "deck", label: "Launch" },
        messages: [
          { id: "m1", role: "user", text: "<script>alert('x')</script>" },
          { id: "m2", role: "assistant", text: "Done & shipped" },
        ],
      },
      runs: [{ id: "run-1", status: "completed" }],
    });
    expect(JSON.stringify(result)).not.toContain("secret-token-hash");
    expect(JSON.stringify(result)).not.toContain("private queued message");
    expect(JSON.stringify(result)).not.toContain("private tool result");
  });

  it("renders a human-readable escaped HTML transcript for browser callers", async () => {
    const event = createSharedThreadEvent(
      "/_agent-native/agent-chat/shared/token-1",
      { accept: "text/html,application/xhtml+xml" },
    );

    const result = await handleSharedThreadRequest(event, {
      routePath: "/_agent-native/agent-chat",
      getThreadByShareToken: vi.fn(async () => sharedThread()),
      listRunsForThread: vi.fn(async () => [run]),
    });

    expect(event.res.headers.get("content-type")).toContain("text/html");
    expect(event.res.headers.get("cache-control")).toBe("private, no-store");
    expect(event.res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(result).toContain("<!doctype html>");
    expect(result).toContain("Read-only shared agent session");
    expect(result).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(result).toContain("Done &amp; shipped");
    expect(result).not.toContain("<script>alert");
    expect(result).not.toContain("secret-token-hash");
    expect(result).not.toContain("private queued message");
  });

  it("returns a not-found page for missing or revoked tokens", async () => {
    const event = createSharedThreadEvent(
      "/_agent-native/agent-chat/shared/revoked-token",
      { accept: "text/html" },
    );

    const result = await handleSharedThreadRequest(event, {
      routePath: "/_agent-native/agent-chat",
      getThreadByShareToken: vi.fn(async () => null),
      listRunsForThread: vi.fn(async () => []),
    });

    expect(event.res.status).toBe(404);
    expect(event.res.headers.get("content-type")).toContain("text/html");
    expect(result).toContain("Shared thread not found");
  });
});
