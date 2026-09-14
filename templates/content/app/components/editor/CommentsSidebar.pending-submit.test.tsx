// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot as createReactRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import { CommentDraftProvider, useCommentDraftContext } from "./comment-drafts";

function createRoot(container: Parameters<typeof createReactRoot>[0]) {
  const root = createReactRoot(container);
  const render = root.render.bind(root);
  root.render = (children) =>
    render(
      <CommentDraftProvider documentId="test-page">
        {children}
      </CommentDraftProvider>,
    );
  return root;
}
import { describe, expect, it, vi } from "vitest";

import {
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
} from "./CommentsSidebar";

vi.mock("@agent-native/core/client/agent-chat", () => ({
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
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("new comment real mutation observer lifetime", () => {
  it.each(["success", "failure"] as const)(
    "settles %s after the submitting sidebar unmounts",
    async (outcome) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      let respond!: (response: Response) => void;
      const fetch = vi.fn(
        (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetch);
      const client = new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { retry: false },
        },
      });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      let owner!: ReturnType<typeof usePendingCommentDraft>;
      const completed = vi.fn();
      function Owner({ surface }: { surface: string }) {
        owner = usePendingCommentDraft("document-one");
        const replyDrafts = useCommentReplyDrafts("document-one");
        return (
          <CommentsSidebar
            key={surface}
            documentId="document-one"
            replyDrafts={replyDrafts}
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
      const show = async (surface: string) =>
        act(async () =>
          root.render(
            <QueryClientProvider client={client}>
              <Owner surface={surface} />
            </QueryClientProvider>,
          ),
        );
      const settle = async () =>
        act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 75));
        });
      try {
        await show("mobile");
        await act(async () =>
          owner.setPendingComment({
            quotedText: "better",
            offsetTop: 80,
            range: { from: 3, to: 9 },
          }),
        );
        await settle();
        await act(async () => {
          const input = container.querySelector("textarea")!;
          Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          )!.set!.call(input, "Survive observer remount");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () =>
          [...container.querySelectorAll("button")]
            .find((node) => node.textContent === "comments.submit")!
            .click(),
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String(fetch.mock.calls[0]?.[0])).toContain("add-comment");
        await show("desktop");
        await settle();
        expect(container.querySelector("textarea")!.disabled).toBe(true);
        await act(async () =>
          respond(
            new Response(
              JSON.stringify(
                outcome === "success"
                  ? { id: "created", threadId: "created-thread" }
                  : { error: "offline" },
              ),
              {
                status: outcome === "success" ? 200 : 500,
                headers: { "content-type": "application/json" },
              },
            ),
          ),
        );
        await settle();
        if (outcome === "success") {
          expect(completed).toHaveBeenCalledWith("created-thread");
          expect(container.querySelector("textarea")).toBeNull();
        } else {
          expect(completed).not.toHaveBeenCalled();
          expect(container.querySelector("textarea")!.disabled).toBe(false);
          expect(container.querySelector("textarea")!.value).toBe(
            "Survive observer remount",
          );
        }
      } finally {
        await act(async () => root.unmount());
        client.clear();
        container.remove();
        vi.unstubAllGlobals();
      }
    },
  );
});

describe("reply real mutation observer lifetime", () => {
  it.each([
    { outcome: "success", newerDraft: false },
    { outcome: "failure", newerDraft: false },
    { outcome: "success", newerDraft: true },
    { outcome: "failure", newerDraft: true },
  ] as const)(
    "settles $outcome after sidebar remount with newer draft $newerDraft",
    async ({ outcome, newerDraft }) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      let respond!: (response: Response) => void;
      const fetch = vi.fn(
        (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetch);
      const client = new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { retry: false },
        },
      });
      const thread: CommentThread = {
        threadId: "reply-root",
        quotedText: null,
        prefix: null,
        suffix: null,
        startOffset: null,
        resolved: false,
        comments: [
          {
            id: "reply-root",
            document_id: "document-one",
            thread_id: "reply-root",
            parent_id: null,
            content: "Original comment",
            quoted_text: null,
            anchor_prefix: null,
            anchor_suffix: null,
            anchor_start_offset: null,
            mentions: [],
            author_email: "reviewer@example.test",
            author_name: "Reviewer",
            resolved: 0,
            created_at: "2026-09-10T12:00:00Z",
            updated_at: "2026-09-10T12:00:00Z",
            notion_comment_id: null,
          },
        ],
      };
      const queryKey = [
        "action",
        "list-comments",
        { documentId: "document-one" },
      ];
      client.setQueryData(queryKey, { comments: thread.comments });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      let replies!: ReturnType<typeof useCommentReplyDrafts>;
      let store!: ReturnType<typeof useCommentDraftContext>;
      function Owner({ surface }: { surface: string }) {
        replies = useCommentReplyDrafts("document-one");
        store = useCommentDraftContext();
        return (
          <CommentsSidebar
            key={surface}
            documentId="document-one"
            replyDrafts={replies}
            threads={[thread]}
            alignToAnchors={false}
            forceVisible
          />
        );
      }
      const show = async (surface: string) =>
        act(async () =>
          root.render(
            <QueryClientProvider client={client}>
              <TooltipProvider>
                <Owner surface={surface} />
              </TooltipProvider>
            </QueryClientProvider>,
          ),
        );
      const settle = async () =>
        act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 75));
        });
      const input = () =>
        container.querySelector<HTMLTextAreaElement>(
          "[data-comment-reply-composer] textarea",
        )!;
      try {
        await show("mobile");
        await act(async () => replies.setOpenReply(thread.threadId));
        await act(async () => {
          Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          )!.set!.call(input(), "Submitted reply");
          input().dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(store.drafts.get("reply:document-one:reply-root")?.text).toBe(
          "Submitted reply",
        );
        await act(async () =>
          container
            .querySelector<HTMLButtonElement>(
              '[data-comment-reply-composer] button[aria-label="comments.submit"]',
            )!
            .click(),
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String(fetch.mock.calls[0]?.[0])).toContain("add-comment");
        const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
        expect(body).toMatchObject({
          documentId: "document-one",
          content: "Submitted reply",
          threadId: "reply-root",
          parentId: "reply-root",
        });
        await show("desktop");
        if (newerDraft)
          await act(async () =>
            replies.setText(thread.threadId, "Newer unsent reply"),
          );
        await act(async () =>
          respond(
            new Response(
              JSON.stringify(
                outcome === "success"
                  ? { id: body.clientOperationId, threadId: thread.threadId }
                  : { error: "offline" },
              ),
              {
                status: outcome === "success" ? 200 : 500,
                headers: { "content-type": "application/json" },
              },
            ),
          ),
        );
        await settle();
        const expected = newerDraft
          ? "Newer unsent reply"
          : outcome === "success"
            ? ""
            : "Submitted reply";
        expect(replies.get(thread.threadId).text).toBe(expected);
        expect(input().value).toBe(expected);
        expect(fetch).toHaveBeenCalledTimes(1);
        if (outcome === "success" && !newerDraft) {
          expect(store.drafts.has("reply:document-one:reply-root")).toBe(false);
        } else {
          expect(store.drafts.get("reply:document-one:reply-root")?.text).toBe(
            expected,
          );
        }
      } finally {
        await act(async () => root.unmount());
        client.clear();
        container.remove();
        vi.unstubAllGlobals();
      }
    },
  );
});
