import { chatModelSelectionStorageKey } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  useReviewComments,
  useReplyReviewComment,
} from "@agent-native/core/client/review";
import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import type { TiptapComposerHandle } from "@agent-native/toolkit/composer";
import {
  IconCheck,
  IconArrowBackUp,
  IconCircleCheck,
  IconCornerDownRight,
  IconFilter,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  type RefObject,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { toast } from "sonner";
export { suggestionTextForDisplay } from "@shared/suggestion-text";

import type { SuggestionPresentationContext } from "@shared/suggestion-text";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterTriggerIndicator } from "@/components/ui/filter-trigger";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateComment,
  useResolveComment,
  type CommentThread,
} from "@/hooks/use-comments";
import { useLocalStorage } from "@/hooks/use-local-storage";
import {
  useMentionMembers,
  type MentionMember,
} from "@/hooks/use-mention-members";
import { cn } from "@/lib/utils";

import type { CommentTextAnchor } from "./comment-anchors";
import {
  useCommentDraft,
  useCommentDraftContext,
  useCommentPanelSession,
  type CommentDraft,
} from "./comment-drafts";
import {
  CommentComposer,
  type CommentAiDraft,
  type CommentAiSubmitPayload,
  type MentionEntry,
} from "./CommentComposer";
import { CommentEntry } from "./CommentEntry";
import {
  CommentAgentBadge,
  CommentAvatar,
  CommentIconButton,
  CommentRow,
  renderCommentBody,
  useCommentTimestamp,
} from "./CommentRow";
export { getAiCommentSource } from "./CommentEntry";
import {
  CommentAiConversation,
  CommentAiRequestStatus,
  latestCommentAiRequest,
  startCommentAiSubmission,
  type CommentAiController,
} from "./comment-ai";
import {
  ReviewAddReactionButton,
  ReviewCommentMenu,
  ReviewReactionList,
} from "./ReviewDiscussionTools";
import type { DraftSuggestion } from "./suggestions/draft-session";
import { SuggestionText } from "./SuggestionText";

/** Where a thread card is shown; each surface shares the same rows. */
export type CommentSurface = "rail" | "popover" | "panel";

/** Per-row slots a thread passes to its entry renderer. */
interface ThreadEntrySlots {
  headerActions?: ReactNode;
  revealActions: "always" | "hover";
  /** The panel's inline "Reply" action for this row. */
  replyAction?: ReactNode;
}

/** Replies shown under the first comment before "Show earlier replies". */
const PANEL_VISIBLE_REPLIES = 2;

function renderSuggestionText(
  content: string,
  context?: SuggestionPresentationContext,
) {
  return <SuggestionText content={content} context={context} />;
}

/** Mentions whose label still appears in the text, serialized for storage. */
function mentionsJsonFor(
  text: string,
  mentions: MentionEntry[],
): string | undefined {
  const present = mentions.filter((m) => text.includes(`@${m.name}`));
  const seen = new Set<string>();
  const deduped = present.filter((m) =>
    seen.has(m.email) ? false : (seen.add(m.email), true),
  );
  return deduped.length ? JSON.stringify(deduped) : undefined;
}

function cssEscape(value: string) {
  return globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

export type CommentThreadPosition = {
  documentTop: number;
  layoutTop: number | null;
};

export function findThreadPosition(
  threadId: string,
  quotedText: string | null,
  scrollContainer: HTMLElement | null,
  layoutContainer: HTMLElement | null,
  anchorAttribute:
    | "data-comment-thread"
    | "data-suggestion-id" = "data-comment-thread",
): CommentThreadPosition | null {
  if (!scrollContainer) return null;
  const documentContent =
    (scrollContainer.querySelector(
      "[data-document-scroll-content]",
    ) as HTMLElement | null) ?? scrollContainer;
  const documentRect = documentContent.getBoundingClientRect();

  const marked = scrollContainer.querySelector(
    `${anchorAttribute === "data-suggestion-id" ? ".ProseMirror " : ""}[${anchorAttribute}="${cssEscape(threadId)}"]`,
  ) as HTMLElement | null;
  if (marked) {
    const rect = marked.getBoundingClientRect();
    return {
      documentTop: rect.top - documentRect.top,
      layoutTop: layoutContainer
        ? rect.top - layoutContainer.getBoundingClientRect().top
        : null,
    };
  }

  if (!quotedText) return null;
  const pm = scrollContainer.querySelector(".ProseMirror") as HTMLElement;
  if (!pm) return null;
  const walker = window.document.createTreeWalker(
    pm,
    NodeFilter.SHOW_TEXT,
    null,
  );
  const searchStr = quotedText.slice(0, 40);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent && node.textContent.includes(searchStr)) {
      const range = window.document.createRange();
      range.selectNode(node);
      const rect = range.getBoundingClientRect();
      return {
        documentTop: rect.top - documentRect.top,
        layoutTop: layoutContainer
          ? rect.top - layoutContainer.getBoundingClientRect().top
          : null,
      };
    }
  }
  return null;
}

export function findPendingCommentOffset(
  scrollContainer: HTMLElement | null,
  positionContainer: HTMLElement | null = scrollContainer,
): number | null {
  if (!scrollContainer) return null;
  const pending = scrollContainer.querySelector(
    ".comment-highlight--pending",
  ) as HTMLElement | null;
  if (!pending) return null;
  const containerRect = (
    positionContainer ?? scrollContainer
  ).getBoundingClientRect();
  const rect = pending.getBoundingClientRect();
  return rect.top - containerRect.top;
}

type ThreadLayoutIdentity = { threadId: string; comments: readonly unknown[] };

// Stable identities: a fresh `[]` default re-keys every downstream useMemo,
// which rebuilds the anchor observers on every render.
const NO_THREADS: CommentThread[] = [];
const NO_SUGGESTIONS: ResourceSuggestion[] = [];
const NO_DRAFT_SUGGESTIONS: DraftSuggestion[] = [];

export function estimateThreadCardHeight(thread: ThreadLayoutIdentity) {
  return 80 + Math.max(0, thread.comments.length - 1) * 44;
}

type CommentLayoutItem<T extends ThreadLayoutIdentity> = {
  thread: T;
  top: number;
  marginTop: number;
  anchorTop: number | null;
  isOrphaned: boolean;
};

export function layoutCommentThreads<T extends ThreadLayoutIdentity>(
  threads: T[],
  positions: Map<string, CommentThreadPosition>,
  heights: Map<string, number>,
  selectedThreadId: string | null | undefined,
  gap = 12,
): CommentLayoutItem<T>[] {
  const ordered = [...threads].sort((left, right) => {
    const leftTop = positions.get(left.threadId)?.documentTop ?? Infinity;
    const rightTop = positions.get(right.threadId)?.documentTop ?? Infinity;
    return leftTop - rightTop;
  });
  const anchored = ordered.filter(
    (thread) => positions.get(thread.threadId)?.layoutTop != null,
  );
  const sequential = ordered.filter(
    (thread) => positions.get(thread.threadId)?.layoutTop == null,
  );
  const tops = new Map<string, number>();
  const heightFor = (thread: T) =>
    heights.get(thread.threadId) ?? estimateThreadCardHeight(thread);
  const selectedIndex = anchored.findIndex(
    (thread) => thread.threadId === selectedThreadId,
  );

  if (selectedIndex >= 0) {
    const selected = anchored[selectedIndex];
    tops.set(
      selected.threadId,
      Math.max(0, positions.get(selected.threadId)?.layoutTop ?? 0),
    );
    for (let index = selectedIndex - 1; index >= 0; index -= 1) {
      const thread = anchored[index];
      const next = anchored[index + 1];
      const nextTop = tops.get(next.threadId) ?? 0;
      const target = positions.get(thread.threadId)?.layoutTop ?? 0;
      tops.set(
        thread.threadId,
        Math.min(target, nextTop - gap - heightFor(thread)),
      );
    }
    for (let index = selectedIndex + 1; index < anchored.length; index += 1) {
      const thread = anchored[index];
      const previous = anchored[index - 1];
      const previousBottom =
        (tops.get(previous.threadId) ?? 0) + heightFor(previous);
      const target = positions.get(thread.threadId)?.layoutTop ?? 0;
      tops.set(thread.threadId, Math.max(target, previousBottom + gap));
    }
  } else {
    let cursor = 0;
    for (const thread of anchored) {
      const target = positions.get(thread.threadId)?.layoutTop ?? 0;
      const top = Math.max(target, cursor === 0 ? 0 : cursor + gap);
      tops.set(thread.threadId, top);
      cursor = top + heightFor(thread);
    }
  }

  let cursor = anchored.reduce(
    (bottom, thread) =>
      Math.max(bottom, (tops.get(thread.threadId) ?? 0) + heightFor(thread)),
    0,
  );
  for (const thread of sequential) {
    const sectionGap =
      positions.get(thread.threadId)?.layoutTop != null ? gap : gap + 20;
    const top = cursor === 0 ? 0 : cursor + sectionGap;
    tops.set(thread.threadId, top);
    cursor = top + heightFor(thread);
  }

  let previousBottom = 0;
  return ordered.map((thread) => {
    const top = tops.get(thread.threadId) ?? previousBottom;
    const position = positions.get(thread.threadId);
    const item = {
      thread,
      top,
      marginTop: Math.max(0, top - previousBottom),
      anchorTop: position?.layoutTop ?? null,
      isOrphaned: !position,
    };
    previousBottom = top + heightFor(thread);
    return item;
  });
}

export function scrollToCommentAnchor(
  scrollContainer: HTMLElement | null,
  documentTop: number | null | undefined,
  topPadding = 72,
) {
  if (!scrollContainer || documentTop == null) return false;
  const maxScrollTop = Math.max(
    0,
    scrollContainer.scrollHeight - scrollContainer.clientHeight,
  );
  scrollContainer.scrollTo({
    top: Math.min(maxScrollTop, Math.max(0, documentTop - topPadding)),
    behavior: "smooth",
  });
  return true;
}

