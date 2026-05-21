// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useChatThreads,
  type ChatThreadSnapshot,
  type ChatThreadSummary,
} from "./use-chat-threads.js";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("useChatThreads", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("crypto", { randomUUID: () => "forked-thread" });
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("starts fresh when no active thread is saved, even if server history exists", async () => {
    const oldThread: ChatThreadSummary = {
      id: "old-project-thread",
      title: "Animated charting tool",
      preview: "make the chart more playful",
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [oldThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "analytics-project");
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("forked-thread");
    expect(hook!.threads.map((thread) => thread.id)).toEqual([
      "forked-thread",
      "old-project-thread",
    ]);
  });

  it("keeps a saved active thread when it still exists on the server", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:analytics-project",
      "old-project-thread",
    );
    const oldThread: ChatThreadSummary = {
      id: "old-project-thread",
      title: "Analytics for Academy",
      preview: "show weekly signups",
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [oldThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "analytics-project");
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("old-project-thread");
    expect(hook!.threads.map((thread) => thread.id)).toEqual([
      "old-project-thread",
    ]);
  });

  it("sends the current client snapshot when forking a thread", async () => {
    const sourceThread: ChatThreadSummary = {
      id: "source-thread",
      title: "Pipeline",
      preview: "make this slide better",
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
      scope: { type: "dashboard", id: "dash-1", label: "Pipeline" },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [sourceThread] });
      }
      if (url === "/chat/threads/source-thread/fork") {
        return jsonResponse({
          ...sourceThread,
          id: "forked-thread",
          title: "Pipeline (fork)",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "fork-test");
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const snapshot: ChatThreadSnapshot = {
      threadData: JSON.stringify({ messages: [{ message: { id: "m1" } }] }),
      title: "Pipeline",
      preview: "make this slide better",
      messageCount: 1,
    };

    let forkedId: string | null = null;
    await act(async () => {
      forkedId = await hook!.forkThread("source-thread", snapshot);
    });

    expect(forkedId).toBe("forked-thread");
    const forkCall = fetchMock.mock.calls.find(
      ([url]) => url === "/chat/threads/source-thread/fork",
    );
    expect(forkCall).toBeDefined();
    expect(JSON.parse(forkCall![1]!.body as string)).toEqual({
      id: "forked-thread",
      source: { ...snapshot, scope: sourceThread.scope },
    });
  });

  it("creates a fork from the client snapshot when the fork endpoint cannot find the source", async () => {
    const sourceThread: ChatThreadSummary = {
      id: "source-thread",
      title: "Pipeline",
      preview: "make this slide better",
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
      scope: { type: "deck", id: "deck-1", label: "Pipeline deck" },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [sourceThread] });
      }
      if (url === "/chat/threads/source-thread/fork") {
        return new Response(JSON.stringify({ error: "Thread not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/chat/threads" && init?.method === "POST") {
        return jsonResponse({
          id: "forked-thread",
          title: "Pipeline (fork)",
          preview: "",
          messageCount: 0,
          createdAt: 3,
          updatedAt: 3,
          scope: sourceThread.scope,
        });
      }
      if (url === "/chat/threads/forked-thread" && init?.method === "PUT") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "fork-test");
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const snapshot: ChatThreadSnapshot = {
      threadData: JSON.stringify({ messages: [{ message: { id: "m1" } }] }),
      title: "Pipeline",
      preview: "make this slide better",
      messageCount: 1,
    };

    let forkedId: string | null = null;
    await act(async () => {
      forkedId = await hook!.forkThread("source-thread", snapshot);
    });

    expect(forkedId).toBe("forked-thread");
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/chat/threads" && init?.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall![1]!.body as string)).toEqual({
      id: "forked-thread",
      title: "Pipeline (fork)",
      scope: sourceThread.scope,
    });
    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/chat/threads/forked-thread" && init?.method === "PUT",
    );
    expect(saveCall).toBeDefined();
    expect(JSON.parse(saveCall![1]!.body as string)).toEqual({
      threadData: snapshot.threadData,
      title: "Pipeline (fork)",
      preview: snapshot.preview,
      messageCount: snapshot.messageCount,
      scope: sourceThread.scope,
    });
  });
});
