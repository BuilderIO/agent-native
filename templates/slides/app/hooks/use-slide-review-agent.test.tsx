// @vitest-environment happy-dom
import type { SlideReviewAgentRequest } from "@shared/slide-review-agent";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  listData: { requests: [] as unknown[] },
  startBackgroundAgentSession: vi.fn(),
  cancelBackgroundAgentSession: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useActionQuery: () => ({ data: mocks.listData, refetch: vi.fn() }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  cancelBackgroundAgentSession: mocks.cancelBackgroundAgentSession,
  isAgentChatAiSetupRequiredError: (error: { code?: string } | null) =>
    error?.code === "setup",
  requestAgentChatThreadOpen: vi.fn(),
  startBackgroundAgentSession: mocks.startBackgroundAgentSession,
}));

vi.mock("@agent-native/toolkit/app/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/review")
  >()),
  useReviewAgentMentions: () => ({
    mentionOptions: [{ id: "agent:anthropic:claude-x", label: "Claude X" }],
    resolveMention: (mention: { id?: string | null }) =>
      mention.id === "agent:ai-sdk:openai:gpt-x"
        ? { engine: "ai-sdk:openai", model: "gpt-x", provider: "OpenAI" }
        : null,
  }),
}));

import { useSlideReviewAgent } from "./use-slide-review-agent";

const session = {
  operationId: "req-1",
  threadId: "slides-review-agent-abc",
  turnId: "turn-1",
  scope: { type: "slides-review-agent", id: "req-1" },
  actionScope: { kind: "slides-review-agent", requestId: "req-1" },
  message: "Respond",
  instructions: "Rules",
  model: "claude-x",
  engine: "anthropic",
  usageLabel: "slides:review-agent",
};

function request(
  overrides: Partial<SlideReviewAgentRequest> = {},
): SlideReviewAgentRequest {
  return {
    requestId: "req-1",
    deckId: "deck-1",
    threadId: "thread-1",
    slideId: "slide-1",
    status: "queued",
    agentName: "Claude X",
    mine: true,
    agentThreadId: session.threadId,
    replyCommentId: null,
    errorCode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    session,
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

// The engine id holds a colon, so only the live selection can name its parts.
const agentChip = { label: "GPT X", id: "agent:ai-sdk:openai:gpt-x" };

beforeEach(() => {
  mocks.listData = { requests: [] };
  mocks.startBackgroundAgentSession.mockReturnValue({
    accepted: Promise.resolve(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSlideReviewAgent", () => {
  it("does nothing for a comment that tags no agent", async () => {
    const { result } = renderHook(
      () => useSlideReviewAgent({ deckId: "deck-1", canAsk: true }),
      { wrapper },
    );
    await expect(
      result.current.startIfTagged({
        threadId: "thread-1",
        commentId: "c1",
        mentions: [{ label: "Sam", email: "sam@example.com" }],
      }),
    ).resolves.toBeNull();
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("records the request and dispatches its scoped session", async () => {
    mocks.callAction.mockResolvedValue({ request: request(), started: true });
    const { result } = renderHook(
      () => useSlideReviewAgent({ deckId: "deck-1", canAsk: true }),
      { wrapper },
    );
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.startIfTagged({
        threadId: "thread-1",
        commentId: "c1",
        mentions: [agentChip],
      });
    });
    expect(outcome).toBe("started");
    expect(mocks.callAction).toHaveBeenCalledWith(
      "start-review-agent-request",
      expect.objectContaining({
        deckId: "deck-1",
        threadId: "thread-1",
        triggerCommentId: "c1",
        engine: "ai-sdk:openai",
        model: "gpt-x",
      }),
    );
    expect(mocks.startBackgroundAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: session.threadId,
        operationId: "req-1",
        actionScope: session.actionScope,
        scope: session.scope,
        model: "claude-x",
        engine: "anthropic",
      }),
    );
  });

  it("reports a thread the agent is already on as busy", async () => {
    mocks.callAction.mockRejectedValue(
      Object.assign(new Error("busy"), { errorCode: "busy" }),
    );
    const { result } = renderHook(
      () => useSlideReviewAgent({ deckId: "deck-1", canAsk: true }),
      { wrapper },
    );
    await act(async () => {
      await expect(
        result.current.startIfTagged({
          threadId: "thread-1",
          commentId: "c1",
          mentions: [agentChip],
        }),
      ).resolves.toBe("busy");
    });
    expect(mocks.startBackgroundAgentSession).not.toHaveBeenCalled();
  });

  it("offers no agents and starts nothing for someone who cannot ask", async () => {
    const { result } = renderHook(
      () => useSlideReviewAgent({ deckId: "deck-1", canAsk: false }),
      { wrapper },
    );
    await expect(
      result.current.startIfTagged({
        threadId: "thread-1",
        commentId: "c1",
        mentions: [agentChip],
      }),
    ).resolves.toBeNull();
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("fails the request when its run cannot be dispatched", async () => {
    mocks.callAction
      .mockResolvedValueOnce({ request: request(), started: true })
      .mockResolvedValueOnce({
        request: request({ status: "failed", session: null }),
        receipt: null,
        changed: true,
      });
    mocks.startBackgroundAgentSession.mockReturnValue({
      accepted: Promise.reject(new Error("engine down")),
    });
    const { result } = renderHook(
      () => useSlideReviewAgent({ deckId: "deck-1", canAsk: true }),
      { wrapper },
    );
    await act(async () => {
      await expect(
        result.current.startIfTagged({
          threadId: "thread-1",
          commentId: "c1",
          mentions: [agentChip],
        }),
      ).resolves.toBe("failed");
    });
    expect(mocks.callAction).toHaveBeenLastCalledWith(
      "cancel-review-agent-request",
      { requestId: "req-1", failure: "dispatch_failed" },
    );
  });

  it("asks to reconnect when the chip's model is gone", async () => {
    const { result } = renderHook(
      () => useSlideReviewAgent({ deckId: "deck-1", canAsk: true }),
      { wrapper },
    );
    await expect(
      result.current.startIfTagged({
        threadId: "thread-1",
        commentId: "c1",
        mentions: [{ label: "Old", id: "agent:anthropic:retired" }],
      }),
    ).resolves.toBe("setup-required");
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("stops a run through its receipt and exposes the latest request per thread", async () => {
    mocks.listData = {
      requests: [
        request({ requestId: "old", status: "failed", session: null }),
        request({ updatedAt: "2026-01-02T00:00:00.000Z" }),
      ],
    };
    mocks.callAction.mockResolvedValue({
      request: request({ status: "cancelled", session: null }),
      receipt: { threadId: session.threadId, turnId: "turn-1" },
      changed: true,
    });
    const { result } = renderHook(
      () => useSlideReviewAgent({ deckId: "deck-1", canAsk: true }),
      { wrapper },
    );
    expect(result.current.requestForThread("thread-1")?.requestId).toBe(
      "req-1",
    );
    await act(async () => {
      await result.current.stop(request());
    });
    expect(mocks.callAction).toHaveBeenCalledWith(
      "cancel-review-agent-request",
      { requestId: "req-1" },
    );
    expect(mocks.cancelBackgroundAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: session.threadId, turnId: "turn-1" }),
    );
  });
});
