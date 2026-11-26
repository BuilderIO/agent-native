// @vitest-environment happy-dom
import type { ReviewComment } from "@agent-native/core/review";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-slide-comments";

import {
  isOwnSlideComment,
  slideCommentDraftSpot,
  slideCommentMentionsViewer,
  SLIDES_AGENT_MENTION_ID,
  useSlideCommentKit,
  type SlideCommentKitOptions,
} from "./slide-comment-kit";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  reply: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  react: vi.fn(),
  sendToAgent: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({
    session: { email: "writer@example.com", orgId: "org-1" },
  }),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/review")
  >()),
  useCreateReviewComment: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
  useReplyReviewComment: () => ({ mutateAsync: mocks.reply, isPending: false }),
  useUpdateReviewComment: () => ({
    mutateAsync: mocks.update,
    isPending: false,
  }),
  useDeleteReviewComment: () => ({
    mutateAsync: mocks.remove,
    isPending: false,
  }),
  useResolveReviewThread: () => ({
    mutateAsync: mocks.resolve,
    isPending: false,
  }),
  useReactToReviewComment: () => ({
    mutateAsync: mocks.react,
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChatAndConfirm: mocks.sendToAgent,
}));

vi.mock("@agent-native/toolkit/app/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/review")
  >()),
  useReviewMentionPeople: () => ({
    people: [{ label: "Pat", email: "pat@example.com" }],
    searching: false,
    failed: false,
    onMentionQueryChange: () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

function comment(
  id: string,
  extra: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id,
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: "thread-1",
    parentCommentId: null,
    targetId: null,
    surfaceId: "slide-1",
    kind: "comment",
    status: "open",
    anchor: null,
    anchorKind: null,
    anchorVersion: null,
    body: "Review this slide",
    authorEmail: "writer@example.com",
    authorName: "Writer",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    metadata: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...extra,
  } as ReviewComment;
}

function thread(root: ReviewComment): CommentThread {
  return {
    threadId: root.threadId,
    slideId: root.surfaceId ?? null,
    quotedText: null,
    anchor: null,
    resolved: false,
    root,
    replies: [],
  };
}

const agentMention = { id: SLIDES_AGENT_MENTION_ID, label: "Agent" };

function handoff(): {
  message?: string;
  submit?: boolean;
  chatTarget?: string;
} {
  return mocks.sendToAgent.mock.calls.at(0)?.at(0) ?? {};
}

function renderKit(options: Partial<SlideCommentKitOptions> = {}) {
  return renderHook(() =>
    useSlideCommentKit({
      deckId: "deck-1",
      surface: "panel",
      currentUserEmail: "writer@example.com",
      canComment: true,
      ...options,
    }),
  );
}

afterEach(() => cleanup());

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.sendToAgent.mockResolvedValue({ delivered: true });
});

