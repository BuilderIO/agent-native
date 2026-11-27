// @vitest-environment happy-dom

import type { CommentAiRequest } from "@shared/comment-ai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CommentAiRequestStatus, useCommentAiRequests } from "./comment-ai";

const api = vi.hoisted(() => ({
  callAction: vi.fn(),
  refetch: vi.fn(),
  startBackgroundAgentSession: vi.fn(),
  getBackgroundAgentSessionStatus: vi.fn(),
  cancelBackgroundAgentSession: vi.fn(),
  loadCommentAiConversation: vi.fn(),
  toastError: vi.fn(),
  requests: [] as CommentAiRequest[],
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: (...args: unknown[]) => api.callAction(...args),
  useActionQuery: () => ({
    data: { requests: api.requests },
    refetch: api.refetch,
  }),
}));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  startBackgroundAgentSession: (...args: unknown[]) =>
    api.startBackgroundAgentSession(...args),
  getBackgroundAgentSessionStatus: (...args: unknown[]) =>
    api.getBackgroundAgentSessionStatus(...args),
  cancelBackgroundAgentSession: (...args: unknown[]) =>
    api.cancelBackgroundAgentSession(...args),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/comment-ai-client", () => ({
  loadCommentAiConversation: (...args: unknown[]) =>
    api.loadCommentAiConversation(...args),
}));
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => api.toastError(...args) },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.refetch.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

it("reports a protected conversation read failure on resume and keeps the button available", async () => {
  const request: CommentAiRequest = {
    operationId: "request-1",
    requestId: "request-1",
    documentId: "document-1",
    threadId: "thread-1",
    rootCommentId: "comment-1",
    intent: "suggest",
    status: "needs-review",
    attemptId: null,
    attemptCount: 0,
    runId: null,
    agentThreadId: "agent-thread-1",
    agentTurnId: "initial-turn-1",
    model: null,
    engine: null,
    result: { editApplied: true },
    errorCode: "operation_failed",
    error: "The request failed",
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:00:00.000Z",
  };
  api.requests = [request];
  api.loadCommentAiConversation.mockRejectedValue(
    new Error("The AI conversation could not be loaded"),
  );

  function Probe() {
    const controller = useCommentAiRequests("document-1", { enabled: true });
    const continuation = controller.continuations.get(request.operationId);
    return createElement(CommentAiRequestStatus, {
      request,
      ...(continuation ? { continuation } : {}),
      onRetry: () => controller.resume(request),
      onStop: () => controller.stop(request),
    });
  }

  await act(async () => root.render(createElement(Probe)));
  const retry = () => {
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((element) => element.textContent === "comments.retry");
    if (!button) throw new Error("Expected the retry button to be present");
    return button;
  };

  await act(async () => retry().click());
  expect(api.toastError.mock.calls[0]?.[0]).toBe(
    "comments.aiConversationUnavailable",
  );
  expect(api.startBackgroundAgentSession).not.toHaveBeenCalled();
  expect(api.callAction).not.toHaveBeenCalled();

  await act(async () => retry().click());
  expect(api.loadCommentAiConversation).toHaveBeenCalledTimes(2);
  expect(api.toastError).toHaveBeenCalledTimes(2);
  expect(api.startBackgroundAgentSession).not.toHaveBeenCalled();
  expect(api.callAction).not.toHaveBeenCalled();
});
