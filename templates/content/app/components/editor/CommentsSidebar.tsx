import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { emailToColor } from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  InlineMarkdown,
  type InlineMarkdownProtectedSpan,
} from "@agent-native/core/client/markdown";
import {
  useReviewComments,
  useReplyReviewComment,
} from "@agent-native/core/client/review";
import type {
  ResourceSuggestion,
  SuggestionDecision,
} from "@agent-native/core/review";
import {
  IconCheck,
  IconMessageCircle,
  IconArrowUp,
  IconArrowBackUp,
  IconFilter,
  IconX,
} from "@tabler/icons-react";
import {
  Fragment,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useId,
  type RefObject,
  type ReactNode,
} from "react";
import { toast } from "sonner";
export { suggestionTextForDisplay } from "@shared/suggestion-text";

import type { SuggestionPresentationContext } from "@shared/suggestion-text";

import {
  Avatar as UserAvatar,
  AvatarFallback as UserAvatarFallback,
  AvatarImage as UserAvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateComment,
  useResolveComment,
  type CommentThread,
  type CommentMention,
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
} from "./comment-drafts";
import { CommentComposer, type MentionEntry } from "./CommentComposer";
import { CommentEntry, CommentAttributionBadge } from "./CommentEntry";
export { getAiCommentSource } from "./CommentEntry";
import { ReviewCommentMenu, ReviewReactionList } from "./ReviewDiscussionTools";
import type { DraftSuggestion } from "./suggestions/draft-session";
import { SuggestionText } from "./SuggestionText";

/**
 * Render a comment body, styling any `@mention` tokens that match the comment's
 * stored mentions. Raw HTML is never interpreted.
 */
function commentMentionSpans(
  mentions: CommentMention[],
): InlineMarkdownProtectedSpan[] {
  const labels = Array.from(
    new Set(mentions.map((m) => m.name).filter((n): n is string => !!n)),
  ).sort((a, b) => b.length - a.length);
  return labels.map((label) => ({
    source: `@${label}`,
    label: `@${label}`,
    className: "comment-mention",
  }));
}

function renderSuggestionText(
  content: string,
  context?: SuggestionPresentationContext,
) {
  return <SuggestionText content={content} context={context} />;
}

