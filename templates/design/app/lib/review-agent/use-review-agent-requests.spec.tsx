// @vitest-environment happy-dom

import type {
  ReviewAgentRequest,
  StartReviewAgentResult,
} from "@shared/review-agent";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makePendingSession,
  makeReviewAgentRequest,
  REVIEW_AGENT_TEST_NOW,
} from "./test-review-agent-request";
import {
  reviewAgentRefetchInterval,
  useReviewAgentRequests,
  type ReviewAgentController,
} from "./use-review-agent-requests";

class SetupRequiredError extends Error {
  readonly code = "agent_chat_ai_setup_required";
}

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  refetch: vi.fn(),
  list: { requests: [] as unknown[] },
  queryOptions: undefined as
    | {
        enabled?: boolean;
        refetchInterval?: (state: { state: { data: unknown } }) => unknown;
      }
    | undefined,
  startSession: vi.fn(),
  cancelSession: vi.fn(),
  sessionStatus: vi.fn(),
  openThread: vi.fn(),
  requireEngine: vi.fn(),
  chatModelsOptions: [] as Array<{ enabled?: boolean; storageKey?: unknown }>,
  chatModels: {
    availableModels: [
      {
        engine: "anthropic",
        label: "Anthropic",
        models: ["claude-sonnet-5-5", "claude-opus-5-5"],
        configured: true,
      },
      {
        engine: "openai",
        label: "OpenAI",
        models: ["gpt-5-4"],
        configured: false,
      },
    ],
    selectedModel: "claude-sonnet-5-5",
    selectedEngine: "anthropic",
    selectionReady: true,
  },
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useActionQuery: (
    _name: string,
    _params: unknown,
    options: typeof mocks.queryOptions,
  ) => {
    mocks.queryOptions = options;
    return { data: mocks.list, refetch: mocks.refetch };
  },
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  startBackgroundAgentSession: mocks.startSession,
  cancelBackgroundAgentSession: mocks.cancelSession,
  getBackgroundAgentSessionStatus: mocks.sessionStatus,
  requestAgentChatThreadOpen: mocks.openThread,
  requireAgentEngineConfiguredForDispatch: mocks.requireEngine,
  isAgentChatAiSetupRequiredError: (error: unknown) =>
    error instanceof SetupRequiredError,
  chatModelSelectionStorageKey: (namespace: string) => `models:${namespace}`,
  useChatModels: (options: { enabled?: boolean; storageKey?: unknown }) => {
    mocks.chatModelsOptions.push(options);
    // A disabled `useChatModels` has loaded nothing.
    return options.enabled
      ? mocks.chatModels
      : { ...mocks.chatModels, availableModels: [], selectionReady: false };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo },
}));

const DESIGN_ID = "design-1";

const startResult = (
  overrides: Partial<StartReviewAgentResult> = {},
): StartReviewAgentResult => {
  const pendingSession = makePendingSession();
  return {
    outcome: "started",
    dispatch: true,
    request: makeReviewAgentRequest({
      status: "queued",
      mode: "reply",
      pendingSession,
    }),
    pendingSession,
    ...overrides,
  };
};

// The real handle swallows its own unhandled rejection; so must the stand-in.
const rejectedHandle = (error: Error, status: { status: string }) => {
  const accepted = Promise.reject(error);
  accepted.catch(() => undefined);
  return { accepted, status: vi.fn().mockResolvedValue(status) };
};

const acceptedHandle = () => ({
  accepted: Promise.resolve({
    operationId: "request-1",
    threadId: "design-review-agent-1",
    turnId: "turn-1",
  }),
  status: vi.fn().mockResolvedValue({ status: "queued" }),
});

