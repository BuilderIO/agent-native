// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useSearchParams } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  threads: undefined as unknown,
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("./use-slide-comments", () => ({
  useSlideComments: () => ({ data: mocks.threads, isError: false }),
}));

import { useOpenCommentFromUrl } from "./use-open-comment-from-url";

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useOpenCommentFromUrl", () => {
  it("opens the linked thread on its slide, wherever that slide now sits, and drops the param", async () => {
    mocks.threads = [{ threadId: "thread-9", slideId: "slide-c" }];
    const onSelectSlide = vi.fn();
    const onSelectThread = vi.fn();
    const { result } = renderHook(
      () => {
        useOpenCommentFromUrl({
          deckId: "deck-1",
          // The slide moved from position 3 to 1 since the email was sent.
          slideIds: ["slide-c", "slide-a", "slide-b"],
          activeSlideId: "slide-a",
          onSelectSlide,
          onSelectThread,
        });
        return useSearchParams()[0];
      },
      { wrapper: wrapper("/deck/deck-1?comment=thread-9") },
    );
    await waitFor(() =>
      expect(onSelectThread).toHaveBeenCalledWith("thread-9"),
    );
    expect(onSelectSlide).toHaveBeenCalledWith("slide-c");
    await waitFor(() => expect(result.current.get("comment")).toBeNull());
  });

  it("says the comment is gone instead of opening nothing", async () => {
    mocks.threads = [];
    const onSelectThread = vi.fn();
    renderHook(
      () =>
        useOpenCommentFromUrl({
          deckId: "deck-1",
          slideIds: ["slide-a"],
          activeSlideId: "slide-a",
          onSelectSlide: vi.fn(),
          onSelectThread,
        }),
      { wrapper: wrapper("/deck/deck-1?comment=missing") },
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("comments.threadNotFound"),
    );
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  it("waits for the editor to settle on a slide before choosing one", () => {
    mocks.threads = [{ threadId: "thread-9", slideId: "slide-c" }];
    const onSelectThread = vi.fn();
    renderHook(
      () =>
        useOpenCommentFromUrl({
          deckId: "deck-1",
          slideIds: ["slide-c"],
          activeSlideId: null,
          onSelectSlide: vi.fn(),
          onSelectThread,
        }),
      { wrapper: wrapper("/deck/deck-1?comment=thread-9") },
    );
    expect(onSelectThread).not.toHaveBeenCalled();
  });
});
