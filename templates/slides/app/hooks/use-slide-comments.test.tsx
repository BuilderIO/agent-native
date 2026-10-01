// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callActionWithRetry: vi.fn(),
  apiDisabledReason: vi.fn((): string | null => null),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callActionWithRetry: mocks.callActionWithRetry,
  useActionMutation: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-surface", () => ({
  agentNativeApiDisabledReason: mocks.apiDisabledReason,
}));

import { useSlideComments } from "./use-slide-comments";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function comment(id: string, threadId: string, parentId: string | null = null) {
  return {
    id,
    deck_id: "deck-1",
    slide_id: "slide-1",
    thread_id: threadId,
    parent_id: parentId,
    content: id,
    quoted_text: null,
    anchor: null,
    reactions: [],
    author_email: "author@example.com",
    author_name: "Author",
    resolved: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

afterEach(() => cleanup());

beforeEach(() => {
  mocks.callActionWithRetry.mockReset();
  mocks.apiDisabledReason.mockReset();
  mocks.apiDisabledReason.mockReturnValue(null);
});

describe("useSlideComments", () => {
  it("loads all pages and groups replies that cross a page boundary", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) =>
      comment(`comment-${index}`, `thread-${index}`),
    );
    mocks.callActionWithRetry
      .mockResolvedValueOnce({
        comments: firstPage,
        has_more: true,
        next_offset: 200,
      })
      .mockResolvedValueOnce({
        comments: [comment("reply-1", "thread-0", "comment-0")],
        has_more: false,
        next_offset: null,
      });

    const { result } = renderHook(() => useSlideComments("deck-1", "slide-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.callActionWithRetry).toHaveBeenNthCalledWith(
      1,
      "list-slide-comments",
      { deckId: "deck-1", slideId: "slide-1", limit: 200, offset: 0 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.callActionWithRetry).toHaveBeenNthCalledWith(
      2,
      "list-slide-comments",
      { deckId: "deck-1", slideId: "slide-1", limit: 200, offset: 200 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data).toHaveLength(200);
    expect(result.current.data?.[0]?.comments.map(({ id }) => id)).toEqual([
      "comment-0",
      "reply-1",
    ]);
  });

  it("preserves loading and surfaces a later page failure without partial data", async () => {
    mocks.callActionWithRetry
      .mockResolvedValueOnce({
        comments: Array.from({ length: 200 }, (_, index) =>
          comment(`comment-${index}`, `thread-${index}`),
        ),
        has_more: true,
        next_offset: 200,
      })
      .mockRejectedValueOnce(new Error("Second page unavailable"));

    const { result } = renderHook(
      () => useSlideComments("deck-1", null, "deck"),
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(new Error("Second page unavailable"));
    expect(result.current.data).toBeUndefined();
    expect(mocks.callActionWithRetry).toHaveBeenNthCalledWith(
      2,
      "list-slide-comments",
      { deckId: "deck-1", limit: 200, offset: 200 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("surfaces invalid continuation metadata instead of returning a partial deck", async () => {
    mocks.callActionWithRetry.mockResolvedValueOnce({
      comments: [comment("comment-1", "thread-1")],
      has_more: true,
      next_offset: 1,
    });

    const { result } = renderHook(
      () => useSlideComments("deck-1", null, "deck"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(
      "Could not load all slide comments: invalid pagination response.",
    );
    expect(result.current.data).toBeUndefined();
    expect(mocks.callActionWithRetry).toHaveBeenCalledOnce();
  });

  it("keeps the query disabled when the Agent-Native API is unavailable", () => {
    mocks.apiDisabledReason.mockReturnValue("embedded surface");

    const { result } = renderHook(() => useSlideComments("deck-1", "slide-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(mocks.callActionWithRetry).not.toHaveBeenCalled();
  });
});
