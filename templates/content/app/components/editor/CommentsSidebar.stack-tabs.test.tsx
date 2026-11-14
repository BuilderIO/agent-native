// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import { commentRailThreads } from "./block-field-comment-threads";
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
vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (date: Date | string) => new Date(date).toISOString(),
  }),
  useT: () => (key: string, params?: { count?: number }) =>
    params?.count === undefined ? key : `${key}:${params.count}`,
}));
vi.mock("@agent-native/toolkit/app/review", () => ({
  CommentBody: ({ body }: { body: string }) => body,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function thread(
  id: string,
  createdAt: string,
  placement: { fieldId?: string; property?: boolean } = {},
): CommentThread {
  const quote = placement.property ? null : `quote ${id}`;
  return {
    threadId: id,
    quotedText: quote,
    prefix: null,
    suffix: null,
    startOffset: 0,
    field: placement.fieldId
      ? { fieldId: placement.fieldId, fieldName: "Notes" }
      : null,
    property: placement.property
      ? { propertyId: "status", propertyName: "Status", propertyValue: "Open" }
      : null,
    resolved: false,
    comments: [
      {
        id: `${id}-0`,
        document_id: "fixture",
        thread_id: id,
        parent_id: null,
        content: `Comment ${id}`,
        quoted_text: quote,
        anchor_prefix: null,
        anchor_suffix: null,
        anchor_start_offset: 0,
        field_id: placement.fieldId ?? null,
        field_name: placement.fieldId ? "Notes" : null,
        mentions: [],
        author_email: "reviewer@example.test",
        author_name: "Reviewer",
        resolved: 0,
        created_at: createdAt,
        updated_at: createdAt,
        notion_comment_id: null,
        submission_source: "frontend",
      },
    ],
  };
}

// Each tab's first paragraph holds its own stack, so the two blocks have the
// same place in their editors. Two threads sit on one Property.
const THREADS = [
  thread("prop-1", "2026-10-20T08:00:00Z", { property: true }),
  thread("prop-2", "2026-10-20T08:30:00Z", { property: true }),
  thread("body-a", "2026-10-20T09:00:00Z"),
  thread("body-b", "2026-10-20T10:00:00Z"),
  thread("notes-a", "2026-10-20T11:00:00Z", { fieldId: "notes" }),
  thread("notes-b", "2026-10-20T12:00:00Z", { fieldId: "notes" }),
  thread("notes-c", "2026-10-20T11:30:00Z", { fieldId: "notes" }),
];

const DOC = `
  <div data-document-scroll-content>
    <div data-page-properties>
      <button data-comment-thread="prop-2" data-property-comment-marker>
        <span data-comment-thread="prop-1"></span>
      </button>
    </div>
    <div data-block-field-panel data-block-field-id="content" data-primary-block-field-panel>
      <div class="ProseMirror"><p>
        <span data-comment-thread="body-a">alpha</span>
        <span data-comment-thread="body-b">beta</span>
      </p></div>
    </div>
    <div data-block-field-panel data-block-field-id="notes" hidden>
      <div class="ProseMirror"><p>
        <span data-comment-thread="notes-a">one</span>
        <span data-comment-thread="notes-b">two</span>
        <span data-comment-thread="notes-c">three</span>
      </p></div>
    </div>
  </div>`;

const harness = {} as {
  openTab: (fieldId: string | null) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  selected: string | null;
};

function Owner({ scroll }: { scroll: HTMLDivElement }) {
  const replies = useCommentReplyDrafts("fixture", "reviewer@example.test");
  const pending = usePendingCommentDraft("fixture");
  const [openFieldId, setOpenFieldId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  harness.selected = selected;
  harness.select = setSelected;
  harness.hover = setHovered;
  harness.openTab = (fieldId) => {
    for (const panel of scroll.querySelectorAll<HTMLElement>(
      "[data-block-field-panel]",
    )) {
      panel.hidden = panel.dataset.blockFieldId !== (fieldId ?? "content");
    }
    setOpenFieldId(fieldId);
  };
  return (
    <CommentsSidebar
      replyDrafts={replies}
      pendingComment={pending.pendingComment}
      onPendingChange={pending.changePendingComment}
      onPendingDone={(id) => pending.completePendingComment(id)}
      documentId="fixture"
      threads={commentRailThreads(THREADS, openFieldId)}
      scrollContainerRef={{ current: scroll }}
      activeThreadId={hovered ?? selected}
      selectedThreadId={selected}
      hoveredThreadId={hovered}
      onActivateThread={(id) => {
        setHovered(null);
        setSelected(id);
      }}
      onSelectedThreadChange={setSelected}
      onHoveredThreadChange={setHovered}
      currentUserEmail="reviewer@example.test"
      canComment
      canResolve
      alignToAnchors
      forceVisible
      presentation="inline"
    />
  );
}

describe("comment stacks across Blocks field tabs", () => {
  let root: Root;
  let container: HTMLDivElement;
  let scroll: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    scroll = document.createElement("div");
    scroll.innerHTML = DOC;
    document.body.append(scroll);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CommentDraftProvider
              documentId="fixture"
              currentUserEmail="reviewer@example.test"
            >
              <Owner scroll={scroll} />
            </CommentDraftProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    scroll.remove();
    queryClient.clear();
    window.localStorage.clear();
  });

  async function settle(ms = 20) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  /** The margin's cards in order: a thread id, or `stack:<front>`. */
  function margin() {
    return [
      ...container.querySelectorAll<HTMLElement>(
        "[data-comment-layout-thread]",
      ),
    ].map((item) => {
      const stack = item.querySelector<HTMLElement>(
        '[data-comment-stack-state="folded"]',
      );
      return stack
        ? `stack:${stack.dataset.commentStackFront}`
        : item.dataset.commentLayoutThread;
    });
  }

  async function openTab(fieldId: string | null) {
    act(() => harness.openTab(fieldId));
    await settle();
  }

  it("shows each tab's own stack, and never stacks Property threads", async () => {
    await settle();
    expect(margin()).toEqual(["prop-1", "prop-2", "stack:body-b"]);
    expect(
      container.querySelector('[data-comment-stack-front="body-b"]')
        ?.textContent,
    ).toContain("comments.stackMore:1");

    await openTab("notes");
    expect(margin()).toEqual(["prop-1", "prop-2", "stack:notes-b"]);
    expect(
      container.querySelector('[data-comment-stack-front="notes-b"]')
        ?.textContent,
    ).toContain("comments.stackMore:2");
  });

  it("keeps what is opened or touched on one tab to that tab", async () => {
    await settle();
    // Open the body's stack on its older thread.
    act(() => harness.select("body-a"));
    expect(margin()).toEqual(["prop-1", "prop-2", "body-a", "body-b"]);

    await openTab("notes");
    expect(margin()).toEqual(["prop-1", "prop-2", "stack:notes-b"]);
    act(() => harness.hover("notes-a"));
    await settle(220);
    act(() => harness.hover(null));
    expect(margin()).toEqual(["prop-1", "prop-2", "stack:notes-a"]);

    await openTab(null);
    expect(margin()).toEqual(["prop-1", "prop-2", "stack:body-a"]);
  });

  it("folds the open stack when the tab changes", async () => {
    await settle();
    await openTab("notes");
    act(() => harness.select("notes-a"));
    expect(margin()).toEqual([
      "prop-1",
      "prop-2",
      "notes-a",
      "notes-b",
      "notes-c",
    ]);

    await openTab(null);
    expect(harness.selected).toBeNull();
    expect(margin()).toEqual(["prop-1", "prop-2", "stack:body-b"]);
    expect(container.querySelector("[data-comment-stack-collapse]")).toBeNull();

    await openTab("notes");
    expect(margin()).toEqual(["prop-1", "prop-2", "stack:notes-a"]);
  });
});