function renderCommentBody(content: string, mentions: CommentMention[]) {
  return (
    <InlineMarkdown
      content={content}
      inline
      protectedSpans={commentMentionSpans(mentions)}
    />
  );
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

function emailToInitial(email: string) {
  return (email.split("@")[0]?.[0] ?? "?").toUpperCase();
}

function CommentAvatar({
  email,
  name,
  className = "h-6 w-6",
}: {
  email?: string | null;
  name?: string | null;
  className?: string;
}) {
  const avatarUrl = useAvatarUrl(email);
  const label = name ?? email ?? "";
  return (
    <UserAvatar className={className} title={label}>
      {avatarUrl ? <UserAvatarImage src={avatarUrl} alt={label} /> : null}
      <UserAvatarFallback
        className="text-[11px] font-medium text-primary-foreground"
        style={{ backgroundColor: emailToColor(email ?? "user") }}
      >
        {emailToInitial(label)}
      </UserAvatarFallback>
    </UserAvatar>
  );
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    const firstTop = tops.get(anchored[0]?.threadId ?? "") ?? 0;
    if (firstTop < 0) {
      for (let index = 0; index <= selectedIndex; index += 1) {
        const thread = anchored[index];
        tops.set(thread.threadId, (tops.get(thread.threadId) ?? 0) - firstTop);
      }
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
    target instanceof HTMLTextAreaElement &&
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
    change: (draft: { text: string; mentions: MentionEntry[] }) => {
      text: string;
      mentions: MentionEntry[];
    },
  ) => {
    draftStore.updateDraft(
      `reply:${documentId}:${threadId}`,
      { text: "", mentions: [] },
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
        revision: 0,
      },
    setText: (threadId: string, text: string) =>
      update(threadId, (draft) => ({ ...draft, text })),
    addMention: (threadId: string, mention: MentionEntry) =>
      update(threadId, (draft) => ({
        ...draft,
        mentions: [...draft.mentions, mention],
      })),
    clear: (threadId: string) =>
      update(threadId, () => ({ text: "", mentions: [] })),
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
  canComment?: boolean;
  canResolve?: boolean;
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

export function CommentsSidebar({
  compact = false,
  replyDrafts,
  documentId,
  threads = [],
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
  canComment = true,
  canResolve = false,
  alignToAnchors = true,
  forceVisible = false,
  suggestions = [],
  draftSuggestions = [],
  onMaterializeDraft,
  canDecideSuggestions = false,
  decidingSuggestion = false,
  onDecideSuggestion,
  visibleThreadId,
  presentation = "inline",
}: CommentsSidebarProps) {
  const t = useT();
  const { data: members = [] } = useMentionMembers();
  const createComment = useCreateComment({ email: currentUserEmail });
  const resolveComment = useResolveComment();
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
  const pendingInputRef = useRef<HTMLTextAreaElement>(null);

  const openThreads = useMemo(() => {
    if (presentation === "inline" && !alignToAnchors && activeSuggestionId)
      return [];
    const open =
      threads?.filter(
        (thread) =>
          !thread.resolved ||
          (presentation === "inline" && thread.threadId === selectedThreadId),
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
  ]);
  const inlineSuggestions = useMemo(
    () =>
      suggestions.filter(
        (suggestion) =>
          suggestion.status === "pending" &&
          (alignToAnchors || suggestion.id === activeSuggestionId),
      ),
    [suggestions, alignToAnchors, activeSuggestionId],
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
    const relinquishFocus = (event: FocusEvent) => {
      if (event.target !== pendingInputRef.current) pendingFocus.current = null;
    };
    document.addEventListener("focusin", relinquishFocus);
    const timer = setTimeout(() => {
      document.removeEventListener("focusin", relinquishFocus);
      const input = pendingInputRef.current;
      const saved = pendingFocus.current;
      if (!input || !saved || input.closest("[inert]")) return;
      input.focus({ preventScroll: true });
      if (saved.start !== undefined && saved.end !== undefined)
        input.setSelectionRange(saved.start, saved.end, saved.direction);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", relinquishFocus);
    };
  }, [pendingFocus, presentation]);

  useLayoutEffect(() => {
    const input = pendingInputRef.current;
    if (!input || !pendingFocus) return;
    const capture = () => {
      if (document.activeElement !== input) return;
      pendingFocus.current = {
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
      };
    };
    const blur = () => {
      if (input.isConnected && !input.closest("[inert]"))
        pendingFocus.current = null;
    };
    input.addEventListener("focus", capture);
    input.addEventListener("select", capture);
    input.addEventListener("input", capture);
    input.addEventListener("blur", blur);
    return () => {
      capture();
      input.removeEventListener("focus", capture);
      input.removeEventListener("select", capture);
      input.removeEventListener("input", capture);
      input.removeEventListener("blur", blur);
    };
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

  const handleSendToAI = (thread: CommentThread) => {
    const commentTexts = thread.comments
      .map((c) => `${c.author_name ?? c.author_email}: ${c.content}`)
      .join("\n");
    const context = thread.quotedText
      ? `${t("comments.agentRegardingText", { text: thread.quotedText })}\n\n`
      : "";
    sendToAgentChat({
      message: t("comments.agentHelp"),
      context: `${context}${t("comments.agentThreadHeader")}\n${commentTexts}`,
    });
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

  const recomputeOffsets = useCallback(() => {
    const container = scrollContainerRef?.current ?? null;
    if (!container || inlineThreads.length === 0) {
      setThreadPositions((prev) => (prev.size === 0 ? prev : new Map()));
      setPendingOffset((prev) => {
        const next =
          pendingComment && alignToAnchors
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
      pendingComment && alignToAnchors
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
  }, [alignToAnchors, inlineThreads, pendingComment, scrollContainerRef]);

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
  }, [openThreadKey, pendingComment, recomputeOffsets]);

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

  const items = layoutCommentThreads(
    inlineThreads,
    threadPositions,
    threadCardHeights,
    inlineSuggestions.find((suggestion) => suggestion.id === activeSuggestionId)
      ?.threadId ??
      inlineDraftSuggestions.find(
        (suggestion) => suggestion.id === activeSuggestionId,
      )?.threadId ??
      selectedThreadId,
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
  ) => (
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
      onHeightChange={handleThreadCardHeightChange}
      members={members}
      canComment={canComment && !thread.resolved}
      canResolve={canResolve}
      onSubmitReply={() => handleReply(thread.threadId)}
      onResolve={() =>
        thread.resolved ? handleReopen(thread) : handleResolve(thread)
      }
      resolved={Boolean(thread.resolved)}
      renderEntry={(id) => (
        <CommentEntry
          comment={thread.comments.find((comment) => comment.id === id)!}
          documentId={documentId}
          currentUserEmail={currentUserEmail}
          canComment={canComment}
          members={members}
        />
      )}
      onSendToAI={() => handleSendToAI(thread)}
      t={t}
    />
  );

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
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconFilter size={14} />
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
        <div className="grid gap-2 p-3">
          {isLoading ? (
            [0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-24 animate-pulse rounded-lg bg-muted/60"
                aria-hidden="true"
              />
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
            historyEntries.map((entry) => {
              if (entry.kind === "draft")
                return renderDraftSuggestionCard(entry.suggestion);
              if (entry.kind === "suggestion")
                return renderSuggestionCard(entry.suggestion);
              if (entry.thread.resolved)
                return renderCommentThread(entry.thread);
              if (replyingThreadId === entry.thread.threadId)
                return renderCommentThread(
                  entry.thread,
                  0,
                  activeThreadId === entry.thread.threadId,
                );
              return (
                <HistoryThreadView
                  key={entry.thread.threadId}
                  thread={entry.thread}
                  onOpen={() => onActivateThread?.(entry.thread.threadId)}
                />
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
          className={
            alignToAnchors
              ? "absolute left-2 right-4 z-10 rounded-lg bg-popover p-3 shadow-md ring-1 ring-border/50"
              : "relative mx-2 mt-3 rounded-lg bg-popover p-3 shadow-md ring-1 ring-border/50"
          }
          style={
            alignToAnchors
              ? { top: pendingOffset ?? pendingComment.offsetTop }
              : undefined
          }
        >
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
            onEscape={() => {
              if (!pendingText.trim()) handlePendingCancel();
            }}
            members={members}
            placeholder={t("comments.add")}
            disabled={pendingSubmitting}
          />
          <div className="flex justify-end gap-1 mt-1.5">
            <button
              onClick={handlePendingCancel}
              disabled={pendingSubmitting}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent"
            >
              {t("comments.cancel")}
            </button>
            <button
              onClick={handlePendingSubmit}
              disabled={
                !pendingText.trim() ||
                pendingSubmitting ||
                !pendingTargetValid ||
                ambiguousCreate()
              }
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {t("comments.submit")}
            </button>
          </div>
        </div>
      )}

      {/* Open thread cards — positioned to align with their referenced text */}
      {items.map((item, index) => {
        const { thread, marginTop, top, isOrphaned } = item;
        if ("suggestion" in thread) {
          return "durability" in thread.suggestion
            ? renderDraftSuggestionCard(thread.suggestion, marginTop)
            : renderSuggestionCard(thread.suggestion, marginTop);
        }
        const isActive = activeThreadId === thread.threadId;
        const startsOrphanedSection =
          isOrphaned &&
          !items.slice(0, index).some((prior) => prior.isOrphaned);
        return (
          <Fragment key={thread.threadId}>
            {startsOrphanedSection ? (
              <div
                className="absolute inset-x-2 flex items-center gap-2 text-[11px] text-muted-foreground"
                style={{ top: Math.max(0, top - 20) }}
                data-unanchored-comments
              >
                <span className="h-px flex-1 bg-border" />
                <span>{t("comments.unanchored")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            {renderCommentThread(thread, marginTop, isActive)}
          </Fragment>
        );
      })}
    </div>
  );
}

function HistoryThreadView({
  thread,
  onOpen,
}: {
  thread: CommentThread;
  onOpen: () => void;
}) {
  const first = thread.comments[0];
  const t = useT();
  const labelId = useId();
  const contentId = useId();
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-lg bg-popover shadow-sm ring-1 ring-border/50 group/history relative">
      <button
        type="button"
        className="absolute inset-0 rounded-lg hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-labelledby={`${labelId} ${contentId}`}
        onClick={onOpen}
      />
      <div className="pointer-events-none relative p-3">
        {thread.quotedText ? (
          <p className="mb-2 line-clamp-2 border-s-2 border-border ps-[26px] text-xs italic leading-4 text-muted-foreground">
            {thread.quotedText}
          </p>
        ) : null}
        <div className="flex items-start gap-2">
          <CommentAvatar
            email={first.author_email}
            name={first.author_name ?? first.author_email}
            className="size-5 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex h-5 min-w-0 items-center gap-1.5">
              <span
                id={labelId}
                className="truncate text-[13px] font-semibold leading-5 text-foreground"
              >
                {first.author_name ?? first.author_email.split("@")[0]}
              </span>
              <CommentAttributionBadge comment={first} />
            </div>
            <div
              id={contentId}
              className="break-words text-start text-[13px] leading-5 text-foreground/90 [&_a]:pointer-events-auto [&_a]:relative"
            >
              {renderCommentBody(first.content, first.mentions)}
            </div>
          </div>
        </div>
        {thread.comments.length > 1 && (
          <span className="mt-2 block text-xs text-muted-foreground">
            {t("comments.replyCount", { count: thread.comments.length - 1 })}
          </span>
        )}
      </div>
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
    const nextText = after?.changedText;
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
  t,
}: {
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
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      {decision === "accepted" ? (
                        <IconCheck size={14} />
                      ) : (
                        <IconX size={14} />
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
  t,
}: {
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
            <ReviewCommentMenu
              alwaysVisible={compact}
              documentId={documentId}
              suggestionId={suggestion.id}
              threadId={suggestion.threadId}
              commentId={commentId}
              discussion={comments.data.discussion}
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
            {anchorUnavailable ? (
              <span className="text-xs text-muted-foreground">
                {t("comments.unanchored")}
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
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      {decision === "accepted" ? (
                        <IconCheck size={14} />
                      ) : (
                        <IconX size={14} />
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
  members,
  onHoverChange,
  onExpand,
  onCollapse,
  onReplyChange,
  onReplyMentionAdd,
  onHeightChange,
  onSubmitReply,
  onResolve,
  canComment,
  canResolve,
  onSendToAI,
  expandLabel,
  firstEntryBody,
  threadActions,
  feedback,
  headerStatus,
  renderCommentActions,
  renderCommentFooter,
  t,
}: {
  renderEntry?: (id: string) => ReactNode;
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
  members: MentionMember[];
  onHoverChange: (hovered: boolean) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onReplyChange: (text: string) => void;
  onReplyMentionAdd: (entry: MentionEntry) => void;
  onHeightChange: (threadId: string, height: number) => void;
  onSubmitReply: () => void;
  onResolve: () => void;
  canComment: boolean;
  canResolve: boolean;
  onSendToAI?: () => void;
  expandLabel?: string;
  firstEntryBody?: ReactNode;
  threadActions?: ReactNode;
  feedback?: ReactNode;
  headerStatus?: ReactNode;
  renderCommentActions?: (commentId: string) => ReactNode;
  renderCommentFooter?: (commentId: string) => ReactNode;
  t: ReturnType<typeof useT>;
}) {
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded && canComment && replyDrafts) {
      const timer = setTimeout(() => {
        const input = replyInputRef.current;
        const saved = replyDrafts.focus.current;
        if (
          !input ||
          !saved ||
          input.closest("[inert]") ||
          saved?.documentId !== documentId ||
          saved.threadId !== thread.threadId
        )
          return;
        input.focus({ preventScroll: true });
        if (saved.start !== undefined && saved.end !== undefined) {
          input.setSelectionRange(saved.start, saved.end, saved.direction);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, canComment]);

  useLayoutEffect(() => {
    const input = replyInputRef.current;
    if (!input || !replyDrafts || !documentId) return;
    const capture = () => {
      if (document.activeElement !== input) return;
      replyDrafts.focus.current = {
        documentId,
        threadId: thread.threadId,
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
      };
    };
    const blur = () => {
      if (
        input.isConnected &&
        !input.closest("[inert]") &&
        replyDrafts.focus.current?.threadId === thread.threadId
      ) {
        replyDrafts.focus.current = null;
      }
    };
    input.addEventListener("focus", capture);
    input.addEventListener("select", capture);
    input.addEventListener("input", capture);
    input.addEventListener("blur", blur);
    return () => {
      if (replyDrafts.focus.current?.threadId === thread.threadId) capture();
      input.removeEventListener("focus", capture);
      input.removeEventListener("select", capture);
      input.removeEventListener("input", capture);
      input.removeEventListener("blur", blur);
    };
  }, [isExpanded, documentId, thread.threadId, replyDrafts?.focus]);

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
      className={cn(
        "group/thread mx-2 mr-4 cursor-pointer rounded-lg shadow-md ring-1 ring-border/50 transition-[background-color,transform,translate] duration-[260ms] ease-[var(--ease-drawer)] motion-reduce:transform-none motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:focus-within:translate-x-0",
        isActive
          ? "-translate-x-2 bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))] shadow-lg"
          : "bg-popover hover:-translate-x-2 hover:bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))] hover:shadow-lg focus-within:-translate-x-2 focus-within:bg-[color-mix(in_srgb,hsl(var(--accent))_60%,hsl(var(--popover)))] focus-within:shadow-lg",
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
      <div className="relative p-3 pb-2">
        {/* Hover actions — top right, Notion style pill */}
        <div className="pointer-events-none absolute top-2 right-2 flex items-center rounded-md bg-accent/80 opacity-0 ring-1 ring-border/50 transition-opacity group-hover/thread:pointer-events-auto group-hover/thread:opacity-100 group-focus-within/thread:pointer-events-auto group-focus-within/thread:opacity-100">
          {threadActions}
          {onSendToAI ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("comments.askAi")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendToAI();
                  }}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-l-md hover:bg-accent"
                >
                  <IconMessageCircle size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("comments.askAi")}</TooltipContent>
            </Tooltip>
          ) : null}
          {canResolve ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t(
                    resolved ? "comments.reopen" : "comments.resolve",
                  )}
                  disabled={isSubmitting}
                  onClick={(e) => {
                    e.stopPropagation();
                    onResolve();
                  }}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  {resolved ? (
                    <IconArrowBackUp size={14} />
                  ) : (
                    <IconCheck size={14} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t(resolved ? "comments.reopen" : "comments.resolve")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        {/* Comments */}
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
        {thread.comments.map((c, index) =>
          renderEntry ? (
            <Fragment key={c.id}>{renderEntry(c.id)}</Fragment>
          ) : (
            <div key={c.id} className="group/comment mb-3 last:mb-0">
              <div
                className={cn(
                  "mb-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5",
                  index === 0 && threadActions ? "pr-16" : undefined,
                )}
              >
                <CommentAvatar
                  email={c.author_email}
                  name={c.author_name ?? c.author_email}
                />
                <span className="text-[13px] font-semibold text-foreground">
                  {c.author_name ?? c.author_email.split("@")[0]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {index === 0 && timeLabel
                    ? timeLabel
                    : formatDate(c.created_at)}
                </span>
                {index === 0 && headerStatus ? (
                  <span className="flex gap-1 text-xs text-muted-foreground">
                    {headerStatus}
                  </span>
                ) : null}
                {renderCommentActions?.(c.id)}
              </div>
              <div className="text-[13px] text-foreground/90 pl-8 leading-relaxed">
                {index === 0 && firstEntryBody !== undefined
                  ? firstEntryBody
                  : renderCommentBody(c.content, c.mentions)}
                {renderCommentFooter?.(c.id)}
              </div>
            </div>
          ),
        )}
      </div>

      {feedback}
      {/* Expanded: Notion-style reply input */}
      {isExpanded && canComment && !resolved && (
        <div
          data-comment-reply-composer
          className="flex items-center gap-2 px-3 pb-3 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <CommentAvatar
            email={thread.comments[0]?.author_email}
            name={
              thread.comments[0]?.author_name ??
              thread.comments[0]?.author_email
            }
            className="h-6 w-6 shrink-0 opacity-40"
          />
          <div className="flex-1 relative">
            <CommentComposer
              ref={replyInputRef}
              value={replyText}
              onChange={onReplyChange}
              onMentionAdd={onReplyMentionAdd}
              onSubmit={onSubmitReply}
              onEscape={() => {
                onCollapse();
                requestAnimationFrame(() => cardRef.current?.focus());
              }}
              members={members}
              placeholder={t("comments.reply")}
              disabled={isSubmitting}
              rows={1}
              className="block w-full resize-none bg-transparent [font-family:inherit] text-[13px] leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none pe-8"
            />
            <div className="absolute right-1 bottom-0.5 flex items-center gap-0.5">
              <button
                type="button"
                aria-label={t("comments.submit")}
                onClick={onSubmitReply}
                disabled={!replyText.trim() || isSubmitting}
                className="p-1 rounded-full text-muted-foreground/40 hover:text-foreground disabled:opacity-30"
              >
                <IconArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
