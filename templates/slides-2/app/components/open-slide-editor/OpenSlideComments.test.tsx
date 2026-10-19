// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: { email: "reviewer@example.test" } }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "comments.loadFailed": "Could not load comments",
      "comments.retry": "Retry",
      "comments.comment": "Comment",
      "comments.editComment": "Edit comment",
      "comments.deleteComment": "Delete comment",
      "comments.save": "Save",
      "comments.saving": "Saving...",
      "comments.cancel": "Cancel",
    })[key] ?? key,
}));

vi.mock("@/hooks/use-slide-comments", () => ({
  useSlideComments: (...args: unknown[]) => mocks.query(...args),
  useCreateSlideComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResolveSlideComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSlideComment: () => ({
    mutateAsync: mocks.updateComment,
    isPending: false,
  }),
  useDeleteSlideComment: () => ({
    mutateAsync: mocks.deleteComment,
    isPending: false,
  }),
}));

import { OpenSlideComments } from "./OpenSlideComments";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refetch.mockResolvedValue({});
  mocks.updateComment.mockResolvedValue({ ok: true });
  mocks.deleteComment.mockResolvedValue({ ok: true });
  mocks.query.mockReturnValue({
    data: undefined,
    isError: true,
    isFetching: false,
    refetch: mocks.refetch,
  });
});

function renderComments(active = true, canEdit = false) {
  return render(
    <OpenSlideComments
      deckId="deck-1"
      slideId="slide-1"
      canComment
      canEdit={canEdit}
      active={active}
      sourceHash={null}
      sourceNodes={[]}
      draftAnchor={null}
      onDraftDone={vi.fn()}
    />,
  );
}

function renderComment(content: string, authorEmail = "reviewer@example.test") {
  mocks.query.mockReturnValue({
    data: [
      {
        threadId: "thread-1",
        slideId: "slide-1",
        quotedText: null,
        anchor: { version: 1, x: 40, y: 50 },
        resolved: false,
        comments: [
          {
            id: "comment-1",
            deck_id: "deck-1",
            slide_id: "slide-1",
            thread_id: "thread-1",
            parent_id: null,
            content,
            quoted_text: null,
            author_email: authorEmail,
            author_name: "Reviewer",
            resolved: false,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
    isError: false,
    isFetching: false,
    refetch: mocks.refetch,
  });
  renderComments();
}

describe("OpenSlideComments", () => {
  it("shows a retry when the comment read fails instead of hiding it as empty", () => {
    renderComments();

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load comments",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("does not show a comment read error while the overlay is inactive", () => {
    renderComments(false);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets the comment author edit a posted comment", async () => {
    renderComment("Original feedback");

    fireEvent.click(
      screen.getByRole("button", { name: "Comment: Original feedback" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
      target: { value: "Updated feedback" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.updateComment).toHaveBeenCalledWith({
        id: "comment-1",
        deckId: "deck-1",
        content: "Updated feedback",
      }),
    );
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox", { name: "Edit comment" })).toBeNull();
  });

  it("lets the comment author delete a posted comment", async () => {
    renderComment("Feedback to remove");

    fireEvent.click(
      screen.getByRole("button", { name: "Comment: Feedback to remove" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));

    await waitFor(() =>
      expect(mocks.deleteComment).toHaveBeenCalledWith({
        id: "comment-1",
        deckId: "deck-1",
      }),
    );
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("keeps comment management hidden for another author without edit access", () => {
    renderComment("A teammate's feedback", "teammate@example.test");

    fireEvent.click(
      screen.getByRole("button", { name: "Comment: A teammate's feedback" }),
    );

    expect(screen.queryByRole("button", { name: "Edit comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete comment" })).toBeNull();
  });
});
