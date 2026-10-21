// @vitest-environment happy-dom

import { act, createElement } from "react";
// @ts-expect-error This test only needs the small React DOM root surface below.
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSessionMock = vi.hoisted(() => vi.fn());
const fetchEligibilityMock = vi.hoisted(() => vi.fn(async () => true));
const forkAndResubmitMock = vi.hoisted(() => vi.fn());
const mobileLifecycle = vi.hoisted(() => ({
  appStateListeners: new Set<(state: string) => void>(),
  deviceEventListeners: new Map<string, Set<() => void>>(),
}));

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mobileLifecycle.appStateListeners.add(listener);
      return {
        remove: vi.fn(() => mobileLifecycle.appStateListeners.delete(listener)),
      };
    },
  },
  DeviceEventEmitter: {
    addListener: (event: string, listener: () => void) => {
      const listeners =
        mobileLifecycle.deviceEventListeners.get(event) ?? new Set();
      listeners.add(listener);
      mobileLifecycle.deviceEventListeners.set(event, listeners);
      return {
        remove: vi.fn(() => listeners.delete(listener)),
      };
    },
  },
}));
vi.mock("@/lib/analytics", () => ({ trackMobileEvent: vi.fn() }));
vi.mock("@/lib/session-token-store", () => ({ getSessionToken: vi.fn() }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    getMobileAgentChatHeaders: vi.fn(async () => ({
      Authorization: "Bearer test-session",
    })),
  };
});
vi.mock("./agentkit-mobile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agentkit-mobile")>();
  return { ...actual, createMobileAgentKitSession: createSessionMock };
});
vi.mock("./message-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./message-actions")>();
  return {
    ...actual,
    forkAndResubmitMobileMessage: forkAndResubmitMock,
  };
});

import { createAgentThreadState } from "@agent-native/agentkit";
import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { invalidateAgentEngineReadiness } from "@agent-native/core/client/agent-engine-readiness";

import {
  AGENT_ENGINE_CONFIGURED_CHANGED_EVENT,
  DEFAULT_CHAT_BASE_URL,
} from "./api";
import type { ChatAttachment } from "./types";
import { useAgentChat, type AgentChatController } from "./use-agent-chat";

const readinessTestSource = {
  statusUrl: `${DEFAULT_CHAT_BASE_URL.replace(/\/+$/, "")}/_agent-native/agent-engine/status`,
};

beforeEach(() => {
  mobileLifecycle.appStateListeners.clear();
  mobileLifecycle.deviceEventListeners.clear();
  fetchEligibilityMock.mockReset();
  fetchEligibilityMock.mockImplementation(async () => true);
  invalidateAgentEngineReadiness(readinessTestSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ chatEligible: await fetchEligibilityMock() }),
    })),
  );
});

function emitDeviceEvent(event: string) {
  act(() => {
    for (const listener of mobileLifecycle.deviceEventListeners.get(event) ??
      []) {
      listener();
    }
  });
}

function emitAppState(state: string) {
  act(() => {
    for (const listener of mobileLifecycle.appStateListeners) listener(state);
  });
}