export function preserveCommentReplyEscape(event: KeyboardEvent) {
  // Radix handles document capture before the composer's own key handler.
  const target = event.target;
  if (
    event.key === "Escape" &&
    target instanceof HTMLElement &&
    (target instanceof HTMLTextAreaElement ||
      target.getAttribute("contenteditable") === "true") &&
    target === target.ownerDocument.activeElement &&
    target.closest("[data-comment-reply-composer]")
  ) {
    event.preventDefault();
  }
}

type CommentHistoryFilters = {
  status: "all" | "open" | "resolved";
  kind: "all" | "comments" | "suggestions";
  author: string | null;
};
const defaultHistoryFilters: CommentHistoryFilters = {
  status: "open",
  kind: "all",
  author: null,
};

export function useCommentReplyDrafts(
  documentId: string,
  currentUserEmail?: string | null,
) {
  const accountKey = currentUserEmail?.trim().toLowerCase() ?? "";
  const draftStore = useCommentDraftContext();
  const [rememberedStatus, setRememberedStatus] = useLocalStorage<
    CommentHistoryFilters["status"]
  >(`content-review-status:${JSON.stringify(accountKey)}`, "open");
  const [revealedStatus, setRevealedStatus] = useState<{
    documentId: string;
    accountKey: string;
  } | null>(null);
  const [history, setHistory] = useState({
    documentId,
    filters: defaultHistoryFilters,
  });
  const revealedHistory = useRef<string | null>(null);
  useEffect(() => {
    setHistory({ documentId, filters: defaultHistoryFilters });
    setRevealedStatus(null);
    revealedHistory.current = null;
  }, [documentId, accountKey]);
  const setHistoryFilters = useCallback(
    (filters: Partial<CommentHistoryFilters>) => {
      if (filters.status) {
        setRememberedStatus(filters.status);
        setRevealedStatus(null);
      }
      setHistory((current) => ({
        documentId,
        filters: {
          ...(current.documentId === documentId
            ? current.filters
            : defaultHistoryFilters),
          ...filters,
        },
      }));
    },
    [documentId, setRememberedStatus],
  );
  const revealHistory = useCallback(
    (conflictId: string | null, focusId: string | null) => {
      const key =
        conflictId || focusId ? `${documentId}:${conflictId}:${focusId}` : null;
      if (revealedHistory.current === key) return;
      revealedHistory.current = key;
      if (key) {
        setHistoryFilters({ kind: "all", author: null });
        setRevealedStatus({ documentId, accountKey });
      }
    },
    [documentId, accountKey, setHistoryFilters],
  );
  const [openReplies, setOpenReplies] = useState<
    Record<string, { threadId: string | null; suggestionId: string | null }>
  >({});
  const focus = useRef<{
    documentId: string;
    threadId: string;
    start?: number;
    end?: number;
    direction?: "forward" | "backward" | "none";
  } | null>(null);
  const setOpenReply = useCallback(
    (
      threadId: string | null,
      suggestionId: string | null = null,
      focusComposer = true,
    ) => {
      focus.current =
        threadId && focusComposer ? { documentId, threadId } : null;
      setOpenReplies((current) => ({
        ...current,
        [documentId]: { threadId, suggestionId },
      }));
    },
    [documentId],
  );
  const update = (
    threadId: string,
    change: (draft: CommentDraft) => CommentDraft,
  ) => {
    draftStore.updateDraft(
      `reply:${documentId}:${threadId}`,
      { text: "", mentions: [], aiDraft: null },
      change,
    );
  };
  return {
    historyFilters: {
      ...(history.documentId === documentId
        ? history.filters
        : defaultHistoryFilters),
      status:
        revealedStatus?.documentId === documentId &&
        revealedStatus.accountKey === accountKey
          ? ("all" as const)
          : rememberedStatus,
    },
    setHistoryFilters,
    revealHistory,
    openReply: openReplies[documentId],
    setOpenReply,
    focus,
    get: (threadId: string) =>
      draftStore.drafts.get(`reply:${documentId}:${threadId}`) ?? {
        text: "",
        mentions: [],
        aiDraft: null,
        revision: 0,
      },
    setText: (threadId: string, text: string) => {
      if (
        text === "" &&
        !draftStore.drafts.has(`reply:${documentId}:${threadId}`)
      )
        return;
      update(threadId, (draft) => ({ ...draft, text }));
    },
    addMention: (threadId: string, mention: MentionEntry) =>
      update(threadId, (draft) => ({
        ...draft,
        mentions: [...draft.mentions, mention],
      })),
    setAiDraft: (threadId: string, aiDraft: CommentAiDraft | null) =>
      update(threadId, (draft) => ({ ...draft, aiDraft })),
    clear: (threadId: string) =>
      update(threadId, () => ({ text: "", mentions: [], aiDraft: null })),
  };
}

export type PendingCommentSelection = {
  quotedText: string;
  offsetTop: number;
  anchor?: CommentTextAnchor;
  range?: { from: number; to: number };
};

type PendingCommentDraft = PendingCommentSelection & {
  id: symbol;
  documentId: string;
  text: string;
  mentions: MentionEntry[];
  submitting: boolean;
  focus: {
    current: {
      start?: number;
      end?: number;
      direction?: "forward" | "backward" | "none";
    } | null;
  };
};
type PendingCommentChange = (
  draft: PendingCommentDraft,
) => Partial<Pick<PendingCommentDraft, "text" | "mentions" | "submitting">>;

export function usePendingCommentDraft(documentId: string) {
  const pendingDraft = useCommentDraft("pending");
  const pendingDraftRef = useRef(pendingDraft);
  pendingDraftRef.current = pendingDraft;
  const [draft, setDraft] = useState<PendingCommentDraft | null>(null);
  const current = useRef(draft);
  const currentDocumentId = useRef(documentId);
  currentDocumentId.current = documentId;
  const setPendingComment = useCallback(
    (selection: PendingCommentSelection | null) => {
      pendingDraftRef.current.discard();
      current.current = selection
        ? {
            ...selection,
            id: Symbol("pending-comment"),
            documentId: currentDocumentId.current,
            text: "",
            mentions: [],
            submitting: false,
            focus: { current: {} },
          }
        : null;
      setDraft(current.current);
    },
    [],
  );
  const changePendingComment = useCallback(
    (id: symbol, change: PendingCommentChange) => {
      const pending = current.current;
      if (
        pending?.id !== id ||
        pending.documentId !== currentDocumentId.current
      )
        return;
      const changes = change({ ...pending, ...pendingDraftRef.current.draft });
      if (changes.text !== undefined)
        pendingDraftRef.current.setText(changes.text);
      if (changes.mentions !== undefined)
        pendingDraftRef.current.setMentions(changes.mentions);
      current.current = { ...pending, ...changes };
      setDraft(current.current);
    },
    [],
  );
  const completePendingComment = useCallback(
    (id: symbol) => {
      const pending = current.current;
      if (
        pending?.id !== id ||
        pending.documentId !== currentDocumentId.current
      )
        return false;
      setPendingComment(null);
      return true;
    },
    [setPendingComment],
  );
  useEffect(() => setPendingComment(null), [documentId, setPendingComment]);
  const pendingComment = useMemo(
    () =>
      draft?.documentId === documentId
        ? { ...draft, ...pendingDraft.draft }
        : null,
    [documentId, draft, pendingDraft.draft],
  );
  return {
    pendingComment,
    setPendingComment,
    changePendingComment,
    completePendingComment,
  };
}

interface CommentsSidebarOptions {
  pendingTargetValid?: boolean;
  compact?: boolean;
  replyDrafts: ReturnType<typeof useCommentReplyDrafts>;
  documentId: string;
  threads?: CommentThread[];
  isLoading?: boolean;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  activeThreadId?: string | null;
  selectedThreadId?: string | null;
  onActivateThread?: (id: string) => void;
  activeSuggestionId?: string | null;
  focusSuggestionId?: string | null;
  onSuggestionFocused?: () => void;
  hoveredSuggestionId?: string | null;
  anchoredSuggestionIds?: string[] | null;
  onActivateSuggestion?: (id: string) => void;
  onSelectedThreadChange?: (id: string | null) => void;
  onHoveredThreadChange?: (id: string | null) => void;
  currentUserEmail?: string;
  currentUserOrgId?: string;
  canComment?: boolean;
  canResolve?: boolean;
  canSuggest?: boolean;
  commentAi?: CommentAiController;
  alignToAnchors?: boolean;
  forceVisible?: boolean;
  suggestions?: ResourceSuggestion[];
  draftSuggestions?: DraftSuggestion[];
  onMaterializeDraft?: (
    suggestion: DraftSuggestion,
  ) => Promise<ResourceSuggestion | null>;
  canDecideSuggestions?: boolean;
  decidingSuggestion?: boolean;
  onDecideSuggestion?: (
    suggestion: ResourceSuggestion,
    decision: SuggestionDecision,
  ) => void;
  visibleThreadId?: string | null;
  presentation?: "inline" | "history";
  /** Card treatment: margin rail, anchored popover, or the comments panel. */
  surface?: CommentSurface;
  /** Closes the anchored popover; shown as its header close button. */
  onClose?: () => void;
}

type CommentsSidebarProps = CommentsSidebarOptions &
  (
    | {
        pendingComment: PendingCommentDraft | null;
        onPendingChange: (id: symbol, change: PendingCommentChange) => void;
        onPendingDone: (id: symbol, threadId?: string) => void;
      }
    | {
        pendingComment?: undefined;
        onPendingChange?: never;
        onPendingDone?: never;
      }
  );

export function commentAiModelStorageKey(
  currentUserEmail?: string,
  currentUserOrgId?: string,
) {
  const email = currentUserEmail?.trim().toLowerCase();
  if (!email) return undefined;
  const orgId = currentUserOrgId?.trim();
  return chatModelSelectionStorageKey(
    `content-comment-ai:${orgId ? `org:${orgId}` : "personal"}:${email}`,
  );
}

