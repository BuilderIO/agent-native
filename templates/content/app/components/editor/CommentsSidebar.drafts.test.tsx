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
      "editor.sourceComponent.previewUnavailable": "Preview unavailable",
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
      discussion:
        targetId === "pending-pointer-decision"
          ? {
              reactions: {},
              threadPreferences: {
                "thread-pending-pointer-decision": {
                  muted: false,
                  unread: false,
                },
              },
              canReact: true,
              canSetThreadPreferences: true,
            }
          : undefined,
    },
    isLoading: false,
  }),
  useReplyReviewComment: () => ({
    mutate: replyMutate,
    isPending: false,
    error: null,
  }),
  useReactToReviewComment: () => ({ mutate: vi.fn(), isPending: false }),
  useSetReviewThreadUnread: () => ({ mutate: vi.fn(), isPending: false }),
  useSetReviewThreadMuted: () => ({ mutate: vi.fn(), isPending: false }),
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
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
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

it("shows semantic markers for a source-contextual whitespace-only operation", async () => {
  const suggestion = suggestionFixture({
    id: "pending-context-whitespace",
    threadId: "thread-pending-context-whitespace",
    revision: 1,
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:00:00.000Z",
    status: "pending",
    operations: [
      {
        id: "context-whitespace-operation",
        ordinal: 0,
        kind: "insert_text",
        targetId: "body",
        before: { markdown: "ab", changedText: "" },
        after: { markdown: "a \tb", changedText: " \t" },
        anchor: { from: 1, to: 1, prefix: "a", suffix: "b" },
        schemaVersion: 1,
      },
    ],
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness() {
    const replyDrafts = useCommentReplyDrafts("document-context-whitespace");
    return (
      <CommentsSidebar
        documentId="document-context-whitespace"
        replyDrafts={replyDrafts}
        suggestions={[suggestion]}
        presentation="history"
        forceVisible
      />
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("Add: “·⇥”");
    expect(container.textContent).not.toContain("Add: “ \t”");
  } finally {
    await act(async () => root.unmount());
  }
});

it.each([
  ["", "<br>", "Add: “↵”", ""],
  ["<br>", "", "Delete: “↵”", ""],
  ["Ec<br>ho", "Ec<br/>again", "with: “Ec↵again”", "Replace: “Ec↵ho”"],
])(
  "renders meaningful hard-break summaries for before %j and after %j",
  async (before, after, primary, detail) => {
    const suggestion = suggestionFixture({
      id: "pending-break",
      threadId: "thread-pending-break",
      revision: 1,
      authorEmail: "reviewer@example.test",
      actorKind: "human",
      createdAt: "2026-09-06T12:00:00.000Z",
      status: "pending",
      operations: [
        {
          id: "break-operation",
          ordinal: 0,
          kind:
            before && after
              ? "replace_text"
              : before
                ? "delete_text"
                : "insert_text",
          before: { changedText: before },
          after: { changedText: after },
          schemaVersion: 1,
        },
      ],
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    let controller!: ReturnType<typeof useCommentReplyDrafts>;
    function Harness() {
      controller = useCommentReplyDrafts("document-break");
      return (
        <CommentsSidebar
          documentId="document-break"
          replyDrafts={controller}
          suggestions={[suggestion]}
          presentation="history"
          forceVisible
        />
      );
    }
    try {
      await act(async () => root.render(<Harness />));
      expect(container.textContent).toContain(primary);
      if (detail) {
        await act(async () =>
          controller.setOpenReply(suggestion.threadId, suggestion.id, false),
        );
        expect(container.textContent).toContain(detail);
      }
      expect(container.textContent).not.toContain("<br");
    } finally {
      await act(async () => root.unmount());
    }
  },
);

it("renders exact marked hard-break replacement summaries without delimiter leakage", async () => {
  const beforeMarkdown = "**Prefix Upper**<br>**Lower suffix.**";
  const from = beforeMarkdown.indexOf("Upper");
  const to = beforeMarkdown.indexOf("Lower") + "Lower".length;
  const afterMarkdown = `${beforeMarkdown.slice(0, from)}Across${beforeMarkdown.slice(to)}`;
  const suggestion = suggestionFixture({
    id: "pending-marked-break",
    threadId: "thread-pending-marked-break",
    revision: 1,
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:00:00.000Z",
    status: "pending",
    operations: [
      {
        id: "marked-break-operation",
        ordinal: 0,
        kind: "replace_text",
        targetId: "body",
        before: {
          markdown: beforeMarkdown,
          changedText: beforeMarkdown.slice(from, to),
        },
        after: { markdown: afterMarkdown, changedText: "Across" },
        anchor: {
          from,
          to,
          prefix: beforeMarkdown.slice(0, from),
          suffix: beforeMarkdown.slice(to),
        },
        schemaVersion: 1,
      },
    ],
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  let controller!: ReturnType<typeof useCommentReplyDrafts>;
  function Harness() {
    controller = useCommentReplyDrafts("document-marked-break");
    return (
      <CommentsSidebar
        documentId="document-marked-break"
        replyDrafts={controller}
        suggestions={[suggestion]}
        presentation="history"
        forceVisible
      />
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    expect(container.querySelector("strong")?.textContent).toBe("Across");
    await act(async () =>
      controller.setOpenReply(suggestion.threadId, suggestion.id, false),
    );
    expect(
      [...container.querySelectorAll("strong")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["Across", "Upper", "Lower"]);
    expect(container.textContent).toContain("Upper↵Lower");
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("<br>");
  } finally {
    await act(async () => root.unmount());
  }
});

it("preserves all history filters across rail and Sheet remounts, resetting only for a new document or reveal intent", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let controller!: ReturnType<typeof useCommentReplyDrafts>;
  function Harness({
    documentId,
    layout,
  }: {
    documentId: string;
    layout: string;
  }) {
    controller = useCommentReplyDrafts(documentId);
    return (
      <CommentsSidebar
        key={layout}
        replyDrafts={controller}
        documentId={documentId}
        presentation="history"
        forceVisible
      />
    );
  }
  const filters = {
    status: "pending" as const,
    kind: "suggestions" as const,
    author: "reviewer@example.test",
  };
  try {
    await act(async () =>
      root.render(<Harness documentId="one" layout="rail" />),
    );
    await act(async () => controller.setHistoryFilters(filters));
    await act(async () =>
      root.render(<Harness documentId="one" layout="sheet" />),
    );
    expect(controller.historyFilters).toEqual(filters);
    await act(async () =>
      root.render(<Harness documentId="one" layout="rail" />),
    );
    expect(controller.historyFilters).toEqual(filters);
    await act(async () => controller.revealHistory("conflict", null));
    expect(controller.historyFilters).toEqual({
      status: "all",
      kind: "all",
      author: null,
    });
    await act(async () => controller.setHistoryFilters(filters));
    await act(async () => controller.revealHistory("conflict", null));
    expect(controller.historyFilters).toEqual(filters);
    await act(async () => controller.revealHistory(null, "explicit-link"));
    expect(controller.historyFilters.status).toBe("all");
    await act(async () => controller.setHistoryFilters(filters));
    await act(async () =>
      root.render(<Harness documentId="two" layout="sheet" />),
    );
    expect(controller.historyFilters).toEqual({
      status: "all",
      kind: "all",
      author: null,
    });
    await act(async () =>
      root.render(<Harness documentId="one" layout="rail" />),
    );
    expect(controller.historyFilters.status).toBe("all");
  } finally {
    await act(async () => root.unmount());
  }
});

it("focuses a linked thread once without focusing its reply composer", async () => {
  const suggestion = suggestionFixture({
    id: "pending-link",
    threadId: "thread-pending-link",
    revision: 1,
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:00:00.000Z",
    status: "pending",
    operations: [],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scroll = vi
    .spyOn(HTMLElement.prototype, "scrollIntoView")
    .mockImplementation(() => {});
  const consumed = vi.fn();
  function Harness({ focus }: { focus: boolean }) {
    const drafts = useCommentReplyDrafts("document-link");
    return (
      <CommentsSidebar
        replyDrafts={drafts}
        documentId="document-link"
        suggestions={[suggestion]}
        presentation="history"
        canComment
        forceVisible
        focusSuggestionId={focus ? suggestion.id : null}
        onSuggestionFocused={consumed}
      />
    );
  }
  try {
    await act(async () => root.render(<Harness focus={false} />));
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness focus />));
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    await act(async () => root.render(<Harness focus={false} />));
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(scroll).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    scroll.mockRestore();
    container.remove();
  }
});

it.each([
  ["editor.acceptSuggestion", "accepted", "ltr"],
  ["editor.rejectSuggestion", "rejected", "rtl"],
] as const)(
  "decides a focused expanded suggestion on the first native-like %s pointer sequence as %s in %s",
  async (label, decision, direction) => {
    const suggestion = suggestionFixture({
      id: "pending-pointer-decision",
      threadId: "thread-pending-pointer-decision",
      revision: 1,
      authorEmail: "reviewer@example.test",
      actorKind: "human",
      createdAt: "2026-09-06T12:00:00.000Z",
      status: "pending",
      operations: [
        {
          ordinal: 0,
          kind: "replace_text",
          before: { changedText: "before" },
          after: { changedText: "after" },
          schemaVersion: 1,
        },
      ],
    });
    const container = document.createElement("div");
    container.dir = direction;
    document.body.append(container);
    const root = createRoot(container);
    const onDecide = vi.fn();
    function Harness({ compact = false }: { compact?: boolean }) {
      const drafts = useCommentReplyDrafts("document-pointer-decision");
      return (
        <CommentsSidebar
          replyDrafts={drafts}
          documentId="document-pointer-decision"
          suggestions={[suggestion]}
          presentation="history"
          canComment
          canDecideSuggestions
          onDecideSuggestion={(_, nextDecision) => onDecide(nextDecision)}
          forceVisible
          compact={compact}
        />
      );
    }
    try {
      await act(async () => root.render(<Harness />));
      const card = container.querySelector<HTMLElement>(
        `[data-suggestion-id="${suggestion.id}"] [data-thread-card]`,
      )!;
      const summary = [...card.querySelectorAll<HTMLElement>("div")].find(
        (element) => element.textContent === "with: “after”",
      )!;
      await act(async () => summary.click());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 70));
      });
      const composer = card.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(document.activeElement).toBe(composer);
      const commentHeader = card.querySelector<HTMLElement>(
        ".group\\/comment > div",
      )!;
      expect(commentHeader.className).toContain("pr-16");
      expect(commentHeader.className).not.toContain("pe-16");
      let moreActions = card.querySelector<HTMLButtonElement>(
        'button[aria-label="comments.moreActions"]',
      )!;
      expect(moreActions.className).toContain("md:opacity-0");
      moreActions.focus();
      expect(document.activeElement).toBe(moreActions);
      composer.focus();

      const trigger = card.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      )!;
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
        );
        const mouseDown = new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
        });
        trigger.dispatchEvent(mouseDown);
        if (!mouseDown.defaultPrevented) trigger.focus();
        trigger.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
        );
        trigger.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail: 1,
          }),
        );
      });

      expect(document.activeElement).toBe(trigger);
      expect(onDecide).toHaveBeenCalledOnce();
      expect(onDecide).toHaveBeenCalledWith(decision);
      expect(trigger.isConnected).toBe(true);
      expect(card.querySelector(`button[aria-label="${label}"]`)).toBe(trigger);

      await act(async () => root.render(<Harness compact />));
      moreActions = container.querySelector<HTMLButtonElement>(
        'button[aria-label="comments.moreActions"]',
      )!;
      expect(moreActions.className).not.toContain("md:opacity-0");
      moreActions.focus();
      expect(document.activeElement).toBe(moreActions);
      expect(
        container.querySelector<HTMLElement>(".group\\/comment > div")!
          .className,
      ).toContain("pr-16");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it.each(["ordinary", "suggestion"] as const)(
  "preserves the active %s reply and backward caret range across responsive remounts",
  async (kind) => {
    const saved = suggestionFixture({
      id: "pending-responsive",
      threadId: "thread-pending-responsive",
      revision: 1,
      authorEmail: "reviewer@example.test",
      actorKind: "human",
      createdAt: "2026-09-06T12:00:00.000Z",
      status: "pending",
      operations: [
        {
          ordinal: 0,
          kind: "insert_text",
          before: { changedText: "" },
          after: { changedText: "proposal" },
          schemaVersion: 1,
        },
      ],
    });
    const thread = {
      threadId: "ordinary-responsive",
      resolved: false,
      quotedText: null,
      prefix: null,
      suffix: null,
      startOffset: null,
      comments: [
        {
          id: "ordinary-root",
          document_id: "responsive",
          thread_id: "ordinary-responsive",
          parent_id: null,
          content: "Review this",
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
    const threadId = kind === "suggestion" ? saved.threadId : thread.threadId;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let drafts!: ReturnType<typeof useCommentReplyDrafts>;
    function Harness({ surface }: { surface: string }) {
      drafts = useCommentReplyDrafts("responsive");
      return (
        <CommentsSidebar
          key={surface}
          replyDrafts={drafts}
          documentId="responsive"
          threads={kind === "ordinary" ? [thread] : []}
          suggestions={kind === "suggestion" ? [saved] : []}
          presentation={surface === "sheet" ? "history" : "inline"}
          canComment
          forceVisible
        />
      );
    }
    const settle = async () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 70));
      });
    try {
      await act(async () => root.render(<Harness surface="rail" />));
      const reply = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "comments.reply",
      );
      await act(async () => reply!.click());
      await act(async () =>
        drafts.setText(threadId, "First line\nSecond line"),
      );
      await settle();
      let input = container.querySelector("textarea")!;
      input.setSelectionRange(3, 15, "backward");
      input.dispatchEvent(new Event("select"));
      for (const surface of ["sheet", "rail"]) {
        await act(async () => root.render(<Harness surface={surface} />));
        await settle();
        expect(container.querySelectorAll("textarea")).toHaveLength(1);
        input = container.querySelector("textarea")!;
        expect(input.value).toBe("First line\nSecond line");
        expect(document.activeElement).toBe(input);
        expect([
          input.selectionStart,
          input.selectionEnd,
          input.selectionDirection,
        ]).toEqual([3, 15, "backward"]);
      }
      input.blur();
      await act(async () => root.render(<Harness surface="sheet" />));
      await settle();
      expect(document.activeElement).not.toBe(
        container.querySelector("textarea"),
      );
      await act(async () => drafts.setOpenReply(null));
      await act(async () => root.render(<Harness surface="rail" />));
      expect(container.querySelector("textarea")).toBeNull();
      expect(drafts.get(threadId).text).toBe("First line\nSecond line");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it("hands focus from a retained inert history rail to the sheet without clearing its range", async () => {
  const saved = suggestionFixture({
    id: "pending-inert",
    threadId: "thread-pending-inert",
    revision: 1,
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:00:00.000Z",
    status: "pending",
    operations: [
      {
        ordinal: 0,
        kind: "insert_text",
        before: { changedText: "" },
        after: { changedText: "proposal" },
        schemaVersion: 1,
      },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let drafts!: ReturnType<typeof useCommentReplyDrafts>;
  function Harness({
    compact = false,
    retained = true,
  }: {
    compact?: boolean;
    retained?: boolean;
  }) {
    drafts = useCommentReplyDrafts("inert-handoff");
    const sidebar = (
      <CommentsSidebar
        replyDrafts={drafts}
        documentId="inert-handoff"
        suggestions={[saved]}
        presentation="history"
        canComment
        forceVisible
      />
    );
    return (
      <>
        <aside inert={compact || undefined} data-history-rail>
          {retained ? sidebar : null}
        </aside>
        {compact ? <section data-sheet>{sidebar}</section> : null}
      </>
    );
  }
  const settle = async () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
  try {
    await act(async () => root.render(<Harness />));
    const reply = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "comments.reply",
    );
    await act(async () => reply!.click());
    await act(async () =>
      drafts.setText(saved.threadId, "First line\nSecond line"),
    );
    await settle();
    const oldInput = container.querySelector("textarea")!;
    oldInput.setSelectionRange(3, 15, "backward");
    oldInput.dispatchEvent(new Event("select"));
    await act(async () => root.render(<Harness compact />));
    expect(oldInput.isConnected).toBe(true);
    expect(oldInput.closest("[inert]")).not.toBeNull();
    // happy-dom does not dispatch the browser's blur when an ancestor becomes inert.
    oldInput.blur();
    await settle();
    const input = container.querySelector<HTMLTextAreaElement>(
      "[data-sheet] textarea",
    )!;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("First line\nSecond line");
    expect([
      input.selectionStart,
      input.selectionEnd,
      input.selectionDirection,
    ]).toEqual([3, 15, "backward"]);
    expect(
      [...container.querySelectorAll("textarea")].filter(
        (element) => !element.closest("[inert]"),
      ),
    ).toEqual([input]);
    await act(async () => root.render(<Harness compact retained={false} />));
    expect(document.activeElement).toBe(input);
    expect(drafts.focus.current?.threadId).toBe(saved.threadId);
    input.blur();
    expect(drafts.focus.current).toBeNull();
    await act(async () => root.render(<Harness />));
    await settle();
    expect(document.activeElement).not.toBe(
      container.querySelector("textarea"),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
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

it("shows an explicit unavailable label for invalid provided suggestion context", async () => {
  const saved = suggestionFixture({
    id: "invalid-presentation",
    revision: 1,
    threadId: "thread-invalid-presentation",
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    createdAt: "2026-09-06T12:00:00.000Z",
    status: "pending",
    operations: [
      {
        ordinal: 0,
        kind: "insert_text",
        before: { markdown: "**Other**", changedText: "" },
        after: { markdown: "**Other**", changedText: "proposal" },
        anchor: { from: 2, to: 2, prefix: "**", suffix: "Other**" },
        schemaVersion: 1,
      },
    ],
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness() {
    const replyDrafts = useCommentReplyDrafts("document-invalid-presentation");
    return (
      <CommentsSidebar
        replyDrafts={replyDrafts}
        documentId="document-invalid-presentation"
        suggestions={[saved]}
        presentation="history"
        canComment
        forceVisible
      />
    );
  }
  try {
    await act(async () => root.render(<Harness />));
    const card = container.querySelector(
      '[data-suggestion-id="invalid-presentation"]',
    );
    expect(card?.textContent).toContain("Preview unavailable");
    expect(card?.textContent).not.toContain("proposal");
  } finally {
    await act(async () => root.unmount());
    container.remove();
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
    expect(container.textContent).toContain("comments.accepted");
    expect(container.textContent).toContain("comments.rejected");
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
