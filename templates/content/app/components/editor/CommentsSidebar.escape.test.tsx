// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useState } from "react";
import { createRoot as createReactRoot, type Root } from "react-dom/client";

import { CommentDraftProvider } from "./comment-drafts";

function createRoot(container: Parameters<typeof createReactRoot>[0]) {
  const root = createReactRoot(container);
  // The sidebar refetches the Page after an AI undo, so it needs a client.
  const queryClient = new QueryClient();
  const render = root.render.bind(root);
  root.render = (children) =>
    render(
      <QueryClientProvider client={queryClient}>
        <CommentDraftProvider documentId="test-page">
          {children}
        </CommentDraftProvider>
      </QueryClientProvider>,
    );
  return root;
}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import { CommentComposer } from "./CommentComposer";
import { usePagePanelEscape } from "./document-page-panel-state";
import {
  CommentsSidebar,
  preserveCommentComposerEscape,
  useCommentReplyDrafts,
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
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (date: Date | string) => new Date(date).toISOString(),
  }),
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-comments", () => ({
  useEditComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactToComment: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutateAsync: vi.fn() }),
  useResolveComment: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({
    data: [{ email: "reviewer@example.test", name: "Reviewer" }],
  }),
}));
vi.mock("@agent-native/core/client/review", () => ({
  useReviewComments: () => ({
    data: {
      comments: [
        {
          id: "root-proposal",
          threadId: "proposal-thread",
          parentCommentId: null,
          status: "open",
          authorEmail: "reviewer@example.test",
          authorName: "Reviewer",
          createdAt: "2026-09-09T00:00:00.000Z",
          createdBy: "reviewer@example.test",
          body: "",
          mentions: [],
        },
      ],
    },
    isLoading: false,
  }),
  useReplyReviewComment: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

const proposal = {
  id: "proposal",
  threadId: "proposal-thread",
  resourceType: "document",
  resourceId: "document-one",
  adapterKind: "content.document-markdown",
  adapterVersion: 1,
  baseRevision: "one",
  summary: "",
  ownerEmail: null,
  orgId: null,
  visibility: "private",
  updatedAt: "2026-09-09T00:00:00.000Z",
  metadata: null,
  revision: 1,
  authorEmail: "reviewer@example.test",
  actorKind: "human",
  createdAt: "2026-09-09T00:00:00.000Z",
  status: "pending",
  operations: [
    {
      ordinal: 0,
      kind: "insert_text",
      before: { changedText: "" },
      after: { changedText: "better" },
      schemaVersion: 1,
    },
  ],
} as ResourceSuggestion;
const ordinary: CommentThread = {
  threadId: "ordinary-thread",
  quotedText: "better",
  prefix: null,
  suffix: null,
  startOffset: null,
  resolved: false,
  comments: [
    {
      id: "ordinary-root",
      document_id: "document-one",
      thread_id: "ordinary-thread",
      parent_id: null,
      content: "Review this",
      quoted_text: "better",
      anchor_prefix: null,
      anchor_suffix: null,
      anchor_start_offset: null,
      mentions: [],
      author_email: "reviewer@example.test",
      author_name: "Reviewer",
      resolved: 0,
      created_at: "2026-09-09T00:00:00.000Z",
      updated_at: "2026-09-09T00:00:00.000Z",
      notion_comment_id: null,
    },
  ],
};

describe("saved reply Escape inside the real Comments Sheet", () => {
  let container: HTMLDivElement;
  let root: Root;
  let drafts!: ReturnType<typeof useCommentReplyDrafts>;
  const dismiss = vi.fn();
  const cancelStandalone = vi.fn();
  function Owner({
    kind = "proposal",
    standalone = false,
    confirm = false,
  }: {
    kind?: "proposal" | "ordinary";
    standalone?: boolean;
    confirm?: boolean;
  }) {
    const [open, setOpen] = useState(true);
    const [text, setText] = useState("New pending comment");
    drafts = useCommentReplyDrafts("document-one");
    return (
      <TooltipProvider>
        <Sheet
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) dismiss();
          }}
        >
          <SheetContent
            aria-describedby={undefined}
            onEscapeKeyDown={preserveCommentComposerEscape}
          >
            <SheetTitle>Comments</SheetTitle>
            <button data-sheet-background>Background</button>
            {standalone ? (
              <CommentComposer
                value={text}
                onChange={setText}
                mentions={[]}
                onMentionsChange={() => {}}
                onSubmit={() => {}}
                onEscape={cancelStandalone}
                confirmEscape={confirm ? "comment" : false}
              />
            ) : (
              <CommentsSidebar
                documentId="document-one"
                replyDrafts={drafts}
                threads={kind === "ordinary" ? [ordinary] : []}
                suggestions={kind === "proposal" ? [proposal] : []}
                presentation="history"
                alignToAnchors={false}
                forceVisible
                onActivateThread={(id) => drafts.setOpenReply(id)}
              />
            )}
          </SheetContent>
        </Sheet>
      </TooltipProvider>
    );
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    dismiss.mockReset();
    cancelStandalone.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const settle = async () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
    });
  // The reply's composer; the Discussion panel's composer for the page stays.
  const replyInput = () =>
    [...document.querySelectorAll<HTMLElement>(".ProseMirror")].find(
      (editor) => !editor.closest("[data-discussion-composer]"),
    ) ?? null;
  const input = () => replyInput()!;
  const show = async (kind: "proposal" | "ordinary" = "proposal") => {
    await act(async () => root.render(<Owner kind={kind} />));
    await settle();
    await act(async () =>
      drafts.setOpenReply(
        `${kind}-thread`,
        kind === "proposal" ? "proposal" : null,
      ),
    );
    await settle();
    expect(input()).not.toBeNull();
    input().focus();
  };
  const type = async (value: string) => {
    await act(async () => {
      const node = input();
      node.focus();
      node.replaceChildren(
        ...value.split("\n").map((line) => {
          const paragraph = document.createElement("p");
          paragraph.textContent = line;
          return paragraph;
        }),
      );
      node.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: value,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const escape = async (
    target: HTMLElement,
    options: KeyboardEventInit = {},
  ) => {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
    });
    await act(async () => {
      (target.isConnected
        ? target
        : (document.activeElement ?? document.body)
      ).dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
    });
  };

  const confirmation = () =>
    document.querySelector<HTMLElement>('[role="alertdialog"]');
  const discardButton = () =>
    [...(confirmation()?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "comments.discard",
    )!;

  it.each(["proposal", "ordinary"] as const)(
    "asks before discarding the %s reply, and a second Escape keeps its multiline draft",
    async (kind) => {
      await show(kind);
      await type("First line\nSecond line");
      expect(document.activeElement).toBe(input());
      await escape(input());
      await settle();
      expect(dismiss).not.toHaveBeenCalled();
      expect(confirmation()?.textContent).toContain(
        "comments.discardReplyQuestion",
      );
      expect(document.activeElement).toBe(discardButton());
      await escape(discardButton());
      await settle();
      expect(confirmation()).toBeNull();
      expect(dismiss).not.toHaveBeenCalled();
      expect(input().innerText).toBe("First line\nSecond line");
      expect(document.activeElement).toBe(input());
      expect(drafts.get(`${kind}-thread`).text).toBe("First line\nSecond line");
    },
  );

  it.each(["proposal", "ordinary"] as const)(
    "discards the %s reply once confirmed and leaves the Sheet open",
    async (kind) => {
      await show(kind);
      await type("First line\nSecond line");
      await escape(input());
      await settle();
      await act(async () => discardButton().click());
      await settle();
      expect(confirmation()).toBeNull();
      expect(dismiss).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(replyInput()).toBeNull();
      expect(drafts.get(`${kind}-thread`).text).toBe("");
      await act(async () =>
        drafts.setOpenReply(
          `${kind}-thread`,
          kind === "proposal" ? "proposal" : null,
        ),
      );
      await settle();
      expect(input().textContent).toBe("");
      const background = document.querySelector<HTMLButtonElement>(
        "[data-sheet-background]",
      )!;
      background.focus();
      await escape(background);
      await settle();
      expect(dismiss).toHaveBeenCalledTimes(1);
    },
  );

  it("collapses an empty reply on Escape without asking", async () => {
    await show("ordinary");
    await escape(input());
    await settle();
    expect(confirmation()).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
    expect(replyInput()).toBeNull();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "leaves reply and Sheet open for composition Escape %j",
    async (options) => {
      await show();
      await type("Composition draft @Rev");
      await escape(input(), options);
      await settle();
      expect(dismiss).not.toHaveBeenCalled();
      expect(input()?.textContent).toBe("Composition draft @Rev");
      expect(document.activeElement).toBe(input());
      expect(drafts.openReply?.threadId).toBe("proposal-thread");
    },
  );

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "keeps inline reply composition Escape away from the document window handler %j",
    async (options) => {
      const windowDismiss = vi.fn();
      function InlineOwner() {
        drafts = useCommentReplyDrafts("document-one");
        useEffect(() => {
          const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              windowDismiss();
              drafts.setOpenReply(null);
            }
          };
          window.addEventListener("keydown", handleKeyDown);
          return () => window.removeEventListener("keydown", handleKeyDown);
        }, []);
        return (
          <TooltipProvider>
            <CommentsSidebar
              documentId="document-one"
              replyDrafts={drafts}
              suggestions={[proposal]}
              activeSuggestionId="proposal"
              alignToAnchors={false}
              forceVisible
            />
          </TooltipProvider>
        );
      }
      await act(async () => root.render(<InlineOwner />));
      await act(async () => drafts.setOpenReply("proposal-thread", "proposal"));
      await settle();
      await type("Inline composition @Rev");
      input().focus();
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      await act(async () => {
        input().dispatchEvent(event);
      });
      await act(async () => {
        input().dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            bubbles: true,
            cancelable: true,
            ...options,
          }),
        );
      });
      await settle();
      expect(windowDismiss).not.toHaveBeenCalled();
      expect(input()?.textContent).toBe("Inline composition @Rev");
      expect(document.activeElement).toBe(input());
      expect(drafts.openReply?.threadId).toBe("proposal-thread");
    },
  );

  it("hands a new comment's Escape to the comment, not the Sheet", async () => {
    await act(async () => root.render(<Owner standalone />));
    await settle();
    input().focus();
    await escape(input());
    await settle();
    expect(cancelStandalone).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("asks before a new comment's Escape discards its text", async () => {
    await act(async () => root.render(<Owner standalone confirm />));
    await settle();
    input().focus();
    await escape(input());
    await settle();
    expect(confirmation()?.textContent).toContain(
      "comments.discardCommentQuestion",
    );
    expect(cancelStandalone).not.toHaveBeenCalled();
    await act(async () => discardButton().click());
    await settle();
    expect(cancelStandalone).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("does not treat an unfocused rich reply editor as the active Escape layer", async () => {
    await show();
    const node = input();
    document
      .querySelector<HTMLButtonElement>("[data-sheet-background]")!
      .focus();
    await escape(node);
    await settle();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

// oracle-change: the page's Escape now runs through the one panel's hook, so
// these press the key on the page instead of reading DocumentEditor's source.
// Focus coming back after the panel closes is tested in document-page-panel-state.
describe("the page panel's Escape with a comment composer", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();
  const onDismiss = vi.fn();

  function Page() {
    usePagePanelEscape({
      belongs: () => true,
      closes: () => true,
      keeps: preserveCommentComposerEscape,
      onDismiss,
      onClose,
    });
    return (
      <>
        <button type="button" data-page-button />
        <div data-comment-composer>
          <textarea data-composer />
        </div>
      </>
    );
  }

  const pressEscape = (selector: string) => {
    const target = host.querySelector<HTMLElement>(selector);
    target?.focus();
    act(() => {
      target?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createReactRoot(host);
    act(() => root.render(<Page />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("lets the comment composer take Escape before the page panel closes", () => {
    pressEscape("[data-composer]");

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the page panel on Escape from anywhere else on the page", () => {
    pressEscape("[data-page-button]");

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets a nested menu use Escape before comment focus is dismissed", () => {
    host.addEventListener("keydown", (event) => event.preventDefault());
    pressEscape("[data-page-button]");

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
