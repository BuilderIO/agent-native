// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import type { DocumentProperty } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import type { CommentAiController } from "./comment-ai";
import { richEditor, setRichEditorValue } from "./comment-composer-test-utils";
import { CommentDraftProvider } from "./comment-drafts";
import {
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
  type PendingCommentSelection,
} from "./CommentsSidebar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  create: vi.fn(),
  aiEnabled: [] as boolean[],
}));
vi.mock("@/hooks/use-comments", () => ({
  useCreateComment: () => ({
    mutateAsync: actions.create,
    isPending: false,
    reconcileAmbiguous: vi.fn(),
  }),
  useEditComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactToComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutateAsync: vi.fn() }),
  useResolveComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  chatModelSelectionStorageKey: (scope: string) => `model:${scope}`,
  useChatModels: ({ enabled }: { enabled: boolean }) => {
    actions.aiEnabled.push(enabled);
    return {
      configuredModels: [],
      selectionReady: false,
      selectedModel: "",
      selectedEngine: "",
      selectedEffort: undefined,
      unavailableSelection: null,
      onModelChange: vi.fn(),
    };
  },
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (date: Date | string) => new Date(date).toISOString(),
  }),
  useT: () => (key: string, options?: { name?: string }) =>
    options?.name === undefined ? key : `${key}:${options.name}`,
}));
vi.mock("@agent-native/toolkit/app/review", () => ({
  InlineMarkdown: ({ content }: { content: string }) => content,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function blocksField(
  id: string,
  name: string,
  position: number,
  primary = false,
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "db-1",
      name,
      type: "blocks",
      visibility: "always_show",
      options: { blocks: { primary } },
      position,
      createdAt: "2026-10-18T00:00:00.000Z",
      updatedAt: "2026-10-18T00:00:00.000Z",
    },
    value: "",
    editable: true,
  } as unknown as DocumentProperty;
}

const twoFields = [
  blocksField("content", "Content", 0, true),
  blocksField("notes", "Notes", 1),
];
const oneField = [blocksField("content", "Content", 0, true)];

function thread(
  id: string,
  fieldId: string | null,
  fieldName: string | null = null,
): CommentThread {
  return {
    threadId: id,
    quotedText: "filler text",
    prefix: null,
    suffix: null,
    startOffset: 0,
    field: fieldId ? { fieldId, fieldName } : null,
    resolved: false,
    comments: [
      {
        id: `${id}-root`,
        document_id: "fixture",
        thread_id: id,
        parent_id: null,
        content: `Comment ${id}`,
        quoted_text: "filler text",
        anchor_prefix: null,
        anchor_suffix: null,
        anchor_start_offset: 0,
        field_id: fieldId,
        field_name: fieldName,
        mentions: [],
        author_email: "reviewer@example.test",
        author_name: "Reviewer",
        resolved: 0,
        created_at: `2026-10-18T12:00:0${id.length % 10}Z`,
        updated_at: "2026-10-18T12:00:00Z",
        notion_comment_id: null,
        submission_source: "frontend",
      },
    ],
  };
}

function suggestion(id: string): ResourceSuggestion {
  return {
    id,
    proposalId: null,
    revision: 1,
    resourceType: "document",
    resourceId: "fixture",
    adapterKind: "markdown",
    adapterVersion: 1,
    threadId: `suggestion-${id}`,
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    baseRevision: "base",
    status: "pending",
    summary: "Filler edit",
    ownerEmail: "reviewer@example.test",
    orgId: null,
    visibility: "private",
    createdAt: "2026-10-18T11:00:00Z",
    updatedAt: "2026-10-18T11:00:00Z",
    metadata: null,
    operations: [],
  } as ResourceSuggestion;
}

const commentAi = {
  requests: [],
  startingThreadIds: new Set<string>(),
  stoppingRequestIds: new Set<string>(),
  continuations: new Map(),
  transcriptRevision: 0,
  start: vi.fn(),
  continue: vi.fn(),
  retry: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  open: vi.fn(),
  undo: vi.fn(),
  freshResolutions: new Map(),
  dismissResolution: vi.fn(),
} satisfies CommentAiController;

type Options = {
  presentation?: "inline" | "history";
  selected?: string | null;
  documentProperties?: DocumentProperty[];
  suggestions?: ResourceSuggestion[];
  pending?: PendingCommentSelection | null;
  commentAi?: CommentAiController;
  scrollContainer?: HTMLDivElement;
};

let replies: ReturnType<typeof useCommentReplyDrafts>;

function Owner({
  threads,
  options,
}: {
  threads: CommentThread[];
  options: Options;
}) {
  replies = useCommentReplyDrafts("fixture", "reviewer@example.test");
  const pending = usePendingCommentDraft("fixture");
  const { setPendingComment } = pending;
  useEffect(() => {
    setPendingComment(options.pending ?? null);
  }, [options.pending, setPendingComment]);
  return (
    <CommentsSidebar
      replyDrafts={replies}
      pendingComment={pending.pendingComment}
      onPendingChange={pending.changePendingComment}
      onPendingDone={(id) => pending.completePendingComment(id)}
      documentId="fixture"
      threads={threads}
      documentProperties={options.documentProperties}
      suggestions={options.suggestions}
      selectedThreadId={options.selected ?? null}
      currentUserEmail="reviewer@example.test"
      canComment
      canResolve
      alignToAnchors={false}
      scrollContainerRef={
        options.scrollContainer
          ? { current: options.scrollContainer }
          : undefined
      }
      forceVisible
      presentation={options.presentation ?? "history"}
      commentAi={options.commentAi}
    />
  );
}

describe("comments across Blocks field tabs", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    actions.create.mockReset();
    actions.aiEnabled.length = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    window.localStorage.clear();
  });

  function render(threads: CommentThread[], options: Options = {}) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CommentDraftProvider
              documentId="fixture"
              currentUserEmail="reviewer@example.test"
            >
              <Owner threads={threads} options={options} />
            </CommentDraftProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }

  /** The feed in order: `#key label` for a tab's heading, else the card. */
  function feed() {
    const list = container.querySelector("[data-comments-feed]");
    return [...(list?.children ?? [])].map((child) => {
      if (child.hasAttribute("data-comments-tab-group")) {
        return `# ${child.textContent}`;
      }
      const card = child.matches("[data-thread-card], [data-suggestion-id]")
        ? child
        : child.querySelector("[data-thread-card], [data-suggestion-id]");
      return (
        card?.getAttribute("data-thread-card") ??
        card?.getAttribute("data-suggestion-id") ??
        "?"
      );
    });
  }

  async function openFilterMenu() {
    const trigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "comments.filter",
    )!;
    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
  }

  const tabThreads = [
    thread("notes-1", "notes", "Notes"),
    thread("body-1", null),
    thread("gone-1", "gone", "Old notes"),
  ];

  it("groups the panel by tab in tab order, then deleted tabs (CMT-4)", () => {
    render(tabThreads, {
      documentProperties: twoFields,
      suggestions: [suggestion("edit-1")],
    });
    expect(feed()).toEqual([
      "# Content",
      "edit-1",
      "body-1",
      "# Notes",
      "notes-1",
      "# comments.fieldRemoved:Old notes",
      "gone-1",
    ]);
    expect(
      container
        .querySelector('[data-comments-tab-group="gone"]')
        ?.hasAttribute("data-comments-tab-removed"),
    ).toBe(true);
  });

  it("filters the panel by tab alongside the other filters (CMT-4)", async () => {
    render(tabThreads, {
      documentProperties: twoFields,
      suggestions: [suggestion("edit-1")],
    });
    await openFilterMenu();
    const options = [
      ...container.querySelectorAll("[data-comments-tab-filter] [role]"),
    ].map((option) => option.textContent);
    expect(options).toEqual([
      "comments.allTabs",
      "Content",
      "Notes",
      "comments.fieldRemoved:Old notes",
    ]);

    await act(async () =>
      container
        .querySelector<HTMLElement>('[data-comments-tab-option="notes"]')!
        .click(),
    );
    expect(feed()).toEqual(["# Notes", "notes-1"]);

    act(() => replies.setHistoryFilters({ tab: "" }));
    expect(feed()).toEqual(["# Content", "edit-1", "body-1"]);

    act(() => replies.setHistoryFilters({ tab: null }));
    expect(feed()).toHaveLength(7);
  });

  it("shows every tab again when the chosen one is gone", () => {
    render(tabThreads, { documentProperties: twoFields });
    act(() => replies.setHistoryFilters({ tab: "gone" }));
    expect(feed()).toEqual(["# comments.fieldRemoved:Old notes", "gone-1"]);

    render(tabThreads.slice(0, 2), { documentProperties: twoFields });
    expect(feed()).toEqual(["# Content", "body-1", "# Notes", "notes-1"]);
  });

  it("keeps the panel flat with one Blocks field (CMT-4)", async () => {
    render([thread("body-1", null), thread("body-22", null)], {
      documentProperties: oneField,
    });
    expect(feed()).toEqual(["body-1", "body-22"]);
    await openFilterMenu();
    expect(container.textContent).toContain("comments.authorFilter");
    expect(container.querySelector("[data-comments-tab-filter]")).toBeNull();
  });

  it("lists a deleted tab's threads under its name even with one field left", () => {
    render([thread("body-1", null), thread("gone-1", "gone", "Old notes")], {
      documentProperties: oneField,
    });
    expect(feed()).toEqual([
      "# Content",
      "body-1",
      "# comments.fieldRemoved:Old notes",
      "gone-1",
    ]);
  });

  it("starts a new comment in the tab its text is in (CMT-1)", async () => {
    actions.create.mockResolvedValue({ id: "created", threadId: "created" });
    render([], {
      presentation: "inline",
      pending: { quotedText: "Notes", offsetTop: 0, fieldId: "notes" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await setRichEditorValue(richEditor(container)!, "Filler comment");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );
    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        quotedText: "Notes",
        fieldId: "notes",
        content: "Filler comment",
      }),
    );
  });

  it("starts a body comment without a field", async () => {
    actions.create.mockResolvedValue({ id: "created", threadId: "created" });
    render([], {
      presentation: "inline",
      pending: { quotedText: "Content", offsetTop: 0 },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    await setRichEditorValue(richEditor(container)!, "Filler comment");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="comments.submit"]')!
        .click(),
    );
    expect(actions.create).toHaveBeenCalledOnce();
    expect(actions.create.mock.calls[0]?.[0]).not.toHaveProperty("fieldId");
  });

  it("offers Ask AI only on the page body's threads", () => {
    render([thread("notes-1", "notes", "Notes")], {
      presentation: "inline",
      selected: "notes-1",
      commentAi,
    });
    expect(richEditor(container)).not.toBeNull();
    expect(actions.aiEnabled.length).toBeGreaterThan(0);
    expect(actions.aiEnabled.every((enabled) => !enabled)).toBe(true);

    actions.aiEnabled.length = 0;
    render([thread("body-1", null)], {
      presentation: "inline",
      selected: "body-1",
      commentAi,
    });
    expect(actions.aiEnabled).toContain(true);
  });

  it("offers Ask AI only on new comments in the page body", () => {
    render([], {
      presentation: "inline",
      pending: { quotedText: "Notes", offsetTop: 0, fieldId: "notes" },
      commentAi,
    });
    expect(richEditor(container)).not.toBeNull();
    expect(actions.aiEnabled.every((enabled) => !enabled)).toBe(true);

    actions.aiEnabled.length = 0;
    render([], {
      presentation: "inline",
      pending: { quotedText: "Content", offsetTop: 0 },
      commentAi,
    });
    expect(actions.aiEnabled).toContain(true);
  });

  it("keeps a closed tab's highlight available, but not a deleted tab's", async () => {
    const scroll = document.createElement("div");
    scroll.innerHTML = `
      <div data-document-scroll-content>
        <div data-block-field-panel data-block-field-id="content" data-primary-block-field-panel>
          <div class="ProseMirror"><span data-comment-thread="body-1">filler text</span></div>
        </div>
        <div data-block-field-panel data-block-field-id="notes" hidden>
          <div class="ProseMirror"><span data-comment-thread="notes-1">filler text</span></div>
        </div>
      </div>`;
    document.body.append(scroll);
    try {
      render(tabThreads, {
        documentProperties: twoFields,
        scrollContainer: scroll as HTMLDivElement,
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const unavailable = (id: string) =>
        container.querySelector(
          `[data-thread-card="${id}"] [data-comment-anchor-unavailable]`,
        ) !== null;
      expect(unavailable("body-1")).toBe(false);
      expect(unavailable("notes-1")).toBe(false);
      expect(unavailable("gone-1")).toBe(true);
    } finally {
      scroll.remove();
    }
  });
});
