// @vitest-environment happy-dom

import type { ResourceSuggestion } from "@agent-native/core/review";
import type { CommentAiRequest } from "@shared/comment-ai";
import { serializeStoredCommentMentions } from "@shared/comment-mentions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

import {
  AI_RESOLVED_MARK_FADE_MS,
  AI_RESOLVED_MARK_HOLD_MS,
  AI_RESULT_LEFT_ALONE_MS,
  type CommentAiController,
} from "./comment-ai";
import {
  richEditor,
  richEditorValue,
  setRichEditorValue,
} from "./comment-composer-test-utils";
import {
  CommentDraftProvider,
  useCommentDraft,
  useCommentPanelSession,
} from "./comment-drafts";
import {
  agentSuggestionReason,
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
} from "./CommentsSidebar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  authors: [] as unknown[],
  create: vi.fn(),
  realMutation: false,
  reconcile: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  modelsReady: false,
}));
vi.mock("@/hooks/use-comments", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useCreateComment: (author: unknown) => {
      actions.authors.push(author);
      const mutation = useMutation({ mutationFn: actions.create });
      return {
        ...(actions.realMutation
          ? mutation
          : { mutateAsync: actions.create, isPending: false }),
        reconcileAmbiguous: actions.reconcile,
      };
    },
    useEditComment: () => ({ mutateAsync: actions.edit, isPending: false }),
    useReactToComment: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteComment: () => ({ mutateAsync: actions.remove }),
    useResolveComment: () => ({
      mutateAsync: actions.resolve,
      isPending: false,
    }),
  };
});
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({ data: [] }),
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: Object.assign((...args: Parameters<typeof actual.toast>) => {
      notify(...args);
      return actual.toast(...args);
    }, actual.toast),
  };
});
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
    selectionReady: actions.modelsReady,
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
  useT:
    () =>
    (
      key: string,
      params?: { count?: number; name?: string; old?: string; new?: string },
    ) =>
      key === "comments.proposalEditCount"
        ? `${key}:${params?.count}`
        : key === "comments.aiAttribution"
          ? `${key}:${params?.name}`
          : key === "comments.suggestionReplaceWith"
            ? `${key}: “${params?.old}” → “${params?.new}”`
            : key,
}));
vi.mock("@agent-native/toolkit/app/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/review")
  >()),
  CommentBody: ({ body }: { body: string }) => body,
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
        submission_source: "frontend",
      },
    ],
  };
}

function proposalSuggestion(
  id: string,
  status: ResourceSuggestion["status"] = "pending",
): ResourceSuggestion {
  return {
    id,
    proposalId: "proposal",
    proposalSummary: "Suggest edits",
    revision: 1,
    resourceType: "document",
    resourceId: "fixture",
    adapterKind: "markdown",
    adapterVersion: 1,
    threadId: `suggestion-${id}`,
    authorEmail: "reviewer@example.test",
    actorKind: "human",
    baseRevision: "base",
    status,
    summary: `Edit ${id}`,
    ownerEmail: "reviewer@example.test",
    orgId: null,
    visibility: "private",
    createdAt: "2026-09-04T12:00:00Z",
    updatedAt: "2026-09-04T12:00:00Z",
    metadata: null,
    operations: [],
  };
}

let panel: ReturnType<typeof useCommentPanelSession>;
let replyState: ReturnType<typeof useCommentReplyDrafts>;
let replyDraft: ReturnType<typeof useCommentDraft>;
function PanelProbe() {
  replyDraft = useCommentDraft("reply:fixture:one");
  panel = useCommentPanelSession();
  return null;
}

function ReplyDraftsProbe({ documentId }: { documentId: string }) {
  replyState = useCommentReplyDrafts(documentId, "reviewer@example.test");
  return null;
}

function SidebarOwner({
  selected,
  threads,
  presentation,
  options,
}: {
  selected: string | null;
  threads: CommentThread[];
  presentation: "inline" | "history";
  options: {
    key?: string;
    pending?: boolean;
    onPendingDone?: (threadId?: string) => void;
    commentAi?: CommentAiController;
    onActivateThread?: (threadId: string) => void;
    onSelectedThreadChange?: (threadId: string | null) => void;
    suggestions?: ResourceSuggestion[];
    awaitedSuggestionIds?: ReadonlySet<string>;
    unreadableSuggestionIds?: ReadonlySet<string>;
    onRetrySuggestionRead?: () => void;
    decidingSuggestion?: (suggestionId: string) => boolean;
    activeSuggestionId?: string;
    unplaceableSuggestionRevisions?: ReadonlyMap<string, number>;
    anchoredSuggestionIds?: string[] | null;
    alignToAnchors?: boolean;
    scrollContainer?: HTMLDivElement;
    onDecideSuggestionProposal?: (
      proposalId: string,
      decision: "accepted" | "rejected",
      members: ResourceSuggestion[],
      exactMembers?: boolean,
    ) => void;
    onStepThreadSuggestion?: (threadId: string, suggestionId: string) => void;
  };
}) {
  const replies = useCommentReplyDrafts("fixture", "reviewer@example.test");
  replyState = replies;
  const pending = usePendingCommentDraft("fixture");
  useEffect(() => {
    pending.setPendingComment(
      options.pending ? { quotedText: "selected anchor", offsetTop: 0 } : null,
    );
  }, [options.pending, options.key, pending.setPendingComment]);
  return (
    <CommentsSidebar
      key={options.key ?? "sidebar"}
      replyDrafts={replies}
      pendingComment={pending.pendingComment}
      onPendingChange={pending.changePendingComment}
      onPendingDone={(id, threadId) => {
        if (pending.completePendingComment(id))
          options.onPendingDone?.(threadId);
      }}
      documentId="fixture"
      threads={threads}
      suggestions={options.suggestions}
      awaitedSuggestionIds={options.awaitedSuggestionIds}
      unreadableSuggestionIds={options.unreadableSuggestionIds}
      onRetrySuggestionRead={options.onRetrySuggestionRead}
      activeSuggestionId={options.activeSuggestionId}
      unplaceableSuggestionRevisions={options.unplaceableSuggestionRevisions}
      anchoredSuggestionIds={options.anchoredSuggestionIds}
      selectedThreadId={selected}
      currentUserEmail="reviewer@example.test"
      currentUserName="Rae Viewer"
      canComment
      canResolve
      canDecideSuggestions
      alignToAnchors={options.alignToAnchors ?? !!options.suggestions}
      scrollContainerRef={
        options.scrollContainer
          ? { current: options.scrollContainer }
          : undefined
      }
      onDecideSuggestionProposal={options.onDecideSuggestionProposal}
      onStepThreadSuggestion={options.onStepThreadSuggestion}
      decidingSuggestion={options.decidingSuggestion}
      forceVisible
      presentation={presentation}
      commentAi={options.commentAi}
      onActivateThread={options.onActivateThread}
      onSelectedThreadChange={options.onSelectedThreadChange}
    />
  );
}

