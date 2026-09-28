// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";

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
import {
  CommentsSidebar,
  preserveCommentReplyEscape,
  useCommentReplyDrafts,
} from "./CommentsSidebar";

vi.mock("@agent-native/core/client/agent-chat", () => ({
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
vi.mock("@agent-native/core/client/hooks", () => ({
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
  let reopen!: () => void;
  const dismiss = vi.fn();
  function Owner({
    kind = "proposal",
    standalone = false,
  }: {
    kind?: "proposal" | "ordinary";
    standalone?: boolean;
  }) {
    const [open, setOpen] = useState(true);
    const [text, setText] = useState("New pending comment");
    drafts = useCommentReplyDrafts("document-one");
    reopen = () => setOpen(true);
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
            onEscapeKeyDown={preserveCommentReplyEscape}
          >
            <SheetTitle>Comments</SheetTitle>
            <button data-sheet-background>Background</button>
            {standalone ? (
              <CommentComposer
                value={text}
                onChange={setText}
                onMentionAdd={() => {}}
                onSubmit={() => {}}
                onEscape={() => {}}
                members={[]}
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
  const input = () => document.querySelector<HTMLElement>(".ProseMirror")!;
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

  it.each(["proposal", "ordinary"] as const)(
    "collapses only the %s reply and keeps its multiline draft",
    async (kind) => {
      await show(kind);
      await type("First line\nSecond line");
      expect(document.activeElement).toBe(input());
      await escape(input());
      await settle();
      expect(dismiss).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.querySelector(".ProseMirror")).toBeNull();
      expect(drafts.get(`${kind}-thread`).text).toBe("First line\nSecond line");
      await act(async () =>
        drafts.setOpenReply(
          `${kind}-thread`,
          kind === "proposal" ? "proposal" : null,
        ),
      );
      await settle();
      expect(input().innerText).toBe("First line\nSecond line");
      expect(document.activeElement).toBe(input());
      const background = document.querySelector<HTMLButtonElement>(
        "[data-sheet-background]",
      )!;
      background.focus();
      await escape(background);
      await settle();
      expect(dismiss).toHaveBeenCalledTimes(1);
    },
  );

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

  it("does not intercept Escape in a non-reply composer", async () => {
    await act(async () => root.render(<Owner standalone />));
    await settle();
    input().focus();
    await escape(input());
    await settle();
    expect(dismiss).toHaveBeenCalledTimes(1);
    await act(async () => reopen());
    await settle();
    expect(input().textContent).toBe("New pending comment");
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

  it("wires the capture boundary on the production document Sheet", () => {
    const source = readFileSync(
      new NodeURL("./DocumentEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /<SheetContent\s+ref=\{setUtilityPanelSheetContainer\}[\s\S]*?onEscapeKeyDown=\{\(event\) => \{\s+preserveCommentReplyEscape\(event\);\s+if \(event\.defaultPrevented\) return;\s+const target = event\.target;\s+const nestedPopper =/,
    );
  });

  it("keeps keyboard focus inside the mobile comments Sheet and restores its trigger", () => {
    const source = readFileSync(
      new NodeURL("./DocumentEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "ref={inSheet ? utilityPanelSheetCloseRef : undefined}",
    );
    expect(source).toMatch(
      /onOpenAutoFocus=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?\(focusedReply \?\? utilityPanelSheetCloseRef\.current\)\?\.focus\(\);/,
    );
    expect(source).toContain(
      "const restoreTarget = utilityPanelSheetTriggerRef.current;",
    );
    expect(source).toContain(
      "utilityPanelFocusGenerationRef.current !== focusGeneration",
    );
    expect(source).toContain("restoreTarget?.isConnected");
    expect(source).toContain(": fallbackTarget");
  });
});
