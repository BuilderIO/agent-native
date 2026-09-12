// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import { CommentDraftProvider } from "./comment-drafts";
import {
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
} from "./CommentsSidebar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/use-comments", () => ({
  useCreateComment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    reconcileAmbiguous: vi.fn(),
  }),
  useEditComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResolveComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (date: Date | string) => new Date(date).toISOString(),
  }),
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/markdown", () => ({
  InlineMarkdown: ({ content }: { content: string }) => content,
}));

function thread(id: string): CommentThread {
  return {
    threadId: id,
    quotedText: `quoted ${id}`,
    prefix: null,
    suffix: null,
    startOffset: 0,
    resolved: false,
    comments: [
      {
        id: `${id}-root`,
        document_id: "fixture",
        thread_id: id,
        parent_id: null,
        content: `Comment ${id}`,
        quoted_text: `quoted ${id}`,
        anchor_prefix: null,
        anchor_suffix: null,
        anchor_start_offset: 0,
        mentions: [],
        author_email: "reviewer@example.test",
        author_name: "Reviewer",
        resolved: 0,
        created_at: "2026-09-04T12:00:00Z",
        updated_at: "2026-09-04T12:00:00Z",
        notion_comment_id: null,
        submission_source: "frontend",
      },
    ],
  };
}

function SidebarOwner({
  threads,
  scrollContainerRef,
}: {
  threads: CommentThread[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const replies = useCommentReplyDrafts("fixture", "reviewer@example.test");
  const pending = usePendingCommentDraft("fixture");
  useEffect(() => {
    pending.setPendingComment({
      quotedText: "selected anchor",
      offsetTop: 0,
    });
  }, [pending.setPendingComment]);
  return (
    <CommentsSidebar
      replyDrafts={replies}
      pendingComment={pending.pendingComment}
      onPendingChange={pending.changePendingComment}
      onPendingDone={pending.completePendingComment}
      documentId="fixture"
      threads={threads}
      scrollContainerRef={scrollContainerRef}
      currentUserEmail="reviewer@example.test"
      canComment
      canResolve
      forceVisible
      presentation="inline"
    />
  );
}

describe("comment sidebar keystroke cost", () => {
  let root: Root;
  let container: HTMLDivElement;
  let scrollHost: HTMLDivElement;
  let queryClient: QueryClient;
  let mutationObservers: number;
  let mutationDisconnects: number;
  let resizeObservers: number;
  const RealMutationObserver = globalThis.MutationObserver;
  const RealResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    mutationObservers = 0;
    mutationDisconnects = 0;
    resizeObservers = 0;
    class CountingMutationObserver extends RealMutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        mutationObservers += 1;
      }
      disconnect() {
        mutationDisconnects += 1;
        super.disconnect();
      }
    }
    globalThis.MutationObserver =
      CountingMutationObserver as unknown as typeof MutationObserver;
    class CountingResizeObserver {
      constructor(_callback: ResizeObserverCallback) {
        resizeObservers += 1;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      CountingResizeObserver as unknown as typeof ResizeObserver;

    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    scrollHost = document.createElement("div");
    scrollHost.setAttribute("data-document-scroll-content", "");
    document.body.append(scrollHost);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    scrollHost?.remove();
    queryClient.clear();
    globalThis.MutationObserver = RealMutationObserver;
    globalThis.ResizeObserver = RealResizeObserver;
    window.localStorage.clear();
  });

  function render(threads: CommentThread[]) {
    const scrollContainerRef = { current: scrollHost };
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CommentDraftProvider
              documentId="fixture"
              currentUserEmail="reviewer@example.test"
            >
              <SidebarOwner
                threads={threads}
                scrollContainerRef={scrollContainerRef}
              />
            </CommentDraftProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }

  function typeCharacters(text: string) {
    const input = container.querySelector("textarea")!;
    for (let index = 0; index < text.length; index += 1) {
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(input, text.slice(0, index + 1));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
  }

  it("does not rebuild the anchor observers on every character", () => {
    render([thread("one"), thread("two")]);
    const baselineObservers = mutationObservers;
    const baselineDisconnects = mutationDisconnects;
    const baselineResize = resizeObservers;

    typeCharacters("hello");

    const rebuilds = mutationObservers - baselineObservers;
    const disconnects = mutationDisconnects - baselineDisconnects;
    expect(rebuilds).toBe(0);
    expect(disconnects).toBe(0);
    expect(resizeObservers - baselineResize).toBe(0);
  });
});
