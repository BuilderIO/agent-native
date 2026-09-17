// @vitest-environment happy-dom

import type { CommentAiRequest } from "@shared/comment-ai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  acknowledgeCommentAiContinuation,
  commentAiRequestsRefetchInterval,
  shouldReconcileCommentAiSnapshot,
  shouldIgnoreContinuationAcceptanceError,
  CommentAiRequestStatus,
  CommentAiThreadActions,
  type CommentAiController,
  useCommentAiRequests,
} from "./comment-ai";

const api = vi.hoisted(() => ({
  callAction: vi.fn(),
  refetch: vi.fn(),
  startBackgroundAgentSession: vi.fn(),
  getBackgroundAgentSessionStatus: vi.fn(),
  cancelBackgroundAgentSession: vi.fn(),
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

  function renderControls(
    props: Partial<Parameters<typeof CommentAiThreadActions>[0]> = {},
  ) {
    const onStart = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              "div",
              null,
              createElement("textarea", { defaultValue: "unfinished reply" }),
              createElement(CommentAiThreadActions, {
                "aria-label": "comments.askAi",
                starting: false,
                canSuggest: true,
                canReply: true,
                canApply: true,
                onStart,
                ...props,
              }),
            ),
          ),
        ),
      ),
    );
    return onStart;
  }

  async function openMenu(trigger: HTMLButtonElement) {
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
    });
  }

  it("opens and dismisses the ordered menu without dispatching", async () => {
    const onStart = renderControls();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="comments.askAi"]',
    )!;
    await openMenu(trigger);
    const items = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      "comments.aiSuggestChanges",
      "comments.aiReplyInThread",
      "comments.aiApplyAndResolve",
    ]);
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onStart).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")?.value).toBe("unfinished reply");
  });

  it("supports keyboard selection and disables unavailable suggestions", async () => {
    const onStart = renderControls();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="comments.askAi"]',
    )!;
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const first = document.querySelector<HTMLElement>("[role=menuitem]")!;
    await act(async () =>
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(onStart).toHaveBeenCalledWith("suggest", undefined);

    act(() => root.unmount());
    root = createRoot(container);
    renderControls({ canSuggest: false });
    await openMenu(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="comments.askAi"]',
      )!,
    );
    expect(
      document
        .querySelector<HTMLElement>("[role=menuitem]")
        ?.getAttribute("data-disabled"),
    ).not.toBeNull();
  });

  it("shows actionable errors and retries with the same request id", async () => {
    const failed = request();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        createElement(CommentAiRequestStatus, {
          request: failed,
          onRetry,
          onReply: vi.fn(),
          onStop: vi.fn().mockResolvedValue(undefined),
          onOpen: vi.fn(),
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

  it("prevents duplicate starts and sends localized text with hidden scoped context", async () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
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
      intent: "suggest" as const,
    };
    await act(async () => {
      await Promise.all([controller!.start(input), controller!.start(input)]);
    });

    expect(api.callAction).toHaveBeenCalledOnce();
    expect(api.callAction).toHaveBeenCalledWith("start-comment-ai-request", {
      documentId: "document-1",
      threadId: "thread-1",
      rootCommentId: "comment-1",
      intent: "suggest",
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
      dispatch: false,
      prompt: "Reply in thread for this comment.",
      context: "Hidden comment AI instructions",
      actionScope: { kind: "content-comment-ai", requestId: "request-1" },
    });
    act(() => root.render(createElement(Probe)));

    await act(async () => {
      await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        intent: "reply",
      });
    });

    expect(api.callAction).toHaveBeenCalledOnce();
    expect(api.startBackgroundAgentSession).not.toHaveBeenCalled();
    expect(api.refetch).toHaveBeenCalledOnce();
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
    };
    api.callAction.mockResolvedValue({
      ...request({ status: "queued", error: null }),
      dispatch: true,
      prompt: options.message,
      context: options.instructions,
      actionScope: options.actionScope,
      backgroundSession: {
        operationId: options.operationId,
        threadId: options.threadId,
        scope: options.scope,
        actionScope: options.actionScope,
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
        intent: "suggest",
        requestId: "request-1",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    api.requests = [request({ status: "queued", error: null })];
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
        intent: "suggest",
        requestId: "request-1",
      });
    });

    expect(api.callAction).toHaveBeenCalledOnce();
    expect(api.startBackgroundAgentSession).toHaveBeenCalledTimes(2);
    expect(api.startBackgroundAgentSession.mock.calls[1]?.[0]).toEqual(
      api.startBackgroundAgentSession.mock.calls[0]?.[0],
    );
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
        intent: "suggest",
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
        intent: "suggest",
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
      await controller!.start({
        threadId: base.threadId,
        rootCommentId: base.rootCommentId,
        intent: base.intent,
        requestId: base.requestId,
      });
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
          intent: "reply",
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
      shouldReconcileCommentAiSnapshot({ ...snapshot, status: "completed" }),
    ).toBe(true);
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