describe("comment review interactions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let resolveCreate: (result: { id: string; threadId: string }) => void;
  beforeEach(() => {
    actions.authors = [];
    actions.realMutation = false;
    actions.modelsReady = false;
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
    vi.useRealTimers();
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
      commentAi?: CommentAiController;
      onActivateThread?: (threadId: string) => void;
      onSelectedThreadChange?: (threadId: string | null) => void;
      suggestions?: ResourceSuggestion[];
      awaitedSuggestionIds?: ReadonlySet<string>;
      unreadableSuggestionIds?: ReadonlySet<string>;
      onRetrySuggestionRead?: () => void;
      decidingSuggestion?: (suggestionId: string) => boolean;
      activeSuggestionId?: string;
      unplaceableSuggestionRevisions?: ReadonlyMap<string, number>;
      anchoredSuggestionIds?: string[] | null;
      alignToAnchors?: boolean;
      scrollContainer?: HTMLDivElement;
      onDecideSuggestionProposal?: (
        proposalId: string,
        decision: "accepted" | "rejected",
        members: ResourceSuggestion[],
        exactMembers?: boolean,
      ) => void;
      onStepThreadSuggestion?: (threadId: string, suggestionId: string) => void;
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
              <SidebarOwner
                threads={threads}
                selected={selected}
                presentation={presentation}
                options={options}
              />
            </CommentDraftProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }
  async function type(text: string) {
    await setRichEditorValue(richEditor(container)!, text);
  }
  it.each(["inline", "history"] as const)(
    "shows a single-member proposal as a normal suggestion card in %s",
    (presentation) => {
      render(null, [], presentation, {
        suggestions: [proposalSuggestion("one")],
      });
      expect(
        container.querySelector("[data-suggestion-id='one']"),
      ).not.toBeNull();
      expect(container.querySelector("[data-suggestion-proposal]")).toBeNull();
    },
  );

  it.each(["inline", "history"] as const)(
    "keeps a multi-member proposal grouped when one edit remains pending in %s",
    (presentation) => {
      render(null, [], presentation, {
        suggestions: [
          proposalSuggestion("one", "accepted"),
          proposalSuggestion("two"),
        ],
      });
      expect(
        container.querySelector("[data-suggestion-proposal='proposal']"),
      ).not.toBeNull();
    },
  );
  it("keeps an expanded proposal open and counts the edits left after its first is accepted", () => {
    const members = ["one", "two", "three"].map((id) => proposalSuggestion(id));
    const header = () =>
      container.querySelector<HTMLButtonElement>(
        "[data-suggestion-proposal='proposal'] > button[aria-expanded]",
      );
    render(null, [], "inline", { suggestions: members });
    expect(header()?.getAttribute("aria-expanded")).toBe("false");
    expect(header()?.textContent).toContain("comments.proposalEditCount:3");
    act(() => header()!.click());
    expect(header()?.getAttribute("aria-expanded")).toBe("true");

    render(null, [], "inline", {
      suggestions: [
        { ...members[0]!, status: "accepted" },
        ...members.slice(1),
      ],
    });
    expect(header()?.getAttribute("aria-expanded")).toBe("true");
    expect(header()?.textContent).toContain("comments.proposalEditCount:2");
  });
  it("shows every pending proposal member before deciding from a focused inline card", () => {
    const onDecideSuggestionProposal = vi.fn();
    render(null, [], "inline", {
      suggestions: [proposalSuggestion("one"), proposalSuggestion("two")],
      activeSuggestionId: "one",
      alignToAnchors: false,
      onDecideSuggestionProposal,
    });
    expect(
      container.querySelector("[data-suggestion-id='one']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-suggestion-id='two']"),
    ).not.toBeNull();
    expect(container.querySelectorAll("[data-suggestion-id]")).toHaveLength(2);
    const accept = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("comments.acceptAll"),
    );
    expect(accept).toBeDefined();
    act(() => accept!.click());
    expect(onDecideSuggestionProposal).toHaveBeenCalledWith(
      "proposal",
      "accepted",
      expect.arrayContaining([
        expect.objectContaining({ id: "one" }),
        expect.objectContaining({ id: "two" }),
      ]),
    );
    expect(onDecideSuggestionProposal.mock.calls[0]?.[2]).toHaveLength(2);
  });
  describe("review units", () => {
    const source = "Teh team will recieve the files.";
    const piece = (
      id: string,
      reviewUnit: string,
      find: string,
      text = source,
    ) => {
      const from = text.indexOf(find);
      return {
        ...proposalSuggestion(id),
        metadata: { reviewUnit },
        operations: [
          {
            id: `operation-${id}`,
            kind: "replace_text",
            before: { markdown: text, changedText: find },
            after: {
              markdown: text.replace(find, find.toUpperCase()),
              changedText: find.toUpperCase(),
            },
            anchor: { from, to: from + find.length },
          },
        ],
      } as unknown as ResourceSuggestion;
    };
    const acceptIn = (id: string) => {
      const accept = container.querySelector<HTMLButtonElement>(
        `[data-suggestion-id='${id}'] [data-suggestion-decision='accepted']`,
      );
      if (!accept) throw new Error(`No Accept on ${id}`);
      return accept;
    };

    it("shows a proposal that is one unit as one card with one Accept", () => {
      const onDecideSuggestionProposal = vi.fn();
      const members = [
        piece("one", "k:0", "Teh"),
        piece("two", "k:0", "recieve"),
      ];
      render(null, [], "inline", {
        suggestions: members,
        activeSuggestionId: "two",
        alignToAnchors: false,
        onDecideSuggestionProposal,
      });
      expect(container.querySelector("[data-suggestion-proposal]")).toBeNull();
      expect(container.querySelectorAll("[data-suggestion-id]")).toHaveLength(
        1,
      );
      expect(container.textContent).toContain("TEH team will RECIEVE");
      act(() => acceptIn("one").click());
      expect(onDecideSuggestionProposal).toHaveBeenCalledWith(
        "proposal",
        "accepted",
        members,
        true,
      );
    });

    it("won't accept what's left of a unit with a stale piece, only reject it", () => {
      const onDecideSuggestionProposal = vi.fn();
      const stale = {
        ...piece("one", "k:0", "Teh"),
        status: "stale",
      } as ResourceSuggestion;
      const rest = [
        piece("two", "k:0", "recieve"),
        piece("three", "k:0", "files"),
      ];
      render(null, [], "inline", {
        suggestions: [stale, ...rest],
        activeSuggestionId: "two",
        alignToAnchors: false,
        onDecideSuggestionProposal,
      });
      expect(acceptIn("two").disabled).toBe(true);
      expect(
        container.querySelector("[data-suggestion-id='two'] [role='alert']"),
      ).not.toBeNull();
      const reject = container.querySelector<HTMLButtonElement>(
        "[data-suggestion-id='two'] [data-suggestion-decision='rejected']",
      );
      if (!reject) throw new Error("No Reject on the unit's card");
      act(() => reject.click());
      expect(onDecideSuggestionProposal).toHaveBeenCalledWith(
        "proposal",
        "rejected",
        rest,
        true,
      );
    });

    it("turns off Accept on a card the server refused", () => {
      const pieces = [
        piece("one", "k:0", "Teh"),
        piece("two", "k:0", "recieve"),
        piece("three", "k:1", "files"),
      ];
      const [first = null, second = null] = pieces;
      if (!first || !second) throw new Error("The unit has two pieces");
      render(null, [], "inline", {
        suggestions: pieces,
        activeSuggestionId: "one",
        alignToAnchors: false,
        unplaceableSuggestionRevisions: new Map([
          [first.id, first.revision],
          [second.id, second.revision],
        ]),
        onDecideSuggestionProposal: vi.fn(),
      });
      expect(acceptIn("one").disabled).toBe(true);
      expect(acceptIn("three").disabled).toBe(false);
      expect(
        container.querySelector<HTMLButtonElement>(
          "[data-suggestion-id='one'] [data-suggestion-decision='rejected']",
        )?.disabled,
      ).toBe(false);
    });

    it("gives each unit of a proposal its own card, counted once", () => {
      const onDecideSuggestionProposal = vi.fn();
      const members = [
        piece("one", "k:0", "Teh"),
        piece("two", "k:0", "recieve"),
        piece("three", "k:1", "files"),
      ];
      render(null, [], "inline", {
        suggestions: members,
        activeSuggestionId: "one",
        alignToAnchors: false,
        onDecideSuggestionProposal,
      });
      expect(
        container.querySelector("[data-suggestion-proposal] > button")
          ?.textContent,
      ).toContain("comments.proposalEditCount:2");
      expect(container.querySelectorAll("[data-suggestion-id]")).toHaveLength(
        2,
      );
      act(() => acceptIn("one").click());
      expect(onDecideSuggestionProposal).toHaveBeenCalledWith(
        "proposal",
        "accepted",
        [members[0], members[1]],
        true,
      );
    });

    it("hands focus on to the card past a proposal decided from the keyboard", () => {
      const onDecideSuggestionProposal = vi.fn();
      const members = [
        piece("one", "k:0", "Teh"),
        piece("two", "k:1", "recieve"),
      ];
      const lone = {
        ...piece("three", "k:2", "files"),
        proposalId: null,
      } as ResourceSuggestion;
      const options = { onDecideSuggestionProposal };
      render(null, [], "history", {
        ...options,
        suggestions: [...members, lone],
      });
      const acceptAll = container.querySelector<HTMLButtonElement>(
        "[data-suggestion-proposal-decision='accepted']",
      );
      if (!acceptAll) throw new Error("The proposal has no Accept all");
      acceptAll.focus();
      act(() => {
        acceptAll.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(onDecideSuggestionProposal).toHaveBeenCalledWith(
        "proposal",
        "accepted",
        members,
      );

      render(null, [], "history", { ...options, suggestions: [lone] });
      expect(container.querySelector("[data-suggestion-proposal]")).toBeNull();
      const next = container.querySelector(
        "[data-suggestion-id='three'] [data-thread-card]",
      );
      expect(next).not.toBeNull();
      expect(document.activeElement).toBe(next);
    });

    it("finds the decided card again when deciding a proposal's first rebuilds the group", () => {
      const onDecideSuggestionProposal = vi.fn();
      const one = piece("one", "k:0", "Teh");
      const two = piece("two", "k:1", "recieve");
      const lone = {
        ...piece("three", "k:2", "files"),
        proposalId: null,
      } as ResourceSuggestion;
      const options = { onDecideSuggestionProposal, activeSuggestionId: "one" };
      render(null, [], "inline", {
        ...options,
        suggestions: [one, two, lone],
      });
      const cardOf = (id: string) =>
        container.querySelector(
          `[data-suggestion-id='${id}'] [data-thread-card]`,
        );
      const before = cardOf("one");
      expect(before).not.toBeNull();
      const accept = acceptIn("one");
      accept.focus();
      act(() => {
        accept.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });

      render(null, [], "inline", {
        ...options,
        suggestions: [{ ...one, status: "accepted" }, two, lone],
      });
      const rebuilt = cardOf("one");
      expect(rebuilt).not.toBeNull();
      expect(rebuilt).not.toBe(before);
      expect(document.activeElement).toBe(rebuilt);
    });

    it("keeps focus on a proposal that stays listed after Accept all", () => {
      const onDecideSuggestionProposal = vi.fn();
      const members = [
        piece("one", "k:0", "Teh"),
        piece("two", "k:1", "recieve"),
      ];
      const options = { onDecideSuggestionProposal };
      render(null, [], "history", { ...options, suggestions: members });
      act(() => replyState.setHistoryFilters({ status: "all" }));
      const acceptAll = container.querySelector<HTMLButtonElement>(
        "[data-suggestion-proposal-decision='accepted']",
      );
      if (!acceptAll) throw new Error("The proposal has no Accept all");
      acceptAll.focus();
      act(() => {
        acceptAll.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });

      render(null, [], "history", {
        ...options,
        suggestions: members.map((member) => ({
          ...member,
          status: "accepted" as const,
        })),
      });
      expect(
        container.querySelector("[data-suggestion-proposal-decision]"),
      ).toBeNull();
      const header = container.querySelector(
        "[data-suggestion-proposal='proposal'] > button[aria-expanded]",
      );
      expect(header).not.toBeNull();
      expect(document.activeElement).toBe(header);
    });

    it("shows what a one-piece unit replaces, where cards would read alike", () => {
      render(null, [], "inline", {
        suggestions: [piece("one", "k:0", "Teh"), piece("two", "k:1", "files")],
        activeSuggestionId: "one",
        alignToAnchors: false,
        onDecideSuggestionProposal: vi.fn(),
      });
      const card = container.querySelector("[data-suggestion-id='one']");
      expect(card?.textContent).toContain(
        "comments.suggestionReplaceWith: “Teh” → “TEH”",
      );
    });

    it("opens a unit's card when a later piece is commented on", () => {
      const long =
        "Teh team that looks after the shared drive will, once the quarterly review is finished and signed off by everyone, recieve the files.";
      render(null, [], "inline", {
        suggestions: [
          piece("one", "k:0", "Teh", long),
          piece("two", "k:0", "recieve", long),
          piece("three", "k:1", "files", long),
        ],
        activeSuggestionId: "one",
        alignToAnchors: false,
        onDecideSuggestionProposal: vi.fn(),
      });
      const closedCard = () =>
        container.querySelector(
          "[data-suggestion-id='one'].cursor-pointer, [data-suggestion-id='one'] .cursor-pointer",
        );
      expect(closedCard()).not.toBeNull();
      act(() => replyState.setOpenReply("suggestion-two", "two"));
      expect(closedCard()).toBeNull();
    });

    it("keeps a unit whole when a history search matches one of its pieces", () => {
      const onDecideSuggestionProposal = vi.fn();
      const members = [
        piece("one", "k:0", "Teh"),
        piece("two", "k:0", "recieve"),
        piece("three", "k:1", "files"),
      ];
      render(null, [], "history", {
        suggestions: members,
        onDecideSuggestionProposal,
      });
      act(() => replyState.setHistoryFilters({ query: "Edit two" }));
      expect(
        container.querySelector("[data-suggestion-id='three']"),
      ).toBeNull();
      act(() => acceptIn("one").click());
      expect(onDecideSuggestionProposal).toHaveBeenCalledWith(
        "proposal",
        "accepted",
        members.slice(0, 2),
        true,
      );
    });

    it("won't accept all while a filter hides what's left of a stale unit", () => {
      render(null, [], "history", {
        suggestions: [
          {
            ...piece("one", "k:0", "Teh"),
            status: "stale",
          } as ResourceSuggestion,
          piece("four", "k:0", "team"),
          piece("two", "k:1", "recieve"),
          piece("three", "k:2", "files"),
        ],
        onDecideSuggestionProposal: vi.fn(),
      });
      act(() => replyState.setHistoryFilters({ query: "Edit t" }));
      expect(container.querySelector("[data-suggestion-id='four']")).toBeNull();
      const acceptAll = container.querySelector<HTMLButtonElement>(
        "[data-suggestion-proposal-decision='accepted']",
      );
      if (!acceptAll) throw new Error("No Accept all on the group");
      expect(acceptAll.disabled).toBe(true);
    });

    it("counts a proposal in units when history shows only some of them", () => {
      const accepted = (id: string, reviewUnit: string, find: string) => ({
        ...piece(id, reviewUnit, find),
        status: "accepted" as const,
      });
      render(null, [], "history", {
        suggestions: [
          accepted("one", "k:0", "Teh"),
          accepted("two", "k:0", "team"),
          accepted("three", "k:1", "will"),
          accepted("four", "k:1", "recieve"),
          piece("five", "k:2", "the"),
          piece("six", "k:2", "files"),
        ],
        onDecideSuggestionProposal: vi.fn(),
      });
      act(() => replyState.setHistoryFilters({ status: "resolved" }));
      expect(
        container.querySelector("[data-suggestion-proposal] > button")
          ?.textContent,
      ).toContain("comments.proposalEditCount:3");
    });

    it("marks a unit's change by whole words", () => {
      const rewrite = "Our plan for the launch is ready now.";
      const swap = (id: string, find: string, replace: string) => {
        const from = rewrite.indexOf(find);
        const member = piece(id, "k:0", find);
        const [operation = null] = member.operations;
        if (!operation) throw new Error("A piece has an operation");
        member.operations = [
          {
            ...operation,
            before: { markdown: rewrite, changedText: find },
            after: { markdown: rewrite, changedText: replace },
            anchor: { from, to: from + find.length },
          },
        ];
        return member;
      };
      render(null, [], "inline", {
        suggestions: [
          swap("one", "Our", "The"),
          swap("two", "ready", "steady"),
        ],
        activeSuggestionId: "one",
        alignToAnchors: false,
        onDecideSuggestionProposal: vi.fn(),
      });
      const marked = (selector: string) =>
        [...container.querySelectorAll(selector)].map((span) =>
          span.textContent.trim(),
        );
      expect(marked(".line-through")).toEqual(["Our", "ready"]);
      expect(marked(".underline")).toEqual(["The", "steady"]);
    });
  });
  it("keeps a proposal's Accept all off while one of its edits can't be placed", () => {
    const failed = proposalSuggestion("one");
    render(null, [], "inline", {
      suggestions: [failed, proposalSuggestion("two")],
      activeSuggestionId: "one",
      alignToAnchors: false,
      unplaceableSuggestionRevisions: new Map([["one", failed.revision]]),
      onDecideSuggestionProposal: vi.fn(),
    });
    const decision = (value: "accepted" | "rejected") =>
      container.querySelector<HTMLButtonElement>(
        `[data-suggestion-proposal-decision='${value}']`,
      );
    expect(decision("accepted")?.disabled).toBe(true);
    expect(decision("rejected")?.disabled).toBe(false);
  });
  it("clamps a grouped suggestion's reason only while the group is closed", () => {
    const reason =
      "React is a UI library, so on its own it has nowhere to centralize business logic; Rails gives you models and controllers for that.";
    render(null, [], "inline", {
      suggestions: [
        { ...proposalSuggestion("one"), proposalSummary: reason },
        { ...proposalSuggestion("two"), proposalSummary: reason },
      ],
    });
    const header = container.querySelector<HTMLButtonElement>(
      "[data-suggestion-proposal='proposal'] > button[aria-expanded]",
    )!;
    const text = [...header.querySelectorAll("span")].find(
      (span) => span.textContent === reason,
    )!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(text.className).toContain("line-clamp-2");
    act(() => header.click());
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(text.className).not.toContain("line-clamp-2");
    act(() => header.click());
    expect(text.className).toContain("line-clamp-2");
  });
  it.each(["inline", "history"] as const)(
    "shows an agent's reason above its lone suggestion in %s, but not inside a group",
    (presentation) => {
      const agent = (id: string): ResourceSuggestion => ({
        ...proposalSuggestion(id),
        actorKind: "agent",
        proposalSummary: "Rails is the framework the article compares against.",
        summary: 'Replace "React" with "Rails"',
      });
      render(null, [], presentation, {
        suggestions: [{ ...agent("one"), proposalId: "lone" }],
      });
      expect(
        container.querySelector(
          "[data-suggestion-id='one'] [data-suggestion-reason]",
        )?.textContent,
      ).toBe("Rails is the framework the article compares against.");
      render(null, [], presentation, {
        suggestions: [agent("one"), agent("two")],
        activeSuggestionId: "one",
      });
      expect(
        container.querySelector("[data-suggestion-id='two']"),
      ).not.toBeNull();
      expect(container.querySelector("[data-suggestion-reason]")).toBeNull();
    },
  );
  it("keeps a pending suggestion the page can't draw in the margin, labeled", () => {
    render(null, [], "inline", {
      suggestions: [
        { ...proposalSuggestion("drawn"), proposalId: "drawn" },
        { ...proposalSuggestion("divider"), proposalId: "divider" },
      ],
      anchoredSuggestionIds: ["drawn"],
    });
    const card = (id: string) =>
      container.querySelector(`[data-suggestion-id='${id}']`);
    expect(card("drawn")?.textContent).not.toContain("comments.unanchored");
    expect(card("divider")?.textContent).toContain("comments.unanchored");
  });
  it("drops the conflict alert once an unplaceable suggestion is amended", () => {
    const conflictAlert = () =>
      [
        ...container.querySelectorAll(
          "[data-suggestion-id='one'] [role='alert']",
        ),
      ].find((alert) => alert.textContent === "editor.toolbar.conflict");
    const failed = proposalSuggestion("one");
    const options = {
      activeSuggestionId: "one",
      alignToAnchors: false,
      unplaceableSuggestionRevisions: new Map([["one", failed.revision]]),
    };
    render(null, [], "inline", { ...options, suggestions: [failed] });
    expect(conflictAlert()).toBeDefined();
    render(null, [], "inline", {
      ...options,
      suggestions: [{ ...failed, revision: failed.revision + 1 }],
    });
    expect(conflictAlert()).toBeUndefined();
  });
  it.each([
    ["inline", "one", false],
    ["history", null, false],
    ["history", null, true],
  ] as const)(
    "preserves AI attribution in %s presentation (selected: %s, resolved: %s)",
    (presentation, selected, resolved) => {
      const attributed = thread("one", resolved);
      attributed.comments[0].submission_source = "mcp";
      render(selected, [attributed], presentation);
      if (resolved) act(() => panel.setHistoryStatus("all"));
      expect(
        container.querySelector('[data-comment-ai-attribution="mcp"]'),
      ).not.toBeNull();
      expect(container.querySelector("[data-comments-sidebar]")).not.toBeNull();
      attributed.comments[0].submission_source = "frontend";
      render(selected, [attributed], presentation);
      expect(
        container.querySelector("[data-comment-ai-attribution]"),
      ).toBeNull();
    },
  );

  it("names the MCP client that posted a comment on its Agent pill", () => {
    const postedFrom = (client: string | null): CommentThread => {
      const base = thread("one");
      return {
        ...base,
        comments: base.comments.map((comment, index) =>
          index === 0
            ? { ...comment, submission_source: "mcp", author_client: client }
            : comment,
        ),
      };
    };
    render(null, [postedFrom("claude-code")], "inline");
    expect(
      container.querySelector('[data-comment-ai-client="claude-code"]')
        ?.textContent,
    ).toContain("Claude Code");
    render(null, [postedFrom(null)], "inline");
    expect(container.querySelector("[data-comment-ai-client]")).toBeNull();
    expect(
      container.querySelector('[data-comment-ai-attribution="mcp"]')
        ?.textContent,
    ).toContain("comments.agentBadge");
  });

  it("tells an MCP agent's suggestion from the app agent's, by client", () => {
    const agent = (
      id: string,
      author: Pick<ResourceSuggestion, "authorSource" | "authorClient"> &
        Partial<Pick<ResourceSuggestion, "authorEmail">>,
    ): ResourceSuggestion => ({
      ...proposalSuggestion(id),
      proposalId: id,
      actorKind: "agent",
      ...author,
    });
    render(null, [], "inline", {
      suggestions: [
        agent("one", {
          authorSource: "mcp",
          authorClient: "codex",
          authorEmail: "writer@example.test",
        }),
        agent("two", { authorSource: "agent", authorClient: null }),
      ],
    });
    const badge = (id: string) =>
      container.querySelector(
        `[data-suggestion-id='${id}'] [data-comment-ai-attribution]`,
      );
    expect(badge("one")?.getAttribute("data-comment-ai-attribution")).toBe(
      "mcp",
    );
    expect(badge("one")?.getAttribute("data-comment-ai-client")).toBe("codex");
    expect(badge("one")?.textContent).toContain("Codex");
    expect(
      badge("one")?.querySelector("[aria-label]")?.getAttribute("aria-label"),
    ).toContain("comments.aiAttribution:Writer.");
    expect(
      container.querySelector("[data-suggestion-id='one']")?.textContent,
    ).toContain("Writer");
    expect(badge("two")?.getAttribute("data-comment-ai-attribution")).toBe(
      "agent",
    );
    expect(badge("two")?.textContent).toContain("comments.agentBadge");
  });

  /** Thread one, which AI has just changed and resolved. */
  function appliedResolution() {
    const applied: CommentAiRequest = {
      operationId: "request-one",
      requestId: "request-one",
      documentId: "fixture",
      threadId: "one",
      rootCommentId: "one-root",
      intent: "apply-resolve",
      status: "resolved",
      attemptId: null,
      attemptCount: 1,
      runId: null,
      agentThreadId: null,
      agentTurnId: null,
      model: "claude-sonnet-5",
      engine: "anthropic",
      result: {
        editApplied: true,
        resolved: true,
        undoable: true,
        changes: [{ before: "soft labels", after: "blurry labels" }],
      },
      errorCode: null,
      error: null,
      createdAt: "2026-09-04T12:00:00Z",
      updatedAt: "2026-09-04T12:01:00Z",
    };
    const dismissResolution = vi.fn();
    const commentAi = {
      requests: [applied],
      serverRequests: [applied],
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
      freshResolutions: new Map([["one", applied]]),
      dismissResolution,
    } satisfies CommentAiController;
    return { commentAi, dismissResolution, resolved: [thread("one", true)] };
  }
  const pointerOver = (element: Element) =>
    act(() => {
      element.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });
  const pointerOut = (element: Element) =>
    act(() => {
      element.dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          pointerType: "mouse",
          relatedTarget: document.body,
        }),
      );
    });
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it("keeps a thread AI just resolved as a mark, then reopens its result", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { commentAi, dismissResolution, resolved } = appliedResolution();
    const onActivateThread = vi.fn();

    render(null, resolved, "inline", { commentAi, onActivateThread });
    const mark = container.querySelector<HTMLButtonElement>(
      '[data-comment-ai-resolved-mark="one"]',
    );
    expect(mark?.textContent).toContain("comments.aiResolvedByAi");
    act(() => mark!.click());
    expect(onActivateThread).toHaveBeenCalledWith("one");
    wait(AI_RESOLVED_MARK_HOLD_MS + AI_RESOLVED_MARK_FADE_MS);
    expect(dismissResolution).toHaveBeenCalledWith("one");

    render("one", resolved, "inline", { commentAi, onActivateThread });
    expect(
      container.querySelector("[data-comment-ai-resolved-mark]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-comment-ai-change]")?.textContent,
    ).toContain("blurry");
    // Opening it from the mark took the mark's focus away, so the card has it.
    expect(document.activeElement).toBe(
      container.querySelector('[data-thread-card="one"]'),
    );
    dismissResolution.mockClear();
    act(() =>
      container
        .querySelector<HTMLButtonElement>("[data-comment-ai-done]")!
        .click(),
    );
    expect(dismissResolution).toHaveBeenCalledWith("one");
  });

  it("folds a result AI applied into its mark once the card is left alone", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { commentAi, resolved } = appliedResolution();
    const onSelectedThreadChange = vi.fn();
    // The card is open while AI works, then its result arrives.
    render("one", [thread("one")], "inline", {
      commentAi: { ...commentAi, freshResolutions: new Map() },
      onSelectedThreadChange,
    });
    wait(AI_RESULT_LEFT_ALONE_MS * 3);
    expect(onSelectedThreadChange).not.toHaveBeenCalled();
    render("one", resolved, "inline", { commentAi, onSelectedThreadChange });
    const card = container.querySelector('[data-thread-card="one"]');
    if (!card) throw new Error("No result card");

    wait(AI_RESULT_LEFT_ALONE_MS - 100);
    expect(onSelectedThreadChange).not.toHaveBeenCalled();
    // A pointer on the card holds it, and leaving starts the count over.
    pointerOver(card);
    wait(AI_RESULT_LEFT_ALONE_MS * 3);
    expect(onSelectedThreadChange).not.toHaveBeenCalled();
    pointerOut(card);
    wait(AI_RESULT_LEFT_ALONE_MS - 100);
    expect(onSelectedThreadChange).not.toHaveBeenCalled();
    wait(100);
    expect(onSelectedThreadChange).toHaveBeenCalledWith(null);

    // Keyboard focus holds it the same way.
    render(null, resolved, "inline", { commentAi, onSelectedThreadChange });
    render("one", resolved, "inline", { commentAi, onSelectedThreadChange });
    onSelectedThreadChange.mockClear();
    const done = container.querySelector<HTMLButtonElement>(
      "[data-comment-ai-done]",
    );
    if (!done) throw new Error("The result has no Done");
    act(() => done.focus());
    wait(AI_RESULT_LEFT_ALONE_MS * 3);
    expect(onSelectedThreadChange).not.toHaveBeenCalled();
    act(() => done.blur());
    wait(AI_RESULT_LEFT_ALONE_MS);
    expect(onSelectedThreadChange).toHaveBeenCalledWith(null);
  });

  it("keeps a resolved thread someone opened, which AI didn't just resolve", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onSelectedThreadChange = vi.fn();
    render("one", [thread("one", true)], "inline", { onSelectedThreadChange });
    wait(AI_RESULT_LEFT_ALONE_MS * 3);
    expect(onSelectedThreadChange).not.toHaveBeenCalled();
  });

  it("brings a fading Resolved by AI mark back while the pointer is on it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { commentAi, dismissResolution, resolved } = appliedResolution();
    render(null, resolved, "inline", { commentAi });
    const mark = container.querySelector<HTMLButtonElement>(
      '[data-comment-ai-resolved-mark="one"]',
    );
    if (!mark) throw new Error("No Resolved by AI mark");

    expect(mark.hasAttribute("data-fading")).toBe(false);
    wait(AI_RESOLVED_MARK_HOLD_MS);
    expect(mark.hasAttribute("data-fading")).toBe(true);
    pointerOver(mark);
    expect(mark.hasAttribute("data-fading")).toBe(false);
    wait(AI_RESOLVED_MARK_HOLD_MS * 3);
    expect(dismissResolution).not.toHaveBeenCalled();
    expect(mark.hasAttribute("data-fading")).toBe(false);

    // Leaving starts it over: it holds, fades, and goes.
    pointerOut(mark);
    wait(AI_RESOLVED_MARK_HOLD_MS - 100);
    expect(mark.hasAttribute("data-fading")).toBe(false);
    wait(100);
    expect(mark.hasAttribute("data-fading")).toBe(true);
    expect(dismissResolution).not.toHaveBeenCalled();
    wait(AI_RESOLVED_MARK_FADE_MS);
    expect(dismissResolution).toHaveBeenCalledWith("one");
  });

  /** Thread one's AI request, finished with the suggestion it names. */
  const suggestedRequest = (
    suggestionId: string,
    operationId = "request-one",
    updatedAt = "2026-10-20T12:01:00Z",
  ): CommentAiController["requests"][number] => ({
    operationId,
    requestId: operationId,
    documentId: "fixture",
    threadId: "one",
    rootCommentId: "one-root",
    intent: "suggest",
    status: "suggested",
    attemptId: null,
    attemptCount: 1,
    runId: null,
    agentThreadId: null,
    agentTurnId: null,
    model: "claude-haiku-5-5",
    engine: "anthropic",
    result: { suggestionId },
    errorCode: null,
    error: null,
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt,
  });
  const commentAiWithRequests = (
    requests: CommentAiController["requests"],
  ): CommentAiController => ({
    requests,
    serverRequests: requests,
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
  });
  const suggestedCommentAi = (suggestionId: string) =>
    commentAiWithRequests([suggestedRequest(suggestionId)]);

  describe("Accept, then Resolve", () => {
    const asked = (id: string, status: ResourceSuggestion["status"]) => ({
      ...proposalSuggestion(id, status),
      metadata: { sourceThreadId: "one", commentAiRequestId: "request-one" },
    });
    const decide = vi.fn();
    const show = (status: ResourceSuggestion["status"]) =>
      render("one", [thread("one")], "inline", {
        suggestions: [asked("first", status), asked("second", status)],
        onDecideSuggestionProposal: decide,
      });
    const resolveButtons = () =>
      container.querySelectorAll<HTMLButtonElement>(
        "[data-thread-suggestion-resolve] button",
      );

    it("accepts the edits and leaves the thread open", () => {
      show("pending");
      const accept = container.querySelector<HTMLButtonElement>(
        "[data-suggestion-proposal-decision='accepted']",
      );
      if (!accept) throw new Error("The proposal has no Accept");
      expect(accept.textContent).toBe("comments.acceptEdits");
      expect(resolveButtons()).toHaveLength(0);
      act(() => accept.click());
      expect(decide).toHaveBeenCalledWith(
        "proposal",
        "accepted",
        expect.arrayContaining([
          expect.objectContaining({ id: "first" }),
          expect.objectContaining({ id: "second" }),
        ]),
      );

      show("accepted");
      expect(actions.resolve).not.toHaveBeenCalled();
      expect(
        container.querySelector("[data-thread-suggestion-decided]"),
      ).not.toBeNull();
      expect(container.textContent).toContain("comments.replyToKeepGoing");
    });

    it("resolves the thread from its own Resolve once the edits are decided", () => {
      show("accepted");
      const resolve = container.querySelector<HTMLButtonElement>(
        "[data-thread-suggestion-resolve] button",
      );
      if (!resolve) throw new Error("The decided group has no Resolve");
      act(() => resolve.click());
      expect(actions.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ id: "one-root", resolved: true }),
      );
    });

    it("offers one Resolve, once no group in the thread is pending", () => {
      const later = (status: ResourceSuggestion["status"]) => ({
        ...asked("third", status),
        proposalId: null,
      });
      const showBoth = (status: ResourceSuggestion["status"]) =>
        render("one", [thread("one")], "inline", {
          suggestions: [
            asked("first", "accepted"),
            asked("second", "accepted"),
            later(status),
          ],
          onDecideSuggestionProposal: decide,
        });

      showBoth("pending");
      expect(resolveButtons()).toHaveLength(0);

      showBoth("rejected");
      expect(resolveButtons()).toHaveLength(1);
    });

    it("offers no Resolve while its AI's newer edit is still loading", () => {
      const showLoading = (awaited: ReadonlySet<string>) =>
        render("one", [thread("one")], "inline", {
          suggestions: [
            asked("first", "accepted"),
            asked("second", "accepted"),
          ],
          onDecideSuggestionProposal: decide,
          commentAi: suggestedCommentAi("fresh"),
          awaitedSuggestionIds: awaited,
        });

      showLoading(new Set(["fresh"]));
      expect(
        container.querySelector("[data-thread-suggestion-placeholder]"),
      ).not.toBeNull();
      expect(resolveButtons()).toHaveLength(0);

      showLoading(new Set());
      expect(resolveButtons()).toHaveLength(1);
    });

    it("offers no Resolve until Accept has saved", () => {
      const showSaving = (saving: boolean) =>
        render("one", [thread("one")], "inline", {
          suggestions: [
            asked("first", "accepted"),
            asked("second", "accepted"),
          ],
          onDecideSuggestionProposal: decide,
          decidingSuggestion: (id) => saving && id === "first",
        });

      showSaving(true);
      expect(
        container.querySelector("[data-thread-suggestion-decided]"),
      ).not.toBeNull();
      expect(resolveButtons()).toHaveLength(0);

      showSaving(false);
      expect(resolveButtons()).toHaveLength(1);
    });

    it("marks each edit it steps to on the page", () => {
      const onStepThreadSuggestion = vi.fn();
      render("one", [thread("one")], "inline", {
        suggestions: ["first", "second", "third", "fourth"].map((id) =>
          asked(id, "pending"),
        ),
        onDecideSuggestionProposal: decide,
        onStepThreadSuggestion,
      });

      const shown = () =>
        [...container.querySelectorAll("[data-thread-suggestion]")].map(
          (edit) => edit.getAttribute("data-thread-suggestion"),
        );
      const [first] = shown();
      expect(shown()).toHaveLength(1);
      act(() =>
        container
          .querySelector<HTMLButtonElement>('[data-suggestion-step="next"]')
          ?.click(),
      );
      const [next] = shown();
      expect(next).not.toBe(first);
      expect(onStepThreadSuggestion).toHaveBeenCalledWith("one", next);
    });

    it("selects the thread a step comes from and marks its edit, without moving focus to Reply", async () => {
      const onActivateThread = vi.fn();
      const onStepThreadSuggestion = vi.fn();
      const askedInTwo = (id: string) => ({
        ...proposalSuggestion(id),
        metadata: { sourceThreadId: "two", commentAiRequestId: "request-two" },
      });
      render("one", [thread("one"), thread("two")], "inline", {
        suggestions: ["first", "second", "third", "fourth"].map(askedInTwo),
        onDecideSuggestionProposal: decide,
        onActivateThread,
        onStepThreadSuggestion,
      });
      const next = container.querySelector<HTMLButtonElement>(
        '[data-thread-card="two"] [data-suggestion-step="next"]',
      );
      if (!next) throw new Error("Thread two has no Next");

      next.focus();
      act(() => next.click());
      render("two", [thread("one"), thread("two")], "inline", {
        suggestions: ["first", "second", "third", "fourth"].map(askedInTwo),
        onDecideSuggestionProposal: decide,
        onActivateThread,
        onStepThreadSuggestion,
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

      expect(onActivateThread).toHaveBeenCalledWith("two");
      const shown = container.querySelector(
        '[data-thread-card="two"] [data-thread-suggestion]',
      );
      expect(onStepThreadSuggestion).toHaveBeenCalledWith(
        "two",
        shown?.getAttribute("data-thread-suggestion"),
      );
      expect(document.activeElement).toBe(next);
    });

    describe("Arrivals in an open card", () => {
      const entry = (id: string) => {
        const root = thread("one").comments.find(
          (comment) => comment.id === "one-root",
        );
        if (!root) throw new Error("The fixture thread has no comment");
        return { ...root, id, parent_id: "one-root", content: `Entry ${id}` };
      };
      const withEntries = (...ids: string[]): CommentThread[] => [
        {
          ...thread("one"),
          comments: [...thread("one").comments, ...ids.map(entry)],
        },
      ];
      const entryTops: Record<string, number> = { "one-root": 0 };
      const GROUP = { top: 500, bottom: 800 };
      const BODY_HEIGHT = 384;
      const DECISION_HEIGHT = 48;
      let restoreRect = () => {};
      beforeEach(() => {
        const rect = vi
          .spyOn(HTMLElement.prototype, "getBoundingClientRect")
          .mockImplementation(function (this: HTMLElement) {
            const body = this.closest<HTMLElement>(
              "[data-comment-thread-body]",
            );
            const scrolled = body?.scrollTop ?? 0;
            const at = (top: number, bottom = top) =>
              DOMRect.fromRect({
                x: 0,
                y: top,
                width: 0,
                height: bottom - top,
              });
            if (this.hasAttribute("data-comment-thread-body"))
              return at(0, BODY_HEIGHT);
            const entryId = this.getAttribute("data-comment-entry");
            if (entryId) return at((entryTops[entryId] ?? 0) - scrolled);
            if (this.hasAttribute("data-suggestion-proposal"))
              return at(GROUP.top - scrolled, GROUP.bottom - scrolled);
            if (this.hasAttribute("data-suggestion-group-decision")) {
              const top = Math.min(
                GROUP.bottom - 8 - scrolled,
                BODY_HEIGHT - DECISION_HEIGHT,
              );
              return at(top, top + DECISION_HEIGHT);
            }
            return at(0);
          });
        restoreRect = () => rect.mockRestore();
      });
      afterEach(() => restoreRect());
      const pendingIn = (ids: string[]) =>
        ids.map((id) => asked(id, "pending"));
      const body = () => {
        const found = container.querySelector<HTMLElement>(
          '[data-thread-card="one"] [data-comment-thread-body]',
        );
        if (!found) throw new Error("Thread one has no body");
        Object.defineProperty(found, "scrollHeight", {
          configurable: true,
          value: 1200,
        });
        Object.defineProperty(found, "clientHeight", {
          configurable: true,
          value: BODY_HEIGHT,
        });
        return found;
      };

      it("shows the pending group of an entry that just arrived, not the entry's start", () => {
        render("one", withEntries(), "inline", {
          onDecideSuggestionProposal: decide,
        });
        const scroller = body();
        const scrollTo = vi.fn();
        scroller.scrollTo = scrollTo;

        entryTops.answer = 450;
        render("one", withEntries("answer"), "inline", {
          suggestions: pendingIn(["first", "second", "third", "fourth"]),
          onDecideSuggestionProposal: decide,
        });

        expect(scrollTo).not.toHaveBeenCalled();
        expect(scroller.scrollTop).toBe(
          GROUP.bottom - (BODY_HEIGHT - DECISION_HEIGHT),
        );
      });

      it("leaves a reader who scrolled alone until something new arrives", () => {
        render("one", withEntries(), "inline", {
          suggestions: pendingIn(["first", "second", "third", "fourth"]),
          onDecideSuggestionProposal: decide,
        });
        const scroller = body();
        scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        scroller.scrollTop = 100;

        render("one", withEntries(), "inline", {
          suggestions: [
            ...pendingIn(["first", "second", "third", "fourth"]),
            { ...asked("later", "pending"), proposalId: null },
          ],
          onDecideSuggestionProposal: decide,
        });
        expect(scroller.scrollTop).toBe(100);

        entryTops.answer = 450;
        render("one", withEntries("answer"), "inline", {
          suggestions: [
            ...pendingIn(["first", "second", "third", "fourth"]),
            { ...asked("later", "pending"), proposalId: null },
          ],
          onDecideSuggestionProposal: decide,
        });
        expect(scroller.scrollTop).toBe(
          GROUP.bottom - (BODY_HEIGHT - DECISION_HEIGHT),
        );
      });
    });

    it("offers no resolve while an earlier request's edit is still loading", () => {
      const retryRead = vi.fn();
      const showEarlier = (
        awaited: ReadonlySet<string>,
        unreadable: ReadonlySet<string> = new Set(),
      ) =>
        render("one", [thread("one")], "inline", {
          suggestions: [
            asked("first", "accepted"),
            asked("second", "accepted"),
          ],
          onDecideSuggestionProposal: decide,
          commentAi: commentAiWithRequests([
            suggestedRequest(
              "earlier",
              "request-earlier",
              "2026-10-20T11:00:00Z",
            ),
            { ...suggestedRequest("first"), status: "replied" },
          ]),
          awaitedSuggestionIds: awaited,
          unreadableSuggestionIds: unreadable,
          onRetrySuggestionRead: retryRead,
        });

      showEarlier(new Set(["earlier"]));
      expect(resolveButtons()).toHaveLength(0);
      expect(
        container.querySelector("[data-thread-suggestion-placeholder]"),
      ).not.toBeNull();

      // The thread stays open on its read, so a failed one offers a retry.
      showEarlier(new Set(["earlier"]), new Set(["earlier"]));
      const failed = container.querySelector(
        '[data-thread-suggestion-placeholder="failed"]',
      );
      act(() => failed?.querySelector("button")?.click());
      expect(retryRead).toHaveBeenCalled();

      showEarlier(new Set());
      expect(
        container.querySelector("[data-thread-suggestion-placeholder]"),
      ).toBeNull();
      expect(resolveButtons()).toHaveLength(1);
    });
  });

  describe("Reply focus on opening a thread", () => {
    it("opens a thread from a link without putting focus in its empty Reply", () => {
      render(null, [thread("one")]);
      replyState.markLinkedThread("one");
      render("one", [thread("one")]);

      expect(replyState.openReply?.threadId).toBe("one");
      expect(replyState.focus.current).toBeNull();
      expect(replyState.linkedThread.current).toBeNull();
    });

    it("focuses a linked thread's Reply that already has words in it", () => {
      render(null, [thread("one")]);
      act(() => replyState.setText("one", "Half a thought"));
      replyState.markLinkedThread("one");
      render("one", [thread("one")]);

      expect(replyState.focus.current?.threadId).toBe("one");
    });

    it("focuses Reply when someone opens the thread themselves", () => {
      render(null, [thread("one")]);
      render("one", [thread("one")]);

      expect(replyState.focus.current?.threadId).toBe("one");
    });

    it.each([
      ["drops", "", null],
      ["keeps", "Half a thought", "one"],
    ])(
      "%s a Reply's focus record when the page changes, with %j in it",
      (_, text, kept) => {
        const show = (documentId: string) =>
          act(() =>
            root.render(
              <CommentDraftProvider
                documentId="fixture"
                currentUserEmail="reviewer@example.test"
              >
                <ReplyDraftsProbe documentId={documentId} />
              </CommentDraftProvider>,
            ),
          );
        const focusedThreadId = () =>
          replyState.focus.current?.threadId ?? null;
        show("fixture");
        if (text) act(() => replyState.setText("one", text));
        replyState.focus.current = { documentId: "fixture", threadId: "one" };
        show("other");

        expect(focusedThreadId()).toBe(kept);
      },
    );
  });

  it("holds a suggested request's place until its suggestion loads", () => {
    const commentAi = suggestedCommentAi("suggestion-one");

    render("one", [thread("one")], "inline", {
      commentAi,
      awaitedSuggestionIds: new Set(["suggestion-one"]),
    });
    expect(
      container.querySelector("[data-thread-suggestion-placeholder]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-comment-ai-status]")).toBeNull();

    // A failed read can't say the suggestion is gone; it offers a retry.
    const retryRead = vi.fn();
    render("one", [thread("one")], "inline", {
      commentAi,
      awaitedSuggestionIds: new Set(["suggestion-one"]),
      unreadableSuggestionIds: new Set(["suggestion-one"]),
      onRetrySuggestionRead: retryRead,
    });
    const failed = container.querySelector(
      '[data-thread-suggestion-placeholder="failed"]',
    );
    expect(failed?.textContent).toContain("comments.suggestionLoadFailed");
    act(() => failed?.querySelector("button")?.click());
    expect(retryRead).toHaveBeenCalled();

    // Read and still absent: nothing to wait for, and nothing to review.
    render("one", [thread("one")], "inline", { commentAi });
    expect(
      container.querySelector("[data-thread-suggestion-placeholder]"),
    ).toBeNull();
    expect(container.querySelector("[data-comment-ai-status]")).toBeNull();
  });

  const commentAiWith = (start: CommentAiController["start"]) =>
    ({
      requests: [],
      serverRequests: [],
      startingThreadIds: new Set<string>(),
      stoppingRequestIds: new Set<string>(),
      continuations: new Map(),
      transcriptRevision: 0,
      start,
      continue: vi.fn(),
      retry: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      open: vi.fn(),
      undo: vi.fn(),
      freshResolutions: new Map(),
      dismissResolution: vi.fn(),
    }) satisfies CommentAiController;
  const clickAiSend = () => {
    const send = container.querySelector<HTMLButtonElement>(
      "[data-comment-ai-send-mode]",
    );
    if (!send) throw new Error("The composer has no AI send button");
    // Send names the response it asks for, not a bare "Send".
    expect(send.getAttribute("data-comment-ai-send-mode")).toBe("suggest");
    expect(send.textContent).toBe("comments.aiSendSuggest");
    expect(send.getAttribute("aria-label")).toBe("comments.aiSendMode");
    return act(async () => send.click());
  };

  const sendAiReply = async (
    start: CommentAiController["start"],
    { removeFails = false } = {},
  ) => {
    actions.modelsReady = true;
    actions.create.mockResolvedValue({ id: "reply-1", threadId: "one" });
    if (removeFails) actions.remove.mockRejectedValue(new Error("lost"));
    else actions.remove.mockResolvedValue(undefined);
    render("one", undefined, "inline", { commentAi: commentAiWith(start) });
    await type("actually, make it Thursday");
    act(() =>
      replyDraft.setAiDraft({
        mode: "suggest",
        selection: { model: "model", engine: "engine", provider: "provider" },
      }),
    );
    // The composer places the AI mention chip a tick after the AI is chosen.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const sent = replyDraft.draft.text;
    expect(sent).toContain("actually, make it Thursday");
    await clickAiSend();
    expect(actions.create).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "one",
        instructions: sent.trim(),
      }),
    );
    return sent;
  };

  it("stores an AI reply's mentions in text order when a person shares the agent's name", async () => {
    const selection = { model: "Ada", engine: "engine", provider: "provider" };
    const agent = { kind: "agent" as const, ...selection, name: "Ada" };
    const person = { email: "ada@example.test", name: "Ada" };
    actions.modelsReady = true;
    actions.create.mockResolvedValue({ id: "reply-1", threadId: "one" });
    render("one", undefined, "inline", {
      commentAi: commentAiWith(vi.fn().mockResolvedValue("confirmed-start")),
    });
    act(() => {
      replyDraft.setText("@Ada asked @Ada");
      replyDraft.setMentions([agent, person]);
      replyDraft.setAiDraft({ mode: "suggest", selection });
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await clickAiSend();

    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "@Ada asked @Ada",
        mentions: serializeStoredCommentMentions([
          agent,
          { kind: "person", ...person },
        ]),
      }),
    );
  });

  it("takes back an AI reply and restores its draft when AI is already busy", async () => {
    const sent = await sendAiReply(vi.fn().mockResolvedValue("busy"));

    expect(actions.remove).toHaveBeenCalledWith({
      id: "reply-1",
      documentId: "fixture",
    });
    expect(replyDraft.draft.text).toBe(sent);
    expect(notify).toHaveBeenCalledWith("comments.aiBusyInThread");
  });

  it("says AI is still working when Send to AI comes during its run", async () => {
    const start = vi.fn();
    actions.modelsReady = true;
    render("one", undefined, "inline", {
      commentAi: {
        ...commentAiWith(start),
        startingThreadIds: new Set(["one"]),
      },
    });
    await type("one more thing");
    act(() =>
      replyDraft.setAiDraft({
        mode: "suggest",
        selection: { model: "model", engine: "engine", provider: "provider" },
      }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await clickAiSend();

    expect(notify).toHaveBeenCalledWith("comments.aiBusyInThread");
    expect(actions.create).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(replyDraft.draft.text).toContain("one more thing");
  });

  it("restores the draft of a busy AI reply even when taking the reply back fails", async () => {
    const sent = await sendAiReply(vi.fn().mockResolvedValue("busy"), {
      removeFails: true,
    });

    expect(actions.remove).toHaveBeenCalledOnce();
    expect(replyDraft.draft.text).toBe(sent);
  });

  it("keeps a busy AI reply when a newer reply was typed while it was sent", async () => {
    let answer!: (outcome: "busy") => void;
    const start = vi.fn(
      () => new Promise<"busy">((resolve) => (answer = resolve)),
    );
    const sending = sendAiReply(start);
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    act(() => replyDraft.setText("a newer thought"));
    await act(async () => answer("busy"));
    await sending;

    expect(actions.remove).not.toHaveBeenCalled();
    expect(replyDraft.draft.text).toBe("a newer thought");
  });

  it("keeps an AI reply when starting AI fails, since the request may have been saved", async () => {
    await sendAiReply(vi.fn().mockRejectedValue(new Error("network lost")));

    expect(actions.remove).not.toHaveBeenCalled();
    expect(replyDraft.draft.text).toBe("");
  });
  it("preserves a reply through thread switches and panel presentation remounts", async () => {
    render("one");
    await type("Unsent detailed feedback");
    render("two");
    await type("Different draft");
    render(null, undefined, "history");
    render("one");
    expect(richEditorValue(richEditor(container)!)).toBe(
      "Unsent detailed feedback",
    );
    render("two");
    expect(richEditorValue(richEditor(container)!)).toBe("Different draft");
  });
  it("does not clear newer typing when an older reply settles", async () => {
    render("one");
    await type("First submitted draft");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(actions.create).toHaveBeenCalledOnce();
    expect(richEditorValue(richEditor(container)!)).toBe("");
    await type("Newer unsent draft");
    await act(async () =>
      resolveCreate({
        id: "saved",
        threadId: "one",
      }),
    );
    expect(richEditorValue(richEditor(container)!)).toBe("Newer unsent draft");
  });
  it.each([false, true])(
    "clears only the submitted revision after ambiguous reconciliation (new mentions: %s)",
    async (addMentions) => {
      render("one");
      await type("Hello @Reviewer");
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
      expect(replyDraft.draft.text).toBe("");
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
      await type("Anchor A draft");
      await act(async () => {
        const submit = [...container.querySelectorAll("button")].find(
          (button) => button.getAttribute("aria-label") === "comments.submit",
        )!;
        submit.click();
      });
      render(null, [], "inline", {
        key: "anchor-b",
        pending: true,
        onPendingDone,
      });
      if (newer) await type("Anchor B draft");
      await act(async () =>
        resolveCreate({ id: "saved-a", threadId: "thread-a" }),
      );
      expect(onPendingDone).not.toHaveBeenCalled();
      expect(richEditorValue(richEditor(container)!)).toBe(
        newer ? "Anchor B draft" : "",
      );
    },
  );

  it("writes new comments under the signed-in person's profile name", () => {
    render("one");
    expect(actions.authors.length).toBeGreaterThan(1);
    for (const author of actions.authors) {
      expect(author).toEqual({
        email: "reviewer@example.test",
        name: "Rae Viewer",
      });
    }
  });

  it("shows the profile name on the reply and page comment boxes", () => {
    render("one");
    expect(
      container
        .querySelector("[data-comment-reply-composer] [title]")
        ?.getAttribute("title"),
    ).toBe("Rae Viewer");
    act(() => root.unmount());
    root = createRoot(container);
    render(null, [thread("one")], "history");
    expect(
      container
        .querySelector("[data-discussion-composer] [title]")
        ?.getAttribute("title"),
    ).toBe("Rae Viewer");
  });

  it("prevents duplicate submits in a pending thread", async () => {
    render("one");
    await type("First draft");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await type("Second draft");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(actions.create).toHaveBeenCalledOnce();
    expect(richEditorValue(richEditor(container)!)).toBe("Second draft");
  });

  it("allows another thread to submit while a reply save is pending", async () => {
    render("one");
    await type("First thread reply");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    render("two");
    await type("Second thread reply");
    act(() =>
      (
        container.querySelector(
          '[aria-label="comments.submit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(actions.create).toHaveBeenCalledTimes(2);
    expect(
      actions.create.mock.calls.map(([payload]) => payload.threadId),
    ).toEqual(["one", "two"]);
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
    await type("unsent reply");
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
    // Resolving in the margin closes the reply box with its card. A box
    // opened while the resolve waits stays blocked until it settles.
    expect(
      container.querySelector('[aria-label="comments.submit"]'),
    ).toBeNull();
    render("one", undefined, "inline", { key: "remounted-sidebar" });
    const remountedSubmit = container.querySelector(
      '[aria-label="comments.submit"]',
    ) as HTMLButtonElement;
    expect(remountedSubmit.disabled).toBe(true);
    await act(async () => rejectResolution(new Error("resolution rejected")));
    expect(remountedSubmit.disabled).toBe(false);
    expect(richEditorValue(richEditor(container)!)).toBe("unsent reply");
  });

  it("lets users clear their own reply text without extra controls", async () => {
    render("one");
    await type("Keep me");
    render("two");
    await type("Discard me");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) =>
          !button.classList.contains("sr-only") &&
          (button.textContent === "comments.discardDraft" ||
            button.textContent === "comments.reply"),
      ),
    ).toBe(false);
    await type("");
    expect(richEditorValue(richEditor(container)!)).toBe("");
    render("one");
    expect(richEditorValue(richEditor(container)!)).toBe("Keep me");
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
    const reopen = [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "comments.reopen",
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
    expect(container.textContent).toContain("comments.discussionEmpty");
    expect(container.textContent).not.toContain("comments.noFilteredComments");
  });

  it("keeps the selected resolved conversation inline until selection changes", () => {
    render("one", [thread("one", true), thread("two", true)]);
    expect(container.querySelector('[data-thread-card="one"]')).not.toBeNull();
    expect(container.querySelector('[data-thread-card="two"]')).toBeNull();
    expect(richEditor(container)).toBeNull();
    expect(
      container.querySelector('[aria-label="comments.reopen"]'),
    ).not.toBeNull();
    expect(panel.historyStatus).toBe("open");
    render(null, [thread("one", true), thread("two", true)]);
    expect(container.querySelector('[data-thread-card="one"]')).toBeNull();
    expect(panel.historyStatus).toBe("open");
  });

  it("moves an earlier thread above the new-comment composer instead of under it", () => {
    const scroll = document.createElement("div");
    scroll.innerHTML =
      '<div class="ProseMirror"><p><mark data-comment-thread="one">first</mark></p><p><mark class="comment-highlight--pending">second</mark></p></div>';
    document.body.append(scroll);
    const box = (top: number, height: number) =>
      ({
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 100,
        width: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const rects = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.matches('[data-comment-thread="one"]')) return box(100, 20);
        if (this.matches(".comment-highlight--pending")) return box(140, 20);
        if (this.matches('[data-thread-card="one"]')) return box(0, 100);
        if (this.matches("[data-comment-pending]")) return box(0, 120);
        return box(0, 0);
      });
    try {
      render(null, [thread("one")], "inline", {
        pending: true,
        alignToAnchors: true,
        scrollContainer: scroll,
      });
      const composer = container.querySelector<HTMLElement>(
        "[data-comment-pending]",
      )!;
      const earlier = container.querySelector<HTMLElement>(
        '[data-comment-layout-thread="one"]',
      )!;
      // The thread rests at its anchor (100) and lifts to end 12px above the
      // composer, which keeps its own anchor (140).
      expect(composer.style.top).toBe("140px");
      expect(earlier.style.marginTop).toBe("100px");
      expect(earlier.style.transform).toBe("translateY(-72px)");
    } finally {
      rects.mockRestore();
      scroll.remove();
    }
  });
});