type Root = {
  render(node: ReturnType<typeof createElement>): void;
  unmount(): void;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createSendClient() {
  return {
    subscribe: vi.fn(() => () => {}),
    loadThread: vi.fn(async (threadId: string) =>
      createAgentThreadState(threadId),
    ),
    sendMessage: vi.fn(async (_request: { text: string }) => ({
      runId: "run-1",
      completed: Promise.resolve(),
    })),
    cancelRun: vi.fn(async () => {}),
  };
}

function mountAgentChat() {
  let chat: AgentChatController | undefined;
  function Harness() {
    chat = useAgentChat({});
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  return {
    get chat() {
      return chat;
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function eventBase(
  type: string,
  id: string,
  threadId: string,
  runId: string,
  sequence: number,
) {
  return {
    type,
    id,
    threadId,
    runId,
    sequence,
    occurredAt: "2026-09-26T12:00:00.000Z",
  };
}

describe("useAgentChat approval continuation", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(["approve", "deny"] as const)(
    "resolves the pending run with %s while streaming instead of sending a new turn",
    async (decision) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const threads = new Map<
        string,
        ReturnType<typeof createAgentThreadState>
      >();
      const listeners = new Set<() => void>();
      let finishOriginalRun = () => {};
      const originalCompleted = new Promise<void>((resolve) => {
        finishOriginalRun = resolve;
      });
      let failDenialOnce = decision === "deny";
      let sequence = 0;
      const getThread = (threadId: string) => {
        let thread = threads.get(threadId);
        if (!thread) {
          thread = createAgentThreadState(threadId);
          threads.set(threadId, thread);
        }
        return thread;
      };
      const appendEvent = (event: AgentEvent) => {
        const current = getThread(event.threadId);
        threads.set(event.threadId, {
          ...current,
          events: [...current.events, event],
        });
        listeners.forEach((listener) => listener());
      };
      const client = {
        subscribe: vi.fn((listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }),
        getThread: vi.fn(getThread),
        loadThread: vi.fn(async (threadId: string) => getThread(threadId)),
        sendMessage: vi.fn(async ({ threadId }: { threadId: string }) => {
          appendEvent({
            ...eventBase(
              "approval.requested",
              "event-approval",
              threadId,
              "run-1",
              ++sequence,
            ),
            type: "approval.requested",
            request: {
              id: "approval-1",
              title: "Run this action?",
              metadata: { toolCallId: "tool-1", toolName: "send-email" },
            },
          } as AgentEvent);
          return { runId: "run-1", completed: originalCompleted };
        }),
        resolveApproval: vi.fn(
          async ({
            threadId,
            approvalId,
            response,
          }: {
            threadId: string;
            approvalId: string;
            response: { decision: "approve" | "deny" };
          }) => {
            if (response.decision === "deny" && failDenialOnce) {
              failDenialOnce = false;
              throw new Error("Approval request failed");
            }
            appendEvent({
              ...eventBase(
                "approval.resolved",
                "event-resolved",
                threadId,
                "run-2",
                1,
              ),
              type: "approval.resolved",
              approvalId,
              response,
            } as AgentEvent);
            if (response.decision === "deny") {
              appendEvent({
                ...eventBase(
                  "tool.updated",
                  "event-denied",
                  threadId,
                  "run-2",
                  2,
                ),
                type: "tool.updated",
                toolCall: {
                  id: "tool-1",
                  name: "send-email",
                  status: "failed",
                  output: "Denied",
                },
              } as AgentEvent);
            }
            appendEvent({
              ...eventBase(
                "run.completed",
                "event-complete",
                threadId,
                "run-2",
                response.decision === "deny" ? 3 : 2,
              ),
              type: "run.completed",
            } as AgentEvent);
          },
        ),
        cancelRun: vi.fn(async () => {}),
      };
      createSessionMock.mockReturnValue({
        client,
        dispose: vi.fn(async () => {}),
      });

      let chat: AgentChatController | undefined;
      function Harness() {
        chat = useAgentChat({});
        return null;
      }
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(createElement(Harness));
      });
      await vi.waitFor(() => expect(chat?.canChat).toBe(true));
      await act(async () => {
        chat?.send("Send the email");
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());

      expect(chat?.isStreaming).toBe(true);
      const threadId = client.sendMessage.mock.calls[0]![0].threadId;
      await act(async () => {
        if (decision === "approve") chat?.approve("approval-1");
        else chat?.deny("approval-1");
        await Promise.resolve();
      });

      if (decision === "deny") {
        await vi.waitFor(() => expect(chat?.isStreaming).toBe(false));
        expect(
          chat?.messages
            .flatMap((message) => message.parts)
            .find(
              (part) =>
                part.type === "tool-call" && part.approvalKey === "approval-1",
            ),
        ).toMatchObject({ status: "awaiting-approval" });
        await act(async () => {
          chat?.deny("approval-1");
          await Promise.resolve();
        });
      }

      finishOriginalRun();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(chat?.isStreaming).toBe(false);
      expect(client.resolveApproval).toHaveBeenLastCalledWith({
        threadId,
        runId: "run-1",
        approvalId: "approval-1",
        response: { decision },
      });
      expect(client.resolveApproval).toHaveBeenCalledTimes(
        decision === "deny" ? 2 : 1,
      );
      expect(client.sendMessage).toHaveBeenCalledOnce();
      if (decision === "deny") {
        expect(
          chat?.messages
            .flatMap((message) => message.parts)
            .find(
              (part) =>
                part.type === "tool-call" && part.approvalKey === "approval-1",
            ),
        ).toMatchObject({ status: "failed", error: "Denied" });
      }
    },
  );
});

describe("useAgentChat file uploads", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uploads before sending and preserves staged files for retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const threads = new Map<
      string,
      ReturnType<typeof createAgentThreadState>
    >();
    const listeners = new Set<() => void>();
    const getThread = (threadId: string) => {
      let thread = threads.get(threadId);
      if (!thread) {
        thread = createAgentThreadState(threadId);
        threads.set(threadId, thread);
      }
      return thread;
    };
    let uploadFailed = false;
    type SentRequest = {
      attachments: Array<{
        type: string;
        name: string;
        mediaType: string;
        url: string;
      }>;
    };
    const sentRequests: SentRequest[] = [];
    const client = {
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      getThread: vi.fn(getThread),
      loadThread: vi.fn(async (threadId: string) => getThread(threadId)),
      uploadFiles: vi.fn(
        async (
          _threadId: string,
          files: Array<{
            name: string;
            mediaType: string;
            size: number;
            body: Blob;
          }>,
        ) => {
          if (!uploadFailed) {
            uploadFailed = true;
            throw new Error("Storage is unavailable.");
          }
          return files.map((file) => ({
            id: `stored-${file.name}`,
            name: file.name,
            mediaType: file.mediaType,
            size: file.size,
            url: `https://files.example.test/${file.name}`,
          }));
        },
      ),
      sendMessage: vi.fn(async (request: SentRequest) => {
        sentRequests.push(request);
        return { runId: "run-1", completed: Promise.resolve() };
      }),
      cancelRun: vi.fn(async () => {}),
    };
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });

    let chat: AgentChatController | undefined;
    function Harness() {
      chat = useAgentChat({});
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(Harness));
    });
    await vi.waitFor(() => expect(chat?.canChat).toBe(true));

    const staged: ChatAttachment[] = [
      {
        type: "file",
        name: "notes.txt",
        contentType: "text/plain",
        text: "private notes",
      },
    ];
    await act(async () => {
      chat?.send("Read this file", staged);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(chat?.error).toBe("Storage is unavailable."));
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(staged[0]?.text).toBe("private notes");

    await act(async () => {
      chat?.retry();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());

    const request = sentRequests[0]!;
    expect(request.attachments).toEqual([
      {
        type: "file",
        name: "notes.txt",
        mediaType: "text/plain",
        url: "https://files.example.test/notes.txt",
      },
    ]);
    expect(JSON.stringify(request)).not.toContain("private notes");
    expect(client.uploadFiles).toHaveBeenCalledTimes(2);
    expect(staged[0]?.text).toBe("private notes");
  });
});

