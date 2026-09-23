// @vitest-environment happy-dom

import type { CommentAiRequest } from "@shared/comment-ai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acknowledgeCommentAiContinuation,
  boundedContinuationContext,
  commentAiModelLabel,
  commentAiRequestsRefetchInterval,
  shouldReconcileCommentAiSnapshot,
  shouldIgnoreContinuationAcceptanceError,
  startCommentAiSubmission,
  CommentAiRequestStatus,
  type CommentAiController,
  useCommentAiRequests,
} from "./comment-ai";

const api = vi.hoisted(() => ({
  callAction: vi.fn(),
  refetch: vi.fn(),
  startBackgroundAgentSession: vi.fn(),
  getBackgroundAgentSessionStatus: vi.fn(),
  cancelBackgroundAgentSession: vi.fn(),
  loadCommentAiConversation: vi.fn(),
  requests: [] as CommentAiRequest[],
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => api.callAction(...args),
  useActionQuery: () => ({
    data: { requests: api.requests },
    refetch: api.refetch,
  }),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  startBackgroundAgentSession: (...args: unknown[]) =>
    api.startBackgroundAgentSession(...args),
  getBackgroundAgentSessionStatus: (...args: unknown[]) =>
    api.getBackgroundAgentSessionStatus(...args),
  cancelBackgroundAgentSession: (...args: unknown[]) =>
    api.cancelBackgroundAgentSession(...args),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/comment-ai-client", () => ({
  loadCommentAiConversation: (...args: unknown[]) =>
    api.loadCommentAiConversation(...args),
}));
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => api.toastError(...args) },
}));

