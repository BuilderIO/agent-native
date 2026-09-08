// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import { act, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  CommentsSidebar,
  suggestionTextForDisplay,
  useCommentReplyDrafts,
} from "./CommentsSidebar";
import type { DraftSuggestion } from "./suggestions/draft-session";

const { replyMutate } = vi.hoisted(() => ({ replyMutate: vi.fn() }));

function suggestionFixture(
  input: Pick<
    ResourceSuggestion,
    | "id"
    | "threadId"
    | "authorEmail"
    | "actorKind"
    | "createdAt"
    | "status"
    | "operations"
  > & { revision: number },
): ResourceSuggestion {
  return {
    resourceType: "document",
    resourceId: "document-fixture",
    adapterKind: "markdown",
    adapterVersion: 1,
    baseRevision: "fixture-revision",
    summary: "",
    ownerEmail: null,
    orgId: null,
    visibility: "private",
    updatedAt: input.createdAt,
    metadata: null,
    ...input,
  } as ResourceSuggestion;
}

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "comments.suggestionAdd": "Add",
      "comments.suggestionDelete": "Delete",
      "comments.suggestionWith": "with",
      "comments.suggestionReplace": "Replace",
    })[key] ?? key,
}));
vi.mock("@agent-native/core/client/markdown", () => ({
  InlineMarkdown: ({ content }: { content: string }) => (
    <>{content.trimEnd()}</>
  ),
}));
vi.mock("@agent-native/core/client/review", () => ({
  useReviewComments: ({ targetId }: { targetId: string }) => ({
    data: {
      comments: /^(materialized|pending|accepted|rejected)-/.test(targetId)
        ? [
            {
              id: `root-${targetId}`,
              threadId: `thread-${targetId}`,
              parentCommentId: null,
              status:
                targetId.startsWith("accepted-") ||
                targetId.startsWith("rejected-")
                  ? "resolved"
                  : "open",
              authorEmail: "reviewer@example.test",
              authorName: "Reviewer",
              createdAt: "2026-09-06T12:00:00.000Z",
              createdBy: "reviewer@example.test",
              body: "",
              mentions: [],
            },
            ...(targetId.startsWith("accepted-") ||
            targetId.startsWith("rejected-")
              ? [
                  {
                    id: `reply-${targetId}`,
                    threadId: `thread-${targetId}`,
                    parentCommentId: `root-${targetId}`,
                    status: "resolved",
                    authorEmail: "reviewer@example.test",
                    authorName: "Reviewer",
                    createdAt: "2026-09-06T12:01:00.000Z",
                    createdBy: "reviewer@example.test",
                    body: `existing reply ${targetId}`,
                    mentions: [],
                  },
                ]
              : []),
          ]
        : [],
    },
    isLoading: false,
  }),
  useReplyReviewComment: () => ({
    mutate: replyMutate,
    isPending: false,
    error: null,
  }),
}));
vi.mock("@/hooks/use-comments", () => ({
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useResolveComment: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AvatarImage: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuCheckboxItem: ({
    children,
    onCheckedChange,
  }: ComponentProps<"button"> & {
    onCheckedChange?: (checked: boolean) => void;
  }) => <button onClick={() => onCheckedChange?.(true)}>{children}</button>,
}));
vi.mock("./CommentComposer", async () => {
  const { forwardRef } = await import("react");
  return {
    CommentComposer: forwardRef<
      HTMLTextAreaElement,
      { value: string; placeholder?: string }
    >(({ value, placeholder }, ref) => (
      <textarea ref={ref} value={value} placeholder={placeholder} readOnly />
    )),
  };
});

it("shows semantic markers for whitespace-only saved and draft changes", () => {
  expect(suggestionTextForDisplay("  ")).toBe("··");
  expect(suggestionTextForDisplay("\t")).toBe("⇥");
  expect(suggestionTextForDisplay("\n")).toBe("↵");
  expect(suggestionTextForDisplay("word word\nnext")).toBe("word word↵next");
});

