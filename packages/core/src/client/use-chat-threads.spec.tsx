// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useChatThreads,
  type ChatThreadScope,
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

  it("loads older chat history pages into All Chats", async () => {
    const firstPage: ChatThreadSummary[] = Array.from(
      { length: 50 },
      (_, index) => ({
        id: `thread-${index}`,
        title: `Thread ${index}`,
        preview: `Preview ${index}`,
        messageCount: 1,
        createdAt: 1_000 - index,
        updatedAt: 1_000 - index,
        scope: null,
      }),
    );
    const olderThread: ChatThreadSummary = {
      id: "thread-50",
      title: "Older thread",
      preview: "older preview",
      messageCount: 1,
      createdAt: 900,
      updatedAt: 900,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: firstPage });
      }
      if (url === "/chat/threads?offset=50" && !init) {
        return jsonResponse({ threads: [olderThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "paged-history", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.threads).toHaveLength(50);
    expect(hook!.hasMoreThreads).toBe(true);

    await act(async () => {
      await hook!.loadMoreThreads();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/chat/threads?offset=50");
    expect(hook!.threads.map((thread) => thread.id)).toContain("thread-50");
    expect(hook!.threads).toHaveLength(51);
    expect(hook!.hasMoreThreads).toBe(false);
  });

  it("does not reclassify a saved thread as new when the initial thread list fails", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:thread-list-failure",
      "thread-1",
    );
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "thread-list-failure");
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.isLoading).toBe(false);
    expect(hook!.activeThreadId).toBe("thread-1");
    expect(hook!.threads).toEqual([]);
    expect(hook!.isNewThread("thread-1")).toBe(false);
  });

  it("reclassifies a saved missing thread as a new empty tab after the thread list loads", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:forms",
      "empty-sidebar-tab",
    );
    window.localStorage.setItem(
      "agent-chat-active-thread:forms:seen",
      String(Date.now()),
    );
    const existingThread: ChatThreadSummary = {
      id: "real-thread",
      title: "Previous form work",
      preview: "add a rating field",
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [existingThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "forms");
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("empty-sidebar-tab");
    expect(hook!.isNewThread("empty-sidebar-tab")).toBe(true);
    expect(hook!.threads.map((thread) => thread.id)).toEqual([
      "empty-sidebar-tab",
      "real-thread",
    ]);
  });

  it("can ignore a saved active thread and start fresh immediately", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:brain",
      "old-brain-thread",
    );
    const oldThread: ChatThreadSummary = {
      id: "old-brain-thread",
      title: "Using the Brain demo corpus",
      preview: "what should the demo cite?",
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
      hook = useChatThreads("/chat", "brain", null, {
        restoreActiveThread: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    expect(hook!.activeThreadId).toBe("forked-thread");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.threads.map((thread) => thread.id)).toEqual([
      "forked-thread",
      "old-brain-thread",
    ]);
  });

  it("lets a route thread override the saved active thread", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:route-test",
      "saved-thread",
    );
    const savedThread: ChatThreadSummary = {
      id: "saved-thread",
      title: "Saved",
      preview: "saved preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const routeThread: ChatThreadSummary = {
      id: "route-thread",
      title: "Route",
      preview: "route preview",
      messageCount: 1,
      createdAt: 3,
      updatedAt: 4,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [savedThread, routeThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "route-test", null, {
        routeThreadId: "route-thread",
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("route-thread");
    expect(
      window.localStorage.getItem("agent-chat-active-thread:route-test"),
    ).toBe("route-thread");
  });

  it("treats a route without a thread as create mode and clears saved active thread", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:route-create-test",
      "saved-thread",
    );
    const savedThread: ChatThreadSummary = {
      id: "saved-thread",
      title: "Saved",
      preview: "saved preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [savedThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "route-create-test", null, {
        routeThreadId: null,
      });
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
    expect(hook!.isNewThread("forked-thread")).toBe(true);
    expect(
      window.localStorage.getItem("agent-chat-active-thread:route-create-test"),
    ).toBeNull();
  });

  it("keeps the active general chat visible when entering a scoped surface", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:forms-app",
      "general-thread",
    );
    const generalThread: ChatThreadSummary = {
      id: "general-thread",
      title: "Create a form",
      preview: "make me a form",
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const formThread: ChatThreadSummary = {
      id: "form-thread",
      title: "Form edits",
      preview: "add another question",
      messageCount: 2,
      createdAt: 3,
      updatedAt: 4,
      scope: { type: "form", id: "form-1", label: "Hackathon" },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [generalThread, formThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness({ scope }: { scope?: ChatThreadScope | null }) {
      hook = useChatThreads("/chat", "forms-app", scope);
      return null;
    }

    await act(async () => {
      root.render(<Harness scope={null} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("general-thread");

    await act(async () => {
      root.render(
        <Harness scope={{ type: "form", id: "form-1", label: "Hackathon" }} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("general-thread");
    expect(
      window.localStorage.getItem(
        "agent-chat-active-thread:forms-app:scope:form:form-1",
      ),
    ).toBeNull();
    expect(
      window.localStorage.getItem("agent-chat-active-thread:forms-app"),
    ).toBe("general-thread");
  });

  it("switches back to the general chat when leaving a scoped thread", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:forms-app",
      "general-thread",
    );
    window.localStorage.setItem(
      "agent-chat-active-thread:forms-app:scope:form:form-1",
      "form-thread",
    );
    const generalThread: ChatThreadSummary = {
      id: "general-thread",
      title: "Create a form",
      preview: "make me a form",
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const formThread: ChatThreadSummary = {
      id: "form-thread",
      title: "Form edits",
      preview: "add another question",
      messageCount: 2,
      createdAt: 3,
      updatedAt: 4,
      scope: { type: "form", id: "form-1", label: "Hackathon" },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [formThread, generalThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness({ scope }: { scope?: ChatThreadScope | null }) {
      hook = useChatThreads("/chat", "forms-app", scope);
      return null;
    }

    await act(async () => {
      root.render(
        <Harness scope={{ type: "form", id: "form-1", label: "Hackathon" }} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("form-thread");

    await act(async () => {
      root.render(<Harness scope={null} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("general-thread");
  });

  it("starts a new scoped chat when entering a resource with no saved active chat", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:design-app:scope:design:design-a",
      "design-a-thread",
    );
    const designAThread: ChatThreadSummary = {
      id: "design-a-thread",
      title: "Design A edits",
      preview: "make the button brighter",
      messageCount: 2,
      createdAt: 1,
      updatedAt: 2,
      scope: { type: "design", id: "design-a", label: "Design A" },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [designAThread] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness({ scope }: { scope: ChatThreadScope }) {
      hook = useChatThreads("/chat", "design-app", scope);
      return null;
    }

    await act(async () => {
      root.render(
        <Harness
          scope={{ type: "design", id: "design-a", label: "Design A" }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("design-a-thread");

    await act(async () => {
      root.render(
        <Harness
          scope={{ type: "design", id: "design-b", label: "Design B" }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("forked-thread");
    expect(hook!.threads[0]).toMatchObject({
      id: "forked-thread",
      scope: { type: "design", id: "design-b", label: "Design B" },
    });
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

  it("keeps generated titles when later thread saves update the preview", async () => {
    const sourceThread: ChatThreadSummary = {
      id: "thread-1",
      title: "Using the Brain demo data for this example",
      preview: "Using the Brain demo data for this example",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [sourceThread] });
      }
      if (url === "/chat/threads/thread-1" && init?.method === "PUT") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "title-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await hook!.saveThreadData("thread-1", {
        threadData: "",
        title: "Brain Demo Setup",
        preview: "Using the Brain demo data for this example",
        titleSource: "generated",
      });
    });

    await act(async () => {
      await hook!.saveThreadData("thread-1", {
        threadData: JSON.stringify({ messages: [] }),
        title: "Using the Brain demo data for this example",
        preview: "What should the demo answer cite?",
        messageCount: 2,
      });
    });

    const saveCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === "/chat/threads/thread-1" && init?.method === "PUT",
    );
    expect(JSON.parse(saveCalls[0]![1]!.body as string).title).toBe(
      "Brain Demo Setup",
    );
    expect(JSON.parse(saveCalls[1]![1]!.body as string).title).toBe(
      "Brain Demo Setup",
    );
    expect(
      hook!.threads.find((thread) => thread.id === "thread-1"),
    ).toMatchObject({
      title: "Brain Demo Setup",
      preview: "What should the demo answer cite?",
      messageCount: 2,
    });
  });

  it("moves a saved thread to the top of the local recency order", async () => {
    const olderThread: ChatThreadSummary = {
      id: "thread-1",
      title: "Older thread",
      preview: "old",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const newerThread: ChatThreadSummary = {
      id: "thread-2",
      title: "Newer thread",
      preview: "new",
      messageCount: 1,
      createdAt: 3,
      updatedAt: 4,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [newerThread, olderThread] });
      }
      if (url === "/chat/threads/thread-1" && init?.method === "PUT") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "recency-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.threads.map((thread) => thread.id)).toEqual([
      "thread-2",
      "thread-1",
    ]);

    await act(async () => {
      await hook!.saveThreadData("thread-1", {
        threadData: "{}",
        title: "Older thread",
        preview: "now active",
        messageCount: 2,
      });
    });

    expect(hook!.threads.map((thread) => thread.id)).toEqual([
      "thread-1",
      "thread-2",
    ]);
  });

  it("renames a thread optimistically", async () => {
    const sourceThread: ChatThreadSummary = {
      id: "thread-1",
      title: "Old title",
      preview: "old preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [sourceThread] });
      }
      if (url === "/chat/threads/thread-1/rename" && init?.method === "POST") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "rename-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await hook!.renameThread("thread-1", "  New   title ");
    });

    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      title: "New title",
    });
    expect(
      hook!.threads.find((thread) => thread.id === "thread-1")?.title,
    ).toBe("New title");
  });

  it("rolls back a failed pin update", async () => {
    const sourceThread: ChatThreadSummary = {
      id: "thread-1",
      title: "Pinned candidate",
      preview: "old preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
      pinnedAt: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [sourceThread] });
      }
      if (url === "/chat/threads/thread-1/pin" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "pin-failure-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let pinned = true;
    await act(async () => {
      pinned = await hook!.pinThread("thread-1", true);
    });

    expect(pinned).toBe(false);
    expect(
      hook!.threads.find((thread) => thread.id === "thread-1"),
    ).toMatchObject({
      pinnedAt: null,
      updatedAt: 2,
    });
  });

  it("keeps the active thread when archive fails", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:archive-failure-test",
      "thread-1",
    );
    const sourceThread: ChatThreadSummary = {
      id: "thread-1",
      title: "Archive candidate",
      preview: "old preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
      archivedAt: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [sourceThread] });
      }
      if (url === "/chat/threads/thread-1/archive" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "archive-failure-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let archived = true;
    await act(async () => {
      archived = await hook!.archiveThread("thread-1");
    });

    expect(archived).toBe(false);
    expect(hook!.activeThreadId).toBe("thread-1");
    expect(
      hook!.threads.find((thread) => thread.id === "thread-1"),
    ).toMatchObject({
      archivedAt: null,
      updatedAt: 2,
    });
  });

  it("keeps server pin metadata when local updatedAt is newer for another reason", async () => {
    let serverThread: ChatThreadSummary = {
      id: "thread-1",
      title: "Thread",
      preview: "old preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
      pinnedAt: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [serverThread] });
      }
      if (url === "/chat/threads/thread-1" && init?.method === "PUT") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "server-pin-merge-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await hook!.saveThreadData("thread-1", {
        threadData: "{}",
        title: "Thread",
        preview: "local send",
        messageCount: 2,
      });
    });

    serverThread = {
      ...serverThread,
      pinnedAt: 123,
      updatedAt: 3,
    };
    await act(async () => {
      hook!.refreshThreads();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      hook!.threads.find((thread) => thread.id === "thread-1"),
    ).toMatchObject({
      pinnedAt: 123,
      preview: "local send",
      messageCount: 2,
    });
  });

  it("does not restore an archived thread after failed archive if the user moved on", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:archive-navigation-test",
      "thread-1",
    );
    const threads: ChatThreadSummary[] = [
      {
        id: "thread-1",
        title: "Archive candidate",
        preview: "old preview",
        messageCount: 1,
        createdAt: 1,
        updatedAt: 2,
        scope: null,
        archivedAt: null,
      },
      {
        id: "thread-2",
        title: "Next thread",
        preview: "keep me open",
        messageCount: 1,
        createdAt: 3,
        updatedAt: 4,
        scope: null,
        archivedAt: null,
      },
    ];
    let resolveArchive:
      | ((response: Response | PromiseLike<Response>) => void)
      | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads });
      }
      if (url === "/chat/threads/thread-1/archive" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveArchive = resolve;
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "archive-navigation-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let archivePromise: Promise<boolean>;
    await act(async () => {
      archivePromise = hook!.archiveThread("thread-1");
      hook!.switchThread("thread-2");
      await Promise.resolve();
    });
    await act(async () => {
      resolveArchive!(
        new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await archivePromise!;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("thread-2");
  });

  it("does not switch away from the current thread when a deleted thread request finishes late", async () => {
    window.localStorage.setItem(
      "agent-chat-active-thread:delete-navigation-test",
      "thread-1",
    );
    const threads: ChatThreadSummary[] = [
      {
        id: "thread-1",
        title: "Delete candidate",
        preview: "old preview",
        messageCount: 1,
        createdAt: 1,
        updatedAt: 2,
        scope: null,
      },
      {
        id: "thread-2",
        title: "Keep this open",
        preview: "new preview",
        messageCount: 1,
        createdAt: 3,
        updatedAt: 4,
        scope: null,
      },
    ];
    let resolveDelete:
      | ((response: Response | PromiseLike<Response>) => void)
      | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads });
      }
      if (url === "/chat/threads/thread-1" && init?.method === "DELETE") {
        return new Promise<Response>((resolve) => {
          resolveDelete = resolve;
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "delete-navigation-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let deletePromise: Promise<void>;
    await act(async () => {
      deletePromise = hook!.deleteThread("thread-1");
      hook!.switchThread("thread-2");
      await Promise.resolve();
    });
    await act(async () => {
      resolveDelete!(jsonResponse({ ok: true }));
      await deletePromise!;
      await Promise.resolve();
    });

    expect(hook!.activeThreadId).toBe("thread-2");
  });

  it("keeps a newer user rename when an earlier rename fails and refreshes stale data", async () => {
    const serverThread: ChatThreadSummary = {
      id: "thread-1",
      title: "Old title",
      preview: "old preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    let resolveFirstRename:
      | ((response: Response | PromiseLike<Response>) => void)
      | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [serverThread] });
      }
      if (url === "/chat/threads/thread-1/rename" && init?.method === "POST") {
        const title = JSON.parse(init.body as string).title;
        if (title === "First title") {
          return new Promise<Response>((resolve) => {
            resolveFirstRename = resolve;
          });
        }
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "rename-race-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let firstRename: Promise<boolean>;
    await act(async () => {
      firstRename = hook!.renameThread("thread-1", "First title");
      await Promise.resolve();
    });
    await act(async () => {
      await hook!.renameThread("thread-1", "Second title");
    });
    await act(async () => {
      resolveFirstRename!(
        new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await firstRename!;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      hook!.threads.find((thread) => thread.id === "thread-1")?.title,
    ).toBe("Second title");
  });

  it("preserves a user rename over generated titles and later saves", async () => {
    const sourceThread: ChatThreadSummary = {
      id: "thread-1",
      title: "Old title",
      preview: "old preview",
      messageCount: 1,
      createdAt: 1,
      updatedAt: 2,
      scope: null,
    };
    let resolveGenerate:
      | ((response: Response | PromiseLike<Response>) => void)
      | null = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [sourceThread] });
      }
      if (url === "/chat/generate-title" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveGenerate = resolve;
        });
      }
      if (url === "/chat/threads/thread-1/rename" && init?.method === "POST") {
        return jsonResponse({ ok: true });
      }
      if (url === "/chat/threads/thread-1" && init?.method === "PUT") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "rename-generated-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const generatedTitlePromise = hook!.generateTitle(
      "thread-1",
      "Please summarize this chat",
    );

    await act(async () => {
      await hook!.renameThread("thread-1", "User title");
    });
    await act(async () => {
      resolveGenerate!(jsonResponse({ title: "Generated title" }));
      await generatedTitlePromise;
    });
    await act(async () => {
      await hook!.saveThreadData("thread-1", {
        threadData: "",
        title: "Generated title",
        preview: "Please summarize this chat",
        titleSource: "generated",
      });
    });

    const saveCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/chat/threads/thread-1" && init?.method === "PUT",
    );
    expect(JSON.parse(saveCall![1]!.body as string).title).toBe("User title");
    expect(
      hook!.threads.find((thread) => thread.id === "thread-1")?.title,
    ).toBe("User title");
  });

  it("creates, reads, and revokes thread share links through the client helper", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/chat/threads" && !init) {
        return jsonResponse({ threads: [] });
      }
      if (url === "/chat/threads/thread-1/share" && !init) {
        return jsonResponse({
          share: {
            enabled: false,
            createdAt: null,
            updatedAt: null,
            revokedAt: null,
          },
        });
      }
      if (url === "/chat/threads/thread-1/share" && init?.method === "POST") {
        return jsonResponse({
          share: {
            enabled: true,
            token: "share-token",
            createdAt: 10,
            updatedAt: 20,
            revokedAt: null,
          },
          url: "https://app.example/shared/share-token",
        });
      }
      if (url === "/chat/threads/thread-1/share" && init?.method === "DELETE") {
        return jsonResponse({
          share: {
            enabled: false,
            createdAt: 10,
            updatedAt: 30,
            revokedAt: 30,
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let hook: ReturnType<typeof useChatThreads> | null = null;
    function Harness() {
      hook = useChatThreads("/chat", "share-test", null, {
        autoCreate: false,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await expect(hook!.getThreadShareState("thread-1")).resolves.toMatchObject({
      enabled: false,
    });
    await expect(hook!.createThreadShareLink("thread-1")).resolves.toEqual({
      enabled: true,
      token: "share-token",
      createdAt: 10,
      updatedAt: 20,
      revokedAt: null,
      url: "https://app.example/shared/share-token",
    });
    await expect(hook!.revokeThreadShareLink("thread-1")).resolves.toEqual({
      enabled: false,
      createdAt: 10,
      updatedAt: 30,
      revokedAt: 30,
    });
  });
});