function request(overrides: Partial<CommentAiRequest> = {}): CommentAiRequest {
  return {
    operationId: "request-1",
    requestId: "request-1",
    documentId: "document-1",
    threadId: "thread-1",
    rootCommentId: "comment-1",
    submittedMode: "suggest",
    instructions: "Please suggest a change",
    submittedProvider: null,
    submittedModel: null,
    submittedEngine: null,
    intent: "suggest",
    status: "failed",
    attemptId: null,
    attemptCount: 0,
    runId: null,
    agentThreadId: null,
    agentTurnId: null,
    model: null,
    engine: null,
    result: null,
    errorCode: "operation_failed",
    error: "The request failed",
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("comment AI controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    api.requests = [];
    api.refetch.mockResolvedValue(undefined);
    api.cancelBackgroundAgentSession.mockResolvedValue(undefined);
    api.loadCommentAiConversation.mockResolvedValue([]);
    api.getBackgroundAgentSessionStatus.mockResolvedValue({
      operationId: "request-1",
      threadId: "agent-thread-1",
      turnId: "agent-turn-1",
      status: "unavailable",
    });
    api.startBackgroundAgentSession.mockReturnValue({
      operationId: "request-1",
      threadId: "agent-thread-1",
      turnId: "agent-turn-1",
      accepted: new Promise(() => undefined),
      completion: new Promise(() => undefined),
      status: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("shows the provider family and a readable model for inline AI turns", () => {
    expect(commentAiModelLabel("gpt-5-6-sol")).toBe("GPT · GPT-5.6 Sol");
    expect(commentAiModelLabel("claude-sonnet-4-5")).toBe(
      "Claude · Claude Sonnet 4.5",
    );
    expect(commentAiModelLabel("claude-opus-5-5")).toBe(
      "Claude · Claude Opus 5.5",
    );
    expect(commentAiModelLabel("claude-haiku-4-5-20251001")).toBe(
      "Claude · Claude Haiku 4.5",
    );
    expect(commentAiModelLabel("gpt-6")).toBe("GPT · GPT-6");
    expect(commentAiModelLabel("gemini-3-pro")).toBe("Gemini · Gemini 3 Pro");
    expect(commentAiModelLabel("llama3.1")).toBe("AI · llama3.1");
  });

  it("starts every structured AI submission and links the prior exact request", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const priorRequest = request({
      requestId: "prior-request",
      status: "replied",
      error: null,
    });

    await startCommentAiSubmission(
      { start },
      {
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "auto",
        instructions: "Please decide whether to answer or edit",
        provider: "OpenAI",
        model: "gpt-5-6-sol",
        engine: "builder",
        priorRequest,
      },
    );

    expect(start).toHaveBeenCalledWith({
      threadId: "thread-1",
      rootCommentId: "comment-1",
      submittedMode: "auto",
      instructions: "Please decide whether to answer or edit",
      provider: "OpenAI",
      model: "gpt-5-6-sol",
      engine: "builder",
      continuationOfRequestId: "prior-request",
    });
  });

  it("shows actionable errors and retries with the same request id", async () => {
    const failed = request();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        createElement(CommentAiRequestStatus, {
          request: failed,
          onRetry,
          onStop: vi.fn().mockResolvedValue(undefined),
        }),
      );
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "comments.aiFailed",
    );
    expect(
      document.querySelector('[role="alert"]')?.getAttribute("title"),
    ).toBe(failed.error);
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "comments.retry")!
        .click(),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps exact recovery available after a partial apply or uncertain continuation", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const renderStatus = async (
      statusRequest: CommentAiRequest,
      continuation?: Parameters<
        typeof CommentAiRequestStatus
      >[0]["continuation"],
    ) => {
      await act(async () => {
        root.render(
          createElement(CommentAiRequestStatus, {
            request: statusRequest,
            continuation,
            onRetry,
            onStop: vi.fn().mockResolvedValue(undefined),
          }),
        );
      });
      expect(
        [...document.querySelectorAll<HTMLButtonElement>("button")].some(
          (button) => button.textContent === "comments.retry",
        ),
      ).toBe(true);
    };

    await renderStatus(
      request({
        status: "needs-review",
        result: { editApplied: true },
      }),
    );
    await renderStatus(
      request({ status: "resolved", result: { editApplied: true } }),
      {
        operationId: "continuation-1",
        threadId: "agent-thread-1",
        turnId: "continuation-turn-1",
        status: "unavailable",
        message: "Continue",
        error: "Delivery was not confirmed",
      },
    );
  });

  it("resumes a partial result on a fresh turn with the same domain action scope", async () => {
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    const partial = request({
      status: "needs-review",
      agentThreadId: "agent-thread-1",
      agentTurnId: "completed-initial-turn",
      result: { editApplied: true },
    });
    api.requests = [partial];
    api.loadCommentAiConversation.mockResolvedValue([]);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "fresh-resume-operation",
    );
    api.startBackgroundAgentSession.mockReturnValue({
      operationId: "fresh-resume-operation",
      threadId: "agent-thread-1",
      turnId: "fresh-resume-turn",
      accepted: Promise.resolve({
        operationId: "fresh-resume-operation",
        threadId: "agent-thread-1",
        turnId: "fresh-resume-turn",
      }),
      status: vi.fn(),
    });
    act(() => root.render(createElement(Probe)));

    await act(async () => controller!.resume(partial));

    expect(api.callAction).not.toHaveBeenCalled();
    expect(api.startBackgroundAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "comments.retry",
        operationId: "fresh-resume-operation",
        threadId: "agent-thread-1",
        scope: { type: "content-comment-ai", id: "request-1" },
        actionScope: { kind: "content-comment-ai", requestId: "request-1" },
        usageLabel: "content:comment-ai-resume",
      }),
    );
    expect(
      api.startBackgroundAgentSession.mock.calls[0]?.[0].operationId,
    ).not.toBe(partial.operationId);
  });

  it("prevents duplicate starts and sends localized text with hidden scoped context", async () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    api.callAction.mockResolvedValue({
      ...request({ status: "queued", error: null }),
      outcome: "confirmed-start",
      dispatch: true,
      prompt: "Handle the source comment",
      context: "Hidden comment AI instructions",
      actionScope: { kind: "content-comment-ai", requestId },
      backgroundSession: {
        operationId: requestId,
        threadId: "agent-thread-1",
        scope: { type: "content-comment-ai", id: requestId },
        actionScope: { kind: "content-comment-ai", requestId },
      },
    });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    act(() => root.render(createElement(Probe)));

    const input = {
      threadId: "thread-1",
      rootCommentId: "comment-1",
      submittedMode: "suggest" as const,
      instructions: "Please suggest a change",
    };
    let outcomes: Array<"confirmed-start" | "busy"> = [];
    await act(async () => {
      outcomes = await Promise.all([
        controller!.start(input),
        controller!.start(input),
      ]);
    });

    expect(api.callAction).toHaveBeenCalledOnce();
    expect(outcomes).toEqual(["confirmed-start", "busy"]);
    expect(api.callAction).toHaveBeenCalledWith("start-comment-ai-request", {
      documentId: "document-1",
      threadId: "thread-1",
      rootCommentId: "comment-1",
      submittedMode: "suggest",
      instructions: "Please suggest a change",
      requestId,
    });
    expect(api.startBackgroundAgentSession).toHaveBeenCalledWith({
      message: "Handle the source comment",
      instructions: "Hidden comment AI instructions",
      operationId: requestId,
      threadId: "agent-thread-1",
      scope: { type: "content-comment-ai", id: requestId },
      actionScope: { kind: "content-comment-ai", requestId },
      usageLabel: "content:comment-ai",
    });
  });

  it("does not dispatch an active request returned by a racing start", async () => {
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    api.callAction.mockResolvedValue({
      ...request({ status: "running", error: null }),
      outcome: "busy",
      dispatch: false,
      prompt: "Reply in thread for this comment.",
      context: "Hidden comment AI instructions",
      actionScope: { kind: "content-comment-ai", requestId: "request-1" },
    });
    act(() => root.render(createElement(Probe)));

    let outcome: "confirmed-start" | "busy" | undefined;
    await act(async () => {
      outcome = await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "reply",
        instructions: "Please reply",
      });
    });

    expect(api.callAction).toHaveBeenCalledOnce();
    expect(outcome).toBe("busy");
    expect(api.startBackgroundAgentSession).not.toHaveBeenCalled();
    expect(api.refetch).toHaveBeenCalledOnce();
  });

  it("returns busy without starting when another tab already exposed an active operation", async () => {
    api.requests = [request({ status: "running", error: null })];
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    act(() => root.render(createElement(Probe)));

    let outcome: "confirmed-start" | "busy" | undefined;
    await act(async () => {
      outcome = await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "reply",
        instructions: "A second cross-tab draft",
      });
    });

    expect(outcome).toBe("busy");
    expect(api.callAction).not.toHaveBeenCalled();
    expect(api.startBackgroundAgentSession).not.toHaveBeenCalled();
  });

  it("replays the submitted provider, model, and engine through classifying and classified reload recovery", async () => {
    const operationId = "00000000-0000-4000-8000-000000000099";
    api.requests = [
      request({
        operationId,
        requestId: operationId,
        status: "classifying",
        submittedMode: "auto",
        instructions: "Decide how to handle this",
        submittedProvider: "OpenAI",
        submittedModel: "gpt-5-6-sol",
        submittedEngine: "builder",
        intent: null,
        pendingSession: {
          phase: "classification",
          backgroundSession: {
            operationId: `${operationId}:classification`,
            threadId: "classifier-thread",
            turnId: "classifier-turn",
            scope: { type: "content-comment-ai-classifier", id: operationId },
            actionScope: {
              kind: "content-comment-ai-classifier",
              requestId: operationId,
            },
            model: "gpt-5-6-sol",
            engine: "builder",
          },
          prompt: "Decide how to handle this",
        },
      }),
    ];
    api.callAction.mockResolvedValue({
      ...api.requests[0],
      outcome: "confirmed-start",
      dispatch: false,
    });
    function Probe() {
      useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    await act(async () => root.render(createElement(Probe)));

    expect(api.callAction).toHaveBeenCalledWith(
      "start-comment-ai-request",
      expect.objectContaining({
        requestId: operationId,
        provider: "OpenAI",
        model: "gpt-5-6-sol",
        engine: "builder",
      }),
    );

    api.callAction.mockClear();
    api.requests = [
      request({
        ...api.requests[0],
        status: "classified",
        intent: "suggest",
        pendingSession: {
          phase: "execution",
          backgroundSession: {
            operationId,
            threadId: "execution-thread",
            turnId: "execution-turn",
            scope: { type: "content-comment-ai", id: operationId },
            actionScope: {
              kind: "content-comment-ai",
              requestId: operationId,
            },
            model: "gpt-5-6-sol",
            engine: "builder",
          },
          prompt: "Suggest changes: Decide how to handle this",
        },
      }),
    ];
    await act(async () => root.render(createElement(Probe)));

    expect(api.callAction).toHaveBeenCalledWith(
      "start-comment-ai-request",
      expect.objectContaining({
        requestId: operationId,
        provider: "OpenAI",
        model: "gpt-5-6-sol",
        engine: "builder",
      }),
    );
  });

  it("makes a rejected initial dispatch recoverable with the exact same tuple", async () => {
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    const options = {
      message: "Handle the source comment",
      instructions: "Hidden comment AI instructions",
      operationId: "request-1",
      threadId: "agent-thread-1",
      scope: { type: "content-comment-ai", id: "request-1" },
      actionScope: { kind: "content-comment-ai", requestId: "request-1" },
      model: "gpt-5-6-sol",
      engine: "builder",
    };
    api.callAction.mockResolvedValue({
      ...request({
        status: "queued",
        error: null,
        submittedProvider: "OpenAI",
        submittedModel: "gpt-5-6-sol",
        submittedEngine: "builder",
      }),
      dispatch: true,
      prompt: options.message,
      context: options.instructions,
      actionScope: options.actionScope,
      backgroundSession: {
        operationId: options.operationId,
        threadId: options.threadId,
        scope: options.scope,
        actionScope: options.actionScope,
        model: options.model,
        engine: options.engine,
      },
    });
    api.startBackgroundAgentSession
      .mockReturnValueOnce({
        operationId: "request-1",
        threadId: "agent-thread-1",
        turnId: "background-turn-1",
        accepted: Promise.reject(new Error("Failed to fetch")),
        status: vi.fn().mockResolvedValue({
          operationId: "request-1",
          threadId: "agent-thread-1",
          turnId: "background-turn-1",
          status: "unavailable",
        }),
      })
      .mockReturnValueOnce({
        operationId: "request-1",
        threadId: "agent-thread-1",
        turnId: "background-turn-1",
        accepted: Promise.resolve({
          operationId: "request-1",
          threadId: "agent-thread-1",
          turnId: "background-turn-1",
        }),
        status: vi.fn(),
      });
    act(() => root.render(createElement(Probe)));

    await act(async () => {
      await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "suggest",
        instructions: "Please suggest a change",
        provider: "OpenAI",
        model: "gpt-5-6-sol",
        engine: "builder",
        requestId: "request-1",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    api.requests = [
      request({
        status: "queued",
        error: null,
        submittedProvider: "OpenAI",
        submittedModel: "gpt-5-6-sol",
        submittedEngine: "builder",
      }),
    ];
    act(() => root.render(createElement(Probe)));
    expect(controller!.requests[0]).toMatchObject({
      status: "needs-review",
      errorCode: "operation_failed",
      error: "Failed to fetch",
    });

    await act(async () => {
      await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "suggest",
        instructions: "Please suggest a change",
        provider: "OpenAI",
        model: "gpt-5-6-sol",
        engine: "builder",
        requestId: "request-1",
      });
    });

    expect(api.callAction).toHaveBeenCalledOnce();
    expect(api.startBackgroundAgentSession).toHaveBeenCalledTimes(2);
    expect(api.startBackgroundAgentSession.mock.calls[1]?.[0]).toEqual(
      api.startBackgroundAgentSession.mock.calls[0]?.[0],
    );
  });

  it("keeps fresh Ask AI blocked while a transport-unknown original completes late", async () => {
    vi.useFakeTimers();
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    const started = {
      ...request({ status: "queued", error: null }),
      dispatch: true,
      prompt: "Handle the source comment",
      context: "Hidden comment AI instructions",
      actionScope: { kind: "content-comment-ai", requestId: "request-1" },
      backgroundSession: {
        operationId: "request-1",
        threadId: "agent-thread-1",
        scope: { type: "content-comment-ai", id: "request-1" },
        actionScope: { kind: "content-comment-ai", requestId: "request-1" },
      },
    };
    api.callAction
      .mockResolvedValueOnce(started)
      .mockResolvedValueOnce(undefined);
    api.startBackgroundAgentSession.mockReturnValue({
      operationId: "request-1",
      threadId: "agent-thread-1",
      turnId: "agent-turn-1",
      accepted: Promise.reject(new Error("Failed to fetch")),
      status: vi.fn().mockResolvedValue({
        operationId: "request-1",
        threadId: "agent-thread-1",
        turnId: "agent-turn-1",
        status: "errored",
        terminalReason: "Background agent session acknowledgement timed out",
      }),
    });
    act(() => root.render(createElement(Probe)));
    await act(async () => {
      await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "suggest",
        instructions: "Please suggest a change",
        requestId: "request-1",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    api.requests = [
      request({
        status: "queued",
        error: null,
        agentThreadId: "agent-thread-1",
        agentTurnId: "agent-turn-1",
      }),
    ];
    act(() => root.render(createElement(Probe)));

    expect(controller!.requests[0]).toMatchObject({ status: "needs-review" });
    await act(async () => {
      await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "reply",
        instructions: "Please reply",
      });
    });
    expect(api.startBackgroundAgentSession).toHaveBeenCalledOnce();

    api.getBackgroundAgentSessionStatus.mockResolvedValue({
      operationId: "request-1",
      threadId: "agent-thread-1",
      turnId: "agent-turn-1",
      status: "completed",
      runId: "run-1",
      terminalReason: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(api.callAction).toHaveBeenNthCalledWith(
      2,
      "reconcile-comment-ai-session",
      {
        operationId: "request-1",
        threadId: "agent-thread-1",
        turnId: "agent-turn-1",
        status: "completed",
        runId: "run-1",
      },
    );
    vi.useRealTimers();
  });

  it("does not downgrade a terminal turn when its acknowledgement rejects late", async () => {
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    api.callAction.mockResolvedValue({
      ...request({ status: "queued", error: null }),
      dispatch: true,
      prompt: "Handle the source comment",
      context: "Hidden comment AI instructions",
      actionScope: { kind: "content-comment-ai", requestId: "request-1" },
      backgroundSession: {
        operationId: "request-1",
        threadId: "agent-thread-1",
        scope: { type: "content-comment-ai", id: "request-1" },
        actionScope: { kind: "content-comment-ai", requestId: "request-1" },
      },
    });
    api.startBackgroundAgentSession.mockReturnValue({
      operationId: "request-1",
      threadId: "agent-thread-1",
      turnId: "background-turn-1",
      accepted: Promise.reject(new Error("acknowledgement timed out")),
      status: vi.fn().mockResolvedValue({
        operationId: "request-1",
        threadId: "agent-thread-1",
        turnId: "background-turn-1",
        status: "completed",
      }),
    });
    act(() => root.render(createElement(Probe)));

    await act(async () => {
      await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "suggest",
        instructions: "Please suggest a change",
        requestId: "request-1",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    api.requests = [
      request({ status: "replied", errorCode: null, error: null }),
    ];
    act(() => root.render(createElement(Probe)));

    expect(controller!.requests[0]?.status).toBe("replied");
    expect(controller!.requests[0]?.errorCode).toBeNull();
  });

  it("replaces Working with an honest recoverable state after an early Stop 404", async () => {
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    api.callAction.mockResolvedValue({
      ...request({ status: "queued", error: null }),
      dispatch: true,
      prompt: "Handle the source comment",
      actionScope: { kind: "content-comment-ai", requestId: "request-1" },
      backgroundSession: {
        operationId: "request-1",
        threadId: "agent-thread-1",
        scope: { type: "content-comment-ai", id: "request-1" },
        actionScope: { kind: "content-comment-ai", requestId: "request-1" },
      },
    });
    api.startBackgroundAgentSession.mockReturnValue({
      operationId: "request-1",
      threadId: "agent-thread-1",
      turnId: "background-turn-1",
      accepted: new Promise(() => undefined),
      status: vi.fn(),
    });
    api.cancelBackgroundAgentSession.mockRejectedValue(
      new Error("Background agent session was rejected (HTTP 404)"),
    );
    act(() => root.render(createElement(Probe)));
    await act(async () => {
      await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        submittedMode: "suggest",
        instructions: "Please suggest a change",
        requestId: "request-1",
      });
    });
    api.requests = [
      request({
        status: "queued",
        error: null,
        agentThreadId: "agent-thread-1",
        agentTurnId: "background-turn-1",
      }),
    ];
    act(() => root.render(createElement(Probe)));

    await expect(
      act(async () => controller!.stop(controller!.requests[0]!)),
    ).rejects.toThrow("HTTP 404");
    act(() => root.render(createElement(Probe)));

    expect(controller!.requests[0]).toMatchObject({
      status: "needs-review",
      errorCode: "operation_failed",
      error: "Background agent session was rejected (HTTP 404)",
    });
  });

  it("retries a rejected continuation after remount with its exact saved tuple", async () => {
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    const base = request({
      status: "replied",
      errorCode: null,
      error: null,
      agentThreadId: "agent-thread-1",
      agentTurnId: "initial-turn-1",
    });
    api.requests = [base];
    api.loadCommentAiConversation.mockResolvedValue([
      {
        turnId: "initial-turn-1",
        userText: "Original comment and protected document context",
        assistantText: "I suggested changing the opening paragraph.",
        status: "complete",
      },
      {
        turnId: "prior-follow-up-1",
        userText: "Why this approach?",
        assistantText: "It preserves the author's stated intent.",
        status: "complete",
      },
    ]);
    api.startBackgroundAgentSession
      .mockReturnValueOnce({
        operationId: "continuation-1",
        threadId: "agent-thread-1",
        turnId: "continuation-turn-1",
        accepted: Promise.reject(new Error("Follow-up POST failed")),
        status: vi.fn(),
      })
      .mockReturnValueOnce({
        operationId: "continuation-1",
        threadId: "agent-thread-1",
        turnId: "continuation-turn-1",
        accepted: Promise.resolve({
          operationId: "continuation-1",
          threadId: "agent-thread-1",
          turnId: "continuation-turn-1",
        }),
        status: vi.fn(),
      });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("continuation-1");
    act(() => root.render(createElement(Probe)));

    await expect(
      act(async () => controller!.continue(base, "What about accessibility?")),
    ).rejects.toThrow("Follow-up POST failed");
    act(() => root.render(createElement(Probe)));
    expect(controller!.requests[0]).toMatchObject({
      status: "needs-review",
      error: "Follow-up POST failed",
    });
    await expect(
      controller!.continue(base, "Accidentally submit another follow-up"),
    ).rejects.toThrow("Follow-up POST failed");
    expect(api.startBackgroundAgentSession).toHaveBeenCalledOnce();

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(Probe)));
    await act(async () => {
      await controller!.retry(base);
    });

    expect(api.callAction).not.toHaveBeenCalled();
    expect(api.startBackgroundAgentSession).toHaveBeenCalledTimes(2);
    expect(api.startBackgroundAgentSession.mock.calls[1]?.[0]).toEqual(
      api.startBackgroundAgentSession.mock.calls[0]?.[0],
    );
    expect(api.startBackgroundAgentSession.mock.calls[1]?.[0]).toMatchObject({
      message: "What about accessibility?",
      operationId: "continuation-1",
      threadId: "agent-thread-1",
    });
    expect(api.loadCommentAiConversation).toHaveBeenCalledWith({
      operationId: "request-1",
      agentThreadId: "agent-thread-1",
      initialTurnId: "",
    });
    expect(
      api.startBackgroundAgentSession.mock.calls[0]?.[0]?.instructions,
    ).toContain("Original comment and protected document context");
    expect(
      api.startBackgroundAgentSession.mock.calls[0]?.[0]?.instructions,
    ).toContain("I suggested changing the opening paragraph.");
    expect(
      api.startBackgroundAgentSession.mock.calls[0]?.[0]?.instructions,
    ).toContain("It preserves the author's stated intent.");
  });

  it("keeps a monitor-observed terminal continuation when acceptance rejects before rerender", async () => {
    vi.useFakeTimers();
    let rejectAcceptance!: (error: Error) => void;
    const accepted = new Promise<never>((_resolve, reject) => {
      rejectAcceptance = reject;
    });
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    const base = request({
      status: "replied",
      errorCode: null,
      error: null,
      agentThreadId: "agent-thread-1",
      agentTurnId: "initial-turn-1",
    });
    api.requests = [base];
    api.startBackgroundAgentSession.mockReturnValue({
      operationId: "continuation-1",
      threadId: "agent-thread-1",
      turnId: "continuation-turn-1",
      accepted,
      status: vi.fn(),
    });
    api.getBackgroundAgentSessionStatus.mockResolvedValue({
      operationId: "continuation-1",
      threadId: "agent-thread-1",
      turnId: "continuation-turn-1",
      status: "completed",
    });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("continuation-1");
    act(() => root.render(createElement(Probe)));

    let continuationPromise!: Promise<Error | null>;
    act(() => {
      continuationPromise = controller!
        .continue(base, "One more question")
        .then(
          () => null,
          (error) => error as Error,
        );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(controller!.continuations.get(base.operationId)).toMatchObject({
      operationId: "continuation-1",
      turnId: "continuation-turn-1",
      status: "completed",
    });
    await act(async () => {
      rejectAcceptance(new Error("acknowledgement timed out"));
      expect(await continuationPromise).toBeNull();
    });
    expect(
      controller!.continuations.get(base.operationId)?.error,
    ).toBeUndefined();
    vi.useRealTimers();
  });

  it("surfaces a failed request start and clears the starting state", async () => {
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    api.callAction.mockRejectedValue(new Error("The comment is stale"));
    act(() => root.render(createElement(Probe)));

    await expect(
      act(async () => {
        await controller!.start({
          threadId: "thread-1",
          rootCommentId: "comment-1",
          submittedMode: "reply",
          instructions: "Please reply",
        });
      }),
    ).rejects.toThrow("The comment is stale");
    expect(controller!.startingThreadIds.size).toBe(0);
    expect(api.startBackgroundAgentSession).not.toHaveBeenCalled();
  });

  it("polls only while a saved request is queued or running", () => {
    expect(
      commentAiRequestsRefetchInterval({
        requests: [request({ status: "queued" })],
      }),
    ).toBe(1_500);
    expect(
      commentAiRequestsRefetchInterval({
        requests: [request({ status: "running" })],
      }),
    ).toBe(1_500);
    expect(
      commentAiRequestsRefetchInterval({
        requests: [request({ status: "replied" })],
      }),
    ).toBe(false);
    expect(commentAiRequestsRefetchInterval(undefined)).toBe(false);
  });
});

describe("comment AI session reconciliation", () => {
  const snapshot = {
    operationId: "operation-1",
    threadId: "thread-1",
    turnId: "turn-1",
    status: "unavailable" as const,
  };

  it("keeps transport uncertainty recoverable", () => {
    expect(
      shouldReconcileCommentAiSnapshot({
        ...snapshot,
        transportError: "acknowledgement timed out",
      }),
    ).toBe(false);
  });

  it("keeps an exact receipt recoverable through delayed visibility", () => {
    for (let poll = 0; poll < 10; poll += 1) {
      expect(shouldReconcileCommentAiSnapshot(snapshot)).toBe(false);
    }
    expect(
      shouldReconcileCommentAiSnapshot({
        ...snapshot,
        status: "completed",
        runId: "run-1",
      }),
    ).toBe(true);
  });

  it("does not terminalize a pre-dispatch error without a durable run", () => {
    for (const status of [
      "completed",
      "truncated",
      "errored",
      "aborted",
    ] as const) {
      expect(
        shouldReconcileCommentAiSnapshot({
          ...snapshot,
          status,
          terminalReason: "Background agent session acknowledgement timed out",
        }),
      ).toBe(false);
      expect(
        shouldReconcileCommentAiSnapshot({
          ...snapshot,
          status,
          runId: "run-1",
          terminalReason: "provider_error",
        }),
      ).toBe(true);
    }
  });

  it("does not let a delayed acknowledgement downgrade a terminal turn", () => {
    const completed = {
      "request-1": {
        operationId: "continuation-1",
        threadId: "thread-1",
        turnId: "turn-1",
        status: "completed" as const,
      },
    };
    expect(
      acknowledgeCommentAiContinuation(completed, "request-1", "turn-1"),
    ).toBe(completed);
    expect(
      shouldIgnoreContinuationAcceptanceError(completed["request-1"], "turn-1"),
    ).toBe(true);

    const queued = {
      "request-1": { ...completed["request-1"], status: "queued" as const },
    };
    expect(
      acknowledgeCommentAiContinuation(queued, "request-1", "turn-1")[
        "request-1"
      ]?.status,
    ).toBe("running");
    expect(
      shouldIgnoreContinuationAcceptanceError(queued["request-1"], "turn-1"),
    ).toBe(false);
  });
});

describe("comment AI continuation context", () => {
  it("preserves a bounded original anchor and the newest fact with explicit truncation", () => {
    const context = boundedContinuationContext([
      {
        turnId: "initial",
        userText: `Original protected context ${"old ".repeat(4_000)}`,
        assistantText: "Initial response",
        status: "complete",
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        turnId: `middle-${index}`,
        userText: `Middle question ${index} ${"detail ".repeat(300)}`,
        assistantText: `Middle answer ${index}`,
        status: "complete" as const,
      })),
      {
        turnId: "latest",
        userText: "How does that affect the launch?",
        assistantText: "The latest launch fact is ORCHID-742.",
        status: "complete",
      },
    ]);

    expect(context.length).toBeLessThanOrEqual(12_000);
    expect(context).toContain("Original protected context");
    expect(context).toContain("[Turn truncated]");
    expect(context).toContain("[Earlier conversation omitted]");
    expect(context).toContain("The latest launch fact is ORCHID-742.");
  });
});