describe("useReviewAgentRequests", () => {
  let container: HTMLDivElement;
  let reactRoot: Root;
  let queryClient: QueryClient;
  let controller: ReviewAgentController;
  let props: Parameters<typeof useReviewAgentRequests>[0];

  function Harness() {
    controller = useReviewAgentRequests(props);
    return null;
  }

  const render = async () => {
    await act(async () => {
      reactRoot.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
  };
  const setRequests = async (requests: ReviewAgentRequest[]) => {
    mocks.list = { requests };
    await render();
  };

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(REVIEW_AGENT_TEST_NOW);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.list = { requests: [] };
    mocks.queryOptions = undefined;
    mocks.chatModelsOptions = [];
    mocks.refetch.mockReset().mockImplementation(async () => ({
      data: mocks.list,
    }));
    mocks.callAction.mockReset();
    mocks.startSession.mockReset().mockReturnValue(acceptedHandle());
    mocks.cancelSession.mockReset().mockResolvedValue(undefined);
    mocks.sessionStatus.mockReset().mockResolvedValue({
      status: "running",
      operationId: "x",
      threadId: "t",
      turnId: "u",
    });
    mocks.openThread.mockReset();
    mocks.requireEngine.mockReset().mockResolvedValue(undefined);
    mocks.toastError.mockReset();
    mocks.toastInfo.mockReset();
    props = { designId: DESIGN_ID, enabled: true, surfaceActive: true };
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.append(container);
    reactRoot = createRoot(container);
  });

  afterEach(() => {
    act(() => reactRoot.unmount());
    container.remove();
    vi.useRealTimers();
  });

  describe("start", () => {
    it("starts the request, then dispatches exactly what its pending session says", async () => {
      mocks.callAction.mockResolvedValueOnce(startResult());
      await render();

      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("started");

      expect(mocks.callAction).toHaveBeenCalledTimes(1);
      const [name, params] = mocks.callAction.mock.calls[0] ?? [];
      expect(name).toBe("start-review-agent-request");
      expect(params).toMatchObject({
        designId: DESIGN_ID,
        threadId: "thread-1",
        mode: "reply",
      });
      expect(params.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(params).not.toHaveProperty("triggerCommentId");
      expect(params).not.toHaveProperty("model");

      expect(mocks.startSession).toHaveBeenCalledExactlyOnceWith({
        message: "Reply in thread: Make it bigger",
        instructions: "You are answering a design review comment.",
        operationId: "request-1",
        threadId: "design-review-agent-1",
        scope: { type: "design-review-agent", id: "request-1" },
        actionScope: { kind: "design-review-agent", requestId: "request-1" },
        model: "claude-sonnet-5-5",
        engine: "anthropic",
        usageLabel: "design:review-agent",
      });
      expect(mocks.refetch).toHaveBeenCalled();
    });

    it("sends the chip's trigger comment and model for an automatic run", async () => {
      mocks.callAction.mockResolvedValueOnce(startResult());
      await render();

      await controller.start({
        threadId: "thread-1",
        mode: "auto",
        triggerCommentId: "comment-9",
        selection: {
          model: "claude-opus-5-5",
          engine: "anthropic",
          provider: "Anthropic",
        },
      });

      expect(mocks.callAction.mock.calls[0]?.[1]).toMatchObject({
        mode: "auto",
        triggerCommentId: "comment-9",
        model: "claude-opus-5-5",
        engine: "anthropic",
        provider: "Anthropic",
      });
      expect(mocks.requireEngine).toHaveBeenCalledWith({ engine: "anthropic" });
    });

    it("does not dispatch when the server says there is nothing to dispatch", async () => {
      mocks.callAction.mockResolvedValueOnce(
        startResult({
          outcome: "replayed",
          dispatch: false,
          pendingSession: null,
        }),
      );
      await render();
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("started");
      expect(mocks.startSession).not.toHaveBeenCalled();
    });

    it("reports a failure rather than a start when the server asks for a dispatch it gave no session for", async () => {
      mocks.callAction.mockResolvedValueOnce(
        startResult({ dispatch: true, pendingSession: null }),
      );
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      await render();
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("unavailable");
      expect(mocks.startSession).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith("review.agent.startFailed");
      warn.mockRestore();
    });

    it("refuses before any network call while the thread has an active run", async () => {
      await setRequests([makeReviewAgentRequest({ status: "running" })]);
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("busy");
      expect(mocks.requireEngine).not.toHaveBeenCalled();
      expect(mocks.callAction).not.toHaveBeenCalled();
      expect(mocks.toastInfo).toHaveBeenCalledWith("review.agent.busy");
    });

    it("lets a stale active run through so the server can expire it", async () => {
      await setRequests([
        makeReviewAgentRequest({
          status: "running",
          updatedAt: new Date(
            REVIEW_AGENT_TEST_NOW - 31 * 60_000,
          ).toISOString(),
        }),
      ]);
      mocks.callAction.mockResolvedValueOnce(startResult());
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("started");
    });

    it("reports busy when the server finds another run, and refreshes the list", async () => {
      mocks.callAction.mockResolvedValueOnce(
        startResult({ outcome: "busy", dispatch: false, pendingSession: null }),
      );
      await render();
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("busy");
      expect(mocks.refetch).toHaveBeenCalled();
      expect(mocks.startSession).not.toHaveBeenCalled();
      expect(mocks.toastInfo).toHaveBeenCalledWith("review.agent.busy");
    });

    it("creates no request when no AI model is connected", async () => {
      mocks.requireEngine.mockRejectedValueOnce(
        new SetupRequiredError("missing"),
      );
      await render();
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("setup-required");
      expect(mocks.callAction).not.toHaveBeenCalled();
      expect(mocks.startSession).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "review.agent.setupRequired",
      );
    });

    it("tells the person and returns unavailable when the start call fails", async () => {
      mocks.callAction.mockRejectedValueOnce(new Error("boom"));
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      await render();
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("unavailable");
      expect(mocks.toastError).toHaveBeenCalledWith("review.agent.startFailed");
      expect(mocks.startSession).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("refuses to start when agents are not enabled", async () => {
      props = { ...props, enabled: false };
      await render();
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("unavailable");
      expect(mocks.callAction).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith("review.agent.startFailed");
    });

    it("marks the thread busy, with the chosen name, while the start is in flight", async () => {
      let finish: (result: StartReviewAgentResult) => void = () => undefined;
      mocks.callAction.mockReturnValueOnce(
        new Promise<StartReviewAgentResult>((resolve) => {
          finish = resolve;
        }),
      );
      await render();
      let outcome!: Promise<string>;
      await act(async () => {
        outcome = controller.start({
          threadId: "thread-1",
          mode: "auto",
          triggerCommentId: "comment-1",
          selection: {
            model: "claude-sonnet-5-5",
            engine: "anthropic",
            provider: "Anthropic",
          },
        });
      });
      expect(controller.isThreadBusy("thread-1")).toBe(true);
      expect(controller.startingThreadIds.has("thread-1")).toBe(true);
      expect(controller.startingAgentName("thread-1")).toBe(
        "Claude Sonnet 5.5",
      );
      expect(controller.isThreadBusy("thread-2")).toBe(false);

      // A second start on the same thread is refused while the first is in flight.
      await expect(
        controller.start({ threadId: "thread-1", mode: "suggest" }),
      ).resolves.toBe("busy");

      await act(async () => finish(startResult()));
      await expect(outcome).resolves.toBe("started");
      expect(controller.startingThreadIds.has("thread-1")).toBe(false);
    });
  });

  describe("dispatch failures", () => {
    it("records engine_not_configured when the session is rejected for setup", async () => {
      mocks.callAction.mockResolvedValueOnce(startResult());
      mocks.startSession.mockReturnValueOnce(
        rejectedHandle(new SetupRequiredError("missing"), {
          status: "unavailable",
        }),
      );
      mocks.callAction.mockResolvedValueOnce({
        request: makeReviewAgentRequest(),
      });
      await render();

      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("unavailable");

      expect(mocks.callAction).toHaveBeenLastCalledWith(
        "reconcile-review-agent-session",
        {
          requestId: "request-1",
          phase: "execution",
          status: "errored",
          errorCode: "engine_not_configured",
        },
      );
      expect(mocks.toastError).toHaveBeenCalledWith(
        "review.agent.setupRequired",
      );
    });

    it("records dispatch_failed for any other transport failure", async () => {
      mocks.callAction.mockResolvedValueOnce(startResult());
      mocks.startSession.mockReturnValueOnce(
        rejectedHandle(new Error("HTTP 500"), { status: "unavailable" }),
      );
      mocks.callAction.mockResolvedValueOnce({
        request: makeReviewAgentRequest(),
      });
      await render();

      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("unavailable");

      expect(mocks.callAction).toHaveBeenLastCalledWith(
        "reconcile-review-agent-session",
        expect.objectContaining({ errorCode: "dispatch_failed" }),
      );
      expect(mocks.toastError).toHaveBeenCalledWith("review.agent.startFailed");
    });

    it("treats a rejected acknowledgement as accepted when the run already exists", async () => {
      mocks.callAction.mockResolvedValueOnce(startResult());
      mocks.startSession.mockReturnValueOnce(
        rejectedHandle(new Error("acknowledgement timed out"), {
          status: "running",
        }),
      );
      await render();

      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("started");
      expect(mocks.callAction).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it("still reports failure when the failure cannot be recorded", async () => {
      mocks.callAction.mockResolvedValueOnce(startResult());
      mocks.startSession.mockReturnValueOnce(
        rejectedHandle(new Error("HTTP 500"), { status: "unavailable" }),
      );
      mocks.callAction.mockRejectedValueOnce(new Error("reconcile failed"));
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      await render();
      await expect(
        controller.start({ threadId: "thread-1", mode: "reply" }),
      ).resolves.toBe("unavailable");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("resume", () => {
    it("dispatches a stuck request's pending session once, however often the list refreshes", async () => {
      const stuck = makeReviewAgentRequest({
        status: "queued",
        agentThreadId: null,
        agentTurnId: null,
        pendingSession: makePendingSession(),
      });
      await setRequests([stuck]);
      expect(mocks.startSession).toHaveBeenCalledTimes(1);
      expect(mocks.startSession.mock.calls[0]?.[0]).toMatchObject({
        operationId: "request-1",
        threadId: "design-review-agent-1",
      });

      await setRequests([{ ...stuck, updatedAt: "2026-10-27T11:59:45.000Z" }]);
      await setRequests([stuck]);
      expect(mocks.startSession).toHaveBeenCalledTimes(1);
    });

    it("dispatches the execution session after classification, as a new phase", async () => {
      const classifying = makeReviewAgentRequest({
        status: "classifying",
        agentThreadId: null,
        agentTurnId: null,
        pendingSession: makePendingSession({
          phase: "classification",
          operationId: "request-1:classification",
          threadId: "classifier-1",
        }),
      });
      await setRequests([classifying]);
      expect(mocks.startSession).toHaveBeenCalledTimes(1);

      await setRequests([
        {
          ...classifying,
          status: "queued",
          intent: "suggest",
          pendingSession: makePendingSession(),
        },
      ]);
      expect(mocks.startSession).toHaveBeenCalledTimes(2);
      expect(mocks.startSession.mock.calls[1]?.[0]).toMatchObject({
        operationId: "request-1",
        threadId: "design-review-agent-1",
      });
    });

    it("does not re-dispatch the session this tab just dispatched from start", async () => {
      mocks.callAction.mockResolvedValueOnce(startResult());
      await render();
      await controller.start({ threadId: "thread-1", mode: "reply" });
      expect(mocks.startSession).toHaveBeenCalledTimes(1);

      // The list still carries the pending session until the first scoped action.
      await setRequests([startResult().request]);
      expect(mocks.startSession).toHaveBeenCalledTimes(1);
    });

    it("leaves someone else's request alone", async () => {
      await setRequests([
        makeReviewAgentRequest({
          status: "queued",
          requesterIsMe: false,
          pendingSession: null,
        }),
      ]);
      expect(mocks.startSession).not.toHaveBeenCalled();
    });

    it("does nothing when agents are not enabled", async () => {
      props = { ...props, enabled: false };
      await setRequests([
        makeReviewAgentRequest({
          status: "queued",
          pendingSession: makePendingSession(),
        }),
      ]);
      expect(mocks.startSession).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("cancels the request first, then aborts the run with the server's receipt", async () => {
      const request = makeReviewAgentRequest({ status: "running" });
      mocks.callAction.mockResolvedValueOnce({
        request: { ...request, status: "cancelled" },
        receipt: { threadId: "design-review-agent-1", turnId: "turn-1" },
        changed: true,
      });
      await setRequests([request]);

      await act(async () => controller.stop(request));

      expect(mocks.callAction).toHaveBeenCalledExactlyOnceWith(
        "cancel-review-agent-request",
        { requestId: "request-1" },
      );
      expect(mocks.cancelSession).toHaveBeenCalledExactlyOnceWith({
        threadId: "design-review-agent-1",
        turnId: "turn-1",
        reason: "user",
      });
      const cancelOrder = mocks.callAction.mock.invocationCallOrder[0] ?? 0;
      const abortOrder = mocks.cancelSession.mock.invocationCallOrder[0] ?? 0;
      expect(cancelOrder).toBeLessThan(abortOrder);
      expect(controller.stoppingRequestIds.size).toBe(0);
      expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it("does not abort when the request was already finished", async () => {
      const request = makeReviewAgentRequest({ status: "running" });
      mocks.callAction.mockResolvedValueOnce({
        request: { ...request, status: "replied" },
        receipt: null,
        changed: false,
      });
      await setRequests([request]);
      await act(async () => controller.stop(request));
      expect(mocks.cancelSession).not.toHaveBeenCalled();
    });

    it("treats a run that is not there to abort as fine", async () => {
      const request = makeReviewAgentRequest({ status: "queued" });
      mocks.callAction.mockResolvedValueOnce({
        request: { ...request, status: "cancelled" },
        receipt: { threadId: "design-review-agent-1", turnId: "turn-1" },
        changed: true,
      });
      mocks.cancelSession.mockRejectedValueOnce(
        Object.assign(new Error("not found"), { status: 404 }),
      );
      await setRequests([request]);
      await act(async () => controller.stop(request));
      expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it("says so when the run could not be aborted", async () => {
      const request = makeReviewAgentRequest({ status: "running" });
      mocks.callAction.mockResolvedValueOnce({
        request: { ...request, status: "cancelled" },
        receipt: { threadId: "design-review-agent-1", turnId: "turn-1" },
        changed: true,
      });
      mocks.cancelSession.mockRejectedValueOnce(
        Object.assign(new Error("server error"), { status: 500 }),
      );
      await setRequests([request]);
      await act(async () => controller.stop(request));
      expect(mocks.toastError).toHaveBeenCalledWith(
        "review.agent.cancelFailed",
      );
    });

    it("says so when the cancel itself fails, and stops tracking it", async () => {
      const request = makeReviewAgentRequest({ status: "running" });
      mocks.callAction.mockRejectedValueOnce(new Error("offline"));
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      await setRequests([request]);
      await act(async () => controller.stop(request));
      expect(mocks.cancelSession).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "review.agent.cancelFailed",
      );
      expect(controller.stoppingRequestIds.size).toBe(0);
      warn.mockRestore();
    });
  });

  describe("retry", () => {
    it("starts a new request with the failed one's mode, trigger comment and model", async () => {
      const failed = makeReviewAgentRequest({
        requestId: "request-old",
        status: "failed",
        mode: "auto",
        triggerCommentId: "comment-7",
        submitted: {
          provider: "Anthropic",
          model: "claude-opus-5-5",
          engine: "anthropic",
        },
      });
      mocks.callAction.mockResolvedValueOnce(startResult());
      await setRequests([failed]);

      await expect(controller.retry(failed)).resolves.toBe("started");

      const params = mocks.callAction.mock.calls[0]?.[1];
      expect(params).toMatchObject({
        mode: "auto",
        threadId: "thread-1",
        triggerCommentId: "comment-7",
        model: "claude-opus-5-5",
        engine: "anthropic",
        provider: "Anthropic",
      });
      expect(params.requestId).not.toBe("request-old");
    });
  });

  describe("open", () => {
    it("opens the run's chat thread", async () => {
      await render();
      controller.open(makeReviewAgentRequest({ agentThreadId: "chat-9" }));
      expect(mocks.openThread).toHaveBeenCalledExactlyOnceWith({
        threadId: "chat-9",
      });
    });

    it("opens nothing when the request has no thread to show", async () => {
      await render();
      controller.open(
        makeReviewAgentRequest({ agentThreadId: null, pendingSession: null }),
      );
      expect(mocks.openThread).not.toHaveBeenCalled();
    });
  });

  describe("refreshing after a run", () => {
    it("refreshes the thread when an active run becomes terminal, not on first sight of a finished one", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      await setRequests([makeReviewAgentRequest({ status: "replied" })]);
      expect(invalidate).not.toHaveBeenCalled();

      await setRequests([
        makeReviewAgentRequest({ requestId: "request-2", status: "running" }),
      ]);
      await setRequests([
        makeReviewAgentRequest({ requestId: "request-2", status: "replied" }),
      ]);
      expect(invalidate).toHaveBeenCalledExactlyOnceWith({
        queryKey: ["action", "list-review-comments"],
      });
    });

    it("also refreshes the design when the run applied changes", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      await setRequests([makeReviewAgentRequest({ status: "running" })]);
      await setRequests([
        makeReviewAgentRequest({
          status: "applied",
          result: { editApplied: true, resolved: true },
        }),
      ]);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["action", "list-review-comments"],
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["action", "get-design"],
      });
    });

    it("refreshes the design when a run ends needing input after it edited", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      await setRequests([makeReviewAgentRequest({ status: "running" })]);
      await setRequests([
        makeReviewAgentRequest({
          status: "needs-input",
          errorCode: "apply_incomplete",
          result: { editApplied: true },
        }),
      ]);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["action", "get-design"],
      });
    });

    it("refreshes when the first list already shows the run this tab started as finished", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      mocks.callAction.mockResolvedValueOnce(startResult());
      await render();
      await controller.start({ threadId: "thread-1", mode: "reply" });
      await setRequests([makeReviewAgentRequest({ status: "replied" })]);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["action", "list-review-comments"],
      });
    });
  });

  describe("monitoring a run", () => {
    const running = () =>
      makeReviewAgentRequest({ status: "running", requesterIsMe: true });
    const tick = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    it("reconciles once the run has ended without the server finishing it", async () => {
      mocks.sessionStatus.mockResolvedValue({
        operationId: "request-1",
        threadId: "design-review-agent-1",
        turnId: "turn-1",
        status: "errored",
        runId: "run-1",
        terminalReason: "model error",
      });
      mocks.callAction.mockResolvedValue({ request: running() });
      await setRequests([running()]);
      await tick(10);

      expect(mocks.sessionStatus).toHaveBeenCalledWith({
        operationId: "request-1",
        threadId: "design-review-agent-1",
        turnId: "turn-1",
      });
      expect(mocks.callAction).toHaveBeenCalledExactlyOnceWith(
        "reconcile-review-agent-session",
        {
          requestId: "request-1",
          phase: "execution",
          status: "errored",
          runId: "run-1",
          terminalReason: "model error",
        },
      );
    });

    it("does not let a terminal label without a run id finish the request", async () => {
      mocks.sessionStatus.mockResolvedValue({
        operationId: "request-1",
        threadId: "design-review-agent-1",
        turnId: "turn-1",
        status: "completed",
      });
      await setRequests([running()]);
      await tick(5_000);
      expect(mocks.callAction).not.toHaveBeenCalled();
      expect(mocks.sessionStatus.mock.calls.length).toBeGreaterThan(1);
    });

    it("keeps watching while the run is queued, running or not visible yet", async () => {
      for (const status of ["queued", "running", "unavailable"]) {
        mocks.sessionStatus.mockReset().mockResolvedValue({
          operationId: "request-1",
          threadId: "design-review-agent-1",
          turnId: "turn-1",
          status,
          runId: "run-1",
        });
        await setRequests([running()]);
        await tick(3_100);
        expect(mocks.callAction).not.toHaveBeenCalled();
      }
    });

    it("skips the reconcile when the server already finished the request", async () => {
      mocks.sessionStatus.mockResolvedValue({
        operationId: "request-1",
        threadId: "design-review-agent-1",
        turnId: "turn-1",
        status: "completed",
        runId: "run-1",
      });
      // The refetch before reconciling shows the request done.
      mocks.refetch.mockImplementation(async () => {
        mocks.list = {
          requests: [makeReviewAgentRequest({ status: "replied" })],
        };
        return { data: mocks.list };
      });
      await setRequests([running()]);
      await tick(10);
      expect(mocks.callAction).not.toHaveBeenCalled();
    });

    it("watches only requests this person started", async () => {
      await setRequests([
        makeReviewAgentRequest({ status: "running", requesterIsMe: false }),
      ]);
      await tick(5_000);
      expect(mocks.sessionStatus).not.toHaveBeenCalled();
    });

    it("watches the classification run while classifying, not the execution thread", async () => {
      mocks.sessionStatus.mockResolvedValue({
        operationId: "request-1:classification",
        threadId: "classifier-1",
        turnId: "turn-c",
        status: "running",
      });
      await setRequests([
        makeReviewAgentRequest({
          status: "classifying",
          pendingSession: makePendingSession({
            phase: "classification",
            operationId: "request-1:classification",
            threadId: "classifier-1",
            turnId: "turn-c",
          }),
        }),
      ]);
      await tick(10);
      expect(mocks.sessionStatus).toHaveBeenCalledWith({
        operationId: "request-1:classification",
        threadId: "classifier-1",
        turnId: "turn-c",
      });
    });

    it("keeps retrying a status read that fails", async () => {
      mocks.sessionStatus
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({
          operationId: "request-1",
          threadId: "design-review-agent-1",
          turnId: "turn-1",
          status: "running",
        });
      await setRequests([running()]);
      await tick(10);
      expect(mocks.sessionStatus).toHaveBeenCalledTimes(1);
      await tick(1_600);
      expect(mocks.sessionStatus).toHaveBeenCalledTimes(2);
    });

    it("stops watching on unmount", async () => {
      await setRequests([running()]);
      await tick(10);
      const calls = mocks.sessionStatus.mock.calls.length;
      await act(async () => reactRoot.unmount());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(mocks.sessionStatus.mock.calls.length).toBe(calls);
      reactRoot = createRoot(container);
    });
  });

  describe("polling", () => {
    it("polls the list while a run could be working, and not otherwise", () => {
      const at = (status: ReviewAgentRequest["status"], age = 0) =>
        reviewAgentRefetchInterval(
          {
            requests: [
              makeReviewAgentRequest({
                status,
                updatedAt: new Date(REVIEW_AGENT_TEST_NOW - age).toISOString(),
              }),
            ],
          },
          REVIEW_AGENT_TEST_NOW,
        );
      expect(at("queued")).toBe(1_500);
      expect(at("classifying")).toBe(1_500);
      expect(at("running")).toBe(1_500);
      expect(at("replied")).toBe(false);
      expect(at("failed")).toBe(false);
      // A run stuck past the stale window is the server's to expire, not worth a poll.
      expect(at("running", 31 * 60_000)).toBe(false);
      expect(reviewAgentRefetchInterval(undefined)).toBe(false);
    });

    it("hands the list query that interval and enables it only for agents-enabled editors", async () => {
      await render();
      expect(mocks.queryOptions?.enabled).toBe(true);
      expect(
        mocks.queryOptions?.refetchInterval?.({
          state: { data: { requests: [makeReviewAgentRequest()] } },
        }),
      ).toBe(1_500);

      props = { ...props, enabled: false };
      await render();
      expect(mocks.queryOptions?.enabled).toBe(false);
      props = { designId: undefined, enabled: true, surfaceActive: true };
      await render();
      expect(mocks.queryOptions?.enabled).toBe(false);
    });
  });

  describe("models and mentions", () => {
    const lastModelsOptions = () =>
      mocks.chatModelsOptions[mocks.chatModelsOptions.length - 1];
    const lastModelsEnabled = () => lastModelsOptions()?.enabled;

    it("loads the model list only once a comment surface is open, then keeps it", async () => {
      props = { ...props, surfaceActive: false };
      await render();
      expect(lastModelsEnabled()).toBe(false);
      expect(controller.mentionOptions).toEqual([]);

      props = { ...props, surfaceActive: true };
      await render();
      expect(lastModelsEnabled()).toBe(true);

      props = { ...props, surfaceActive: false };
      await render();
      expect(lastModelsEnabled()).toBe(true);
    });

    it("loads the list when a surface reports itself open", async () => {
      props = { ...props, surfaceActive: false };
      await render();
      expect(lastModelsEnabled()).toBe(false);
      await act(async () => controller.markSurfaceUsed());
      expect(lastModelsEnabled()).toBe(true);
    });

    it("never loads models for someone who cannot use agents", async () => {
      props = { ...props, enabled: false };
      await render();
      expect(lastModelsEnabled()).toBe(false);
      expect(controller.enabled).toBe(false);
      expect(controller.mentionOptions).toEqual([]);
      expect(controller.models.ready).toBe(false);
    });

    it("offers a mention for each configured model and resolves a chip back to its selection", async () => {
      await render();
      expect(lastModelsOptions()?.storageKey).toBe(
        "models:design-review-agent",
      );
      expect(controller.models.ready).toBe(true);
      expect(controller.models.selected).toEqual({
        model: "claude-sonnet-5-5",
        engine: "anthropic",
        provider: "Anthropic",
      });
      expect(controller.mentionOptions).toEqual([
        {
          id: "agent:anthropic:claude-sonnet-5-5",
          label: "Claude Sonnet 5.5",
          email: null,
          description: "Anthropic",
        },
        {
          id: "agent:anthropic:claude-opus-5-5",
          label: "Claude Opus 5.5",
          email: null,
          description: "Anthropic",
        },
      ]);
      expect(
        controller.resolveMention({
          label: "Claude Opus 5.5",
          id: "agent:anthropic:claude-opus-5-5",
        }),
      ).toEqual({
        model: "claude-opus-5-5",
        engine: "anthropic",
        provider: "Anthropic",
      });
      // OpenAI is not configured, so its model is neither offered nor resolvable.
      expect(
        controller.resolveMention({
          label: "GPT-5.4",
          id: "agent:openai:gpt-5-4",
        }),
      ).toBeNull();
    });

    it("keeps its identity across renders that change nothing", async () => {
      await render();
      const first = controller;
      await render();
      expect(controller).toBe(first);
    });

    it("exposes the latest request for a thread and whether the thread is busy", async () => {
      await setRequests([
        makeReviewAgentRequest({
          requestId: "old",
          status: "replied",
          updatedAt: "2026-10-27T11:00:00.000Z",
        }),
        makeReviewAgentRequest({
          requestId: "new",
          status: "failed",
          updatedAt: "2026-10-27T11:30:00.000Z",
        }),
      ]);
      expect(controller.requestForThread("thread-1")?.requestId).toBe("new");
      expect(controller.requestForThread("thread-2")).toBeUndefined();
      expect(controller.isThreadBusy("thread-1")).toBe(false);

      await setRequests([
        makeReviewAgentRequest({
          requestId: "someone-elses",
          requesterIsMe: false,
          status: "running",
        }),
      ]);
      expect(controller.isThreadBusy("thread-1")).toBe(true);
    });
  });
});
