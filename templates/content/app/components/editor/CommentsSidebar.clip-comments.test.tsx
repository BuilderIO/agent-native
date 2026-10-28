// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot as createReactRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import {
  clipCommentThreads,
  useClipSeeker,
  type ClipThreadView,
} from "./clip-embed/clip-comments";
import {
  richEditor,
  richEditorValue,
  setRichEditorValue,
} from "./comment-composer-test-utils";
import { CommentDraftProvider } from "./comment-drafts";
import {
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
} from "./CommentsSidebar";

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  chatModelSelectionStorageKey: (scope: string) => `model:${scope}`,
  useChatModels: () => ({
    configuredModels: [],
    selectionReady: false,
    selectedModel: "",
    selectedEngine: "",
    selectedEffort: undefined,
    unavailableSelection: null,
    onModelChange: vi.fn(),
  }),
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (date: Date | string) => new Date(date).toISOString(),
  }),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const DOC = "document-one";

function clipThread(
  canComment: boolean,
  overrides?: { isOwner?: boolean },
): CommentThread {
  const view: ClipThreadView = {
    id: "c1",
    videoTimestampMs: 4_000,
    content: "Look here",
    authorEmail: "ada@example.test",
    authorName: "Ada Example",
    createdAt: "2026-10-23T12:00:00.000Z",
    replyCount: 0,
    replies: [],
  };
  const threads = clipCommentThreads(
    DOC,
    [
      {
        recordingId: "rec_1",
        threads: [view],
        canComment,
        isOwner: overrides?.isOwner ?? false,
        fieldId: null,
      },
    ],
    "bo@example.test",
  );
  expect(threads).toHaveLength(1);
  return found(threads[0], "margin thread");
}

/** The element a step needs, or a failed test naming the one missing. */
function found<T>(value: T | null | undefined, name: string): T {
  if (value == null) throw new Error(`No ${name}`);
  return value;
}

let fetchMock: ReturnType<typeof vi.fn>;
let respond: (status: number, body: unknown) => Promise<void>;
let client: QueryClient;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveFetch!: (response: Response) => void;
  fetchMock = vi.fn(
    (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
  );
  respond = async (status, body) => {
    await act(async () =>
      resolveFetch(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await settle();
  };
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createReactRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 75));
  });

function show(children: ReactNode) {
  return act(async () =>
    root.render(
      <CommentDraftProvider documentId={DOC}>
        <QueryClientProvider client={client}>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryClientProvider>
      </CommentDraftProvider>,
    ),
  );
}

const lastRequest = () => {
  const calls = fetchMock.mock.calls;
  const [input, init] = calls[calls.length - 1] ?? [];
  return { url: String(input), body: JSON.parse(String(init?.body)) };
};

const submitButton = (scope = "") =>
  container.querySelector<HTMLButtonElement>(
    `${scope} button[aria-label="comments.submit"]`.trim(),
  );