it("matches Notion operation order, disclosure, and full-line colors for draft and saved cards", async () => {
  const operations = [
    {
      ordinal: 0,
      kind: "delete_text",
      before: { changedText: "run" },
      after: { changedText: "" },
      schemaVersion: 1,
    },
    {
      ordinal: 1,
      kind: "insert_text",
      before: { changedText: "" },
      after: { changedText: "An " },
      schemaVersion: 1,
    },
    {
      ordinal: 2,
      kind: "replace_text",
      before: { changedText: "workflow" },
      after: { changedText: "workflows" },
      schemaVersion: 1,
    },
  ];
  const saved = suggestionFixture({
    id: "pending-summary",
    revision: 1,
    threadId: "thread-pending-summary",
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:00:00.000Z",
    status: "pending",
    operations,
  });
  const draft: DraftSuggestion = {
    durability: "draft",
    id: "draft-summary",
    threadId: "draft-summary",
    authorEmail: "reviewer@example.test",
    createdAt: "2026-09-06T12:01:00.000Z",
    operations,
    anchor: { from: 0, to: 8, prefix: "", suffix: "" },
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness() {
    const replyDrafts = useCommentReplyDrafts("document-summary");
    return (
      <CommentsSidebar
        replyDrafts={replyDrafts}
        documentId="document-summary"
        suggestions={[saved]}
        draftSuggestions={[draft]}
        hoveredSuggestionId={saved.id}
        canComment
        forceVisible
      />
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    for (const id of [saved.id, draft.id]) {
      const card = container.querySelector(`[data-suggestion-id="${id}"]`);
      expect(card?.textContent).toContain("Delete: “run”");
      expect(card?.textContent).toContain("Add: “An ”");
      expect(card?.textContent).toContain("with: “workflows”");
      expect(card?.textContent).not.toContain("Replace: “workflow”");
      const lines = [...(card?.querySelectorAll("div") ?? [])];
      expect(
        lines.find((line) => line.textContent === "Delete: “run”")?.className,
      ).toContain("text-muted-foreground");
      expect(
        lines.find((line) => line.textContent === "Add: “An ”")?.className,
      ).toContain("text-[hsl(var(--suggestion))]");
      expect(
        lines.some(
          (line) =>
            line.textContent === "with: “workflows”" &&
            line.className.includes("text-[hsl(var(--suggestion))]"),
        ),
      ).toBe(true);
    }

    const savedCard = container.querySelector(
      `[data-suggestion-id="${saved.id}"] [data-thread-card]`,
    );
    expect(savedCard?.className).toContain(
      "bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))]",
    );
    expect(
      savedCard?.querySelector('textarea[placeholder="comments.reply"]'),
    ).toBeNull();

    const replyButton = [...savedCard!.querySelectorAll("button")].find(
      (button) => button.textContent === "comments.reply",
    );
    await act(async () => replyButton?.click());
    const expandedText = savedCard?.textContent ?? "";
    expect(expandedText).toContain("Replace: “workflow”");
    expect(expandedText.indexOf("with: “workflows”")).toBeLessThan(
      expandedText.indexOf("Replace: “workflow”"),
    );
    expect(
      [...savedCard!.querySelectorAll("div")].find(
        (line) => line.textContent === "Replace: “workflow”",
      )?.className,
    ).toContain("text-muted-foreground");
  } finally {
    await act(async () => root.unmount());
  }
});

it("shares hover, focus, and reduced-motion behavior across comment and suggestion cards", async () => {
  const thread = {
    threadId: "ordinary-thread",
    quotedText: null,
    prefix: null,
    suffix: null,
    startOffset: null,
    resolved: false,
    comments: [
      {
        id: "ordinary-comment",
        document_id: "document-comments",
        thread_id: "ordinary-thread",
        parent_id: null,
        content: "A focused comment",
        quoted_text: null,
        anchor_prefix: null,
        anchor_suffix: null,
        anchor_start_offset: null,
        mentions: [],
        author_email: "reviewer@example.test",
        author_name: "Reviewer",
        resolved: 0,
        created_at: "2026-09-06T12:00:00.000Z",
        updated_at: "2026-09-06T12:00:00.000Z",
        notion_comment_id: null,
      },
    ],
  };
  const operation = {
    ordinal: 0,
    kind: "insert_text",
    before: { changedText: "" },
    after: { changedText: "proposal" },
    schemaVersion: 1,
  };
  const saved = suggestionFixture({
    id: "pending-shared-card",
    revision: 1,
    threadId: "thread-pending-shared-card",
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:01:00.000Z",
    status: "pending",
    operations: [operation],
  });
  const draft: DraftSuggestion = {
    durability: "draft",
    id: "draft-shared-card",
    threadId: "draft-shared-card",
    authorEmail: "reviewer@example.test",
    createdAt: "2026-09-06T12:02:00.000Z",
    operations: [operation],
    anchor: { from: 0, to: 8, prefix: "", suffix: "" },
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness({ active = false }: { active?: boolean }) {
    const replyDrafts = useCommentReplyDrafts("document-comments");
    return (
      <CommentsSidebar
        replyDrafts={replyDrafts}
        documentId="document-comments"
        threads={[thread]}
        suggestions={[saved]}
        draftSuggestions={[draft]}
        activeThreadId={active ? thread.threadId : null}
        forceVisible
      />
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    const cards = [thread.threadId, saved.threadId, draft.threadId].map(
      (threadId) => container.querySelector(`[data-thread-card="${threadId}"]`),
    );
    expect(cards.every(Boolean)).toBe(true);
    expect(new Set(cards.map((card) => card?.className)).size).toBe(1);
    expect(cards[0]?.className).toContain("hover:-translate-x-2");
    expect(cards[0]?.className).toContain(
      "hover:bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))]",
    );
    expect(cards[0]?.className).toContain("focus-within:-translate-x-2");
    expect(cards[0]?.className).toContain("motion-reduce:hover:translate-x-0");

    await act(async () => root.render(<Harness active />));
    expect(
      container.querySelector(`[data-thread-card="${thread.threadId}"]`)
        ?.className,
    ).toContain(
      "bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))]",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps replies and mentions across composer remounts and isolates documents and threads", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let drafts!: ReturnType<typeof useCommentReplyDrafts>;
  function Owner({
    documentId,
    threadId,
    open,
  }: {
    documentId: string;
    threadId: string;
    open: boolean;
  }) {
    drafts = useCommentReplyDrafts(documentId);
    return open ? (
      <textarea readOnly value={drafts.get(threadId).text} />
    ) : null;
  }
  const show = async (documentId: string, threadId: string, open = true) => {
    await act(async () => {
      root.render(
        <Owner documentId={documentId} threadId={threadId} open={open} />,
      );
    });
  };
  try {
    await show("document-one", "ordinary-thread");
    await act(async () => {
      drafts.setText("ordinary-thread", "Unsent @Example reply");
      drafts.addMention("ordinary-thread", {
        email: "example@example.test",
        name: "Example",
      });
      drafts.setText("suggestion-thread", "Unsent suggestion reply");
    });
    await show("document-one", "ordinary-thread", false);
    await show("document-one", "ordinary-thread");
    expect(container.querySelector("textarea")?.value).toBe(
      "Unsent @Example reply",
    );
    expect(drafts.get("ordinary-thread").mentions).toEqual([
      { email: "example@example.test", name: "Example" },
    ]);
    await show("document-one", "suggestion-thread");
    expect(container.querySelector("textarea")?.value).toBe(
      "Unsent suggestion reply",
    );
    await show("document-two", "ordinary-thread");
    expect(container.querySelector("textarea")?.value).toBe("");
    await show("document-one", "ordinary-thread");
    expect(container.querySelector("textarea")?.value).toBe(
      "Unsent @Example reply",
    );
    await act(async () => {
      drafts.clear("ordinary-thread");
    });
    expect(drafts.get("ordinary-thread")).toEqual({ text: "", mentions: [] });
    expect(drafts.get("suggestion-thread").text).toBe(
      "Unsent suggestion reply",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it("renders an existing saved proposal and a live draft in the rail and Pending history", async () => {
  const saved = suggestionFixture({
    id: "saved-publish",
    revision: 1,
    threadId: "thread-saved-publish",
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:00:00.000Z",
    status: "pending",
    operations: [
      {
        ordinal: 0,
        kind: "delete_text",
        before: { changedText: "publish" },
        after: { changedText: "" },
        schemaVersion: 1,
      },
    ],
  });
  const draft: DraftSuggestion = {
    durability: "draft",
    id: "draft-session-0",
    threadId: "draft-session-0",
    authorEmail: "reviewer@example.test",
    createdAt: "2026-09-06T12:01:00.000Z",
    operations: [
      {
        ordinal: 0,
        kind: "insert_text",
        before: { changedText: "" },
        after: { changedText: "eded" },
        schemaVersion: 1,
      },
    ],
    anchor: { from: 10, to: 14, prefix: "", suffix: "" },
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness({ presentation }: { presentation: "inline" | "history" }) {
    const replyDrafts = useCommentReplyDrafts("document-one");
    return (
      <CommentsSidebar
        replyDrafts={replyDrafts}
        documentId="document-one"
        suggestions={[saved]}
        draftSuggestions={[draft]}
        activeSuggestionId={draft.id}
        presentation={presentation}
        forceVisible
      />
    );
  }
  try {
    await act(async () => root.render(<Harness presentation="inline" />));
    expect(container.textContent).toContain("publish");
    expect(container.textContent).toContain("eded");
    expect(container.textContent).toContain("editor.toolbar.suggesting");
    expect(container.textContent).not.toContain("comments.empty");

    await act(async () => root.render(<Harness presentation="history" />));
    const pendingFilter = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "comments.pending",
    );
    await act(async () => pendingFilter?.click());
    expect(container.textContent).toContain("publish");
    expect(container.textContent).toContain("eded");
    expect(container.textContent).not.toContain("comments.noFilteredComments");
  } finally {
    await act(async () => root.unmount());
  }
});

it("materializes a draft Reply from history and focuses the durable thread composer", async () => {
  const draft: DraftSuggestion = {
    durability: "draft",
    id: "draft-reply",
    threadId: "draft-reply",
    authorEmail: "reviewer@example.test",
    createdAt: "2026-09-06T12:01:00.000Z",
    operations: [
      {
        ordinal: 0,
        kind: "insert_text",
        before: { changedText: "" },
        after: { changedText: "reply change" },
        schemaVersion: 1,
      },
    ],
    anchor: { from: 0, to: 12, prefix: "", suffix: "" },
  };
  const materialized = suggestionFixture({
    id: "materialized-reply",
    revision: 1,
    threadId: "thread-materialized-reply",
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:01:00.000Z",
    status: "pending",
    operations: draft.operations,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const replyDrafts = useCommentReplyDrafts("document-reply");
    const [saved, setSaved] = useState<ResourceSuggestion[]>([]);
    const [drafts, setDrafts] = useState([draft]);
    const [activeId, setActiveId] = useState<string | null>(null);
    return (
      <CommentsSidebar
        replyDrafts={replyDrafts}
        documentId="document-reply"
        suggestions={saved}
        draftSuggestions={drafts}
        activeSuggestionId={activeId}
        onActivateSuggestion={setActiveId}
        onMaterializeDraft={async () => {
          setSaved([materialized]);
          setDrafts([]);
          return materialized;
        }}
        presentation="history"
        canComment
        forceVisible
      />
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    const reply = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "comments.reply",
    );
    await act(async () => {
      reply?.click();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="comments.reply"]',
    );
    expect(composer).not.toBeNull();
    expect(document.activeElement).toBe(composer);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("keeps decided suggestion history readable and replies only to pending threads", async () => {
  replyMutate.mockClear();
  const operation = {
    ordinal: 0,
    kind: "replace_text",
    before: { changedText: "original" },
    after: { changedText: "proposal" },
    schemaVersion: 1,
  };
  const suggestions = (["accepted", "rejected", "pending"] as const).map(
    (status) =>
      suggestionFixture({
        id: `${status}-suggestion`,
        revision: 1,
        threadId: `thread-${status}-suggestion`,
        authorEmail: "reviewer@example.test",
        actorKind: "human",
        createdAt: "2026-09-06T12:00:00.000Z",
        status,
        operations: [operation],
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let drafts!: ReturnType<typeof useCommentReplyDrafts>;
  function Harness() {
    drafts = useCommentReplyDrafts("document-lifecycle");
    return (
      <CommentsSidebar
        replyDrafts={drafts}
        documentId="document-lifecycle"
        suggestions={suggestions}
        presentation="history"
        canComment
        forceVisible
      />
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain(
      "existing reply accepted-suggestion",
    );
    expect(container.textContent).toContain(
      "existing reply rejected-suggestion",
    );
    expect(container.textContent).toContain("with: “proposal”");
    expect(container.textContent).not.toContain("Replace: “original”");
    const detailButtons = [...container.querySelectorAll("button")].filter(
      (button) => button.textContent === "comments.suggestionDetails",
    );
    expect(detailButtons).toHaveLength(2);
    await act(async () => detailButtons[0]?.click());
    expect(container.textContent).toContain("Replace: “original”");
    const replyButtons = [...container.querySelectorAll("button")].filter(
      (button) => button.textContent === "comments.reply",
    );
    expect(replyButtons).toHaveLength(1);

    await act(async () => replyButtons[0]?.click());
    await act(async () => {
      drafts.setText("thread-pending-suggestion", "Pending reply");
    });
    const submit = [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "comments.submit",
    );
    expect(submit).toBeDefined();
    await act(async () => submit?.click());
    expect(replyMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: "root-pending-suggestion",
        body: "Pending reply",
      }),
      expect.any(Object),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
