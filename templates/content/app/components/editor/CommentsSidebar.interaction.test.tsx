// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import {
  CommentDraftProvider,
  useCommentDraft,
  useCommentPanelSession,
} from "./comment-drafts";
import { CommentsSidebar } from "./CommentsSidebar";

const actions = vi.hoisted(() => ({
  create: vi.fn(),
  realMutation: false,
  reconcile: vi.fn(),
  edit: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@/hooks/use-comments", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useCreateComment: () => {
      const mutation = useMutation({ mutationFn: actions.create });
      return {
        ...(actions.realMutation
          ? mutation
          : { mutateAsync: actions.create, isPending: false }),
        reconcileAmbiguous: actions.reconcile,
      };
    },
    useEditComment: () => ({ mutateAsync: actions.edit, isPending: false }),
    useResolveComment: () => ({
      mutateAsync: actions.resolve,
      isPending: false,
    }),
  };
});
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
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/markdown", () => ({
  InlineMarkdown: ({ content }: { content: string }) => content,
}));

function thread(id: string, resolved = false): CommentThread {
  return {
    threadId: id,
    quotedText: "unique selected text",
    prefix: null,
    suffix: null,
    startOffset: 0,
    resolved,
    comments: [
      {
        id: `${id}-root`,
        document_id: "fixture",
        thread_id: id,
        parent_id: null,
        content: `Comment ${id}`,
        quoted_text: "unique selected text",
        anchor_prefix: null,
        anchor_suffix: null,
        anchor_start_offset: 0,
        mentions: [],
        author_email: "reviewer@example.test",
        author_name: "Reviewer",
        resolved: resolved ? 1 : 0,
        created_at: "2026-09-04T12:00:00Z",
        updated_at: "2026-09-04T12:00:00Z",
        notion_comment_id: null,
      },
    ],
  };
}

let panel: ReturnType<typeof useCommentPanelSession>;
let replyDraft: ReturnType<typeof useCommentDraft>;
function PanelProbe() {
  replyDraft = useCommentDraft("reply:one");
  panel = useCommentPanelSession();
  return null;
}