describe("useSlideCommentKit", () => {
  it("offers people and the Slides agent as mentions, with drafts kept per deck, user and org", () => {
    const { result } = renderKit();

    expect(result.current.mentionOptions).toEqual([
      { label: "Pat", email: "pat@example.com" },
      {
        id: SLIDES_AGENT_MENTION_ID,
        label: "comments.agentMention",
        description: "comments.agentMentionDescription",
      },
    ]);
    expect(result.current.draftScope).toEqual({
      resourceType: "deck",
      resourceId: "deck-1",
      userEmail: "writer@example.com",
      orgId: "org-1",
    });
    expect(result.current.draftKey("reply:thread-1")).toBe(
      "panel:reply:thread-1",
    );
  });

  it("hands a new thread that mentions the agent to the agent chat", async () => {
    mocks.create.mockResolvedValue(
      comment("comment-9", { threadId: "thread-9" }),
    );
    const { result } = renderKit();

    await act(() =>
      result.current.createThread({
        slideId: "slide-1",
        draft: {
          text: "@Agent tighten this title",
          mentions: [agentMention],
          images: [],
        },
      }),
    );

    expect(mocks.create).toHaveBeenCalledWith({
      resourceType: "deck",
      resourceId: "deck-1",
      surfaceId: "slide-1",
      body: "@Agent tighten this title",
      mentions: [agentMention],
    });
    expect(mocks.sendToAgent).toHaveBeenCalledOnce();
    const { message, submit, chatTarget } = handoff();
    expect({ submit, chatTarget }).toEqual({
      submit: true,
      chatTarget: "local",
    });
    expect(message).toContain("slide `slide-1` of deck `deck-1`");
    expect(message).toContain("thread `thread-9`");
    expect(message).toContain("parentId `comment-9`");
    expect(message).toContain(
      "while `has_more` is true, call it again with the `next_cursor` it returned as `cursor`, so you see all of thread `thread-9`",
    );
  });

  it("hands a reply that mentions the agent to the agent chat under the thread's root", async () => {
    mocks.reply.mockResolvedValue(
      comment("reply-1", { parentCommentId: "comment-1" }),
    );
    const { result } = renderKit();

    await act(() =>
      result.current.reply(thread(comment("comment-1")), {
        text: "@Agent please fix",
        mentions: [agentMention],
        images: [],
      }),
    );

    expect(mocks.reply).toHaveBeenCalledWith({
      resourceType: "deck",
      resourceId: "deck-1",
      commentId: "comment-1",
      body: "@Agent please fix",
      mentions: [agentMention],
    });
    const { message } = handoff();
    expect(message).toContain("thread `thread-1`");
    expect(message).toContain("parentId `comment-1`");
  });

  it("leaves the agent out of comments that only mention people", async () => {
    mocks.create.mockResolvedValue(comment("comment-1"));
    const { result } = renderKit();

    await act(() =>
      result.current.createThread({
        slideId: "slide-1",
        draft: {
          text: "@Pat take a look",
          mentions: [{ label: "Pat", email: "pat@example.com" }],
          images: [],
        },
      }),
    );

    expect(mocks.sendToAgent).not.toHaveBeenCalled();
  });

  it("says so when the agent chat can't take the handoff", async () => {
    mocks.create.mockResolvedValue(comment("comment-1"));
    mocks.sendToAgent.mockResolvedValue({ delivered: false });
    const { result } = renderKit();

    await act(() =>
      result.current.createThread({
        slideId: "slide-1",
        draft: { text: "@Agent help", mentions: [agentMention], images: [] },
      }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "floatingToolbar.agentUnavailable",
      ),
    );
  });

  it("keeps the quote and images in a new thread's metadata", async () => {
    mocks.create.mockResolvedValue(comment("comment-1"));
    const { result } = renderKit();
    const image = {
      url: "/uploads/chart.png",
      name: "chart.png",
      contentType: "image/png",
    };

    await act(() =>
      result.current.createThread({
        slideId: "slide-1",
        draft: { text: "See this", mentions: [], images: [image] },
        quotedText: "Revenue",
      }),
    );

    expect(mocks.create).toHaveBeenCalledWith({
      resourceType: "deck",
      resourceId: "deck-1",
      surfaceId: "slide-1",
      body: "See this",
      mentions: [],
      metadata: { quotedText: "Revenue", attachments: [image] },
    });
  });

  it("sends attachments on an edit only when its images changed", async () => {
    mocks.update.mockResolvedValue({});
    const { result } = renderKit();
    const opened = comment("comment-1");

    await act(() =>
      result.current.update(opened, opened, {
        text: "New words",
        mentions: [],
        images: [],
      }),
    );
    expect(mocks.update).toHaveBeenLastCalledWith({
      resourceType: "deck",
      resourceId: "deck-1",
      commentId: "comment-1",
      body: "New words",
      mentions: [],
    });

    await act(() =>
      result.current.update(opened, opened, {
        text: "New words",
        mentions: [],
        images: [{ url: "/uploads/chart.png", name: "chart.png" }],
      }),
    );
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ url: "/uploads/chart.png" })],
      }),
    );
  });

  it("hands an edit that adds the agent to the agent chat, once", async () => {
    mocks.update.mockResolvedValue({});
    const { result } = renderKit();
    const reply = comment("reply-1", { parentCommentId: "comment-1" });

    await act(() =>
      result.current.update(reply, reply, {
        text: "@Agent please fix",
        mentions: [agentMention],
        images: [],
      }),
    );
    expect(mocks.sendToAgent).toHaveBeenCalledOnce();
    const { message } = handoff();
    expect(message).toContain("thread `thread-1`");
    expect(message).toContain("parentId `comment-1`");

    const mentioned = comment("reply-1", {
      parentCommentId: "comment-1",
      mentions: [agentMention],
    });
    await act(() =>
      result.current.update(mentioned, mentioned, {
        text: "@Agent please fix both",
        mentions: [agentMention],
        images: [],
      }),
    );
    expect(mocks.sendToAgent).toHaveBeenCalledOnce();
  });

  it("lets only the author edit and only the server's grants delete", () => {
    const { result } = renderKit();
    const own = comment("comment-1", {
      canDelete: true,
      canDeleteThread: false,
    });
    const agentReply = comment("reply-1", {
      createdBy: "agent",
      authorName: "Slides agent",
      canDelete: false,
    });

    expect(result.current.canEditComment(own)).toBe(true);
    expect(result.current.canEditComment(agentReply)).toBe(false);
    expect(result.current.canDeleteComment(own, "reply")).toBe(true);
    expect(result.current.canDeleteComment(own, "root")).toBe(false);
    expect(result.current.canDeleteComment(agentReply, "reply")).toBe(false);

    const viewer = renderKit({ canComment: false });
    expect(viewer.result.current.canEditComment(own)).toBe(false);
    expect(viewer.result.current.canDeleteComment(own, "reply")).toBe(false);
    expect(viewer.result.current.canReact).toBe(false);
  });
});