export function CommentsSidebar({
  compact = false,
  replyDrafts,
  documentId,
  threads = NO_THREADS,
  isLoading = false,
  pendingComment,
  pendingTargetValid = true,
  onPendingChange,
  onPendingDone,
  scrollContainerRef,
  activeThreadId,
  selectedThreadId,
  onActivateThread,
  activeSuggestionId,
  focusSuggestionId,
  onSuggestionFocused,
  hoveredSuggestionId,
  anchoredSuggestionIds,
  onActivateSuggestion,
  onSelectedThreadChange,
  onHoveredThreadChange,
  currentUserEmail,
  currentUserOrgId,
  canComment = true,
  canResolve = false,
  canSuggest = false,
  commentAi,
  alignToAnchors = true,
  forceVisible = false,
  suggestions = NO_SUGGESTIONS,
  draftSuggestions = NO_DRAFT_SUGGESTIONS,
  onMaterializeDraft,
  canDecideSuggestions = false,
  decidingSuggestion = false,
  onDecideSuggestion,
  visibleThreadId,
  presentation = "inline",
  surface: surfaceProp,
  onClose,
}: CommentsSidebarProps) {
  const surface: CommentSurface =
    surfaceProp ?? (presentation === "history" ? "panel" : "rail");
  const t = useT();
  const aiModelStorageKey = commentAiModelStorageKey(
    currentUserEmail,
    currentUserOrgId,
  );
  const { data: members = [] } = useMentionMembers();
  const createComment = useCreateComment({ email: currentUserEmail });
  const resolveComment = useResolveComment();
  const queryClient = useQueryClient();
  const pendingDraft = useCommentDraft("pending");
  const draftStore = useCommentDraftContext();
  const { isResolving, startResolution, finishResolution } =
    useCommentPanelSession();
  const ambiguousCreate = (threadId?: string) =>
    threads.some((thread) =>
      thread.comments.some(
        (comment) =>
          comment.mutation?.ambiguous &&
          comment.mutation.kind === "create" &&
          (threadId
            ? comment.thread_id === threadId
            : comment.parent_id === null),
      ),
    );
  const replyingThreadId = replyDrafts.openReply?.suggestionId
    ? null
    : (replyDrafts.openReply?.threadId ?? null);
  const expandedSuggestionId = replyDrafts.openReply?.suggestionId ?? null;
  const setReplyingThreadId = replyDrafts.setOpenReply;
  const setExpandedSuggestionId = (id: string | null) => {
    const suggestion = suggestions.find((entry) => entry.id === id);
    replyDrafts.setOpenReply(suggestion?.threadId ?? null, id);
  };
  const pendingText = pendingComment?.text ?? "";
  const pendingMentions = pendingComment?.mentions ?? [];
  const pendingSubmitting =
    createComment.isPending || !!pendingComment?.submitting;
  const {
    status: historyStatus,
    kind: historyKind,
    author: historyAuthor,
  } = replyDrafts.historyFilters;
  const setHistoryStatus = (status: CommentHistoryFilters["status"]) =>
    replyDrafts.setHistoryFilters({ status });
  const setHistoryKind = (kind: CommentHistoryFilters["kind"]) =>
    replyDrafts.setHistoryFilters({ kind });
  const setHistoryAuthor = (author: string | null) =>
    replyDrafts.setHistoryFilters({ author });
  const historyFiltered =
    historyStatus !== "all" || historyKind !== "all" || historyAuthor !== null;
  const [historyPortalContainer, setHistoryPortalContainer] =
    useState<HTMLDivElement | null>(null);
  const activeConflictId = suggestions.find(
    (suggestion) =>
      suggestion.id === activeSuggestionId && suggestion.status === "stale",
  )?.id;
  useEffect(() => {
    if (presentation !== "history") return;
    replyDrafts.revealHistory(
      activeConflictId ?? null,
      focusSuggestionId ?? null,
    );
  }, [
    activeConflictId,
    focusSuggestionId,
    replyDrafts.revealHistory,
    presentation,
  ]);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const pendingInputRef = useRef<TiptapComposerHandle>(null);

  const openThreads = useMemo(() => {
    if (presentation === "inline" && !alignToAnchors && activeSuggestionId)
      return [];
    const open =
      threads?.filter(
        (thread) =>
          !thread.resolved ||
          (presentation === "inline" &&
            (thread.threadId === selectedThreadId ||
              commentAi?.freshResolutions.has(thread.threadId))),
      ) ?? [];
    return visibleThreadId
      ? open.filter((thread) => thread.threadId === visibleThreadId)
      : open;
  }, [
    threads,
    visibleThreadId,
    presentation,
    alignToAnchors,
    activeSuggestionId,
    selectedThreadId,
    commentAi?.freshResolutions,
  ]);
  // A suggestion whose text is gone has nothing to point at in the margin; it
  // stays reviewable in the comments panel.
  const inlineSuggestions = useMemo(
    () =>
      suggestions.filter(
        (suggestion) =>
          suggestion.status === "pending" &&
          (alignToAnchors || suggestion.id === activeSuggestionId) &&
          (suggestion.id === activeSuggestionId ||
            !anchoredSuggestionIds ||
            anchoredSuggestionIds.includes(suggestion.id)),
      ),
    [suggestions, alignToAnchors, activeSuggestionId, anchoredSuggestionIds],
  );
  const inlineDraftSuggestions = useMemo(
    () =>
      draftSuggestions.filter(
        (suggestion) => alignToAnchors || suggestion.id === activeSuggestionId,
      ),
    [draftSuggestions, alignToAnchors, activeSuggestionId],
  );
  const inlineThreads = useMemo(
    () => [
      ...openThreads,
      ...inlineSuggestions.map((suggestion) => ({
        threadId: suggestion.threadId,
        comments: [],
        suggestion,
      })),
      ...inlineDraftSuggestions.map((suggestion) => ({
        threadId: suggestion.threadId,
        comments: [],
        suggestion,
      })),
    ],
    [openThreads, inlineDraftSuggestions, inlineSuggestions],
  );
  const selectedThreadIsOpen =
    !!selectedThreadId &&
    openThreads.some((thread) => thread.threadId === selectedThreadId);

  useLayoutEffect(() => {
    if (
      presentation === "inline" &&
      canComment &&
      selectedThreadIsOpen &&
      selectedThreadId !== replyingThreadId
    )
      setReplyingThreadId(selectedThreadId);
  }, [canComment, presentation, selectedThreadId, selectedThreadIsOpen]);
  const historyAuthors = useMemo(() => {
    const authors = new Map<string, string>();
    for (const suggestion of suggestions) {
      if (suggestion.authorEmail) {
        authors.set(
          suggestion.authorEmail,
          suggestion.authorEmail.split("@")[0],
        );
      }
    }
    for (const suggestion of draftSuggestions) {
      if (suggestion.authorEmail) {
        authors.set(
          suggestion.authorEmail,
          suggestion.authorEmail.split("@")[0],
        );
      }
    }
    for (const thread of threads) {
      for (const comment of thread.comments) {
        authors.set(
          comment.author_email,
          comment.author_name ?? comment.author_email.split("@")[0],
        );
      }
    }
    return [...authors.entries()].sort((left, right) =>
      left[1].localeCompare(right[1]),
    );
  }, [draftSuggestions, suggestions, threads]);
  const historySuggestions = useMemo(() => {
    if (historyKind === "comments") return [];
    return suggestions.filter((suggestion) => {
      const unresolved =
        suggestion.status === "pending" || suggestion.status === "stale";
      if (historyStatus === "open" && !unresolved) {
        return false;
      }
      if (historyStatus === "resolved" && unresolved) {
        return false;
      }
      return !historyAuthor || suggestion.authorEmail === historyAuthor;
    });
  }, [historyAuthor, historyKind, historyStatus, suggestions]);
  const historyDraftSuggestions = useMemo(() => {
    if (historyKind === "comments") return [];
    if (historyStatus === "resolved") return [];
    return draftSuggestions.filter(
      (suggestion) =>
        !historyAuthor || suggestion.authorEmail === historyAuthor,
    );
  }, [draftSuggestions, historyAuthor, historyKind, historyStatus]);
  const historyThreads = useMemo(() => {
    if (historyKind === "suggestions") return [];
    return threads.filter((thread) => {
      if (selectedThreadId === thread.threadId) return true;
      if (historyStatus === "open" && thread.resolved) return false;
      if (historyStatus === "resolved" && !thread.resolved) return false;
      if (
        historyAuthor &&
        !thread.comments.some(
          (comment) => comment.author_email === historyAuthor,
        )
      ) {
        return false;
      }
      return true;
    });
  }, [historyAuthor, historyKind, historyStatus, threads, selectedThreadId]);

  const historyEntries = useMemo(
    () =>
      [
        ...historyDraftSuggestions.map((suggestion) => ({
          kind: "draft" as const,
          id: suggestion.id,
          createdAt: suggestion.createdAt,
          suggestion,
        })),
        ...historySuggestions.map((suggestion) => ({
          kind: "suggestion" as const,
          id: suggestion.id,
          createdAt: suggestion.createdAt,
          suggestion,
        })),
        ...historyThreads.map((thread) => ({
          kind: "comment" as const,
          id: thread.threadId,
          createdAt: thread.comments[0].created_at,
          thread,
        })),
      ].sort(
        (left, right) =>
          Number(right.id === activeConflictId) -
            Number(left.id === activeConflictId) ||
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id),
      ),
    [
      activeConflictId,
      historyDraftSuggestions,
      historySuggestions,
      historyThreads,
    ],
  );

  const pendingFocus = pendingComment?.focus;
  useEffect(() => {
    if (!pendingFocus || presentation !== "inline") return;
    const timer = setTimeout(() => {
      const input = pendingInputRef.current;
      const saved = pendingFocus.current;
      if (!input || !saved) return;
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        active !== document.documentElement &&
        active.isConnected
      )
        return;
      input.focus();
      if (saved.start !== undefined && saved.end !== undefined)
        input.setSelection(saved.start, saved.end, saved.direction);
    }, 50);
    return () => clearTimeout(timer);
  }, [pendingFocus, presentation]);

  const handlePendingSubmit = async () => {
    if (!canComment) return;
    if (
      !pendingComment ||
      !pendingText.trim() ||
      pendingSubmitting ||
      !pendingTargetValid ||
      ambiguousCreate()
    )
      return;
    const id = pendingComment.id;
    const clientOperationId = crypto.randomUUID();
    const submitted = pendingDraft.markSubmitted(clientOperationId);
    onPendingChange(id, () => ({ submitting: true }));
    try {
      const result = await createComment.mutateAsync({
        clientOperationId,
        documentId,
        content: pendingText.trim(),
        quotedText: pendingComment?.quotedText,
        anchorPrefix: pendingComment?.anchor?.prefix,
        anchorSuffix: pendingComment?.anchor?.suffix,
        anchorStartOffset: pendingComment?.anchor?.startOffset,
        mentions: mentionsJsonFor(pendingText, pendingMentions),
      });
      pendingDraft.clearIfUnchanged(submitted);
      onPendingDone(id, result.threadId);
    } catch (error) {
      onPendingChange(id, () => ({ submitting: false }));
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handlePendingCancel = () => {
    if (pendingComment) onPendingDone(pendingComment.id);
  };

  const handleReply = async (threadId: string) => {
    const { text: replyText, mentions: replyMentions } =
      replyDrafts.get(threadId);
    if (!canComment) return;
    if (
      !replyText.trim() ||
      createComment.isPending ||
      isResolving(threadId) ||
      ambiguousCreate(threadId)
    )
      return;
    const thread = threads?.find((t) => t.threadId === threadId);
    if (!thread || thread.resolved) return;
    const clientOperationId = crypto.randomUUID();
    const submitted = replyDrafts.get(threadId);
    draftStore.submittedDrafts.set(clientOperationId, submitted);
    try {
      await createComment.mutateAsync({
        clientOperationId,
        documentId,
        content: replyText.trim(),
        threadId,
        parentId: thread?.comments[0]?.id,
        mentions: mentionsJsonFor(replyText, replyMentions),
      });
      draftStore.clearIfUnchanged(`reply:${documentId}:${threadId}`, submitted);
    } catch (error) {
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const [threadPositions, setThreadPositions] = useState<
    Map<string, CommentThreadPosition>
  >(new Map());
  const [threadCardHeights, setThreadCardHeights] = useState<
    Map<string, number>
  >(new Map());
  const [pendingOffset, setPendingOffset] = useState<number | null>(null);
  const openThreadKey = inlineThreads
    .map(
      (t) =>
        `${t.threadId}:${"quotedText" in t ? (t.quotedText ?? "") : t.suggestion.id}`,
    )
    .join(",");

  const handleThreadCardHeightChange = useCallback(
    (threadId: string, height: number) => {
      setThreadCardHeights((prev) => {
        if (prev.get(threadId) === height) return prev;
        const next = new Map(prev);
        next.set(threadId, height);
        return next;
      });
    },
    [],
  );

  // Draft text changes on every keystroke; only presence moves the lane.
  const hasPendingComment = Boolean(pendingComment);
  const recomputeOffsets = useCallback(() => {
    const container = scrollContainerRef?.current ?? null;
    if (!container || inlineThreads.length === 0) {
      setThreadPositions((prev) => (prev.size === 0 ? prev : new Map()));
      setPendingOffset((prev) => {
        const next =
          hasPendingComment && alignToAnchors
            ? findPendingCommentOffset(container, sidebarRef.current)
            : null;
        return prev === next ? prev : next;
      });
      return;
    }
    const layoutContainer = alignToAnchors ? sidebarRef.current : null;
    const positions = new Map<string, CommentThreadPosition>();
    for (const thread of inlineThreads) {
      const position = findThreadPosition(
        "suggestion" in thread ? thread.suggestion.id : thread.threadId,
        "suggestion" in thread ? null : thread.quotedText,
        container,
        layoutContainer,
        "suggestion" in thread ? "data-suggestion-id" : "data-comment-thread",
      );
      if (position) positions.set(thread.threadId, position);
    }
    const nextPendingOffset =
      hasPendingComment && alignToAnchors
        ? findPendingCommentOffset(container, layoutContainer)
        : null;
    setThreadPositions((prev) => {
      if (
        prev.size === positions.size &&
        [...positions].every(([key, value]) => {
          const prior = prev.get(key);
          return (
            prior?.documentTop === value.documentTop &&
            prior?.layoutTop === value.layoutTop
          );
        })
      ) {
        return prev;
      }
      return positions;
    });
    setPendingOffset((prev) =>
      prev === nextPendingOffset ? prev : nextPendingOffset,
    );
  }, [alignToAnchors, hasPendingComment, inlineThreads, scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef?.current ?? null;
    if (!container) return;

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recomputeOffsets);
    };
    schedule();

    const pm = container.querySelector(".ProseMirror");
    const observer = new MutationObserver(schedule);
    observer.observe(pm ?? container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resizeObserver?.observe(container);
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadKey, hasPendingComment, recomputeOffsets]);

  useEffect(() => {
    const openIds = new Set(inlineThreads.map((thread) => thread.threadId));
    setThreadCardHeights((prev) => {
      if ([...prev.keys()].every((threadId) => openIds.has(threadId))) {
        return prev;
      }
      const next = new Map<string, number>();
      for (const [threadId, height] of prev) {
        if (openIds.has(threadId)) next.set(threadId, height);
      }
      return next;
    });
  }, [inlineThreads]);

  useEffect(() => {
    if (
      selectedThreadId &&
      !openThreads.some((thread) => thread.threadId === selectedThreadId)
    ) {
      onSelectedThreadChange?.(null);
      setReplyingThreadId(null);
    }
  }, [onSelectedThreadChange, selectedThreadId, openThreads]);

  const hasContent =
    presentation === "history"
      ? threads.length > 0 ||
        suggestions.length > 0 ||
        draftSuggestions.length > 0
      : inlineThreads.length > 0 || !!pendingComment;
  if (!hasContent && !isLoading && !forceVisible) return null;

  const selectedLayoutThreadId =
    inlineSuggestions.find((suggestion) => suggestion.id === activeSuggestionId)
      ?.threadId ??
    inlineDraftSuggestions.find(
      (suggestion) => suggestion.id === activeSuggestionId,
    )?.threadId ??
    selectedThreadId;
  const restingItems = layoutCommentThreads(
    inlineThreads,
    threadPositions,
    threadCardHeights,
    null,
  );
  const restingItemsById = new Map(
    restingItems.map((item) => [item.thread.threadId, item]),
  );
  const items = layoutCommentThreads(
    inlineThreads,
    threadPositions,
    threadCardHeights,
    selectedLayoutThreadId,
  );

  const changeResolution = async (thread: CommentThread, resolved: boolean) => {
    if (
      !canResolve ||
      thread.comments.some(
        (comment) =>
          comment.mutation?.status === "pending" || comment.mutation?.ambiguous,
      ) ||
      !startResolution(thread.threadId)
    )
      return;
    try {
      await resolveComment.mutateAsync({
        id: thread.comments[0].id,
        documentId,
        resolved,
      });
    } catch (error) {
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      finishResolution(thread.threadId);
    }
  };
  const handleResolve = (thread: CommentThread) => {
    void changeResolution(thread, true);
  };

  const handleReopen = (thread: CommentThread) => {
    void changeResolution(thread, false);
  };

  const renderCommentThread = (
    thread: CommentThread,
    marginTop = 0,
    isActive = false,
  ) => {
    const aiRequest = commentAi
      ? latestCommentAiRequest(commentAi.requests, thread.threadId)
      : undefined;
    const continuation = aiRequest
      ? commentAi?.continuations.get(aiRequest.operationId)
      : undefined;
    const freshResolution =
      thread.resolved && commentAi?.freshResolutions.has(thread.threadId);
    if (
      freshResolution &&
      presentation === "inline" &&
      selectedThreadId !== thread.threadId
    ) {
      return (
        <ResolvedByAiMark
          key={thread.threadId}
          threadId={thread.threadId}
          marginTop={marginTop}
          onHeightChange={handleThreadCardHeightChange}
          onOpen={() => onActivateThread?.(thread.threadId)}
          onFaded={() => commentAi?.dismissResolution(thread.threadId)}
          t={t}
        />
      );
    }
    const undoAi = async () => {
      if (!commentAi || !aiRequest) return;
      try {
        await commentAi.undo(aiRequest);
        commentAi.dismissResolution(thread.threadId);
        // This tab's own writes don't come back as refresh signals, so fetch
        // the restored Page body and reopened thread directly.
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["action", "get-document", { id: documentId }],
          }),
          queryClient.invalidateQueries({
            queryKey: ["action", "list-comments", { documentId }],
          }),
        ]);
      } catch (error) {
        toast.error(t("comments.aiUndoFailed"), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    };
    const submitAi = async (selection: CommentAiSubmitPayload) => {
      if (!commentAi || !thread.comments[0]) return;
      const instructions = replyDrafts.get(thread.threadId).text.trim();
      if (!instructions) return;
      const submitted = replyDrafts.get(thread.threadId);
      try {
        const outcome = await startCommentAiSubmission(commentAi, {
          threadId: thread.threadId,
          rootCommentId: thread.comments[0].id,
          submittedMode: selection.intent,
          instructions,
          provider: selection.provider,
          model: selection.model,
          engine: selection.engine,
          priorRequest: aiRequest,
        });
        if (outcome === "confirmed-start") {
          draftStore.clearIfUnchanged(
            `reply:${documentId}:${thread.threadId}`,
            submitted,
          );
        }
      } catch (error) {
        toast.error(t("empty.genericError"), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    };
    const stopAi = async () => {
      if (!commentAi || !aiRequest) return;
      try {
        await commentAi.stop(aiRequest);
      } catch (error) {
        toast.error(t("empty.genericError"), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    };
    return (
      <ThreadView
        key={thread.threadId}
        replyDrafts={replyDrafts}
        documentId={documentId}
        thread={thread}
        marginTop={marginTop}
        isActive={isActive}
        canExpand={canComment}
        isExpanded={replyingThreadId === thread.threadId}
        isSubmitting={
          isResolving(thread.threadId) ||
          ambiguousCreate(thread.threadId) ||
          thread.comments.some(
            (comment) => comment.mutation?.status === "pending",
          )
        }
        replyText={replyDrafts.get(thread.threadId).text}
        aiDraft={replyDrafts.get(thread.threadId).aiDraft}
        onHoverChange={(hovered) =>
          onHoveredThreadChange?.(hovered ? thread.threadId : null)
        }
        onExpand={() => {
          if (createComment.isPending || replyingThreadId === thread.threadId)
            return;
          onActivateThread?.(thread.threadId);
          scrollToCommentAnchor(
            scrollContainerRef?.current ?? null,
            threadPositions.get(thread.threadId)?.documentTop,
          );
          if (canComment) setReplyingThreadId(thread.threadId);
        }}
        onCollapse={() => {
          if (createComment.isPending) return;
          setReplyingThreadId(null);
          onSelectedThreadChange?.(null);
        }}
        onReplyChange={(text) => replyDrafts.setText(thread.threadId, text)}
        onReplyMentionAdd={(mention) =>
          replyDrafts.addMention(thread.threadId, mention)
        }
        onAiDraftChange={(aiDraft) =>
          replyDrafts.setAiDraft(thread.threadId, aiDraft)
        }
        onHeightChange={handleThreadCardHeightChange}
        members={members}
        canComment={canComment && !thread.resolved}
        canResolve={canResolve}
        onSubmitReply={() => handleReply(thread.threadId)}
        onResolve={() =>
          thread.resolved ? handleReopen(thread) : handleResolve(thread)
        }
        resolved={Boolean(thread.resolved)}
        surface={surface}
        onClose={onClose}
        currentUserEmail={currentUserEmail}
        quote={thread.quotedText}
        renderEntry={(id, slots) => (
          <CommentEntry
            comment={thread.comments.find((comment) => comment.id === id)!}
            documentId={documentId}
            currentUserEmail={currentUserEmail}
            canComment={canComment}
            members={members}
            headerActions={slots.headerActions}
            revealActions={slots.revealActions}
            replyAction={slots.replyAction}
            onOpenAiConversation={
              id === thread.comments[0]?.id &&
              aiRequest?.agentThreadId &&
              aiRequest.agentTurnId &&
              commentAi
                ? () => commentAi.open(aiRequest)
                : undefined
            }
          />
        )}
        feedback={
          aiRequest && commentAi ? (
            <>
              {continuation ||
              aiRequest.status === "replied" ||
              aiRequest.status === "suggested" ||
              aiRequest.status === "resolved" ? (
                <CommentAiConversation
                  request={aiRequest}
                  revision={commentAi.transcriptRevision}
                  continuation={continuation}
                />
              ) : null}
              <CommentAiRequestStatus
                request={aiRequest}
                continuation={continuation}
                stopping={commentAi.stoppingRequestIds.has(
                  aiRequest.operationId,
                )}
                onRetry={() => commentAi.retry(aiRequest)}
                onStop={stopAi}
                onUndo={canResolve ? undoAi : undefined}
                onDone={
                  freshResolution
                    ? () => {
                        commentAi.dismissResolution(thread.threadId);
                        onSelectedThreadChange?.(null);
                      }
                    : undefined
                }
              />
            </>
          ) : undefined
        }
        onAiSubmit={commentAi ? submitAi : undefined}
        aiModelStorageKey={commentAi ? aiModelStorageKey : undefined}
        t={t}
      />
    );
  };

  const renderSuggestionCard = (
    suggestion: ResourceSuggestion,
    marginTop = 0,
  ) => {
    const anchorUnavailable =
      suggestion.status === "pending" &&
      anchoredSuggestionIds !== null &&
      !anchoredSuggestionIds?.includes(suggestion.id);
    return (
      <SuggestionThreadView
        surface={surface}
        onClose={onClose}
        currentUserEmail={currentUserEmail}
        compact={compact}
        replyDrafts={replyDrafts}
        key={suggestion.id}
        marginTop={marginTop}
        onHeightChange={handleThreadCardHeightChange}
        suggestion={suggestion}
        documentId={documentId}
        isActive={
          activeSuggestionId === suggestion.id ||
          hoveredSuggestionId === suggestion.id
        }
        expandRequested={expandedSuggestionId === suggestion.id}
        focusRequested={focusSuggestionId === suggestion.id}
        onFocused={onSuggestionFocused}
        anchorUnavailable={anchorUnavailable}
        canComment={canComment}
        canDecide={canDecideSuggestions}
        deciding={decidingSuggestion}
        members={members}
        onActivate={() => {
          if (presentation !== "history") onActivateSuggestion?.(suggestion.id);
        }}
        onExpansionChange={(expanded) =>
          setExpandedSuggestionId(expanded ? suggestion.id : null)
        }
        onDecide={(decision) => onDecideSuggestion?.(suggestion, decision)}
        t={t}
      />
    );
  };

  const renderDraftSuggestionCard = (
    suggestion: DraftSuggestion,
    marginTop = 0,
  ) => (
    <DraftSuggestionThreadView
      surface={surface}
      onClose={onClose}
      currentUserEmail={currentUserEmail}
      key={suggestion.id}
      marginTop={marginTop}
      onHeightChange={handleThreadCardHeightChange}
      suggestion={suggestion}
      isActive={
        activeSuggestionId === suggestion.id ||
        hoveredSuggestionId === suggestion.id
      }
      canDecide={canDecideSuggestions}
      members={members}
      onActivate={() => onActivateSuggestion?.(suggestion.id)}
      onMaterialize={onMaterializeDraft}
      onActivateSaved={(saved) => {
        replyDrafts.setOpenReply(saved.threadId, saved.id);
        onActivateSuggestion?.(saved.id);
      }}
      onDecide={(saved, decision) => onDecideSuggestion?.(saved, decision)}
      t={t}
    />
  );

  if (presentation === "history") {
    return (
      <div
        ref={setHistoryPortalContainer}
        className="min-h-full w-full bg-background"
        data-comments-history
        data-comments-sidebar
      >
        <div className="sticky top-0 z-10 flex items-center border-b border-border bg-background px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  historyFiltered ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <FilterTriggerIndicator active={historyFiltered}>
                  <IconFilter size={14} />
                </FilterTriggerIndicator>
                {t("comments.filter")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56"
              container={historyPortalContainer}
            >
              <DropdownMenuLabel>{t("comments.typeFilter")}</DropdownMenuLabel>
              <DropdownMenuGroup>
                {(["comments", "suggestions"] as const).map((kind) => (
                  <DropdownMenuCheckboxItem
                    key={kind}
                    checked={historyKind === "all" || historyKind === kind}
                    onCheckedChange={(checked) =>
                      setHistoryKind(
                        checked
                          ? "all"
                          : kind === "comments"
                            ? "suggestions"
                            : "comments",
                      )
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    {kind === "comments"
                      ? t("comments.title")
                      : t("comments.suggestions")}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("comments.statusFilter")}
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                {(["open", "resolved", "all"] as const).map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={historyStatus === status}
                    onCheckedChange={(checked) =>
                      checked && setHistoryStatus(status)
                    }
                    onSelect={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    {status === "all"
                      ? t("comments.allStatuses")
                      : status === "open"
                        ? t("comments.open")
                        : t("comments.resolvedStatus")}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("comments.authorFilter")}
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                  checked={historyAuthor === null}
                  onCheckedChange={(checked) =>
                    checked && setHistoryAuthor(null)
                  }
                  onSelect={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  {t("comments.allAuthors")}
                </DropdownMenuCheckboxItem>
                {historyAuthors.map(([email, name]) => (
                  <DropdownMenuCheckboxItem
                    key={email}
                    checked={historyAuthor === email}
                    onCheckedChange={(checked) =>
                      checked && setHistoryAuthor(email)
                    }
                    onSelect={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    {name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          className="flex flex-col divide-y divide-border/60"
          data-comments-feed
        >
          {isLoading ? (
            [0, 1, 2].map((item) => (
              <div key={item} className="p-4" aria-hidden="true">
                <div className="h-20 animate-pulse rounded-lg bg-muted/60" />
              </div>
            ))
          ) : historyEntries.length === 0 ? (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">
              {historyKind !== "suggestions" &&
              historyStatus !== "resolved" &&
              historyAuthor === null &&
              threads.length === 0 &&
              suggestions.length === 0 &&
              draftSuggestions.length === 0
                ? t(
                    canComment
                      ? "comments.selectTextToComment"
                      : "comments.empty",
                  )
                : t("comments.noFilteredComments")}
            </div>
          ) : (
            // One flat feed: every thread shows its first comment and latest
            // replies in place, whether it is a comment or a suggested edit.
            historyEntries.map((entry) => {
              if (entry.kind === "draft")
                return renderDraftSuggestionCard(entry.suggestion);
              if (entry.kind === "suggestion")
                return renderSuggestionCard(entry.suggestion);
              return renderCommentThread(
                entry.thread,
                0,
                activeThreadId === entry.thread.threadId,
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={sidebarRef}
      className="relative flow-root w-full min-w-0 shrink-0 pb-16"
      data-comments-sidebar
    >
      {!hasContent && !isLoading ? (
        <div className="px-4 py-8 text-sm text-muted-foreground">
          {t("comments.empty")}
        </div>
      ) : null}
      {isLoading ? (
        <div className="space-y-3 px-2 pt-3" aria-hidden="true">
          {[0, 1].map((item) => (
            <div
              key={item}
              className="h-28 animate-pulse rounded-lg bg-muted/60"
            />
          ))}
        </div>
      ) : null}
      {/* Pending new comment — positioned at the selection Y offset */}
      {pendingComment && (
        <div
          className={cn(
            "overflow-hidden rounded-xl bg-popover ring-1 ring-border/60 shadow-comment-raised",
            alignToAnchors
              ? "absolute left-2 right-4 z-10"
              : surface === "popover"
                ? "relative"
                : "relative mx-2 mt-3",
          )}
          style={
            alignToAnchors
              ? { top: pendingOffset ?? pendingComment.offsetTop }
              : undefined
          }
          data-comment-pending
        >
          {surface === "popover" ? (
            <div className="flex h-12 items-center gap-1 border-b border-border/70 pe-2 ps-4">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {t("comments.commentTitle")}
              </span>
              {onClose ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CommentIconButton
                      aria-label={t("comments.close")}
                      onClick={handlePendingCancel}
                    >
                      <IconX size={18} />
                    </CommentIconButton>
                  </TooltipTrigger>
                  <TooltipContent>{t("comments.close")}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-start gap-2.5 p-3.5">
            <div className="flex h-9.5 shrink-0 items-center">
              <CommentAvatar email={currentUserEmail} name={currentUserEmail} />
            </div>
            <div className="min-w-0 flex-1">
              {!pendingTargetValid && (
                <p role="alert" className="mb-2 text-xs text-muted-foreground">
                  {t("comments.selectTextToComment")}
                </p>
              )}
              <CommentComposer
                ref={pendingInputRef}
                value={pendingText}
                onChange={(text) =>
                  onPendingChange(pendingComment.id, () => ({ text }))
                }
                onMentionAdd={(mention) =>
                  onPendingChange(pendingComment.id, (draft) => ({
                    mentions: [...draft.mentions, mention],
                  }))
                }
                onSubmit={handlePendingSubmit}
                onCancel={handlePendingCancel}
                onEscape={() => {
                  if (!pendingText.trim()) handlePendingCancel();
                }}
                onFocus={() => {
                  const selection = pendingInputRef.current?.getSelection();
                  if (selection && pendingFocus)
                    pendingFocus.current = selection;
                }}
                onSelectionChange={(selection) => {
                  if (pendingFocus) pendingFocus.current = selection;
                }}
                onBlur={() => {
                  if (pendingFocus) pendingFocus.current = null;
                }}
                members={members}
                placeholder={t("comments.add")}
                submitLabel={t("comments.submit")}
                submitDisabled={!pendingTargetValid || ambiguousCreate()}
                disabled={pendingSubmitting}
              />
            </div>
          </div>
        </div>
      )}

      {/* Open thread cards — positioned to align with their referenced text */}
      {items.map((item, index) => {
        const { thread, top, isOrphaned } = item;
        const restingItem = restingItemsById.get(thread.threadId);
        const marginTop = restingItem?.marginTop ?? item.marginTop;
        const translateY = top - (restingItem?.top ?? top);
        const card =
          "suggestion" in thread
            ? "durability" in thread.suggestion
              ? renderDraftSuggestionCard(thread.suggestion)
              : renderSuggestionCard(thread.suggestion)
            : renderCommentThread(
                thread,
                0,
                activeThreadId === thread.threadId,
              );
        const startsOrphanedSection =
          isOrphaned &&
          !items.slice(0, index).some((prior) => prior.isOrphaned);
        return (
          <div
            key={thread.threadId}
            className="relative transition-transform duration-[260ms] ease-[var(--ease-drawer)] motion-reduce:transition-none"
            data-comment-layout-thread={thread.threadId}
            style={{ marginTop, transform: `translateY(${translateY}px)` }}
          >
            {startsOrphanedSection ? (
              <div
                className="absolute inset-x-2 flex items-center gap-2 text-[11px] text-muted-foreground"
                style={{ top: -20 }}
                data-unanchored-comments
              >
                <span className="h-px flex-1 bg-border" />
                <span>{t("comments.unanchored")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            {card}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What a thread AI resolved folds into once the person moves on. It fades out
 * on its own; hovering holds it, and clicking reopens the result.
 */
function ResolvedByAiMark({
  threadId,
  marginTop,
  onHeightChange,
  onOpen,
  onFaded,
  t,
}: {
  threadId: string;
  marginTop: number;
  onHeightChange: (threadId: string, height: number) => void;
  onOpen: () => void;
  onFaded: () => void;
  t: ReturnType<typeof useT>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element)
      onHeightChange(threadId, element.getBoundingClientRect().height);
  }, [onHeightChange, threadId]);
  return (
    <div ref={ref} style={{ marginTop }} className="flex">
      <button
        type="button"
        onClick={onOpen}
        onAnimationEnd={onFaded}
        className="comment-ai-resolved-mark inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-comment-card transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-comment-ai-resolved-mark={threadId}
      >
        <IconCircleCheck size={14} aria-hidden />
        {t("comments.aiResolvedByAi")}
      </button>
    </div>
  );
}

function SuggestionOperationSummary({
  operations,
  expanded,
  t,
}: {
  operations: ResourceSuggestion["operations"];
  expanded: boolean;
  t: ReturnType<typeof useT>;
}) {
  return operations.map((operation, index) => {
    const before = operation.before as
      | { markdown?: string; changedText?: string }
      | undefined;
    const after = operation.after as
      | { markdown?: string; changedText?: string }
      | undefined;
    const previousText = before?.changedText;
    const nextText =
      operation.kind === "delete_text" &&
      after?.changedText === "<empty-block/>"
        ? ""
        : after?.changedText;
    const key = operation.id ?? index;
    const anchor = operation.anchor as
      | { from?: unknown; to?: unknown }
      | undefined;
    const previousPresentation =
      previousText !== undefined &&
      before?.markdown !== undefined &&
      typeof anchor?.from === "number" &&
      typeof anchor.to === "number"
        ? {
            source: before.markdown,
            from: anchor.from,
            to: anchor.to,
          }
        : undefined;
    const nextPresentation =
      nextText !== undefined &&
      after?.markdown !== undefined &&
      typeof anchor?.from === "number"
        ? {
            source: after.markdown,
            from: anchor.from,
            to: anchor.from + nextText.length,
          }
        : undefined;

    if (previousText && nextText) {
      return (
        <div key={key} className="break-words">
          <div className="text-[hsl(var(--suggestion))]">
            {t("comments.suggestionWith")}: {"“"}
            {renderSuggestionText(nextText, nextPresentation)}
            {"”"}
          </div>
          {expanded ? (
            <div className="text-muted-foreground">
              {t("comments.suggestionReplace")}: {"“"}
              {renderSuggestionText(previousText, previousPresentation)}
              {"”"}
            </div>
          ) : null}
        </div>
      );
    }

    if (previousText) {
      return (
        <div key={key} className="break-words text-muted-foreground">
          {t("comments.suggestionDelete")}: {"“"}
          {renderSuggestionText(previousText, previousPresentation)}
          {"”"}
        </div>
      );
    }

    if (nextText) {
      return (
        <div key={key} className="break-words text-[hsl(var(--suggestion))]">
          {t("comments.suggestionAdd")}: {"“"}
          {renderSuggestionText(nextText, nextPresentation)}
          {"”"}
        </div>
      );
    }

    return null;
  });
}

function DraftSuggestionThreadView({
  marginTop = 0,
  onHeightChange,
  suggestion,
  isActive,
  canDecide,
  members,
  onActivate,
  onMaterialize,
  onActivateSaved,
  onDecide,
  surface = "rail",
  onClose,
  currentUserEmail,
  t,
}: {
  surface?: CommentSurface;
  onClose?: () => void;
  currentUserEmail?: string;
  marginTop?: number;
  onHeightChange: (threadId: string, height: number) => void;
  suggestion: DraftSuggestion;
  isActive: boolean;
  canDecide: boolean;
  members: MentionMember[];
  onActivate: () => void;
  onMaterialize?: (
    suggestion: DraftSuggestion,
  ) => Promise<ResourceSuggestion | null>;
  onActivateSaved: (suggestion: ResourceSuggestion) => void;
  onDecide: (
    suggestion: ResourceSuggestion,
    decision: SuggestionDecision,
  ) => void;
  t: ReturnType<typeof useT>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const materialize = async () => {
    if (!onMaterialize || isSaving) return null;
    setIsSaving(true);
    try {
      return await onMaterialize(suggestion);
    } finally {
      setIsSaving(false);
    }
  };
  const thread = {
    threadId: suggestion.threadId,
    comments: [
      {
        id: suggestion.id,
        author_email: suggestion.authorEmail ?? "",
        author_name: null,
        created_at: suggestion.createdAt,
        content: "",
        mentions: [],
      },
    ],
  };
  return (
    <div data-suggestion-id={suggestion.id}>
      <ThreadView
        surface={surface}
        onClose={onClose}
        currentUserEmail={currentUserEmail}
        popoverTitle={t("comments.suggestionTitle")}
        thread={thread}
        marginTop={marginTop}
        isActive={isActive}
        canExpand
        isExpanded={false}
        isSubmitting={isSaving}
        timeLabel={t("editor.toolbar.suggesting")}
        replyText=""
        members={members}
        onHoverChange={() => {}}
        onExpand={() => {
          onActivate();
          void materialize().then((saved) => {
            if (saved) onActivateSaved(saved);
          });
        }}
        onCollapse={() => {}}
        onReplyChange={() => {}}
        onReplyMentionAdd={() => {}}
        onHeightChange={onHeightChange}
        onSubmitReply={() => {}}
        onResolve={() => {}}
        canComment={false}
        canResolve={false}
        t={t}
        firstEntryBody={
          <>
            <SuggestionOperationSummary
              operations={suggestion.operations}
              expanded={false}
              t={t}
            />
          </>
        }
        threadActions={
          canDecide ? (
            <>
              {(["accepted", "rejected"] as const).map((decision) => (
                <Tooltip key={decision}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t(
                        decision === "accepted"
                          ? "editor.acceptSuggestion"
                          : "editor.rejectSuggestion",
                      )}
                      disabled={isSaving || !onMaterialize}
                      onClick={(event) => {
                        event.stopPropagation();
                        void materialize().then((saved) => {
                          if (saved) onDecide(saved, decision);
                        });
                      }}
                      className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                      data-suggestion-decision={decision}
                    >
                      {decision === "accepted" ? (
                        <IconCheck size={18} />
                      ) : (
                        <IconX size={18} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t(
                      decision === "accepted"
                        ? "editor.acceptSuggestion"
                        : "editor.rejectSuggestion",
                    )}
                  </TooltipContent>
                </Tooltip>
              ))}
            </>
          ) : null
        }
      />
    </div>
  );
}

function SuggestionThreadView({
  compact,
  replyDrafts,
  marginTop = 0,
  onHeightChange,
  suggestion,
  documentId,
  isActive,
  expandRequested,
  focusRequested,
  onFocused,
  anchorUnavailable,
  canComment,
  canDecide,
  deciding,
  members,
  onActivate,
  onExpansionChange,
  onDecide,
  surface = "rail",
  onClose,
  currentUserEmail,
  t,
}: {
  surface?: CommentSurface;
  onClose?: () => void;
  currentUserEmail?: string;
  compact: boolean;
  replyDrafts: ReturnType<typeof useCommentReplyDrafts>;
  marginTop?: number;
  onHeightChange: (threadId: string, height: number) => void;
  suggestion: ResourceSuggestion;
  documentId: string;
  isActive: boolean;
  expandRequested: boolean;
  focusRequested: boolean;
  onFocused?: () => void;
  anchorUnavailable: boolean;
  canComment: boolean;
  canDecide: boolean;
  deciding: boolean;
  members: MentionMember[];
  onActivate: () => void;
  onExpansionChange: (expanded: boolean) => void;
  onDecide: (decision: SuggestionDecision) => void;
  t: ReturnType<typeof useT>;
}) {
  const sourceUrl =
    typeof suggestion.metadata?.sourceUrl === "string"
      ? suggestion.metadata.sourceUrl
      : null;
  const focusTarget = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusRequested) return;
    const frame = requestAnimationFrame(() => {
      const target = focusTarget.current;
      if (!target || target.closest("[inert]")) return;
      target.scrollIntoView({ block: "nearest" });
      target.focus({ preventScroll: true });
      onFocused?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequested, onFocused]);
  const comments = useReviewComments({
    resourceType: "document",
    resourceId: documentId,
    targetId: suggestion.id,
    includeResolved: true,
  });
  const reply = useReplyReviewComment();
  const expanded = expandRequested;
  const { text: draft, mentions } = replyDrafts.get(suggestion.threadId);
  const root = comments.data?.comments.find(
    (comment) =>
      comment.threadId === suggestion.threadId && !comment.parentCommentId,
  );
  const canReply =
    canComment && suggestion.status === "pending" && root?.status === "open";
  const canExpand =
    canReply ||
    suggestion.operations.some((operation) => {
      const before = operation.before as { changedText?: string } | undefined;
      const after = operation.after as { changedText?: string } | undefined;
      return !!before?.changedText && !!after?.changedText;
    });
  const entries = (comments.data?.comments ?? [])
    .filter((comment) => comment.id !== root?.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const thread = {
    threadId: suggestion.threadId,
    comments: [
      {
        id: root?.id ?? suggestion.id,
        author_email: suggestion.authorEmail ?? "",
        author_name:
          root?.authorName ??
          (suggestion.authorEmail ? null : suggestion.actorKind),
        created_at: suggestion.createdAt,
        content: "",
        mentions: [],
      },
      ...entries.map((comment) => ({
        id: comment.id,
        author_email: comment.authorEmail ?? "",
        author_name:
          comment.authorName ??
          (comment.authorEmail ? null : comment.createdBy),
        created_at: comment.createdAt,
        content: comment.body,
        mentions: comment.mentions.flatMap((mention) =>
          typeof mention.email === "string"
            ? [{ email: mention.email, name: mention.label }]
            : [],
        ),
      })),
    ],
  };
  const error = comments.error ?? reply.error;
  return (
    <div
      ref={focusTarget}
      data-suggestion-id={suggestion.id}
      tabIndex={-1}
      className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("comments.suggestionDetails")}
    >
      <ThreadView
        surface={surface}
        onClose={onClose}
        currentUserEmail={currentUserEmail}
        popoverTitle={t("comments.suggestionTitle")}
        replyDrafts={replyDrafts}
        documentId={documentId}
        thread={thread}
        marginTop={marginTop}
        isActive={isActive}
        canExpand={canExpand}
        isExpanded={expanded}
        isSubmitting={reply.isPending || comments.isLoading}
        replyText={draft}
        members={members}
        onHoverChange={() => {}}
        onExpand={() => {
          if (!canExpand) return;
          if (!expanded) {
            onActivate();
            onExpansionChange(true);
          }
        }}
        onCollapse={() => onExpansionChange(false)}
        onReplyChange={(text) => replyDrafts.setText(suggestion.threadId, text)}
        onReplyMentionAdd={(entry) =>
          replyDrafts.addMention(suggestion.threadId, entry)
        }
        onHeightChange={onHeightChange}
        onSubmitReply={() => {
          if (!canReply || !root || !draft.trim() || reply.isPending) return;
          reply.mutate(
            {
              resourceType: "document",
              resourceId: documentId,
              commentId: root.id,
              body: draft.trim(),
              mentions: mentions
                .filter((mention) => draft.includes(`@${mention.name}`))
                .map((mention) => ({
                  email: mention.email,
                  label: mention.name,
                })),
            },
            {
              onSuccess: () => {
                replyDrafts.clear(suggestion.threadId);
              },
            },
          );
        }}
        onResolve={() => {}}
        canComment={canReply}
        canResolve={false}
        expandLabel={
          canReply ? t("comments.reply") : t("comments.suggestionDetails")
        }
        t={t}
        headerStatus={
          <>
            {suggestion.status === "accepted" ? (
              <span>{t("comments.accepted")}</span>
            ) : null}
            {suggestion.status === "rejected" ? (
              <span>{t("comments.rejected")}</span>
            ) : null}
            {comments.data?.discussion?.threadPreferences[suggestion.threadId]
              ?.unread ? (
              <span>{t("comments.unread")}</span>
            ) : null}
          </>
        }
        renderCommentActions={(commentId) =>
          comments.data?.discussion && root ? (
            <>
              {comments.data.discussion.canReact ? (
                <ReviewAddReactionButton
                  documentId={documentId}
                  commentId={commentId}
                  reactions={
                    comments.data.discussion.reactions[commentId] ?? []
                  }
                />
              ) : null}
              <ReviewCommentMenu
                alwaysVisible={compact}
                documentId={documentId}
                suggestionId={suggestion.id}
                threadId={suggestion.threadId}
                commentId={commentId}
                discussion={comments.data.discussion}
              />
            </>
          ) : null
        }
        renderCommentBadge={(commentId) =>
          commentId === thread.comments[0]?.id &&
          suggestion.actorKind === "agent" ? (
            <CommentAgentBadge
              ariaLabel={`${t("comments.aiAttribution", {
                name: suggestion.authorEmail ?? "",
              })}. ${t("comments.aiSourceAgent")}`}
              details={
                <span className="grid gap-0.5">
                  <span>
                    {t("comments.aiAttribution", {
                      name: suggestion.authorEmail ?? "",
                    })}
                  </span>
                  <span className="text-muted-foreground">
                    {t("comments.aiSourceAgent")}
                  </span>
                </span>
              }
            />
          ) : null
        }
        renderCommentFooter={(commentId) =>
          comments.data?.discussion ? (
            <ReviewReactionList
              documentId={documentId}
              commentId={commentId}
              reactions={comments.data.discussion.reactions[commentId] ?? []}
              canReact={comments.data.discussion.canReact}
            />
          ) : null
        }
        firstEntryBody={
          <>
            <SuggestionOperationSummary
              operations={suggestion.operations}
              expanded={expanded}
              t={t}
            />
            {anchorUnavailable || sourceUrl ? (
              <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {anchorUnavailable ? (
                  <span>{t("comments.unanchored")}</span>
                ) : null}
                {sourceUrl ? (
                  <Link
                    className="hover:text-foreground hover:underline"
                    to={sourceUrl}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {t("comments.sourceComment")}
                  </Link>
                ) : null}
              </span>
            ) : null}
          </>
        }
        threadActions={
          canDecide && suggestion.status === "pending" ? (
            <>
              {(["accepted", "rejected"] as const).map((decision) => (
                <Tooltip key={decision}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t(
                        decision === "accepted"
                          ? "editor.acceptSuggestion"
                          : "editor.rejectSuggestion",
                      )}
                      disabled={deciding}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDecide(decision);
                      }}
                      className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                      data-suggestion-decision={decision}
                    >
                      {decision === "accepted" ? (
                        <IconCheck size={18} />
                      ) : (
                        <IconX size={18} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t(
                      decision === "accepted"
                        ? "editor.acceptSuggestion"
                        : "editor.rejectSuggestion",
                    )}
                  </TooltipContent>
                </Tooltip>
              ))}
            </>
          ) : null
        }
        feedback={
          error ? (
            <div role="alert" className="px-3 pb-3 text-xs text-destructive">
              {error.message}
            </div>
          ) : suggestion.status === "stale" ? (
            <div role="alert" className="px-3 pb-3 text-xs text-destructive">
              {t("editor.toolbar.conflict")}
            </div>
          ) : null
        }
      />
    </div>
  );
}

function ThreadView({
  renderEntry,
  surface = "rail",
  quote,
  onClose,
  popoverTitle,
  currentUserEmail,
  resolved = false,
  replyDrafts,
  documentId,
  thread,
  marginTop,
  isActive,
  canExpand,
  isExpanded,
  isSubmitting,
  timeLabel,
  replyText,
  aiDraft,
  members,
  onHoverChange,
  onExpand,
  onCollapse,
  onReplyChange,
  onReplyMentionAdd,
  onAiDraftChange,
  onHeightChange,
  onSubmitReply,
  onResolve,
  canComment,
  canResolve,
  onAiSubmit,
  aiModelStorageKey,
  expandLabel,
  firstEntryBody,
  threadActions,
  feedback,
  headerStatus,
  renderCommentActions,
  renderCommentFooter,
  renderCommentBadge,
  t,
}: {
  renderEntry?: (id: string, slots: ThreadEntrySlots) => ReactNode;
  surface?: CommentSurface;
  /** The anchored text, shown as a quote line above the thread in the panel. */
  quote?: string | null;
  onClose?: () => void;
  popoverTitle?: string;
  currentUserEmail?: string;
  resolved?: boolean;
  replyDrafts?: ReturnType<typeof useCommentReplyDrafts>;
  documentId?: string;
  thread: {
    threadId: string;
    comments: Pick<
      CommentThread["comments"][number],
      | "id"
      | "author_email"
      | "author_name"
      | "created_at"
      | "content"
      | "mentions"
    >[];
  };
  marginTop: number;
  isActive: boolean;
  canExpand: boolean;
  isExpanded: boolean;
  isSubmitting: boolean;
  timeLabel?: string;
  replyText: string;
  aiDraft?: CommentAiDraft | null;
  members: MentionMember[];
  onHoverChange: (hovered: boolean) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onReplyChange: (text: string) => void;
  onReplyMentionAdd: (entry: MentionEntry) => void;
  onAiDraftChange?: (draft: CommentAiDraft | null) => void;
  onHeightChange: (threadId: string, height: number) => void;
  onSubmitReply: () => void;
  onResolve: () => void;
  canComment: boolean;
  canResolve: boolean;
  onAiSubmit?: (payload: CommentAiSubmitPayload) => void;
  aiModelStorageKey?: string;
  expandLabel?: string;
  firstEntryBody?: ReactNode;
  threadActions?: ReactNode;
  feedback?: ReactNode;
  headerStatus?: ReactNode;
  renderCommentActions?: (commentId: string) => ReactNode;
  renderCommentFooter?: (commentId: string) => ReactNode;
  renderCommentBadge?: (commentId: string) => ReactNode;
  t: ReturnType<typeof useT>;
}) {
  const replyInputRef = useRef<TiptapComposerHandle>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded && canComment && replyDrafts) {
      const timer = setTimeout(() => {
        const input = replyInputRef.current;
        const saved = replyDrafts.focus.current;
        if (
          !input ||
          !saved ||
          saved?.documentId !== documentId ||
          saved.threadId !== thread.threadId
        )
          return;
        input.focus();
        if (saved.start !== undefined && saved.end !== undefined) {
          input.setSelection(saved.start, saved.end, saved.direction);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, canComment]);

  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const updateHeight = () => {
      onHeightChange(thread.threadId, element.getBoundingClientRect().height);
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange, thread.threadId]);

  const timestamp = useCommentTimestamp();
  const isRail = surface === "rail";
  const isPanel = surface === "panel";
  // The panel keeps long threads scannable: the first comment and the latest
  // replies, with the rest one click away. Comments and suggestions alike.
  const [showAllReplies, setShowAllReplies] = useState(false);
  const hiddenReplyCount =
    isPanel && !showAllReplies
      ? Math.max(0, thread.comments.length - 1 - PANEL_VISIBLE_REPLIES)
      : 0;
  const visibleComments = hiddenReplyCount
    ? [thread.comments[0]!, ...thread.comments.slice(1 + hiddenReplyCount)]
    : thread.comments;
  const replyButton = () =>
    canExpand && canComment && !resolved ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onExpand();
        }}
        className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-sm font-medium text-foreground/80 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-comment-reply-action
      >
        <IconCornerDownRight size={16} aria-hidden />
        {t("comments.replyAction")}
      </button>
    ) : null;
  const resolveLabel = t(resolved ? "comments.reopen" : "comments.resolve");
  const resolveButton = canResolve ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <CommentIconButton
          aria-label={resolveLabel}
          disabled={isSubmitting}
          onClick={(e) => {
            e.stopPropagation();
            onResolve();
          }}
          data-comment-resolve
        >
          {resolved ? (
            <IconArrowBackUp size={18} />
          ) : (
            <IconCircleCheck size={19} stroke={1.75} />
          )}
        </CommentIconButton>
      </TooltipTrigger>
      <TooltipContent>{resolveLabel}</TooltipContent>
    </Tooltip>
  ) : null;
  const headerActions =
    threadActions || resolveButton ? (
      <>
        {threadActions}
        {resolveButton}
      </>
    ) : null;
  const popoverHeader =
    surface === "popover" ? (
      <div
        className="flex h-12 items-center gap-1 border-b border-border/70 pe-2 ps-4"
        data-comment-popover-header
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {popoverTitle ?? t("comments.commentTitle")}
        </span>
        {headerActions}
        {onClose ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <CommentIconButton
                aria-label={t("comments.close")}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
              >
                <IconX size={18} />
              </CommentIconButton>
            </TooltipTrigger>
            <TooltipContent>{t("comments.close")}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    ) : null;
  const firstRowActions = surface === "popover" ? null : headerActions;

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          !isSubmitting &&
          canExpand &&
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onExpand();
        }
      }}
      data-thread-card={thread.threadId}
      data-comment-surface={surface}
      className={cn(
        "group/thread text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isPanel
          ? cn(
              "transition-[background-color,opacity] hover:bg-accent/40 focus-within:bg-accent/40",
              isActive && "bg-accent/40",
              resolved &&
                "opacity-60 hover:opacity-100 focus-within:opacity-100",
            )
          : cn(
              "overflow-hidden rounded-xl bg-popover ring-1 ring-border/60 focus-visible:ring-2",
              surface === "popover"
                ? "shadow-comment-raised"
                : "shadow-comment-card",
            ),
        canExpand && !isExpanded && "cursor-pointer",
        isRail &&
          "mx-2 mr-4 transition-[box-shadow,translate] duration-[260ms] ease-[var(--ease-drawer)] motion-reduce:transform-none motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:focus-within:translate-x-0",
        isRail &&
          (isActive
            ? "-translate-x-2 shadow-comment-emphasis ring-foreground/15"
            : "hover:-translate-x-2 hover:shadow-comment-emphasis focus-within:-translate-x-2 focus-within:shadow-comment-emphasis"),
      )}
      style={{ marginTop }}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button, input, textarea, a, [contenteditable=true]",
          )
        )
          return;
        if (!isSubmitting && canExpand) {
          if (isExpanded && !canComment) onCollapse();
          else onExpand();
        }
      }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      {popoverHeader}
      <div
        className={cn(
          "relative grid gap-3.5",
          isPanel ? "px-4 py-3.5" : "px-4 pb-3.5 pt-3.5",
        )}
      >
        {isPanel && quote ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (canExpand) onExpand();
            }}
            className="-mb-1 line-clamp-2 border-s-2 border-border ps-2.5 text-start text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-comment-quote
          >
            {quote}
          </button>
        ) : null}
        {canExpand ? (
          <button
            type="button"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-2 focus:z-10 focus:rounded focus:bg-background focus:px-2 focus:py-1 focus:text-xs focus:ring-2 focus:ring-ring"
            aria-expanded={isExpanded}
            onClick={(event) => {
              event.stopPropagation();
              if (isExpanded) onCollapse();
              else onExpand();
            }}
          >
            {expandLabel ?? t("comments.reply")}
          </button>
        ) : null}
        {visibleComments.map((c, visibleIndex) => {
          const index =
            visibleIndex === 0 ? 0 : visibleIndex + hiddenReplyCount;
          const isReply = index > 0;
          const indent = isPanel && isReply ? "ms-9.5" : undefined;
          const earlier =
            visibleIndex === 1 && hiddenReplyCount ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAllReplies(true);
                }}
                className="ms-9.5 -my-1 justify-self-start rounded-full px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-comment-earlier-replies
              >
                {t("comments.showEarlierReplies")}
              </button>
            ) : null;
          return renderEntry ? (
            <Fragment key={c.id}>
              {earlier}
              <div className={indent}>
                {renderEntry(c.id, {
                  headerActions: index === 0 ? firstRowActions : undefined,
                  revealActions: index === 0 ? "always" : "hover",
                  replyAction: isPanel && !isReply ? replyButton() : undefined,
                })}
              </div>
            </Fragment>
          ) : (
            <Fragment key={c.id}>
              {earlier}
              <CommentRow
                className={indent}
                avatar={
                  <CommentAvatar
                    email={c.author_email}
                    name={c.author_name ?? c.author_email}
                  />
                }
                name={c.author_name ?? c.author_email.split("@")[0]}
                badge={renderCommentBadge?.(c.id)}
                timestamp={
                  index === 0 && timeLabel
                    ? { label: timeLabel, title: timeLabel }
                    : { ...timestamp(c.created_at), dateTime: c.created_at }
                }
                status={index === 0 ? headerStatus : undefined}
                actions={
                  renderCommentActions || (index === 0 && firstRowActions) ? (
                    <>
                      {renderCommentActions?.(c.id)}
                      {index === 0 ? firstRowActions : null}
                    </>
                  ) : null
                }
                revealActions={index === 0 ? "always" : "hover"}
                footer={
                  (isPanel && !isReply) || renderCommentFooter ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {isPanel && !isReply ? replyButton() : null}
                      {renderCommentFooter?.(c.id)}
                    </div>
                  ) : null
                }
              >
                {index === 0 && firstEntryBody !== undefined
                  ? firstEntryBody
                  : renderCommentBody(c.content, c.mentions)}
              </CommentRow>
            </Fragment>
          );
        })}
        {feedback ? (
          <div className={isPanel ? "ms-9.5" : undefined}>{feedback}</div>
        ) : null}
      </div>

      {isExpanded && canComment && !resolved && (
        <div
          data-comment-reply-composer
          className={cn(
            "flex items-start gap-2.5 px-4 pb-4",
            isPanel && "ps-13.5",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-9.5 shrink-0 items-center">
            <CommentAvatar
              email={currentUserEmail ?? thread.comments[0]?.author_email}
              name={currentUserEmail ?? thread.comments[0]?.author_name}
            />
          </div>
          <CommentComposer
            ref={replyInputRef}
            className="flex-1"
            collapsible
            value={replyText}
            onChange={onReplyChange}
            onMentionAdd={onReplyMentionAdd}
            onSubmit={onSubmitReply}
            onAiSubmit={onAiSubmit}
            aiDraft={aiDraft}
            onAiDraftChange={onAiDraftChange}
            aiModelStorageKey={aiModelStorageKey}
            onEscape={() => {
              onCollapse();
              requestAnimationFrame(() => cardRef.current?.focus());
            }}
            onFocus={() => {
              const selection = replyInputRef.current?.getSelection();
              if (!selection || !replyDrafts || !documentId) return;
              replyDrafts.focus.current = {
                documentId,
                threadId: thread.threadId,
                ...selection,
              };
            }}
            onSelectionChange={(selection) => {
              if (!replyDrafts || !documentId) return;
              replyDrafts.focus.current = {
                documentId,
                threadId: thread.threadId,
                ...selection,
              };
            }}
            onBlur={() => {
              if (cardRef.current?.closest("[inert]")) return;
              if (replyDrafts?.focus.current?.threadId === thread.threadId)
                replyDrafts.focus.current = null;
            }}
            members={members}
            placeholder={t("comments.reply")}
            submitLabel={t("comments.submit")}
            disabled={isSubmitting}
          />
        </div>
      )}
    </div>
  );
}
