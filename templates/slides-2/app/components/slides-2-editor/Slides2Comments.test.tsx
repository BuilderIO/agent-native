// @vitest-environment happy-dom
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
  createComment: vi.fn(),
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
      "comments.addCommentPlaceholder": "Add a comment...",
      "comments.saveCommentFailed": "Could not save this comment.",
      "comments.save": "Save",
      "comments.saving": "Saving...",
      "comments.cancel": "Cancel",
    })[key] ?? key,
}));

vi.mock("@/hooks/use-slide-comments", () => ({
  useSlideComments: (...args: unknown[]) => mocks.query(...args),
  useCreateSlideComment: () => ({
    mutateAsync: mocks.createComment,
    isPending: false,
  }),
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

import { Slides2Comments } from "./Slides2Comments";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refetch.mockResolvedValue({});
  mocks.createComment.mockResolvedValue({ ok: true });
  mocks.updateComment.mockResolvedValue({ ok: true });
  mocks.deleteComment.mockResolvedValue({ ok: true });
  mocks.query.mockReturnValue({
    data: undefined,
    isError: true,
    isFetching: false,
    refetch: mocks.refetch,
  });
});

function renderComments(
  active = true,
  canEdit = false,
  draftAnchor: SlideCommentAnchor | null = null,
  onDraftDone = vi.fn(),
) {
  return render(
    <TooltipProvider>
      <Slides2Comments
        deckId="deck-1"
        slideId="slide-1"
        canComment
        canEdit={canEdit}
        active={active}
        sourceHash={null}
        sourceNodes={[]}
        draftAnchor={draftAnchor}
        onDraftDone={onDraftDone}
      />
    </TooltipProvider>,
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

describe("Slides2Comments", () => {
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

  it("places the new-comment composer beside its canvas anchor", async () => {
    const onDraftDone = vi.fn();
    mocks.query.mockReturnValue({
      data: [],
      isError: false,
      isFetching: false,
      refetch: mocks.refetch,
    });
    renderComments(true, false, { x: 42, y: 38 }, onDraftDone);

    const anchor = screen.getByTestId("comment-draft-anchor");
    expect(anchor.style.left).toBe("42%");
    expect(anchor.style.top).toBe("38%");
    const composer = screen.getByRole("textbox", {
      name: "Add a comment...",
    });
    fireEvent.change(composer, { target: { value: "A canvas note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.createComment).toHaveBeenCalledWith({
        deckId: "deck-1",
        slideId: "slide-1",
        content: "A canvas note",
        anchor: { x: 42, y: 38 },
      }),
    );
    expect(onDraftDone).toHaveBeenCalledOnce();
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("previews a comment when its pin is hovered", async () => {
    renderComment("A short hover preview");

    fireEvent.pointerMove(
      screen.getByRole("button", {
        name: "Comment: A short hover preview",
      }),
      { pointerType: "mouse" },
    );

    await waitFor(
      () =>
        expect(
          document.querySelector("[data-agent-native-tooltip]")?.textContent,
        ).toContain("A short hover preview"),
      { timeout: 1500 },
    );
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
