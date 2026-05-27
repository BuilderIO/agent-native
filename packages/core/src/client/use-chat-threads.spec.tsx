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
});