describe("a Clip comment in the margin", () => {
  it("shows its moment before anything is typed, and posts it to Clips there", async () => {
    let owner!: ReturnType<typeof usePendingCommentDraft>;
    const completed = vi.fn();
    function Margin() {
      owner = usePendingCommentDraft(DOC);
      return (
        <CommentsSidebar
          documentId={DOC}
          replyDrafts={useCommentReplyDrafts(DOC)}
          pendingComment={owner.pendingComment}
          onPendingChange={owner.changePendingComment}
          onPendingDone={(id, threadId) => {
            if (owner.completePendingComment(id)) completed(threadId);
          }}
          alignToAnchors={false}
          forceVisible
        />
      );
    }
    await show(<Margin />);
    await act(async () =>
      owner.setPendingComment({
        quotedText: "",
        offsetTop: 0,
        clip: { recordingId: "rec_1", videoTimestampMs: 6_000 },
      }),
    );
    await settle();
    expect(container.textContent).toContain(
      'clipEmbed.commentMoment {"time":"0:06"}',
    );

    await setRichEditorValue(
      found(richEditor(container), "composer"),
      "Cut this pause",
    );
    await act(async () => found(submitButton(), "submit button").click());
    expect(lastRequest().url).toContain("add-clip-comment");
    expect(lastRequest().body).toMatchObject({
      documentId: DOC,
      recordingId: "rec_1",
      content: "Cut this pause",
      videoTimestampMs: 6_000,
    });
    expect(lastRequest().body).not.toHaveProperty("mentions");

    await respond(200, { id: "c3", threadId: "c3" });
    expect(completed).toHaveBeenCalledWith("clip:rec_1:c3");
  });

  it("gives the draft back when Clips refuses it", async () => {
    let owner!: ReturnType<typeof usePendingCommentDraft>;
    const completed = vi.fn();
    function Margin() {
      owner = usePendingCommentDraft(DOC);
      return (
        <CommentsSidebar
          documentId={DOC}
          replyDrafts={useCommentReplyDrafts(DOC)}
          pendingComment={owner.pendingComment}
          onPendingChange={owner.changePendingComment}
          onPendingDone={(id, threadId) => {
            if (owner.completePendingComment(id)) completed(threadId);
          }}
          alignToAnchors={false}
          forceVisible
        />
      );
    }
    await show(<Margin />);
    await act(async () =>
      owner.setPendingComment({
        quotedText: "",
        offsetTop: 0,
        clip: { recordingId: "rec_1", videoTimestampMs: 6_000 },
      }),
    );
    await settle();
    await setRichEditorValue(
      found(richEditor(container), "composer"),
      "Cut this pause",
    );
    await act(async () => found(submitButton(), "submit button").click());

    await respond(403, { error: "clip_comments_disabled" });
    expect(completed).not.toHaveBeenCalled();
    expect(richEditorValue(found(richEditor(container), "composer"))).toBe(
      "Cut this pause",
    );
  });

  it("moves the video to a thread's moment, and replies to it in Clips", async () => {
    const thread = clipThread(true);
    const seek = vi.fn();
    let replies!: ReturnType<typeof useCommentReplyDrafts>;
    function Margin() {
      replies = useCommentReplyDrafts(DOC);
      useClipSeeker(DOC, "rec_1", seek);
      return (
        <CommentsSidebar
          documentId={DOC}
          replyDrafts={replies}
          threads={[thread]}
          alignToAnchors={false}
          forceVisible
        />
      );
    }
    await show(<Margin />);
    const quote = container.querySelector<HTMLButtonElement>(
      "button[data-comment-quote]",
    );
    expect(quote?.textContent).toBe('clipEmbed.commentMoment {"time":"0:04"}');
    await act(async () => found(quote, "moment").click());
    expect(seek).toHaveBeenCalledWith(4_000);
    // Clips lets the thread's author or the Clip's owner resolve it.
    expect(container.querySelector("[data-comment-resolve]")).toBeNull();

    await act(async () => replies.setOpenReply(thread.threadId));
    await setRichEditorValue(
      found(
        container.querySelector<HTMLElement>(
          "[data-comment-reply-composer] .ProseMirror",
        ),
        "reply composer",
      ),
      "Agreed",
    );
    await act(async () =>
      found(
        submitButton("[data-comment-reply-composer]"),
        "reply button",
      ).click(),
    );
    expect(lastRequest().url).toContain("add-clip-comment");
    expect(lastRequest().body).toMatchObject({
      documentId: DOC,
      recordingId: "rec_1",
      content: "Agreed",
      threadId: "c1",
    });
    await respond(200, { id: "r1", threadId: "c1" });
  });

  it("resolves a Clip's thread in Clips for its owner", async () => {
    const thread = clipThread(true, { isOwner: true });
    function Margin() {
      return (
        <CommentsSidebar
          documentId={DOC}
          replyDrafts={useCommentReplyDrafts(DOC)}
          threads={[thread]}
          alignToAnchors={false}
          forceVisible
        />
      );
    }
    await show(<Margin />);
    await act(async () =>
      found(
        container.querySelector<HTMLButtonElement>("[data-comment-resolve]"),
        "Resolve",
      ).click(),
    );
    expect(lastRequest().url).toContain("resolve-clip-comment");
    expect(lastRequest().body).toMatchObject({
      documentId: DOC,
      recordingId: "rec_1",
      threadId: "c1",
      resolved: true,
    });
    await respond(200, { id: "c1", resolved: true });
  });

  it("is read-only when Clips takes no comments from the reader", async () => {
    const thread = clipThread(false, { isOwner: true });
    let replies!: ReturnType<typeof useCommentReplyDrafts>;
    function Margin() {
      replies = useCommentReplyDrafts(DOC);
      return (
        <CommentsSidebar
          documentId={DOC}
          replyDrafts={replies}
          threads={[thread]}
          alignToAnchors={false}
          forceVisible
        />
      );
    }
    await show(<Margin />);
    await act(async () => replies.setOpenReply(thread.threadId));
    expect(container.textContent).toContain("Look here");
    expect(container.querySelector("[data-comment-reply-composer]")).toBeNull();
    expect(container.querySelector("[data-comment-resolve]")).toBeNull();
  });
});