describe("agentSuggestionReason", () => {
  const base = (
    overrides: Partial<ResourceSuggestion> = {},
  ): ResourceSuggestion => ({
    ...proposalSuggestion("one"),
    actorKind: "agent",
    proposalSummary: "Use American spelling, like the rest of the page.",
    summary: 'Replace "colour" with "color"',
    metadata: { sourceFind: "colour", sourceReplace: "color" },
    ...overrides,
  });
  it("returns the reason an agent wrote", () => {
    expect(agentSuggestionReason(base())).toBe(
      "Use American spelling, like the rest of the page.",
    );
    expect(
      agentSuggestionReason(
        base({ proposalId: null, proposalSummary: null, summary: "Typo." }),
      ),
    ).toBe("Typo.");
  });
  it("skips people's suggestions", () => {
    expect(agentSuggestionReason(base({ actorKind: "human" }))).toBeNull();
  });
  it("skips the summary written for an agent that gave no reason", () => {
    expect(
      agentSuggestionReason(
        base({
          proposalSummary: 'Replace "colour" with "color"',
          summary: 'Replace "a" with "A"',
        }),
      ),
    ).toBeNull();
    expect(
      agentSuggestionReason(
        base({
          proposalSummary: 'Delete "very "',
          summary: "Delete: very",
          metadata: { sourceFind: "very ", sourceReplace: "" },
        }),
      ),
    ).toBeNull();
  });
});
