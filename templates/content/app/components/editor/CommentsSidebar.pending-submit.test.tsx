// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
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