describe("useAgentChat readiness gate", () => {
  let mounted: ReturnType<typeof mountAgentChat> | undefined;

  afterEach(() => {
    mounted?.cleanup();
    mounted = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("waits for the boot check and keeps a blocked prompt available to retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const probe = deferred<boolean>();
    fetchEligibilityMock.mockReturnValueOnce(probe.promise);
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();

    let dispatchPromise: Promise<boolean> | undefined;
    await act(async () => {
      dispatchPromise = mounted?.chat?.send("Keep this draft");
      await Promise.resolve();
    });
    expect(fetchEligibilityMock).toHaveBeenCalledOnce();
    expect(client.sendMessage).not.toHaveBeenCalled();

    await act(async () => probe.resolve(false));
    await vi.waitFor(() => {
      expect(mounted?.chat?.chatEligibility).toBe("missing");
      expect(mounted?.chat?.errorCode).toBe("missing_api_key");
    });
    await expect(dispatchPromise!).resolves.toBe(false);
    expect(client.sendMessage).not.toHaveBeenCalled();

    fetchEligibilityMock.mockResolvedValueOnce(false);
    act(() => mounted?.chat?.retry());
    await vi.waitFor(() =>
      expect(fetchEligibilityMock).toHaveBeenCalledTimes(2),
    );
    expect(client.sendMessage).not.toHaveBeenCalled();

    fetchEligibilityMock.mockResolvedValueOnce(true);
    act(() => mounted?.chat?.retry());
    await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
    expect(client.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: "Keep this draft",
    });
  });

  it("sends only after a pending readiness check confirms AI is connected", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const probe = deferred<boolean>();
    fetchEligibilityMock.mockReturnValueOnce(probe.promise);
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();

    let dispatchPromise: Promise<boolean> | undefined;
    act(() => {
      dispatchPromise = mounted?.chat?.send("Wait for readiness");
    });
    expect(client.sendMessage).not.toHaveBeenCalled();

    await act(async () => probe.resolve(true));
    await expect(dispatchPromise!).resolves.toBe(true);
    await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
    expect(client.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: "Wait for readiness",
    });
  });

  it("cancels a queued handle without cancelling its active run", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const client = createSendClient();
    const completed = deferred<void>();
    const cancelQueued = vi.fn(async () => {});
    client.sendMessage.mockResolvedValueOnce({
      queuedMessageId: "queued-mobile-1",
      activeRunId: "run-active-1",
      completed: completed.promise,
      cancel: cancelQueued,
    } as never);
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));

    let dispatchPromise: Promise<boolean> | undefined;
    await act(async () => {
      dispatchPromise = mounted?.chat?.send("Queue this prompt");
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
    await expect(dispatchPromise!).resolves.toBe(true);

    act(() => mounted?.chat?.stop());
    expect(cancelQueued).toHaveBeenCalledOnce();
    expect(client.cancelRun).not.toHaveBeenCalled();

    await act(async () => completed.resolve());
    await vi.waitFor(() => expect(mounted?.chat?.isStreaming).toBe(false));
    expect(mounted?.chat?.errorCode).toBeNull();
  });

  it("buffers queued events until a handle arrives after active completion", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const threads = new Map<
      string,
      ReturnType<typeof createAgentThreadState>
    >();
    const listeners = new Set<() => void>();
    const queuedHandle = deferred<{
      queuedMessageId: string;
      activeRunId: string;
      completed: Promise<void>;
      cancel: () => Promise<void>;
    }>();
    let sequence = 0;
    const getThread = (threadId: string) => {
      let thread = threads.get(threadId);
      if (!thread) {
        thread = createAgentThreadState(threadId);
        threads.set(threadId, thread);
      }
      return thread;
    };
    const appendEvent = (event: AgentEvent) => {
      const current = getThread(event.threadId);
      threads.set(event.threadId, {
        ...current,
        events: [...current.events, event],
      });
      listeners.forEach((listener) => listener());
    };
    const client = {
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      getThread: vi.fn(getThread),
      loadThread: vi.fn(async (threadId: string) => getThread(threadId)),
      sendMessage: vi.fn(
        (_input: { threadId: string }) => queuedHandle.promise,
      ),
      cancelRun: vi.fn(async () => {}),
    };
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));

    let dispatchPromise: Promise<boolean> | undefined;
    await act(async () => {
      dispatchPromise = mounted?.chat?.send("Queue this prompt");
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());

    const threadId = client.sendMessage.mock.calls[0]![0].threadId;
    await act(async () => {
      appendEvent({
        ...eventBase(
          "run.completed",
          "event-active-run-complete",
          threadId,
          "run-active-mobile",
          ++sequence,
        ),
        type: "run.completed",
      } as AgentEvent);
      await Promise.resolve();
    });
    expect(mounted?.chat?.isStreaming).toBe(true);
    expect(
      mounted?.chat?.messages.some((message) =>
        message.parts.some(
          (part) => part.type === "text" && part.text.includes("Queued reply"),
        ),
      ),
    ).toBe(false);

    await act(async () => {
      appendEvent({
        ...eventBase(
          "run.started",
          "event-queued-run-started",
          threadId,
          "run-queued-mobile",
          ++sequence,
        ),
        type: "run.started",
        metadata: {
          custom: { agentNativeQueuedMessageId: "queued-mobile-reply" },
        },
      } as AgentEvent);
      appendEvent({
        ...eventBase(
          "message.created",
          "event-queued-user-message",
          threadId,
          "run-queued-mobile",
          ++sequence,
        ),
        type: "message.created",
        message: {
          id: "queued-mobile-reply",
          role: "user",
          parts: [{ type: "text", text: "Queue this prompt" }],
          metadata: {
            custom: { agentNativeQueuedMessageId: "queued-mobile-reply" },
          },
        },
      } as AgentEvent);
      appendEvent({
        ...eventBase(
          "message.delta",
          "event-queued-answer",
          threadId,
          "run-queued-mobile",
          ++sequence,
        ),
        type: "message.delta",
        messageId: "assistant-queued-mobile",
        text: "Queued reply",
      } as AgentEvent);
      appendEvent({
        ...eventBase(
          "run.completed",
          "event-queued-run-complete",
          threadId,
          "run-queued-mobile",
          ++sequence,
        ),
        type: "run.completed",
      } as AgentEvent);
      expect(
        mounted?.chat?.messages.some((message) =>
          message.parts.some(
            (part) =>
              part.type === "text" && part.text.includes("Queued reply"),
          ),
        ),
      ).toBe(false);
      queuedHandle.resolve({
        queuedMessageId: "queued-mobile-reply",
        activeRunId: "run-active-mobile",
        completed: Promise.resolve(),
        cancel: vi.fn(async () => {}),
      });
      await dispatchPromise;
    });

    await expect(dispatchPromise!).resolves.toBe(true);
    expect(mounted?.chat?.isStreaming).toBe(false);
    expect(
      mounted?.chat?.messages.some((message) =>
        message.parts.some(
          (part) => part.type === "text" && part.text.includes("Queued reply"),
        ),
      ),
    ).toBe(true);
  });

  it.each([true, false])(
    "replays early active-run events with a prior assistant message: %s",
    async (hasPriorAssistant) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const threads = new Map<
        string,
        ReturnType<typeof createAgentThreadState>
      >();
      const listeners = new Set<() => void>();
      const queuedHandle = deferred<{
        queuedMessageId: string;
        activeRunId: string;
        completed: Promise<void>;
        cancel: () => Promise<void>;
      }>();
      let sequence = 0;
      const threadId = "thread-active-mobile";
      const getThread = (threadId: string) => {
        let thread = threads.get(threadId);
        if (!thread) {
          thread = createAgentThreadState(threadId);
          threads.set(threadId, thread);
        }
        return thread;
      };
      threads.set(threadId, {
        ...createAgentThreadState(threadId),
        messages: hasPriorAssistant
          ? [
              {
                id: "assistant-active-mobile",
                role: "assistant",
                parts: [{ type: "text", text: "Active reply" }],
                metadata: { runId: "run-active-mobile" },
              },
            ]
          : [],
      });
      const appendEvent = (event: AgentEvent) => {
        const current = getThread(event.threadId);
        threads.set(event.threadId, {
          ...current,
          events: [...current.events, event],
        });
        listeners.forEach((listener) => listener());
      };
      const client = {
        subscribe: vi.fn((listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }),
        getThread: vi.fn(getThread),
        loadThread: vi.fn(async (threadId: string) => getThread(threadId)),
        sendMessage: vi.fn(
          (_input: { threadId: string }) => queuedHandle.promise,
        ),
        cancelRun: vi.fn(async () => {}),
      };
      createSessionMock.mockReturnValue({
        client,
        dispose: vi.fn(async () => {}),
      });
      mounted = mountAgentChat();
      await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));
      await act(async () => {
        mounted?.chat?.openThread(threadId);
        await Promise.resolve();
      });
      if (hasPriorAssistant) {
        await vi.waitFor(() =>
          expect(
            mounted?.chat?.messages.some(
              (message) =>
                message.id === "assistant-active-mobile" &&
                message.parts.some(
                  (part) =>
                    part.type === "text" && part.text === "Active reply",
                ),
            ),
          ).toBe(true),
        );
      } else {
        expect(
          mounted?.chat?.messages.some(
            (message) => message.id === "assistant-active-mobile",
          ),
        ).toBe(false);
      }

      let queuedDispatch: Promise<boolean> | undefined;
      await act(async () => {
        queuedDispatch = mounted?.chat?.send("Queue this prompt");
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());

      await act(async () => {
        appendEvent({
          ...eventBase(
            "message.delta",
            "event-active-run-late-delta",
            threadId,
            "run-active-mobile",
            ++sequence,
          ),
          type: "message.delta",
          messageId: "assistant-active-mobile",
          text: " continued",
        } as AgentEvent);
        appendEvent({
          ...eventBase(
            "run.completed",
            "event-active-run-late-complete",
            threadId,
            "run-active-mobile",
            ++sequence,
          ),
          type: "run.completed",
        } as AgentEvent);
      });
      expect(mounted?.chat?.isStreaming).toBe(true);

      await act(async () => {
        appendEvent({
          ...eventBase(
            "run.started",
            "event-queued-run-started-late-replay",
            threadId,
            "run-queued-mobile",
            ++sequence,
          ),
          type: "run.started",
          metadata: {
            custom: { agentNativeQueuedMessageId: "queued-mobile-reply" },
          },
        } as AgentEvent);
        appendEvent({
          ...eventBase(
            "message.delta",
            "event-queued-run-reply-late-replay",
            threadId,
            "run-queued-mobile",
            ++sequence,
          ),
          type: "message.delta",
          messageId: "assistant-queued-mobile",
          text: "Queued reply",
        } as AgentEvent);
        appendEvent({
          ...eventBase(
            "run.completed",
            "event-queued-run-complete-late-replay",
            threadId,
            "run-queued-mobile",
            ++sequence,
          ),
          type: "run.completed",
        } as AgentEvent);
        queuedHandle.resolve({
          queuedMessageId: "queued-mobile-reply",
          activeRunId: "run-active-mobile",
          completed: Promise.resolve(),
          cancel: vi.fn(async () => {}),
        });
        await queuedDispatch;
      });

      await expect(queuedDispatch!).resolves.toBe(true);
      await vi.waitFor(() => expect(mounted?.chat?.isStreaming).toBe(false));
      const activeAssistant = mounted?.chat?.messages.find(
        (message) =>
          message.role === "assistant" &&
          message.parts.some(
            (part) => part.type === "text" && part.text.includes("continued"),
          ),
      );
      expect(activeAssistant).toBeDefined();
      expect(
        activeAssistant?.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      ).toBe(hasPriorAssistant ? "Active reply continued" : " continued");
      expect(
        mounted?.chat?.messages.some((message) =>
          message.parts.some(
            (part) => part.type === "text" && part.text === "Queued reply",
          ),
        ),
      ).toBe(true);
    },
  );

  it("reattaches to the submitted run from its durable receipt", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const threads = new Map<
      string,
      ReturnType<typeof createAgentThreadState>
    >();
    const listeners = new Set<() => void>();
    let sequence = 0;
    const getThread = (threadId: string) => {
      let thread = threads.get(threadId);
      if (!thread) {
        thread = createAgentThreadState(threadId);
        threads.set(threadId, thread);
      }
      return thread;
    };
    const appendEvent = (event: AgentEvent) => {
      const current = getThread(event.threadId);
      threads.set(event.threadId, {
        ...current,
        events: [...current.events, event],
      });
      listeners.forEach((listener) => listener());
    };
    const client = {
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      getThread: vi.fn(getThread),
      loadThread: vi.fn(async (threadId: string) => getThread(threadId)),
      sendMessage: vi.fn(async (_input: { threadId: string }) => ({
        queuedMessageId: "queued-recovered-mobile",
        activeRunId: "run-active-before-recovery",
        completed: Promise.resolve(),
        cancel: vi.fn(async () => {}),
      })),
      getQueuedSubmissionStatus: vi.fn(async () => ({
        state: "submitted" as const,
        submittedRunId: "run-queued-recovered",
      })),
      resubscribeRun: vi.fn(async (threadId: string, runId: string) => {
        await act(async () => {
          appendEvent({
            ...eventBase(
              "run.started",
              "event-queued-recovered-started",
              threadId,
              runId,
              ++sequence,
            ),
            type: "run.started",
          } as AgentEvent);
          appendEvent({
            ...eventBase(
              "message.delta",
              "event-queued-recovered-reply",
              threadId,
              runId,
              ++sequence,
            ),
            type: "message.delta",
            messageId: "assistant-queued-recovered",
            text: "Recovered queued reply",
          } as AgentEvent);
          appendEvent({
            ...eventBase(
              "run.completed",
              "event-queued-recovered-complete",
              threadId,
              runId,
              ++sequence,
            ),
            type: "run.completed",
          } as AgentEvent);
        });
      }),
      cancelRun: vi.fn(async () => {}),
    };
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));

    const dispatchPromise = mounted?.chat?.send("Queue this prompt");
    await vi.waitFor(() =>
      expect(client.resubscribeRun).toHaveBeenCalledOnce(),
    );
    await expect(dispatchPromise!).resolves.toBe(true);
    expect(client.resubscribeRun).toHaveBeenCalledWith(
      expect.any(String),
      "run-queued-recovered",
    );
    expect(mounted?.chat?.isStreaming).toBe(false);
    expect(
      mounted?.chat?.messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "text" && part.text === "Recovered queued reply",
        ),
      ),
    ).toBe(true);
  });

  it.each(["expired", "blocked"] as const)(
    "settles a queued turn when its durable receipt is %s",
    async (receiptState) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const client = {
        ...createSendClient(),
        getQueuedSubmissionStatus: vi.fn(async () => ({ state: receiptState })),
      };
      client.sendMessage.mockResolvedValueOnce({
        queuedMessageId: "queued-expired-mobile",
        activeRunId: "run-active-expired",
        completed: Promise.resolve(),
        cancel: vi.fn(async () => {}),
      } as never);
      createSessionMock.mockReturnValue({
        client,
        dispose: vi.fn(async () => {}),
      });
      mounted = mountAgentChat();
      await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));

      let dispatchPromise: Promise<boolean> | undefined;
      await act(async () => {
        dispatchPromise = mounted?.chat?.send("Queue this prompt");
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
      await expect(dispatchPromise!).resolves.toBe(true);
      expect(client.getQueuedSubmissionStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: "queued-expired-mobile",
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(mounted?.chat?.isStreaming).toBe(false);
      expect(mounted?.chat?.errorCode).toBe(
        `queued_submission_${receiptState}`,
      );
      expect(mounted?.chat?.error).toContain(
        receiptState === "expired"
          ? "expired before it could run"
          : "could not be started",
      );
    },
  );

  it.each([
    { label: "missing status support", mode: "missing" as const },
    { label: "missing receipt response", mode: "undefined" as const },
    { label: "HTTP 404", mode: 404 as const },
    { label: "HTTP 501", mode: 501 as const },
  ])(
    "settles a queued turn when receipt status is $label",
    async ({ mode }) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const client = {
        ...createSendClient(),
        sendMessage: vi.fn(async () => ({
          queuedMessageId: "queued-status-unavailable",
          activeRunId: "run-active-status-unavailable",
          completed: Promise.resolve(),
          cancel: vi.fn(async () => {}),
        })),
        ...(mode === "missing"
          ? {}
          : {
              getQueuedSubmissionStatus: vi.fn(async () => {
                if (mode === "undefined") return undefined as never;
                throw Object.assign(
                  new Error("Receipt status is unavailable"),
                  {
                    status: mode,
                    retryable: false,
                  },
                );
              }),
            }),
      };
      createSessionMock.mockReturnValue({
        client,
        dispose: vi.fn(async () => {}),
      });
      mounted = mountAgentChat();
      await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));

      let dispatchPromise: Promise<boolean> | undefined;
      await act(async () => {
        dispatchPromise = mounted?.chat?.send("Queue this prompt");
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
      await expect(dispatchPromise!).resolves.toBe(true);
      await vi.waitFor(() => expect(mounted?.chat?.isStreaming).toBe(false));
      expect(mounted?.chat?.errorCode).toBe(
        "queued_submission_status_unavailable",
      );
      expect(mounted?.chat?.error).toContain("Could not confirm");
    },
  );

  it("waits for a fresh readiness check after an unavailable boot result", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchEligibilityMock.mockRejectedValueOnce(new Error("status unavailable"));
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() =>
      expect(mounted?.chat?.chatEligibility).toBe("unavailable"),
    );

    const probe = deferred<boolean>();
    fetchEligibilityMock.mockReturnValueOnce(probe.promise);
    let dispatchPromise: Promise<boolean> | undefined;
    act(() => {
      dispatchPromise = mounted?.chat?.send("Wait through unavailable");
    });
    await vi.waitFor(() =>
      expect(fetchEligibilityMock).toHaveBeenCalledTimes(2),
    );
    expect(mounted?.chat?.chatEligibility).toBe("unavailable");
    expect(client.sendMessage).not.toHaveBeenCalled();

    await act(async () => probe.resolve(true));
    await expect(dispatchPromise!).resolves.toBe(true);
    await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
    expect(client.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: "Wait through unavailable",
    });
  });

  it("refreshes readiness on setup completion without remounting or losing the prompt", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchEligibilityMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() =>
      expect(mounted?.chat?.chatEligibility).toBe("missing"),
    );

    await act(async () => {
      await expect(
        mounted?.chat?.send("Keep this connected draft"),
      ).resolves.toBe(false);
    });
    expect(mounted?.chat?.errorCode).toBe("missing_api_key");
    expect(client.sendMessage).not.toHaveBeenCalled();

    emitDeviceEvent(AGENT_ENGINE_CONFIGURED_CHANGED_EVENT);
    await vi.waitFor(() =>
      expect(mounted?.chat?.chatEligibility).toBe("eligible"),
    );
    expect(mounted?.chat?.errorCode).toBeNull();
    expect(client.sendMessage).not.toHaveBeenCalled();

    act(() => mounted?.chat?.retry());
    await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
    expect(client.sendMessage.mock.calls[0]?.[0]).toMatchObject({
      text: "Keep this connected draft",
    });
  });

  it("rechecks readiness when the app resumes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchEligibilityMock
      .mockRejectedValueOnce(new Error("status unavailable"))
      .mockResolvedValueOnce(true);
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() =>
      expect(mounted?.chat?.chatEligibility).toBe("unavailable"),
    );

    emitAppState("background");
    emitAppState("active");
    await vi.waitFor(() =>
      expect(mounted?.chat?.chatEligibility).toBe("eligible"),
    );
    expect(fetchEligibilityMock).toHaveBeenCalledTimes(2);
  });

  it("blocks unavailable retry, continue, and regenerate paths", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchEligibilityMock.mockResolvedValueOnce(true);
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));

    await act(async () => {
      await mounted?.chat?.send("Original prompt");
    });
    await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mounted?.chat?.isStreaming).toBe(false));
    const sourceMessageId = mounted?.chat?.messages[0]?.id;
    expect(sourceMessageId).toBeTruthy();

    fetchEligibilityMock.mockResolvedValueOnce(false);
    act(() => mounted?.chat?.refreshChatEligibility());
    await vi.waitFor(() =>
      expect(mounted?.chat?.chatEligibility).toBe("missing"),
    );

    fetchEligibilityMock.mockRejectedValueOnce(new Error("status unavailable"));
    act(() => mounted?.chat?.retry());
    await vi.waitFor(() =>
      expect(fetchEligibilityMock).toHaveBeenCalledTimes(3),
    );
    expect(mounted?.chat?.errorCode).toBe("chat_setup_unavailable");
    expect(client.sendMessage).toHaveBeenCalledOnce();

    fetchEligibilityMock.mockRejectedValueOnce(new Error("status unavailable"));
    act(() =>
      mounted?.chat?.continueAfterConnection(
        "not-an-admitted-request",
        "Builder.io",
      ),
    );
    expect(mounted?.chat?.chatEligibility).toBe("unavailable");
    await vi.waitFor(() =>
      expect(fetchEligibilityMock).toHaveBeenCalledTimes(4),
    );
    await vi.waitFor(() =>
      expect(mounted?.chat?.chatEligibility).toBe("unavailable"),
    );
    expect(mounted?.chat?.errorCode).toBe("chat_setup_unavailable");
    expect(client.sendMessage).toHaveBeenCalledOnce();

    fetchEligibilityMock.mockRejectedValueOnce(new Error("status unavailable"));
    forkAndResubmitMock.mockImplementationOnce(
      async (
        _client: unknown,
        _threadId: string,
        _messageId: string,
        beforeFork: () => Promise<void>,
        _text: string | undefined,
      ) => {
        await beforeFork();
        return { id: "unused-fork" };
      },
    );
    await expect(
      mounted?.chat?.regenerateMessage(sourceMessageId!),
    ).rejects.toMatchObject({ code: "chat_setup_unavailable" });
    expect(forkAndResubmitMock).toHaveBeenCalledOnce();
    expect(client.sendMessage).toHaveBeenCalledOnce();
  });

  it("rechecks readiness after thread loading and before a regenerate fork", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchEligibilityMock.mockResolvedValueOnce(true);
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    forkAndResubmitMock.mockImplementationOnce(
      async (
        _client: unknown,
        _threadId: string,
        _messageId: string,
        beforeFork: () => Promise<void>,
        _text: string | undefined,
      ) => {
        await beforeFork();
        return { id: "unused-fork" };
      },
    );
    mounted = mountAgentChat();
    await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));

    await act(async () => {
      await mounted?.chat?.send("Original prompt");
    });
    await vi.waitFor(() => expect(mounted?.chat?.isStreaming).toBe(false));
    const sourceMessageId = mounted?.chat?.messages[0]?.id;
    expect(sourceMessageId).toBeTruthy();

    fetchEligibilityMock.mockResolvedValueOnce(false);
    await expect(
      mounted?.chat?.editMessage(sourceMessageId!, "Edited prompt"),
    ).rejects.toMatchObject({ code: "missing_api_key" });

    expect(fetchEligibilityMock).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(mounted?.chat?.errorCode).toBe("missing_api_key"),
    );

    forkAndResubmitMock.mockImplementationOnce(
      async (
        _client: unknown,
        _threadId: string,
        _messageId: string,
        beforeFork: () => Promise<void>,
        _text: string | undefined,
      ) => {
        await beforeFork();
        return { id: "retried-fork" };
      },
    );
    fetchEligibilityMock.mockResolvedValueOnce(true);
    await act(async () => {
      mounted?.chat?.retry();
      await vi.waitFor(() =>
        expect(forkAndResubmitMock).toHaveBeenCalledTimes(2),
      );
    });
    expect(client.sendMessage).toHaveBeenCalledOnce();
  });

  it("runs a pending fork retry only once while the retry is in flight", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchEligibilityMock.mockResolvedValueOnce(true);
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() => expect(mounted?.chat?.canChat).toBe(true));

    await act(async () => {
      await mounted?.chat?.send("Original prompt");
    });
    await vi.waitFor(() => expect(mounted?.chat?.isStreaming).toBe(false));
    const sourceMessageId = mounted?.chat?.messages[0]?.id;
    expect(sourceMessageId).toBeTruthy();

    fetchEligibilityMock.mockResolvedValueOnce(false);
    forkAndResubmitMock.mockImplementationOnce(
      async (
        _client: unknown,
        _threadId: string,
        _messageId: string,
        beforeFork: () => Promise<void>,
      ) => {
        await beforeFork();
        throw new Error("The readiness check should block this fork.");
      },
    );
    await expect(
      mounted?.chat?.regenerateMessage(sourceMessageId!),
    ).rejects.toMatchObject({ code: "missing_api_key" });
    expect(forkAndResubmitMock).toHaveBeenCalledOnce();

    const forkResult = deferred<{ id: string }>();
    fetchEligibilityMock.mockResolvedValueOnce(true);
    forkAndResubmitMock.mockImplementationOnce(
      async (
        _client: unknown,
        _threadId: string,
        _messageId: string,
        beforeFork: () => Promise<void>,
      ) => {
        await beforeFork();
        return forkResult.promise;
      },
    );
    act(() => {
      mounted?.chat?.retry();
      mounted?.chat?.retry();
    });
    await vi.waitFor(() =>
      expect(forkAndResubmitMock).toHaveBeenCalledTimes(2),
    );
    forkResult.resolve({ id: "retried-fork" });
    await vi.waitFor(() =>
      expect(mounted?.chat?.threadId).toBe("retried-fork"),
    );
    expect(forkAndResubmitMock).toHaveBeenCalledTimes(2);
  });

  it("shows the missing-provider error instead of submitting when readiness is missing", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchEligibilityMock.mockResolvedValueOnce(false);
    const client = createSendClient();
    createSessionMock.mockReturnValue({
      client,
      dispose: vi.fn(async () => {}),
    });
    mounted = mountAgentChat();
    await vi.waitFor(() =>
      expect(mounted?.chat?.chatEligibility).toBe("missing"),
    );

    await act(async () => {
      await mounted?.chat?.send("Blocked prompt");
    });
    await vi.waitFor(() =>
      expect(mounted?.chat?.errorCode).toBe("missing_api_key"),
    );
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});