describe("comment review interactions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let resolveCreate: (result: { id: string; threadId: string }) => void;
  beforeEach(() => {
    actions.realMutation = false;
    queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    actions.resolve.mockImplementation(() => new Promise(() => {}));
    actions.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    queryClient.clear();
    vi.clearAllMocks();
    window.localStorage.clear();
  });
  function render(
    selected: string | null,
    threads = [thread("one"), thread("two")],
    presentation: "inline" | "history" = "inline",
    options: {
      key?: string;
      pending?: boolean;
      onPendingDone?: (threadId?: string) => void;
    } = {},
  ) {
    if (!container) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CommentDraftProvider
              documentId="fixture"
              currentUserEmail="reviewer@example.test"
            >
              <PanelProbe />
              <CommentsSidebar
                key={options.key ?? "sidebar"}
                pendingComment={
                  options.pending
                    ? { quotedText: "selected anchor", offsetTop: 0 }
                    : null
                }
                onPendingDone={options.onPendingDone}
                documentId="fixture"
                threads={threads}
                selectedThreadId={selected}
                currentUserEmail="reviewer@example.test"
                canComment
                canResolve
                alignToAnchors={false}
                forceVisible
                presentation={presentation}
              />
            </CommentDraftProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }
  function type(text: string) {
    const input = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("preserves a reply through dismissal, thread switches, and panel presentation remounts", () => {
    render("one");
    type("Unsent detailed feedback");
    act(() => {
      container
        .querySelector("textarea")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    render("two");
    type("Different draft");
    render(null, undefined, "history");
    render("one");
    expect(container.querySelector("textarea")!.value).toBe(
      "Unsent detailed feedback",
    );
    render("two");
    expect(container.querySelector("textarea")!.value).toBe("Different draft");
  });
  it("does not clear newer typing when an older reply settles", async () => {
    render("one");
    type("First submitted draft");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(actions.create).toHaveBeenCalledOnce();
    type("Newer unsent draft");
    await act(async () =>
      resolveCreate({
        id: "saved",
        threadId: "one",
      }),
    );
    expect(container.querySelector("textarea")!.value).toBe(
      "Newer unsent draft",
    );
  });
  it.each([false, true])(
    "clears only the submitted revision after ambiguous reconciliation (new mentions: %s)",
    async (addMentions) => {
      render("one");
      type("Hello @Reviewer");
      act(() =>
        (
          container.querySelector(
            '[aria-label="comments.submit"]',
          ) as HTMLButtonElement
        ).click(),
      );
      if (addMentions)
        act(() =>
          replyDraft.setMentions([
            { email: "reviewer@example.test", name: "Reviewer" },
          ]),
        );
      const pending = thread("one");
      pending.comments.push({
        ...pending.comments[0],
        id: "optimistic-reply",
        parent_id: pending.comments[0].id,
        content: "Hello @Reviewer",
        mutation: {
          kind: "create",
          status: "error",
          operationId: actions.create.mock.calls[0][0].clientOperationId,
          ambiguous: true,
        },
      });
      render("one", [pending]);
      actions.reconcile.mockResolvedValue("confirmed");
      const check = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("comments.checkSaved"),
      )!;
      await act(async () => check.click());
      expect(actions.reconcile).toHaveBeenCalledWith(
        "fixture",
        actions.create.mock.calls[0][0].clientOperationId,
      );
      expect(replyDraft.draft.text).toBe(addMentions ? "Hello @Reviewer" : "");
      expect(replyDraft.draft.mentions).toEqual(
        addMentions
          ? [{ email: "reviewer@example.test", name: "Reviewer" }]
          : [],
      );
    },
  );

  it.each([false, true])(
    "keeps old anchored-save UI effects detached after remount (new draft: %s)",
    async (newer) => {
      actions.realMutation = true;
      const onPendingDone = vi.fn();
      render(null, [], "inline", {
        key: "anchor-a",
        pending: true,
        onPendingDone,
      });
      type("Anchor A draft");
      await act(async () => {
        const submit = [...container.querySelectorAll("button")].find(
          (button) => button.textContent === "comments.submit",
        )!;
        submit.click();
      });
      render(null, [], "inline", {
        key: "anchor-b",
        pending: true,
        onPendingDone,
      });
      if (newer) type("Anchor B draft");
      await act(async () =>
        resolveCreate({ id: "saved-a", threadId: "thread-a" }),
      );
      expect(onPendingDone).not.toHaveBeenCalled();
      expect(container.querySelector("textarea")!.value).toBe(
        newer ? "Anchor B draft" : "",
      );
    },
  );

  it("reconciles the original submission without clearing a second submitted draft", async () => {
    render("one");
    type("First draft");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const firstOperationId = actions.create.mock.calls[0][0].clientOperationId;
    type("Second draft");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(actions.create.mock.calls[1][0].clientOperationId).not.toBe(
      firstOperationId,
    );
    const ambiguous = thread("one");
    ambiguous.comments.push({
      ...ambiguous.comments[0],
      id: "optimistic-first",
      parent_id: ambiguous.comments[0].id,
      content: "First draft",
      mutation: {
        kind: "create",
        status: "error",
        operationId: firstOperationId,
        ambiguous: true,
      },
    });
    render("one", [ambiguous]);
    actions.reconcile.mockResolvedValue("confirmed");
    const check = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("comments.checkSaved"),
    )!;
    await act(async () => check.click());
    expect(actions.reconcile).toHaveBeenCalledWith("fixture", firstOperationId);
    expect(container.querySelector("textarea")!.value).toBe("Second draft");
  });

  it("blocks replies immediately while resolution waits for cancellation", async () => {
    let rejectResolution!: (error: Error) => void;
    actions.resolve.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectResolution = reject;
        }),
    );
    render("one");
    type("unsent reply");
    const resolve = [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "comments.resolve",
    )!;
    const submit = container.querySelector(
      '[aria-label="comments.submit"]',
    ) as HTMLButtonElement;
    await act(async () => {
      resolve.click();
      submit.click();
    });
    expect(actions.resolve).toHaveBeenCalledOnce();
    expect(actions.create).not.toHaveBeenCalled();
    expect(submit.disabled).toBe(true);
    render("one", undefined, "inline", { key: "remounted-sidebar" });
    const remountedSubmit = container.querySelector(
      '[aria-label="comments.submit"]',
    ) as HTMLButtonElement;
    expect(remountedSubmit.disabled).toBe(true);
    await act(async () => rejectResolution(new Error("resolution rejected")));
    expect(remountedSubmit.disabled).toBe(false);
    expect(container.querySelector("textarea")!.value).toBe("unsent reply");
  });

  it("lets users clear their own reply text without extra controls", () => {
    render("one");
    type("Keep me");
    render("two");
    type("Discard me");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) =>
          button.textContent === "comments.discardDraft" ||
          button.textContent === "comments.reply",
      ),
    ).toBe(false);
    type("");
    expect(container.querySelector("textarea")!.value).toBe("");
    render("one");
    expect(container.querySelector("textarea")!.value).toBe("Keep me");
  });
  it("shows resolved reply history without reopening and exposes Reopen", () => {
    const resolved = thread("one", true);
    resolved.comments.push({
      ...resolved.comments[0],
      id: "reply",
      parent_id: resolved.comments[0].id,
      content: "Resolved reply history",
    });
    render(null, [resolved], "history");
    act(() => panel.setHistoryStatus("all"));
    expect(container.textContent).toContain("Resolved reply history");
    const reopen = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("comments.reopen"),
    )!;
    act(() => reopen.click());
    expect(actions.resolve).toHaveBeenCalledWith({
      id: "one-root",
      documentId: "fixture",
      resolved: false,
    });
  });
  it("distinguishes the initial empty list from filtering", () => {
    render(null, [], "history");
    expect(container.textContent).toContain("comments.selectTextToComment");
    expect(container.textContent).not.toContain("comments.noFilteredComments");
  });
});
