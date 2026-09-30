// @vitest-environment happy-dom

import { act, createElement } from "react";
// @ts-expect-error This test only needs the small React DOM root surface below.
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const createSessionMock = vi.hoisted(() => vi.fn());
const fetchEligibilityMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: vi.fn() }),
  },
  DeviceEventEmitter: { addListener: () => ({ remove: vi.fn() }) },
}));
vi.mock("@/lib/analytics", () => ({ trackMobileEvent: vi.fn() }));
vi.mock("@/lib/session-token-store", () => ({ getSessionToken: vi.fn() }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, fetchMobileChatEligibility: fetchEligibilityMock };
});
vi.mock("./agentkit-mobile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agentkit-mobile")>();
  return { ...actual, createMobileAgentKitSession: createSessionMock };
});

import { createAgentThreadState } from "@agent-native/agentkit";
import type { AgentEvent } from "@agent-native/agentkit/protocol";

import type { ChatAttachment } from "./types";
import { useAgentChat, type AgentChatController } from "./use-agent-chat";

type Root = {
  render(node: ReturnType<typeof createElement>): void;
  unmount(): void;
};

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
