// @vitest-environment happy-dom

import {
  AgentKitClient,
  createAgentThreadState,
  type AgentKitController,
  type AgentKitSnapshot,
  reduceAgentEvent,
} from "@agent-native/agentkit/client";
import { createAgentKitHttpHandler } from "@agent-native/agentkit/http";
import type {
  AgentEvent,
  AgentToolCall,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { StrictMode, act, useEffect, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentChat } from "./chat.js";
import {
  AgentActivityGroup,
  AgentConnectionRequestCard,
  AgentKitChat,
  AgentMessageActions,
  formatAgentKitDuration,
} from "./components.js";
import {
  AgentKitProvider,
  useAgentKit,
  useAgentKitSelector,
} from "./context.js";
import { AgentKitRoot } from "./root.js";

interface MountedTree {
  container: HTMLDivElement;
  root: Root;
  render(node: ReactNode): Promise<void>;
  unmount(): Promise<void>;
}

const mountedTrees = new Set<MountedTree>();

function mount(): MountedTree {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const tree: MountedTree = {
    container,
    root,
    async render(node) {
      await act(async () => {
        root.render(node);
        await Promise.resolve();
      });
    },
    async unmount() {
      if (!mountedTrees.delete(tree)) return;
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
    },
  };
  mountedTrees.add(tree);
  return tree;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function baseTransport(): AgentTransport {
  return {
    async startRun() {
      return { runId: "run-1" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
  };
}

function observableController(initial: AgentKitSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const controller = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getThread(threadId: string) {
      return snapshot.threads[threadId] ?? createAgentThreadState(threadId);
    },
    loadThread: vi.fn(async (threadId: string) =>
      controller.getThread(threadId),
    ),
    uploadFiles: vi.fn(async () => []),
    invokeAction: vi.fn(async () => ({ invocationId: "invocation-1" })),
    resolveApproval: vi.fn(async () => undefined),
    resolveConnectionRequest: vi.fn(async () => undefined),
  } as unknown as AgentKitController;
  return {
    controller,
    update(next: AgentKitSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

function ComposerFocusTarget() {
  const { registerComposerFocus, threadId } = useAgentKit();
  const target = useRef<HTMLButtonElement>(null);
  useEffect(
    () => registerComposerFocus(threadId, () => target.current?.focus()),
    [registerComposerFocus, threadId],
  );
  return <button ref={target}>Composer focus target</button>;
}

function RunSubscriptionProbe() {
  const { controller, threadId } = useAgentKit();
  useEffect(() => {
    void controller.resubscribeRun(threadId, "run-active").catch(() => {
      // The lifecycle signal deliberately ends this probe's stream.
    });
  }, [controller, threadId]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  for (const tree of [...mountedTrees]) await tree.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentChat lifecycle", () => {
  it("keeps partial transcript updates out of live announcements", async () => {
    const threadId = "thread-accessible-transcript";
    const thread = {
      ...createAgentThreadState(threadId),
      messages: [
        {
          id: "assistant-streaming",
          role: "assistant" as const,
          status: "streaming" as const,
          parts: [{ type: "text" as const, text: "Still working" }],
        },
        {
          id: "assistant-complete",
          role: "assistant" as const,
          status: "complete" as const,
          parts: [{ type: "text" as const, text: "Release review complete." }],
        },
      ],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const transcript = tree.container.querySelector(".agentkit-transcript");
    expect(transcript?.getAttribute("role")).toBeNull();
    expect(transcript?.getAttribute("aria-live")).toBe("off");
    expect(transcript?.getAttribute("aria-relevant")).toBeNull();

    const streaming = tree.container.querySelector(
      '[data-message-id="assistant-streaming"]',
    );
    expect(streaming?.getAttribute("aria-label")).toBe("Assistant");
    expect(streaming?.getAttribute("aria-busy")).toBe("true");

    const complete = tree.container.querySelector(
      '[data-message-id="assistant-complete"]',
    );
    expect(complete?.getAttribute("aria-label")).toBe("Assistant");
    expect(complete?.getAttribute("aria-busy")).toBe("false");
    expect(complete?.textContent).toContain("Release review complete.");
  });

  it("follows transcript output until the user scrolls away and rejoins on send", async () => {
    const threadId = "thread-follow-output";
    const firstMessage = {
      id: "assistant-1",
      role: "assistant" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "First response" }],
    };
    const initialThread = {
      ...createAgentThreadState(threadId),
      messages: [firstMessage],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: initialThread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const transcript = tree.container.querySelector(
      ".agentkit-transcript",
    ) as HTMLDivElement;
    const clientHeight = 300;
    let scrollHeight = 1_200;
    let scrollTop = 0;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    const secondMessage = {
      id: "assistant-2",
      role: "assistant" as const,
      status: "streaming" as const,
      parts: [{ type: "text" as const, text: "Streaming response" }],
    };
    observable.update({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: {
        [threadId]: {
          ...initialThread,
          messages: [firstMessage, secondMessage],
        },
      },
      revision: 1,
    });
    await flush();
    expect(scrollTop).toBe(900);
    expect(transcript.getAttribute("data-scrollbar-visible")).toBe("false");

    scrollTop = 500;
    await act(async () => {
      transcript.dispatchEvent(new Event("wheel", { bubbles: true }));
      transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    scrollHeight = 1_400;
    observable.update({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: {
        [threadId]: {
          ...initialThread,
          messages: [
            firstMessage,
            {
              ...secondMessage,
              parts: [
                {
                  type: "text" as const,
                  text: "Streaming response with more output",
                },
              ],
            },
          ],
        },
      },
      revision: 2,
    });
    await flush();
    expect(scrollTop).toBe(500);

    const userMessage = {
      id: "user-2",
      role: "user" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "Continue" }],
    };
    scrollHeight = 1_600;
    observable.update({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: {
        [threadId]: {
          ...initialThread,
          messages: [firstMessage, secondMessage, userMessage],
        },
      },
      revision: 3,
    });
    await flush();
    expect(scrollTop).toBe(1_300);
    expect(transcript.getAttribute("data-scrollbar-visible")).toBe("false");
  });

  it("follows buffered layout growth without feeding updates back into React", async () => {
    const resizeObservers: Array<{
      callback: ResizeObserverCallback;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    class TranscriptResizeObserver {
      public disconnect = vi.fn();
      public observe = vi.fn();

      public constructor(public callback: ResizeObserverCallback) {
        resizeObservers.push(this);
      }
    }
    vi.stubGlobal("ResizeObserver", TranscriptResizeObserver);
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
      window.clearTimeout(handle),
    );

    const threadId = "thread-buffered-follow";
    const thread = {
      ...createAgentThreadState(threadId),
      messages: [
        {
          id: "assistant-streaming",
          role: "assistant" as const,
          status: "streaming" as const,
          parts: [{ type: "text" as const, text: "Streaming response" }],
        },
      ],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();

    try {
      await tree.render(
        <AgentKitProvider
          controller={observable.controller}
          threadId={threadId}
        >
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      );

      const transcript = tree.container.querySelector(
        ".agentkit-transcript",
      ) as HTMLDivElement;
      let scrollHeight = 1_200;
      let scrollTop = 900;
      Object.defineProperties(transcript, {
        clientHeight: { configurable: true, get: () => 300 },
        scrollHeight: { configurable: true, get: () => scrollHeight },
        scrollTop: {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        },
      });

      expect(resizeObservers).toHaveLength(1);
      scrollHeight = 1_600;
      await act(async () => {
        for (let index = 0; index < 100; index += 1) {
          resizeObservers[0]?.callback(
            [],
            resizeObservers[0] as ResizeObserver,
          );
        }
        vi.runOnlyPendingTimers();
      });
      expect(scrollTop).toBe(1_300);

      scrollTop = 400;
      await act(async () => {
        transcript.dispatchEvent(new Event("wheel", { bubbles: true }));
        transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      scrollHeight = 1_900;
      await act(async () => {
        resizeObservers[0]?.callback([], resizeObservers[0] as ResizeObserver);
        vi.runOnlyPendingTimers();
      });
      expect(scrollTop).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a sustained burst of streaming snapshots", async () => {
    const threadId = "thread-stream-burst";
    const baseThread = createAgentThreadState(threadId);
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: baseThread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat />
      </AgentKitProvider>,
    );

    await act(async () => {
      for (let revision = 1; revision <= 100; revision += 1) {
        observable.update({
          connection: "connected",
          capabilities: {},
          capabilitiesStatus: "ready",
          threads: {
            [threadId]: {
              ...baseThread,
              messages: [
                {
                  id: "assistant-streaming",
                  role: "assistant",
                  status: "streaming",
                  parts: [
                    {
                      type: "text",
                      text: "Streaming response ".repeat(revision),
                    },
                  ],
                },
              ],
            },
          },
          revision,
        });
        await Promise.resolve();
      }
    });
    await flush();

    expect(
      tree.container.querySelector('[data-message-id="assistant-streaming"]'),
    ).not.toBeNull();
  });

  it("does not write transcript scroll position for queue-only bursts", async () => {
    const threadId = "thread-queue-scroll-burst";
    const message = {
      id: "assistant-complete",
      role: "assistant" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "Ready" }],
    };
    const baseThread = {
      ...createAgentThreadState(threadId),
      messages: [message],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: baseThread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const transcript = tree.container.querySelector(
      ".agentkit-transcript",
    ) as HTMLDivElement;
    let scrollTop = 900;
    let scrollWrites = 0;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => 1_200 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollWrites += 1;
          scrollTop = value;
        },
      },
    });

    await act(async () => {
      for (let revision = 1; revision <= 100; revision += 1) {
        observable.update({
          connection: "connected",
          capabilities: {},
          capabilitiesStatus: "ready",
          threads: {
            [threadId]: {
              ...baseThread,
              queuedMessages: Array.from(
                { length: revision % 12 },
                (_, index) => ({
                  id: `queued-${index}`,
                  threadId,
                  text: `Queued ${index}`,
                  createdAt: "2026-08-31T00:00:00.000Z",
                }),
              ),
            },
          },
          revision,
        });
        await Promise.resolve();
      }
    });
    await flush();

    expect(scrollWrites).toBe(0);
    expect(scrollTop).toBe(900);
  });

  it("keeps a long stream anchored when the attached queue shrinks the viewport", async () => {
    const resizeObservers: Array<{
      callback: ResizeObserverCallback;
      observe: ReturnType<typeof vi.fn>;
    }> = [];
    class TranscriptResizeObserver {
      public disconnect = vi.fn();
      public observe = vi.fn();

      public constructor(public callback: ResizeObserverCallback) {
        resizeObservers.push(this);
      }
    }
    vi.stubGlobal("ResizeObserver", TranscriptResizeObserver);
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
      window.clearTimeout(handle),
    );

    const threadId = "thread-queue-viewport-follow";
    const thread = {
      ...createAgentThreadState(threadId),
      messages: [
        {
          id: "assistant-streaming",
          role: "assistant" as const,
          status: "streaming" as const,
          parts: [{ type: "text" as const, text: "Streaming response" }],
        },
      ],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();

    try {
      await tree.render(
        <AgentKitProvider
          controller={observable.controller}
          threadId={threadId}
        >
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      );

      const transcript = tree.container.querySelector(
        ".agentkit-transcript",
      ) as HTMLDivElement;
      const content = tree.container.querySelector(
        ".agentkit-transcript-content",
      ) as HTMLDivElement;
      let clientHeight = 300;
      let scrollHeight = 1_200;
      let scrollTop = 900;
      Object.defineProperties(transcript, {
        clientHeight: { configurable: true, get: () => clientHeight },
        scrollHeight: { configurable: true, get: () => scrollHeight },
        scrollTop: {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        },
      });

      expect(resizeObservers).toHaveLength(1);
      expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(transcript);
      expect(resizeObservers[0]?.observe).toHaveBeenCalledWith(content);

      clientHeight = 180;
      await act(async () => {
        resizeObservers[0]?.callback([], resizeObservers[0] as ResizeObserver);
        vi.runOnlyPendingTimers();
      });
      expect(scrollTop).toBe(1_020);

      scrollHeight = 1_500;
      await act(async () => {
        transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
        resizeObservers[0]?.callback([], resizeObservers[0] as ResizeObserver);
        vi.runOnlyPendingTimers();
      });
      expect(scrollTop).toBe(1_320);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows transcript chrome only while the user navigates history", async () => {
    const threadId = "thread-scrollbar-intent";
    const thread = {
      ...createAgentThreadState(threadId),
      messages: [
        {
          id: "assistant-1",
          role: "assistant" as const,
          status: "complete" as const,
          parts: [{ type: "text" as const, text: "Earlier response" }],
        },
      ],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const transcript = tree.container.querySelector(
      ".agentkit-transcript",
    ) as HTMLDivElement;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => 1_200 },
    });

    expect(transcript.getAttribute("data-scrollbar-visible")).toBe("false");

    vi.useFakeTimers();
    try {
      await act(async () => {
        transcript.dispatchEvent(new Event("wheel", { bubbles: true }));
      });
      expect(transcript.getAttribute("data-scrollbar-visible")).toBe("true");

      await act(async () => {
        vi.runOnlyPendingTimers();
      });
      expect(transcript.getAttribute("data-scrollbar-visible")).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles work when visible response streaming begins", async () => {
    const threadId = "thread-run-work-order";
    const runId = "run-work-order";
    const userMessage = {
      id: "user-1",
      role: "user" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "Explain this app" }],
    };
    const activityEvent = {
      id: "event-activity",
      threadId,
      runId,
      sequence: 1,
      occurredAt: "2026-08-31T00:00:00.000Z",
      type: "activity.started" as const,
      activity: {
        id: "activity-1",
        kind: "tool",
        label: "Contacting model",
        status: "running" as const,
      },
    };
    const runningThread = {
      ...createAgentThreadState(threadId),
      messages: [userMessage],
      events: [activityEvent],
      runs: {
        [runId]: {
          id: runId,
          status: "running" as const,
          lastSequence: 1,
          startedAt: "2026-08-31T00:00:00.000Z",
        },
      },
      activeRunIds: [runId],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: runningThread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const runWorkBefore = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    );
    expect(runWorkBefore).not.toBeNull();
    expect(runWorkBefore?.open).toBe(false);
    expect(
      runWorkBefore?.querySelector("[data-agentkit-current-activity]")
        ?.textContent,
    ).toBe("Contacting model");

    const assistantMessage = {
      id: "assistant-1",
      role: "assistant" as const,
      status: "streaming" as const,
      parts: [
        {
          type: "reasoning" as const,
          text: "Preparing the response",
          visibility: "summary" as const,
        },
        { type: "text" as const, text: "This app coordinates" },
      ],
    };
    const messageCreatedEvent = {
      id: "event-message-created",
      threadId,
      runId,
      sequence: 2,
      occurredAt: "2026-08-31T00:00:01.000Z",
      type: "message.created" as const,
      message: {
        ...assistantMessage,
        parts: [],
      },
    };
    const reasoningEvent = {
      id: "event-reasoning",
      threadId,
      runId,
      sequence: 3,
      occurredAt: "2026-08-31T00:00:02.000Z",
      type: "reasoning.delta" as const,
      messageId: assistantMessage.id,
      text: "Preparing the response",
    };
    const activityCompletedEvent = {
      ...activityEvent,
      id: "event-activity-completed",
      sequence: 4,
      occurredAt: "2026-08-31T00:00:03.000Z",
      type: "activity.completed" as const,
      activity: {
        ...activityEvent.activity,
        status: "completed" as const,
        completedAt: "2026-08-31T00:00:03.000Z",
      },
    };
    const textEvent = {
      id: "event-text",
      threadId,
      runId,
      sequence: 5,
      occurredAt: "2026-08-31T00:00:04.000Z",
      type: "message.delta" as const,
      messageId: assistantMessage.id,
      text: "This app coordinates",
    };
    const runCompletedEvent = {
      id: "event-run-completed",
      threadId,
      runId,
      sequence: 6,
      occurredAt: "2026-08-31T00:00:08.000Z",
      type: "run.completed" as const,
    };
    observable.update({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: {
        [threadId]: {
          ...runningThread,
          messages: [userMessage, assistantMessage],
          events: [
            activityEvent,
            messageCreatedEvent,
            reasoningEvent,
            activityCompletedEvent,
            textEvent,
          ],
          runs: {
            [runId]: {
              id: runId,
              status: "running" as const,
              lastSequence: 5,
              startedAt: "2026-08-31T00:00:00.000Z",
            },
          },
          activeRunIds: [runId],
        },
      },
      revision: 1,
    });
    await flush();

    const runWorkAfter = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    );
    const response = tree.container.querySelector(
      '[data-message-id="assistant-1"]',
    );
    expect(runWorkAfter).toBe(runWorkBefore);
    expect(runWorkAfter?.open).toBe(false);
    expect(
      runWorkAfter?.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 4s");
    expect(runWorkAfter?.hasAttribute("data-running")).toBe(false);
    expect(runWorkAfter?.querySelector('[data-status="running"]')).toBeNull();
    expect(
      runWorkAfter && response
        ? runWorkAfter.compareDocumentPosition(response) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).not.toBe(0);

    observable.update({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: {
        [threadId]: {
          ...runningThread,
          messages: [
            userMessage,
            {
              ...assistantMessage,
              status: "complete" as const,
              parts: [
                {
                  type: "text" as const,
                  text: "This app coordinates work.",
                },
              ],
            },
          ],
          events: [
            activityEvent,
            messageCreatedEvent,
            reasoningEvent,
            activityCompletedEvent,
            textEvent,
            runCompletedEvent,
          ],
          runs: {
            [runId]: {
              id: runId,
              status: "completed" as const,
              lastSequence: 6,
              startedAt: "2026-08-31T00:00:00.000Z",
              completedAt: "2026-08-31T00:00:08.000Z",
            },
          },
          activeRunIds: [],
        },
      },
      revision: 2,
    });
    await flush();
    expect(
      runWorkAfter?.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 4s");

    await act(async () => {
      runWorkAfter
        ?.querySelector("summary")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(runWorkAfter?.open).toBe(true);
  });

  it("keeps thoughts inside one work disclosure through streaming and completion", async () => {
    const threadId = "thread-reasoning-work";
    const runId = "run-reasoning-work";
    const base = (sequence: number, seconds: number = sequence) => ({
      id: `event-${sequence}`,
      threadId,
      runId,
      sequence,
      occurredAt: `2026-09-28T00:00:${String(seconds).padStart(2, "0")}.000Z`,
    });
    const events: AgentEvent[] = [
      { ...base(1, 0), type: "run.started" },
      {
        ...base(2),
        type: "message.completed",
        message: {
          id: "thought-1",
          role: "assistant",
          status: "complete",
          parts: [
            { type: "reasoning", text: "First thought" },
            { type: "reasoning", text: "Hidden thought", visibility: "hidden" },
          ],
        },
      },
      {
        ...base(3),
        type: "reasoning.delta",
        messageId: "assistant-2",
        text: "Second thought",
      },
      {
        ...base(4),
        type: "activity.started",
        activity: {
          id: "search",
          kind: "search",
          label: "Searching documentation",
          status: "running",
        },
      },
    ];
    let thread = events.reduce(
      reduceAgentEvent,
      createAgentThreadState(threadId),
    );
    const snapshot = (revision: number) => ({
      connection: "connected" as const,
      capabilities: {},
      capabilitiesStatus: "ready" as const,
      threads: { [threadId]: thread },
      revision,
    });
    const observable = observableController(snapshot(0));
    const tree = mount();
    await tree.render(
      <AgentKitProvider
        controller={observable.controller}
        threadId={threadId}
        slots={{
          reasoning: ({ value, active, resetKey }) => (
            <span data-thought={resetKey} data-active={active}>
              {value.text}
            </span>
          ),
        }}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const work = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    )!;
    expect(work.open).toBe(false);
    expect(
      tree.container.querySelectorAll(".agentkit-activities"),
    ).toHaveLength(1);
    expect(tree.container.querySelectorAll("article")).toHaveLength(0);
    expect(
      work.querySelectorAll('[data-activity-bucket="thinking"] [data-thought]'),
    ).toHaveLength(2);
    expect(tree.container.textContent).not.toContain("Hidden thought");
    expect(
      work.querySelector("[data-agentkit-current-activity]")?.textContent,
    ).toBe("Searching documentation");
    expect(
      work
        .querySelector(".agentkit-activities-label")
        ?.nextElementSibling?.classList.contains("agentkit-summary-chevron"),
    ).toBe(true);
    expect(
      work
        .querySelector('[data-thought="thread-reasoning-work:assistant-2:0"]')
        ?.getAttribute("data-active"),
    ).toBe("false");

    thread = reduceAgentEvent(thread, {
      ...base(5, 18),
      type: "message.completed",
      message: {
        id: "assistant-2",
        role: "assistant",
        status: "complete",
        parts: [
          { type: "reasoning", text: "Second thought" },
          { type: "text", text: "Here is the answer." },
        ],
      },
    });
    thread = reduceAgentEvent(thread, {
      ...base(6, 19),
      type: "run.completed",
    });
    await act(async () => observable.update(snapshot(1)));
    await flush();
    expect(tree.container.querySelector(".agentkit-activities")).toBe(work);
    expect(work.open).toBe(false);
    expect(work.querySelector("summary")?.textContent).toBe("Worked for 18s");
    expect(work.querySelector("[data-agentkit-current-activity]")).toBeNull();
    expect(tree.container.querySelectorAll("article")).toHaveLength(1);
    const answer = tree.container.querySelector(
      '[data-message-id="assistant-2"]',
    )!;
    expect(answer.textContent).toContain("Here is the answer.");
    expect(answer.querySelector("[data-thought]")).toBeNull();
    expect(
      work.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    await act(async () => work.querySelector("summary")!.click());
    expect(work.open).toBe(true);
    expect(work.querySelectorAll("[data-thought]")).toHaveLength(2);
    await act(async () => work.querySelector("summary")!.click());
    expect(work.open).toBe(false);
  });

  it.each(["completed", "cancelled"] as const)(
    "keeps reasoning-only %s runs collapsed without empty message rows",
    async (status) => {
      const threadId = "reasoning-only";
      const runId = "run-reasoning-only";
      const message = {
        id: "thought",
        role: "assistant" as const,
        status: "streaming" as const,
        parts: [{ type: "reasoning" as const, text: "Reviewing the request" }],
      };
      const thread = {
        ...createAgentThreadState(threadId),
        messages: [message],
        events: [
          {
            id: "reasoning",
            type: "reasoning.delta" as const,
            threadId,
            runId,
            sequence: 1,
            occurredAt: "2026-09-28T00:00:01.000Z",
            messageId: message.id,
            text: "Reviewing the request",
          },
        ],
        runs: {
          [runId]: {
            id: runId,
            status,
            lastSequence: 1,
            startedAt: "2026-09-28T00:00:00.000Z",
            completedAt: "2026-09-28T00:00:18.000Z",
          },
        },
      };
      const { controller } = observableController({
        connection: "connected",
        capabilities: {},
        capabilitiesStatus: "ready",
        threads: { [threadId]: thread },
        revision: 0,
      });
      const tree = mount();
      await tree.render(
        <AgentKitProvider controller={controller} threadId={threadId}>
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      );
      const work = tree.container.querySelector<HTMLDetailsElement>(
        ".agentkit-activities",
      )!;
      expect(work.open).toBe(false);
      expect(work.querySelector("summary")?.textContent).toBe("Worked for 18s");
      expect(work.querySelector(".agentkit-reasoning")).not.toBeNull();
      expect(
        work.querySelector("[data-active], [data-agentkit-current-activity]"),
      ).toBeNull();
      expect(tree.container.querySelector("article")).toBeNull();
    },
  );

  it("collapses snapshot reasoning without run events and preserves message supplements", async () => {
    const threadId = "restored-reasoning";
    const thread = {
      ...createAgentThreadState(threadId),
      messages: [
        {
          id: "restored",
          role: "assistant" as const,
          status: "complete" as const,
          parts: [
            { type: "reasoning" as const, text: "Earlier thought" },
            {
              type: "reasoning" as const,
              text: "Not public",
              visibility: "hidden" as const,
            },
          ],
        },
      ],
    };
    const { controller } = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();
    await tree.render(
      <AgentKitProvider
        controller={controller}
        threadId={threadId}
        slots={{
          messageSupplement: () => <div data-supplement="true">Supplement</div>,
        }}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const work = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    )!;
    expect(work.open).toBe(false);
    expect(work.querySelector("summary")?.textContent).toBe("Worked");
    expect(work.querySelector(".agentkit-reasoning")?.textContent).toContain(
      "Earlier thought",
    );
    expect(tree.container.textContent).not.toContain("Not public");
    expect(tree.container.querySelector("[data-supplement]")).not.toBeNull();
    expect(tree.container.querySelector("article")).toBeNull();
  });

  it("keeps active work compact and groups expanded history by purpose", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:15.000Z"));
    const threadId = "thread-clustered-work";
    const runId = "run-clustered-work";
    const activities = Array.from({ length: 3 }, (_, index) => ({
      id: `activity-docs-${index}`,
      kind: "search",
      label: "Docs search",
      status: "completed" as const,
      detail: `Result ${index + 1}`,
    }));
    const events: AgentEvent[] = [
      ...activities.map(
        (activity, index): AgentEvent => ({
          id: `event-docs-${index}`,
          threadId,
          runId,
          sequence: index + 1,
          occurredAt: `2026-08-31T00:00:0${index}.000Z`,
          type: "activity.completed",
          activity,
        }),
      ),
      {
        id: "event-model",
        threadId,
        runId,
        sequence: 4,
        occurredAt: "2026-08-31T00:00:04.000Z",
        type: "activity.started",
        activity: {
          id: "activity-model",
          kind: "model",
          label: "Contacting model",
          status: "running",
        },
      },
      {
        id: "event-latest-started",
        threadId,
        runId,
        sequence: 5,
        occurredAt: "2026-08-31T00:00:05.000Z",
        type: "activity.started",
        activity: {
          id: "activity-latest",
          kind: "read",
          label: "Reading a file",
          status: "running",
        },
      },
      {
        id: "event-model-updated",
        threadId,
        runId,
        sequence: 6,
        occurredAt: "2026-08-31T00:00:06.000Z",
        type: "activity.updated",
        activity: {
          id: "activity-model",
          kind: "model",
          label: "Reviewing results",
          status: "running",
        },
      },
    ];
    const thread = {
      ...createAgentThreadState(threadId),
      events,
      runs: {
        [runId]: {
          id: runId,
          status: "running" as const,
          lastSequence: 6,
          startedAt: "2026-08-31T00:00:00.000Z",
        },
      },
      activeRunIds: [runId],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();

    try {
      await tree.render(
        <AgentKitProvider
          controller={observable.controller}
          threadId={threadId}
        >
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      );
      await act(async () => {
        await Promise.resolve();
      });

      const work = tree.container.querySelector<HTMLDetailsElement>(
        ".agentkit-activities",
      );
      const cluster = work?.querySelector<HTMLDetailsElement>(
        ".agentkit-activity-cluster",
      );
      expect(
        work?.querySelector(".agentkit-activities-summary")?.textContent,
      ).toContain("Working for 15s");
      expect(work?.open).toBe(false);
      expect(
        work?.querySelector("[data-agentkit-current-activity]")?.textContent,
      ).toBe("Reviewing results");
      expect(work?.querySelector(".agentkit-activities-count")).toBeNull();
      expect(
        Array.from(
          work?.querySelectorAll("[data-activity-bucket]") ?? [],
          (bucket) => bucket.getAttribute("data-activity-bucket"),
        ),
      ).toEqual(["thinking", "research"]);
      expect(cluster?.open).toBe(false);
      expect(cluster?.querySelector("summary")?.textContent).toContain(
        "Docs search×3",
      );
      expect(
        cluster?.querySelectorAll(".agentkit-activity-cluster-items > *"),
      ).toHaveLength(3);
      await act(async () => {
        work
          ?.querySelector<HTMLElement>(".agentkit-activities-summary")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(work?.open).toBe(true);
      await act(async () => {
        cluster
          ?.querySelector<HTMLElement>("summary")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(cluster?.open).toBe(true);
      expect(
        work?.querySelectorAll(
          '[data-activity-bucket="research"] [data-status="completed"]',
        ),
      ).toHaveLength(3);
      expect(
        work?.querySelectorAll(
          '[data-activity-bucket="thinking"] [data-status="running"]',
        ),
      ).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(
        work?.querySelector(".agentkit-activities-summary")?.textContent,
      ).toContain("Working for 16s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares integration badges between current work and history without mixing providers", async () => {
    const threadId = "thread-tool-sources";
    const runId = "run-tool-sources";
    const tools: AgentToolCall[] = ["slack", "slack", "gong", "figma"].map(
      (provider, index) => ({
        id: `tool-${index}`,
        name: "provider-api-request",
        input: { provider },
        status: provider === "figma" ? "running" : "completed",
      }),
    );
    const thread = {
      ...createAgentThreadState(threadId),
      tools: Object.fromEntries(tools.map((tool) => [tool.id, tool])),
      events: tools.map(
        (tool, index): AgentEvent => ({
          id: `event-${tool.id}`,
          threadId,
          runId,
          sequence: index + 1,
          occurredAt: "2026-09-28T00:00:00.000Z",
          type: "tool.started",
          toolCall: tool,
        }),
      ),
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();
    await tree.render(
      <AgentKitProvider
        controller={observable.controller}
        threadId={threadId}
        registry={{
          toolSource: (tool) => {
            const provider = (tool.input as { provider: string }).provider;
            return {
              id: provider,
              icon: (
                <span
                  role="img"
                  aria-label={provider}
                  data-source-id={provider}
                />
              ),
            };
          },
        }}
      >
        <AgentActivityGroup runId={runId} />
      </AgentKitProvider>,
    );
    const work = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    );
    expect(work?.open).toBe(false);
    expect(
      work?.querySelector(
        '[data-agentkit-current-activity] [data-source-id="figma"]',
      ),
    ).not.toBeNull();
    const clusters = work?.querySelectorAll(".agentkit-activity-cluster");
    expect(clusters).toHaveLength(1);
    expect(
      clusters?.[0]?.querySelector('summary [data-source-id="slack"]'),
    ).not.toBeNull();
    expect(clusters?.[0]?.querySelector("summary")?.textContent).toContain(
      "×2",
    );
    expect(clusters?.[0]?.querySelector('[data-source-id="gong"]')).toBeNull();
    expect(
      work?.querySelector('.agentkit-activities-list [data-source-id="gong"]'),
    ).not.toBeNull();
    await tree.unmount();
  });

  it("keeps generic tool results in collapsed history but preserves rich surfaces", async () => {
    const threadId = "thread-collapsed-tool-results";
    const runId = "run-collapsed-tool-results";
    const genericTool: AgentToolCall = {
      id: "tool-search",
      name: "docs-search",
      input: { query: "workspace defaults" },
      output: "Found the workspace defaults guide.",
      status: "completed",
    };
    const richTool: AgentToolCall = {
      id: "tool-rich-result",
      name: "create-report",
      status: "completed",
    };
    const thread = {
      ...createAgentThreadState(threadId),
      tools: {
        [genericTool.id]: genericTool,
        [richTool.id]: richTool,
      },
      events: [genericTool, richTool].map(
        (tool, index): AgentEvent => ({
          id: `event-${tool.id}`,
          threadId,
          runId,
          sequence: index + 1,
          occurredAt: `2026-08-31T00:00:0${index + 1}.000Z`,
          type: "tool.started",
          toolCall: { ...tool, status: "running" },
        }),
      ),
      runs: {
        [runId]: {
          id: runId,
          status: "completed" as const,
          lastSequence: 2,
          startedAt: "2026-08-31T00:00:00.000Z",
          completedAt: "2026-08-31T00:00:03.000Z",
        },
      },
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();
    const GenericToolRenderer = ({ value }: { value: AgentToolCall }) => (
      <div data-testid="generic-tool-result">{value.name}</div>
    );
    const RichToolRenderer = ({ value }: { value: AgentToolCall }) => (
      <div data-testid="rich-tool-result">{value.name}</div>
    );

    await tree.render(
      <AgentKitProvider
        controller={observable.controller}
        threadId={threadId}
        slots={{ tool: GenericToolRenderer }}
        registry={{ tools: { [richTool.name]: RichToolRenderer } }}
      >
        <AgentActivityGroup runId={runId} />
      </AgentKitProvider>,
    );

    const work = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    );
    const genericResult = tree.container.querySelector(
      '[data-testid="generic-tool-result"]',
    );
    const richResult = tree.container.querySelector(
      '[data-testid="rich-tool-result"]',
    );
    expect(work?.open).toBe(false);
    expect(genericResult?.closest("details")).toBe(work);
    expect(richResult?.closest("details")).toBeNull();
    expect(
      tree.container
        .querySelector("[data-agentkit-tool-results]")
        ?.contains(richResult),
    ).toBe(true);
    await tree.unmount();
  });

  it("keeps failed tools visible while successful work stays collapsed", async () => {
    const threadId = "thread-tool-failure";
    const runId = "run-tool-failure";
    const tools: AgentToolCall[] = [
      {
        id: "read",
        name: "read-file",
        status: "completed",
        output: "Read complete",
      },
      {
        id: "write",
        name: "write-file",
        status: "failed",
        error: {
          code: "write_failed",
          message: "The file could not be saved.",
        },
      },
    ];
    const events = tools.map(
      (toolCall, index): AgentEvent => ({
        id: `event-${index}`,
        threadId,
        runId,
        sequence: index + 1,
        occurredAt: "2026-09-28T00:00:00.000Z",
        type: "tool.updated",
        toolCall,
      }),
    );
    const thread = events.reduce(
      reduceAgentEvent,
      createAgentThreadState(threadId),
    );
    const { controller } = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();
    await tree.render(
      <AgentKitProvider controller={controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const failure = tree.container.querySelector('[role="alert"]');
    expect(failure?.textContent).toContain("The file could not be saved.");
    expect(failure?.closest("details")).toBeNull();
    expect(
      tree.container.querySelector<HTMLDetailsElement>(".agentkit-activities")
        ?.open,
    ).toBe(false);
  });

  it("resets disclosure state when switching threads with reused run ids", async () => {
    const threads = Object.fromEntries(
      ["thread-a", "thread-b"].map((threadId) => [
        threadId,
        reduceAgentEvent(createAgentThreadState(threadId), {
          id: "event-1",
          threadId,
          runId: "run-1",
          sequence: 1,
          occurredAt: "2026-09-28T00:00:00.000Z",
          type: "tool.updated",
          toolCall: { id: "tool-1", name: "read-file", status: "completed" },
        }),
      ]),
    );
    const { controller } = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads,
      revision: 0,
    });
    const tree = mount();
    const render = (threadId: string) =>
      tree.render(
        <AgentKitProvider controller={controller} threadId={threadId}>
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      );
    await render("thread-a");
    const first = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    )!;
    await act(async () => first.querySelector("summary")!.click());
    expect(first.open).toBe(true);
    await render("thread-b");
    expect(
      tree.container.querySelector<HTMLDetailsElement>(".agentkit-activities")
        ?.open,
    ).toBe(false);
  });

  it("keeps internal activity labels out of a restored summary without run state", async () => {
    const threadId = "thread-activity-without-run";
    const runId = "run-activity-without-run";
    const events: AgentEvent[] = [
      "Starting agent",
      "Contacting model",
      "Preparing action",
    ].map((label, index) => ({
      id: `event-${index}`,
      threadId,
      runId,
      sequence: index + 1,
      occurredAt: `2026-08-31T00:00:0${index}.000Z`,
      type: "activity.completed",
      activity: {
        id: `activity-${index}`,
        kind: "tool",
        label,
        status: "completed",
      },
    }));
    const thread = { ...createAgentThreadState(threadId), events };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentActivityGroup runId={runId} />
      </AgentKitProvider>,
    );

    const summary = tree.container.querySelector(
      ".agentkit-activities-summary",
    );
    expect(summary?.textContent).toBe("Worked");
    expect(summary?.textContent).not.toContain("Starting agent");
    expect(summary?.textContent).not.toContain("Contacting model");
    expect(summary?.textContent).not.toContain("3");
    await tree.unmount();
  });

  it("keeps each execution segment between the assistant responses it produced", async () => {
    const threadId = "thread-segmented-run-work";
    const runId = "run-segmented-work";
    const firstResponse = {
      id: "assistant-first",
      role: "assistant" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "I found the relevant files." }],
    };
    const secondResponse = {
      id: "assistant-second",
      role: "assistant" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "The implementation is ready." }],
    };
    const events: AgentEvent[] = [
      {
        id: "event-read-started",
        threadId,
        runId,
        sequence: 1,
        occurredAt: "2026-08-31T00:00:00.000Z",
        type: "activity.started",
        activity: {
          id: "activity-read",
          kind: "read",
          label: "Read framework files",
          status: "running",
        },
      },
      {
        id: "event-first-response",
        threadId,
        runId,
        sequence: 2,
        occurredAt: "2026-08-31T00:00:01.000Z",
        type: "message.completed",
        message: firstResponse,
      },
      {
        id: "event-read-completed",
        threadId,
        runId,
        sequence: 3,
        occurredAt: "2026-08-31T00:00:02.000Z",
        type: "activity.completed",
        activity: {
          id: "activity-read",
          kind: "read",
          label: "Read framework files",
          status: "completed",
        },
      },
      {
        id: "event-edit-started",
        threadId,
        runId,
        sequence: 4,
        occurredAt: "2026-08-31T00:00:03.000Z",
        type: "activity.started",
        activity: {
          id: "activity-edit",
          kind: "write",
          label: "Edited transcript model",
          status: "running",
        },
      },
      {
        id: "event-edit-completed",
        threadId,
        runId,
        sequence: 5,
        occurredAt: "2026-08-31T00:00:04.000Z",
        type: "activity.completed",
        activity: {
          id: "activity-edit",
          kind: "write",
          label: "Edited transcript model",
          status: "completed",
        },
      },
      {
        id: "event-second-response",
        threadId,
        runId,
        sequence: 6,
        occurredAt: "2026-08-31T00:00:05.000Z",
        type: "message.completed",
        message: secondResponse,
      },
    ];
    const thread = {
      ...createAgentThreadState(threadId),
      messages: [firstResponse, secondResponse],
      events,
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const work = Array.from(
      tree.container.querySelectorAll<HTMLDetailsElement>(
        ".agentkit-activities",
      ),
    );
    const firstMessage = tree.container.querySelector(
      '[data-message-id="assistant-first"]',
    );
    const secondMessage = tree.container.querySelector(
      '[data-message-id="assistant-second"]',
    );
    expect(work).toHaveLength(2);
    expect(
      work[0]?.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 1s");
    expect(
      work[1]?.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 2s");
    expect(work[0]?.textContent).toContain("Read framework files");
    expect(work[0]?.textContent).not.toContain("Edited transcript model");
    expect(work[1]?.textContent).toContain("Edited transcript model");
    expect(work[1]?.textContent).not.toContain("Read framework files");
    expect(work[0]?.hasAttribute("data-running")).toBe(false);
    expect(
      work[0] && firstMessage
        ? work[0].compareDocumentPosition(firstMessage) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).not.toBe(0);
    expect(
      firstMessage && work[1]
        ? firstMessage.compareDocumentPosition(work[1]) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).not.toBe(0);
    expect(
      work[1] && secondMessage
        ? work[1].compareDocumentPosition(secondMessage) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).not.toBe(0);
  });

  it("formats completed run durations without noisy zero units", () => {
    expect(formatAgentKitDuration(400)).toBe("1s");
    expect(formatAgentKitDuration(125_000)).toBe("2m 5s");
    expect(formatAgentKitDuration(3_900_000)).toBe("1h 5m");
    expect(
      formatAgentKitDuration(125_000, {
        minute: " min",
        second: " sec",
      }),
    ).toBe("2 min 5 sec");
  });

  it("keeps pending work collapsed when the next response arrives", async () => {
    const threadId = "thread-pending-run-work";
    const runId = "run-pending-work";
    const firstResponse = {
      id: "assistant-first",
      role: "assistant" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "I will update the framework." }],
    };
    const firstResponseEvent: AgentEvent = {
      id: "event-first-response",
      threadId,
      runId,
      sequence: 1,
      occurredAt: "2026-08-31T00:00:00.000Z",
      type: "message.completed",
      message: firstResponse,
    };
    const runningActivityEvent: AgentEvent = {
      id: "event-edit-started",
      threadId,
      runId,
      sequence: 2,
      occurredAt: "2026-08-31T00:00:01.000Z",
      type: "activity.started",
      activity: {
        id: "activity-edit",
        kind: "write",
        label: "Edited framework files",
        status: "running",
      },
    };
    const runningThread = {
      ...createAgentThreadState(threadId),
      messages: [firstResponse],
      events: [firstResponseEvent, runningActivityEvent],
      activeRunIds: [runId],
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: runningThread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const pendingBefore = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    );
    expect(pendingBefore?.open).toBe(false);
    expect(pendingBefore?.getAttribute("data-running")).toBe("true");
    expect(
      pendingBefore?.querySelector("[data-agentkit-current-activity]")
        ?.textContent,
    ).toBe("Edited framework files");

    const secondResponse = {
      id: "assistant-second",
      role: "assistant" as const,
      status: "complete" as const,
      parts: [{ type: "text" as const, text: "The framework is updated." }],
    };
    const completedActivityEvent: AgentEvent = {
      ...runningActivityEvent,
      id: "event-edit-completed",
      sequence: 3,
      occurredAt: "2026-08-31T00:00:02.000Z",
      type: "activity.completed",
      activity: {
        ...runningActivityEvent.activity,
        status: "completed",
      },
    };
    const secondResponseEvent: AgentEvent = {
      id: "event-second-response",
      threadId,
      runId,
      sequence: 4,
      occurredAt: "2026-08-31T00:00:03.000Z",
      type: "message.completed",
      message: secondResponse,
    };
    observable.update({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: {
        [threadId]: {
          ...runningThread,
          messages: [firstResponse, secondResponse],
          events: [
            firstResponseEvent,
            runningActivityEvent,
            completedActivityEvent,
            secondResponseEvent,
          ],
          activeRunIds: [],
        },
      },
      revision: 1,
    });
    await flush();

    const pendingAfter = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    );
    const secondMessage = tree.container.querySelector(
      '[data-message-id="assistant-second"]',
    );
    expect(pendingAfter).toBe(pendingBefore);
    expect(pendingAfter?.open).toBe(false);
    expect(pendingAfter?.hasAttribute("data-running")).toBe(false);
    expect(
      pendingAfter && secondMessage
        ? pendingAfter.compareDocumentPosition(secondMessage) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).not.toBe(0);
  });

  it("does not move later work ahead of an already emitted response", async () => {
    const threadId = "thread-streamed-response-boundary";
    const runId = "run-streamed-response-boundary";
    const response = {
      id: "assistant-commentary",
      role: "assistant" as const,
      status: "complete" as const,
      parts: [
        {
          type: "text" as const,
          text: "I found the boundary and will update it now.",
        },
      ],
    };
    const events: AgentEvent[] = [
      {
        id: "event-message-created",
        threadId,
        runId,
        sequence: 1,
        occurredAt: "2026-08-31T00:00:00.000Z",
        type: "message.created",
        message: { ...response, status: "streaming" },
      },
      {
        id: "event-edit-started",
        threadId,
        runId,
        sequence: 2,
        occurredAt: "2026-08-31T00:00:01.000Z",
        type: "activity.started",
        activity: {
          id: "activity-edit",
          kind: "write",
          label: "Edited lifecycle reducer",
          status: "running",
        },
      },
      {
        id: "event-edit-completed",
        threadId,
        runId,
        sequence: 3,
        occurredAt: "2026-08-31T00:00:02.000Z",
        type: "activity.completed",
        activity: {
          id: "activity-edit",
          kind: "write",
          label: "Edited lifecycle reducer",
          status: "completed",
        },
      },
      {
        id: "event-message-completed",
        threadId,
        runId,
        sequence: 4,
        occurredAt: "2026-08-31T00:00:03.000Z",
        type: "message.completed",
        message: response,
      },
    ];
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: {
        [threadId]: {
          ...createAgentThreadState(threadId),
          messages: [response],
          events,
        },
      },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const message = tree.container.querySelector(
      '[data-message-id="assistant-commentary"]',
    );
    const work = tree.container.querySelector(".agentkit-activities");
    expect(
      message && work
        ? message.compareDocumentPosition(work) &
            Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).not.toBe(0);
  });

  it("collapses terminal work even when its item completion events were omitted", async () => {
    const threadId = "thread-terminal-work";
    const runId = "run-terminal-work";
    const thread = {
      ...createAgentThreadState(threadId),
      events: [
        {
          id: "event-activity-started",
          threadId,
          runId,
          sequence: 1,
          occurredAt: "2026-08-31T00:00:00.000Z",
          type: "activity.started" as const,
          activity: {
            id: "activity-1",
            kind: "tool",
            label: "Inspect workspace",
            status: "running" as const,
          },
        },
        {
          id: "event-tool-started",
          threadId,
          runId,
          sequence: 2,
          occurredAt: "2026-08-31T00:00:01.000Z",
          type: "tool.started" as const,
          toolCall: {
            id: "tool-1",
            name: "Inspect workspace",
            status: "running" as const,
          },
        },
      ],
      activities: {
        "activity-1": {
          id: "activity-1",
          kind: "tool" as const,
          label: "Inspect workspace",
          status: "completed" as const,
        },
      },
      tools: {
        "tool-1": {
          id: "tool-1",
          name: "Inspect workspace",
          status: "completed" as const,
        },
      },
      runs: {
        [runId]: {
          id: runId,
          status: "completed" as const,
          lastSequence: 3,
          startedAt: "2026-08-31T00:00:00.000Z",
          completedAt: "2026-08-31T00:00:02.000Z",
        },
      },
    };
    const observable = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [threadId]: thread },
      revision: 0,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={observable.controller} threadId={threadId}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const work = tree.container.querySelector<HTMLDetailsElement>(
      ".agentkit-activities",
    );
    expect(work?.open).toBe(false);
    expect(work?.hasAttribute("data-running")).toBe(false);
    expect(
      work?.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 2s");
    expect(work?.querySelector('[data-status="running"]')).toBeNull();
  });

  it("is SSR-safe and rejects ambiguous ownership at runtime", () => {
    const fetcher = vi.fn(() => {
      throw new Error("SSR must not start network work");
    });

    const html = renderToStaticMarkup(
      <AgentChat
        endpoint="/_agent-native/agentkit"
        http={{ fetch: fetcher }}
        threadId="thread-ssr"
      />,
    );

    expect(html).toContain("agentkit-chat");
    expect(fetcher).not.toHaveBeenCalled();

    const client = new AgentKitClient({ transport: baseTransport() });
    expect(() =>
      renderToStaticMarkup(
        <AgentChat
          {...({ client, transport: baseTransport() } as never)}
          threadId="thread-invalid"
        />,
      ),
    ).toThrow(/exactly one client, transport, or HTTP endpoint/);
  });

  it("forwards every HTTP lifecycle option to the managed transport", async () => {
    const streamRequested = Promise.withResolvers<void>();
    const lifecycle = new AbortController();
    let streamSignal: AbortSignal | undefined;
    let streamCorrelationId: string | null = null;
    let streamProductHeader: string | null = null;
    const handler = createAgentKitHttpHandler({
      transport: {
        async startRun() {
          return { runId: "run-active" };
        },
        async *subscribeToRun({ threadId, runId, signal }) {
          yield {
            id: "event-1",
            threadId,
            runId,
            sequence: 1,
            occurredAt: "2026-08-29T00:00:00.000Z",
            type: "run.started",
          } satisfies AgentEvent;
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else
              signal?.addEventListener("abort", () => resolve(), {
                once: true,
              });
          });
        },
        async cancelRun() {},
      },
    });
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/events?")) {
        const headers = new Headers(init?.headers);
        streamSignal = init?.signal ?? undefined;
        streamCorrelationId = headers.get("x-agentkit-correlation-id");
        streamProductHeader = headers.get("x-product");
        streamRequested.resolve();
      }
      return handler(new Request(input, init));
    };
    const tree = mount();

    await tree.render(
      <AgentKitRoot
        endpoint="https://agentkit.test/agentkit"
        http={{
          fetch: fetcher,
          headers: async () => ({ "x-product": "chat" }),
          createCorrelationId: () => "react-http-correlation",
          signal: lifecycle.signal,
        }}
        threadId="thread-http-options"
        load="manual"
      >
        <RunSubscriptionProbe />
      </AgentKitRoot>,
    );
    await streamRequested.promise;

    expect(streamCorrelationId).toBe("react-http-correlation");
    expect(streamProductHeader).toBe("chat");
    expect(streamSignal?.aborted).toBe(false);

    lifecycle.abort("surface released");
    await flush();

    expect(streamSignal?.aborted).toBe(true);
  });

  it("deduplicates Strict Mode loads and keeps one managed client across thread changes", async () => {
    const signals: AbortSignal[] = [];
    const getThreadSnapshot = vi.fn(
      async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        messages: [],
        activeRunIds: [`run-${threadId}`],
        runs: [{ id: `run-${threadId}`, status: "running" as const }],
      }),
    );
    const transport: AgentTransport = {
      ...baseTransport(),
      getThreadSnapshot,
      async *subscribeToRun({ signal }) {
        if (!signal)
          throw new Error("Managed streams require a release signal.");
        signals.push(signal);
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    };
    const dispose = vi.spyOn(AgentKitClient.prototype, "dispose");
    const tree = mount();

    await tree.render(
      <StrictMode>
        <AgentChat
          transport={transport}
          threadId="thread-one"
          composer={false}
        />
      </StrictMode>,
    );
    await flush();

    expect(getThreadSnapshot).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();

    await tree.render(
      <StrictMode>
        <AgentChat
          transport={transport}
          threadId="thread-one"
          composer={false}
          onLoadError={vi.fn()}
        />
      </StrictMode>,
    );
    await flush();

    expect(getThreadSnapshot).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);

    await tree.render(
      <StrictMode>
        <AgentChat
          transport={transport}
          threadId="thread-two"
          composer={false}
        />
      </StrictMode>,
    );
    await flush();

    expect(getThreadSnapshot).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(dispose).not.toHaveBeenCalled();

    await tree.unmount();
    await flush();

    expect(signals[1]?.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes each owned transport exactly once across Strict Mode and thread changes", async () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const firstTransport: AgentTransport = {
      ...baseTransport(),
      dispose: firstDispose,
    };
    const secondTransport: AgentTransport = {
      ...baseTransport(),
      dispose: secondDispose,
    };
    const tree = mount();

    await tree.render(
      <StrictMode>
        <AgentChat
          transport={firstTransport}
          clientOptions={{ transportOwnership: "owned" }}
          threadId="thread-one"
          load="manual"
          composer={false}
        />
      </StrictMode>,
    );
    await flush();

    expect(firstDispose).not.toHaveBeenCalled();

    await tree.render(
      <StrictMode>
        <AgentChat
          transport={secondTransport}
          clientOptions={{ transportOwnership: "owned" }}
          threadId="thread-two"
          load="manual"
          composer={false}
        />
      </StrictMode>,
    );
    await flush();

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).not.toHaveBeenCalled();

    await tree.unmount();
    await flush();

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledTimes(1);
  });

  it("never disposes a caller-owned client and releases obsolete load callbacks", async () => {
    let rejectFirst!: (error: Error) => void;
    const firstLoad = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const getThreadSnapshot = vi.fn(({ threadId }: { threadId: string }) => {
      if (threadId === "thread-one") return firstLoad;
      return Promise.resolve({
        id: threadId,
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        messages: [],
      });
    });
    const transport: AgentTransport = {
      ...baseTransport(),
      getThreadSnapshot,
    };
    const client = new AgentKitClient({ transport });
    const dispose = vi.spyOn(client, "dispose");
    const onLoadError = vi.fn();
    const tree = mount();

    await tree.render(
      <AgentChat
        client={client}
        threadId="thread-one"
        onLoadError={onLoadError}
        composer={false}
      />,
    );
    await tree.render(
      <AgentChat
        client={client}
        threadId="thread-two"
        onLoadError={onLoadError}
        composer={false}
      />,
    );
    rejectFirst(new Error("obsolete load failed"));
    await flush();

    expect(onLoadError).not.toHaveBeenCalled();
    expect(client.getSnapshot().connection).toBe("connected");
    expect(
      getThreadSnapshot.mock.calls.filter(
        ([request]) => request.threadId === "thread-two",
      ),
    ).toHaveLength(2);
    await tree.unmount();
    await flush();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("releases caller-owned thread subscriptions without disposing the client", async () => {
    const signals = new Map<string, AbortSignal>();
    const transport: AgentTransport = {
      ...baseTransport(),
      async getThreadSnapshot({ threadId }) {
        return {
          id: threadId,
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
          messages: [],
          activeRunIds: [`run-${threadId}`],
          runs: [{ id: `run-${threadId}`, status: "running" as const }],
        };
      },
      async *subscribeToRun({ threadId, signal }) {
        if (!signal) throw new Error("Thread leases require release signals.");
        signals.set(threadId, signal);
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    };
    const client = new AgentKitClient({ transport });
    const dispose = vi.spyOn(client, "dispose");
    const tree = mount();

    await tree.render(
      <AgentChat client={client} threadId="thread-one" composer={false} />,
    );
    await flush();
    await tree.render(
      <AgentChat client={client} threadId="thread-two" composer={false} />,
    );
    await flush();

    expect(signals.get("thread-one")?.aborted).toBe(true);
    expect(signals.get("thread-two")?.aborted).toBe(false);
    expect(dispose).not.toHaveBeenCalled();

    await tree.unmount();
    await flush();
    expect(signals.get("thread-two")?.aborted).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("AgentKit subscriptions and recovery", () => {
  it("honors explicit thread ids on advanced controls", async () => {
    const snapshot: AgentKitSnapshot = {
      connection: "connected",
      capabilities: { feedback: true },
      capabilitiesStatus: "ready",
      threads: {},
      revision: 0,
    };
    const store = observableController(snapshot);
    const submitFeedback = vi.fn(async () => undefined);
    Object.assign(store.controller, { submitFeedback });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={store.controller} threadId="thread-context">
        <AgentMessageActions
          threadId="thread-explicit"
          value={{
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "Ready." }],
          }}
        />
      </AgentKitProvider>,
    );
    const helpful = tree.container.querySelector(
      'button[aria-label="Helpful"]',
    );
    await act(async () => {
      helpful?.click();
      await Promise.resolve();
    });

    expect(submitFeedback).toHaveBeenCalledWith(
      "thread-explicit",
      "assistant-1",
      "positive",
    );
    expect(helpful?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      helpful?.click();
      await Promise.resolve();
    });
    expect(submitFeedback).toHaveBeenCalledTimes(1);

    const notHelpful = tree.container.querySelector(
      'button[aria-label="Not helpful"]',
    );
    await act(async () => {
      notHelpful?.click();
      await Promise.resolve();
    });
    expect(submitFeedback).toHaveBeenLastCalledWith(
      "thread-explicit",
      "assistant-1",
      "negative",
    );
    expect(helpful?.getAttribute("aria-pressed")).toBe("false");
    expect(notHelpful?.getAttribute("aria-pressed")).toBe("true");
  });

  it("copies both message roles and completes a fork with visible state", async () => {
    const snapshot: AgentKitSnapshot = {
      connection: "connected",
      capabilities: { feedback: true, threadForking: true },
      capabilitiesStatus: "ready",
      threads: {},
      revision: 0,
    };
    const store = observableController(snapshot);
    const forkedThread = {
      id: "thread-forked",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    };
    const forkThread = vi.fn(async () => forkedThread);
    Object.assign(store.controller, { forkThread });
    const onThreadForked = vi.fn();
    const writeText = vi.fn(async () => undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const tree = mount();

    try {
      await tree.render(
        <AgentKitProvider
          controller={store.controller}
          threadId="thread-context"
          onThreadForked={onThreadForked}
        >
          <AgentMessageActions
            threadId="thread-explicit"
            value={{
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Question?" }],
            }}
          />
          <AgentMessageActions
            threadId="thread-explicit"
            value={{
              id: "assistant-1",
              role: "assistant",
              parts: [{ type: "text", text: "Ready." }],
            }}
          />
        </AgentKitProvider>,
      );
      const assistantActions = tree.container.querySelectorAll(
        ".agentkit-message-actions",
      )[1];
      expect(
        Array.from(
          assistantActions?.querySelectorAll(
            ".agentkit-message-actions-leading button",
          ) ?? [],
        ).map((button) => button.getAttribute("aria-label")),
      ).toEqual(["Copy message", "Helpful", "Not helpful"]);
      expect(
        assistantActions?.querySelector(".agentkit-message-actions-trailing"),
      ).toBeTruthy();
      expect(
        assistantActions
          ?.querySelector(
            '.agentkit-message-actions-trailing button[aria-label="Message actions"]',
          )
          ?.getAttribute("aria-expanded"),
      ).toBe("false");
      const copyButtons = tree.container.querySelectorAll(
        'button[aria-label="Copy message"]',
      );
      await act(async () => {
        (copyButtons[0] as HTMLButtonElement | undefined)?.click();
        await Promise.resolve();
      });
      await act(async () => {
        (copyButtons[1] as HTMLButtonElement | undefined)?.click();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenNthCalledWith(1, "Question?");
      expect(writeText).toHaveBeenNthCalledWith(2, "Ready.");
      expect(
        tree.container.querySelectorAll('button[aria-label="Copied"]'),
      ).toHaveLength(2);

      const more = assistantActions?.querySelector(
        'button[aria-label="Message actions"]',
      );
      await act(async () => {
        more?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        await Promise.resolve();
      });
      const fork = Array.from(
        document.body.querySelectorAll(
          '.agentkit-message-menu [role="menuitem"]',
        ),
      ).find((button) => button.textContent?.trim() === "Fork conversation");
      expect(fork).toBeTruthy();
      await act(async () => {
        (fork as HTMLButtonElement | null)?.click();
        await Promise.resolve();
      });
      expect(forkThread).toHaveBeenCalledWith("thread-explicit", "assistant-1");
      expect(onThreadForked).toHaveBeenCalledWith(forkedThread);
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  it("copies the assistant request ID from the inline message actions", async () => {
    const thread = createAgentThreadState("thread-request-id");
    thread.messages = [
      {
        id: "assistant-request-id",
        role: "assistant",
        parts: [{ type: "text", text: "Ready." }],
        metadata: { runId: "server-run-id" },
      },
    ];
    const snapshot: AgentKitSnapshot = {
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [thread.id]: thread },
      revision: 0,
    };
    const store = observableController(snapshot);
    const writeText = vi.fn(async () => undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const tree = mount();

    try {
      await tree.render(
        <AgentKitProvider
          controller={store.controller}
          threadId="thread-request-id"
        >
          <AgentMessageActions
            threadId="thread-request-id"
            value={thread.messages[0]!}
          />
        </AgentKitProvider>,
      );
      const trigger = tree.container.querySelector(
        'button[aria-label="Message actions"]',
      );
      expect(trigger).toBeTruthy();
      expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
      expect(trigger?.getAttribute("aria-expanded")).toBe("false");
      const leadingActions = tree.container.querySelector(
        ".agentkit-message-actions-leading",
      );
      expect(
        Array.from(leadingActions?.querySelectorAll("button") ?? []).map(
          (button) => button.getAttribute("aria-label"),
        ),
      ).toEqual(["Copy message"]);
      expect(
        tree.container.querySelector(".agentkit-message-actions-trailing"),
      ).toBeTruthy();
      await act(async () => {
        (trigger as HTMLElement | null)?.focus();
        trigger?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
        );
        await Promise.resolve();
      });
      expect(
        tree.container
          .querySelector(".agentkit-message-actions")
          ?.querySelector('[aria-label="Message actions"]')
          ?.getAttribute("aria-expanded"),
      ).toBe("true");
      const actionMenu = document.body.querySelector(
        '.agentkit-message-menu[role="menu"]',
      );
      expect(actionMenu).toBeTruthy();
      const requestIdButton = Array.from(
        actionMenu?.querySelectorAll('[role="menuitem"]') ?? [],
      ).find((button) => button.textContent?.trim() === "Copy request ID");
      expect(requestIdButton).toBeTruthy();
      await act(async () => {
        requestIdButton?.click();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith("server-run-id");
      expect(
        tree.container.querySelector('button[aria-label="Message actions"]'),
      ).toBeTruthy();
      expect(trigger?.getAttribute("aria-expanded")).toBe("false");
      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        await Promise.resolve();
      });
      expect(trigger?.getAttribute("aria-expanded")).toBe("true");
      const copiedRequestId = Array.from(
        document.body.querySelectorAll(
          '.agentkit-message-menu [role="menuitem"]',
        ),
      ).find((button) => button.textContent?.trim() === "Copied");
      expect(copiedRequestId).toBeTruthy();
      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        await Promise.resolve();
      });
      expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
      await tree.unmount();
    }
  });

  it("omits request ID actions when the message has no request ID", async () => {
    const thread = createAgentThreadState("thread-no-request-id");
    thread.messages = [
      {
        id: "assistant-no-request-id",
        role: "assistant",
        parts: [{ type: "text", text: "Ready." }],
      },
    ];
    const store = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { [thread.id]: thread },
      revision: 0,
    });
    const tree = mount();

    try {
      await tree.render(
        <AgentKitProvider
          controller={store.controller}
          threadId="thread-no-request-id"
        >
          <AgentMessageActions
            threadId="thread-no-request-id"
            value={thread.messages[0]!}
          />
        </AgentKitProvider>,
      );
      const trigger = tree.container.querySelector(
        'button[aria-label="Message actions"]',
      );
      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        await Promise.resolve();
      });

      const actionMenu = document.body.querySelector(
        '.agentkit-message-menu[role="menu"]',
      );
      expect(actionMenu).toBeTruthy();
      expect(actionMenu?.textContent).not.toContain("Request ID unavailable");
      expect(actionMenu?.textContent).not.toContain("Copy request ID");
    } finally {
      await tree.unmount();
    }
  });

  it("uses selector equality without caching a changed selector", async () => {
    const initial: AgentKitSnapshot = {
      connection: "idle",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: {},
      revision: 0,
    };
    const store = observableController(initial);
    let renders = 0;
    function Selection({ field }: { field: "connection" | "error" }) {
      renders += 1;
      const value = useAgentKitSelector((snapshot) =>
        field === "connection"
          ? snapshot.connection
          : (snapshot.error?.message ?? "none"),
      );
      return <span>{value}</span>;
    }
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={store.controller} threadId="thread-one">
        <Selection field="connection" />
      </AgentKitProvider>,
    );
    expect(renders).toBe(1);

    act(() => {
      store.update({
        ...initial,
        error: { code: "offline", message: "Disconnected", retryable: true },
        revision: 1,
      });
    });
    expect(renders).toBe(1);

    await tree.render(
      <AgentKitProvider controller={store.controller} threadId="thread-one">
        <Selection field="error" />
      </AgentKitProvider>,
    );
    expect(tree.container.textContent).toBe("Disconnected");
    expect(renders).toBe(2);
  });

  it("resets client-effect dedupe for both client and thread changes", async () => {
    const event = {
      id: "shared-event-id",
      threadId: "thread-one",
      runId: "run-1",
      sequence: 1,
      occurredAt: "2026-08-29T00:00:00.000Z",
      type: "client.effect",
      name: "focus-editor",
    } satisfies AgentEvent;
    const threadOne = {
      ...createAgentThreadState("thread-one"),
      events: [event],
    };
    const threadTwo = {
      ...createAgentThreadState("thread-two"),
      events: [{ ...event, threadId: "thread-two" }],
    };
    const snapshot = {
      connection: "connected" as const,
      capabilities: {},
      capabilitiesStatus: "ready" as const,
      threads: { "thread-one": threadOne, "thread-two": threadTwo },
      revision: 1,
    };
    const first = observableController(snapshot);
    const second = observableController(snapshot);
    const onClientEffect = vi.fn();
    const tree = mount();

    await tree.render(
      <AgentKitProvider
        controller={first.controller}
        threadId="thread-one"
        onClientEffect={onClientEffect}
      >
        <span />
      </AgentKitProvider>,
    );
    await tree.render(
      <AgentKitProvider
        controller={first.controller}
        threadId="thread-two"
        onClientEffect={onClientEffect}
      >
        <span />
      </AgentKitProvider>,
    );
    await tree.render(
      <AgentKitProvider
        controller={second.controller}
        threadId="thread-two"
        onClientEffect={onClientEffect}
      >
        <span />
      </AgentKitProvider>,
    );

    expect(onClientEffect).toHaveBeenCalledTimes(3);
  });

  it("keeps failed recovery focused and hides stale errors after recovery", async () => {
    const thread = createAgentThreadState("thread-one");
    const failed: AgentKitSnapshot = {
      connection: "error",
      capabilities: {},
      capabilitiesStatus: "error",
      threads: { "thread-one": thread },
      error: { code: "offline", message: "Connection lost", retryable: true },
      revision: 1,
    };
    const store = observableController(failed);
    let recover = false;
    vi.mocked(store.controller.loadThread).mockImplementation(async () => {
      if (!recover) throw new Error("Still offline");
      store.update({ ...failed, connection: "connected", revision: 2 });
      return thread;
    });
    const tree = mount();
    await tree.render(
      <AgentKitProvider controller={store.controller} threadId="thread-one">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    const button = tree.container.querySelector("button");
    expect(button?.textContent).toContain("Reconnect");
    button?.focus();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(button);
    expect(tree.container.textContent).toContain("Still offline");

    recover = true;
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(tree.container.textContent).not.toContain("Connection lost");
    expect(tree.container.textContent).not.toContain("Still offline");
  });

  it("removes a resolved approval and restores composer focus", async () => {
    const thread = {
      ...createAgentThreadState("thread-approval"),
      approvals: {
        "approval-1": {
          id: "approval-1",
          title: "Apply the release changes?",
        },
      },
      approvalRunIds: { "approval-1": "run-1" },
    };
    const initial: AgentKitSnapshot = {
      connection: "connected",
      capabilities: { approvals: true },
      capabilitiesStatus: "ready",
      threads: { "thread-approval": thread },
      revision: 1,
    };
    const store = observableController(initial);
    vi.mocked(store.controller.resolveApproval).mockImplementation(async () => {
      store.update({
        ...initial,
        threads: {
          "thread-approval": {
            ...thread,
            approvals: {},
            approvalRunIds: {},
          },
        },
        revision: 2,
      });
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider
        controller={store.controller}
        threadId="thread-approval"
      >
        <AgentKitChat composer={false} />
        <ComposerFocusTarget />
      </AgentKitProvider>,
    );
    const approve = Array.from(tree.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Approve",
    );

    await act(async () => {
      approve?.click();
      await Promise.resolve();
    });
    await flush();

    expect(tree.container.textContent).not.toContain(
      "Apply the release changes?",
    );
    expect(document.activeElement?.textContent).toBe("Composer focus target");
  });

  it("offers and submits a custom response for choice prompts by default", async () => {
    const thread = {
      ...createAgentThreadState("thread-choice"),
      approvals: {
        "choice-1": {
          id: "choice-1",
          title: "How should the report be structured?",
          kind: "choice" as const,
          options: [
            { id: "brief", label: "Brief" },
            { id: "detailed", label: "Detailed" },
          ],
        },
      },
      approvalRunIds: { "choice-1": "run-1" },
    };
    const store = observableController({
      connection: "connected",
      capabilities: { approvals: true },
      capabilitiesStatus: "ready",
      threads: { "thread-choice": thread },
      revision: 1,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={store.controller} threadId="thread-choice">
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const otherButton = Array.from(
      tree.container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Other");

    await act(async () => {
      otherButton?.click();
      await Promise.resolve();
    });

    const input = tree.container.querySelector<HTMLInputElement>(
      'input[placeholder="Type your answer"]',
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(input, "Use a two-column comparison");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    const submit = Array.from(tree.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Submit",
    );
    expect(submit?.disabled).toBe(false);

    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(store.controller.resolveApproval).toHaveBeenCalledWith({
      threadId: "thread-choice",
      runId: "run-1",
      approvalId: "choice-1",
      response: {
        decision: "approve",
        optionIds: undefined,
        other: "Use a two-column comparison",
        input: undefined,
      },
    });
  });

  it("lets hosts explicitly disable custom choice responses", async () => {
    const thread = {
      ...createAgentThreadState("thread-fixed-choice"),
      approvals: {
        "choice-1": {
          id: "choice-1",
          title: "Choose a release channel",
          kind: "choice" as const,
          allowOther: false,
          options: [{ id: "stable", label: "Stable" }],
        },
      },
      approvalRunIds: { "choice-1": "run-1" },
    };
    const store = observableController({
      connection: "connected",
      capabilities: { approvals: true },
      capabilitiesStatus: "ready",
      threads: { "thread-fixed-choice": thread },
      revision: 1,
    });
    const tree = mount();

    await tree.render(
      <AgentKitProvider
        controller={store.controller}
        threadId="thread-fixed-choice"
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );

    expect(tree.container.textContent).not.toContain("Other");
  });

  it("resolves a contextual connection card through the host callback", async () => {
    const thread = {
      ...createAgentThreadState("thread-connection"),
      connectionRequests: {
        "connection-1": {
          id: "connection-1",
          provider: "slack",
          reason: "connect" as const,
          status: "requested" as const,
        },
      },
      connectionRequestRunIds: { "connection-1": "run-1" },
    };
    const initial: AgentKitSnapshot = {
      connection: "connected",
      capabilities: { connectionRequests: true },
      capabilitiesStatus: "ready",
      threads: { "thread-connection": thread },
      revision: 1,
    };
    const store = observableController(initial);
    const connect = vi.fn(async () => ({
      status: "connected" as const,
      connectionId: "workspace-slack",
    }));
    const tree = mount();

    await tree.render(
      <AgentKitProvider
        controller={store.controller}
        threadId="thread-connection"
        onConnectionRequest={connect}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const button = Array.from(tree.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Connect",
    );
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "slack", reason: "connect" }),
    );
    expect(store.controller.resolveConnectionRequest).toHaveBeenCalledWith({
      threadId: "thread-connection",
      runId: "run-1",
      requestId: "connection-1",
      response: {
        status: "connected",
        connectionId: "workspace-slack",
      },
    });
  });

  it("leaves a workspace request pending while its connection callback redirects", async () => {
    const threadId = "thread-workspace-connection";
    const store = observableController({
      connection: "connected",
      capabilities: { connectionRequests: true },
      capabilitiesStatus: "ready",
      threads: { [threadId]: createAgentThreadState(threadId) },
      revision: 1,
    });
    const request = {
      id: "connection-google-drive",
      provider: "google_drive",
      reason: "connect" as const,
      status: "requested" as const,
    };
    const onConnect = vi.fn(async () => undefined);
    const tree = mount();

    await tree.render(
      <AgentKitProvider controller={store.controller} threadId={threadId}>
        <AgentConnectionRequestCard
          request={request}
          runId="run-1"
          providerLabel="Google Drive"
          onConnect={onConnect}
        />
      </AgentKitProvider>,
    );
    const button = Array.from(tree.container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Connect",
    );
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(tree.container.textContent).toContain("Connect Google Drive");
    expect(onConnect).toHaveBeenCalledWith(request);
    expect(store.controller.resolveConnectionRequest).not.toHaveBeenCalled();
  });

  it("renders a pre-connection-request controller projection", async () => {
    const legacyThread = createAgentThreadState("thread-legacy") as ReturnType<
      typeof createAgentThreadState
    > & { connectionRequests?: undefined };
    delete legacyThread.connectionRequests;
    const store = observableController({
      connection: "connected",
      capabilities: {},
      capabilitiesStatus: "ready",
      threads: { "thread-legacy": legacyThread },
      revision: 1,
    } as AgentKitSnapshot);
    const tree = mount();

    await expect(
      tree.render(
        <AgentKitProvider
          controller={store.controller}
          threadId="thread-legacy"
        >
          <AgentKitChat composer={false} />
        </AgentKitProvider>,
      ),
    ).resolves.toBeUndefined();
  });
});