describe("slide comment helpers", () => {
  it("matches the viewer by email regardless of case", () => {
    const own = comment("comment-1", { authorEmail: "Writer@Example.com" });

    expect(isOwnSlideComment(own, "writer@example.com")).toBe(true);
    expect(isOwnSlideComment(own, null)).toBe(false);
    expect(
      isOwnSlideComment(
        { ...own, createdBy: "agent", authorName: "Slides agent" },
        "writer@example.com",
      ),
    ).toBe(false);
  });

  it("finds the viewer in mentions and in older @email text", () => {
    expect(
      slideCommentMentionsViewer(
        comment("comment-1", {
          mentions: [{ label: "Writer", email: "WRITER@example.com" }],
        }),
        "writer@example.com",
      ),
    ).toBe(true);
    expect(
      slideCommentMentionsViewer(
        comment("comment-2", { body: "cc @writer@example.com" }),
        "Writer@example.com",
      ),
    ).toBe(true);
    expect(
      slideCommentMentionsViewer(comment("comment-3"), "writer@example.com"),
    ).toBe(false);
  });

  it("names a new comment's spot by its anchor, else its quote", () => {
    expect(
      slideCommentDraftSpot(
        {
          x: 42,
          y: 33,
          targetText: "Quarterly revenue",
          objectId: "shape-7",
          objectX: 50,
          objectY: 75,
          textStartOffset: 0,
          textEndOffset: 7,
        },
        "Revenue",
      ),
    ).toBe("42,33,0,7");
    expect(slideCommentDraftSpot({ x: 10, y: 20 })).toBe("10,20,,");
    expect(slideCommentDraftSpot(null, "Revenue")).toBe("quote:Revenue");
    expect(slideCommentDraftSpot(undefined)).toBe("");
  });
});
