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
  IconArrowBackUp,
  IconCircleCheck,
  IconCornerDownRight,
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

import type { DocumentProperty } from "@shared/api";
import type { CommentAnchorBlockType } from "@shared/comment-block-anchor";
import {
  commentMentionsForText,
  findCommentMentions,
} from "@shared/comment-mentions";
import type { CommentPropertyTarget } from "@shared/comment-property-target";
import {
  findReplaceSuggestionSummary,
  suggestionDiffParts,
} from "@shared/suggestion-diff";
import {
  suggestionAnchorText,
  suggestionTextForDisplay,
  type SuggestionPresentationContext,
} from "@shared/suggestion-text";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateComment,
  useDeleteComment,
  useResolveComment,
  type CommentThread,
} from "@/hooks/use-comments";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";

import {
  commentTabKey,
  commentTabsFromProperties,
  commentThreadFieldId,
  commentThreadPlacement,
  groupCommentsByTab,
  showsCommentTabs,
  type CommentTabGroup,
  type CommentTabPlacement,
} from "./block-field-comment-threads";
import {
  blockFieldEditor,
  inHiddenBlockFieldPanel,
  primaryBlockFieldEditor,
} from "./blockFieldTabs";
import type { CommentTextAnchor } from "./comment-anchors";
import {
  commentThreadAt,
  commentThreadMarkSelector,
  commentThreadQuote,
} from "./comment-block-anchors";
import {
  draftMention,
  useCommentDraft,
  useCommentDraftContext,
  useCommentPanelSession,
  type CommentDraft,
  type MentionEntry,
} from "./comment-drafts";
import type { CommentAiSelection } from "./CommentAiRecipient";
import {
  aiRecipientMention,
  CommentComposer,
  type CommentAiDraft,
  type CommentAiSubmitPayload,
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
import {
  commentThreadOrderFacts,
  compareDiscussionEntries,
  DISCUSSION_SORTS,
  DISCUSSION_TARGETS,
  DiscussionComposer,
  discussionThreadTarget,
  DiscussionToolbar,
  isPageCommentThread,
  suggestionMatchesSearch,
  threadMatchesSearch,
  threadMentions,
  type DiscussionChip,
  type DiscussionFilterGroup,
  type DiscussionOrderFacts,
  type DiscussionSort,
  type DiscussionTarget,
} from "./discussion-panel";
import {
  PropertyThreadTargetLabel,
  propertyThreadTarget,
  type PropertyThreadTarget,
} from "./property-comments";
export { getAiCommentSource } from "./CommentEntry";
import {
  clipMarginThreadId,
  optimisticClipCommentId,
  seekClip,
  useClipStackFronts,
} from "./clip-embed/clip-comments";
import { msToClock } from "./clip-embed/scrubber-position";
import { useClipCommentWrites } from "./clip-embed/use-clip-comment-writes";
import {
  CommentAiConversation,
  CommentAiRequestStatus,
  isCommentAiWorkingOn,
  latestCommentAiRequest,
  startCommentAiSubmission,
  type CommentAiController,
} from "./comment-ai";
import {
  commentBlockKey,
  commentStackFront,
  commentStackKey,
  groupCommentStacks,
  measureCommentBlocks,
  type CommentBlockPlacement,
  type CommentStack,
} from "./comment-stacks";
import {
  CommentStackCard,
  CommentStackGuide,
  CommentStackHeader,
  CommentStackSheets,
  CommentStackShowAll,
} from "./CommentStack";
import {
  ReviewAddReactionButton,
  ReviewCommentMenu,
  ReviewReactionList,
} from "./ReviewDiscussionTools";
import { ProposalGroup, SuggestionDecisionButtons } from "./SuggestionControls";
import type { DraftSuggestion } from "./suggestions/draft-session";
import { SuggestionText } from "./SuggestionText";
import {
  proposalGroups,
  receiptSuggestion,
  suggestionSourceThreadId,
  suggestionsByThread,
} from "./thread-suggestions";
import { ThreadSuggestionBody, ThreadSuggestionRow } from "./ThreadSuggestion";

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

/**
 * Who a comment mentions, in the text order of its chips, for storage. An
 * agent chip stands for the agent the comment was sent to, so a comment sent
 * to none mentions none.
 */
function mentionsJsonFor(
  text: string,
  mentions: readonly MentionEntry[],
  agent?: CommentAiSelection,
): string | undefined {
  return commentMentionsForText(
    text,
    mentions.flatMap((entry) =>
      entry.kind !== "agent"
        ? [draftMention(entry)]
        : agent
          ? [aiRecipientMention(agent)]
          : [],
    ),
  );
}

function isAmbiguousCommentCreateError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown }).status;
  const timedOut = (error as Error & { timedOut?: unknown }).timedOut;
  return (
    timedOut === true ||
    (typeof status === "number"
      ? status < 400 || status === 408 || status >= 500
      : /^Action (?:add-comment|reply-review-comment) failed:/.test(
          error.message,
        ) || error.name === "AbortError")
  );
}

/** The session's name for the signed-in person's own entries, if it has one. */
function ownAuthorName(
  authorEmail: string | null | undefined,
  currentUserEmail?: string,
  currentUserName?: string,
) {
  const name = currentUserName?.trim();
  return name &&
    authorEmail &&
    authorEmail.trim().toLowerCase() === currentUserEmail?.trim().toLowerCase()
    ? name
    : null;
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

function anchorPosition(
  top: number,
  scrollContainer: HTMLElement,
  layoutContainer: HTMLElement | null,
): CommentThreadPosition {
  const documentContent =
    (scrollContainer.querySelector(
      "[data-document-scroll-content]",
    ) as HTMLElement | null) ?? scrollContainer;
  return {
    documentTop: top - documentContent.getBoundingClientRect().top,
    layoutTop: layoutContainer
      ? top - layoutContainer.getBoundingClientRect().top
      : null,
  };
}

/**
 * Where a thread's highlight is. `fieldId` names the Blocks field tab whose
 * editor holds it; null or omitted is the page body. A highlight in a tab
 * that isn't open has no position.
 */
export function findThreadPosition(
  threadId: string,
  quotedText: string | null,
  scrollContainer: HTMLElement | null,
  layoutContainer: HTMLElement | null,
  anchorAttribute:
    | "data-comment-thread"
    | "data-suggestion-id" = "data-comment-thread",
  fieldId: string | null = null,
): CommentThreadPosition | null {
  if (!scrollContainer) return null;
  const fieldEditor =
    fieldId === null ? null : blockFieldEditor(scrollContainer, fieldId);
  if (
    fieldId !== null &&
    (!fieldEditor || inHiddenBlockFieldPanel(fieldEditor))
  )
    return null;
  const marked = (fieldEditor ?? scrollContainer).querySelector(
    anchorAttribute === "data-comment-thread"
      ? commentThreadMarkSelector(threadId)
      : `${fieldEditor ? "" : ".ProseMirror "}[${anchorAttribute}="${cssEscape(threadId)}"]`,
  ) as HTMLElement | null;
  if (marked && !inHiddenBlockFieldPanel(marked)) {
    return anchorPosition(
      marked.getBoundingClientRect().top,
      scrollContainer,
      layoutContainer,
    );
  }

  if (!quotedText) return null;
  const pm = fieldEditor ?? primaryBlockFieldEditor(scrollContainer);
  if (!pm || inHiddenBlockFieldPanel(pm)) return null;
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
      return anchorPosition(
        range.getBoundingClientRect().top,
        scrollContainer,
        layoutContainer,
      );
    }
  }
  return null;
}

// The elements a page's text blocks render as.
const QUOTE_TEXT_BLOCKS = "p, h1, h2, h3, h4, h5, h6, pre";

/**
 * A quote as its highlight reads. A stored quote runs blocks together, so
 * where the highlight crosses into another block this puts a space. Null when
 * the highlight stays in one block or no longer holds the stored quote.
 */
export function highlightedQuote(
  marked: Iterable<Pick<Element, "textContent" | "closest">>,
  quotedText: string,
): string | null {
  let quote = "";
  let text = "";
  let block: Element | null | undefined;
  for (const element of marked) {
    const part = element.textContent ?? "";
    if (!part) continue;
    const owner = element.closest(QUOTE_TEXT_BLOCKS);
    if (block !== undefined && owner !== block) quote += " ";
    block = owner;
    quote += part;
    text += part;
  }
  return text === quotedText && quote !== text ? quote : null;
}

/**
 * The quotes of `threads` that read differently in their highlights, from one
 * pass over the page's highlights.
 */
function measureThreadQuotes(
  container: ParentNode,
  threads: readonly { threadId: string; quotedText?: string | null }[],
): Map<string, string> {
  const marked = new Map<string, Element[]>();
  for (const element of container.querySelectorAll(
    ".ProseMirror [data-comment-thread]",
  )) {
    const threadId = element.getAttribute("data-comment-thread")!;
    const elements = marked.get(threadId);
    if (elements) elements.push(element);
    else marked.set(threadId, [element]);
  }
  const quotes = new Map<string, string>();
  for (const { threadId, quotedText } of threads) {
    const elements = marked.get(threadId);
    const quote =
      elements && quotedText ? highlightedQuote(elements, quotedText) : null;
    if (quote) quotes.set(threadId, quote);
  }
  return quotes;
}

/** Whether a thread's tab is on the page but not open. */
function sameThreadIds(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...b].every((threadId) => a.has(threadId));
}

function sameQuotes(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
) {
  return (
    a.size === b.size && [...b].every(([id, quote]) => a.get(id) === quote)
  );
}

function threadTabHidden(
  scrollContainer: HTMLElement,
  fieldId: string | null,
): boolean {
  const editor = blockFieldEditor(scrollContainer, fieldId);
  return !!editor && inHiddenBlockFieldPanel(editor);
}

/** What a new comment sits beside: its text's highlight, or its Clip. */
function pendingCommentMark(
  container: ParentNode,
  clipRecordingId: string | null,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    clipRecordingId
      ? `[data-clip-embed="${cssEscape(clipRecordingId)}"]`
      : ".comment-highlight--pending",
  );
}

export function findPendingCommentPosition(
  scrollContainer: HTMLElement | null,
  layoutContainer: HTMLElement | null,
  clipRecordingId: string | null = null,
): CommentThreadPosition | null {
  if (!scrollContainer) return null;
  const pending = pendingCommentMark(scrollContainer, clipRecordingId);
  if (!pending) return null;
  return anchorPosition(
    pending.getBoundingClientRect().top,
    scrollContainer,
    layoutContainer,
  );
}

type ThreadLayoutIdentity = { threadId: string; comments: readonly unknown[] };

const NO_THREADS: CommentThread[] = [];
const NO_SUGGESTIONS: ResourceSuggestion[] = [];
const NO_DRAFT_SUGGESTIONS: DraftSuggestion[] = [];

export function estimateThreadCardHeight(thread: ThreadLayoutIdentity) {
  return 80 + Math.max(0, thread.comments.length - 1) * 44;
}

/**
 * The new-comment composer's slot in the rail layout. It takes the selected
 * slot, so the threads around it move aside instead of sitting under it.
 */
export const PENDING_COMMENT_LAYOUT_ID = "pending-comment";
const PENDING_COMMENT_CARD_ESTIMATE = 112;
/** How much of a new entry must show in a capped card to count as in view. */
const NEW_ENTRY_MIN_VISIBLE = 64;
/** An open stack's Collapse row, laid out like a card above its threads. */
const STACK_HEADER_LAYOUT_ID = "comment-stack-header";
const STACK_HEADER_HEIGHT = 28;
/** How long the pointer rests on a highlight before its thread comes to the front. */
const STACK_HOVER_INTENT_MS = 180;
const NO_BLOCKS: ReadonlyMap<string, CommentBlockPlacement> = new Map();
const NO_TOUCHES: ReadonlyMap<string, number> = new Map();

function sameBlocks(
  left: ReadonlyMap<string, CommentBlockPlacement>,
  right: ReadonlyMap<string, CommentBlockPlacement>,
) {
  if (left.size !== right.size) return false;
  for (const [threadId, placement] of right) {
    const prior = left.get(threadId);
    if (prior?.key !== placement.key || prior.order !== placement.order)
      return false;
  }
  return true;
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

/**
 * An open stack laid out as one block: its Collapse row, then its cards, each
 * at an offset from the block's top. The card in focus, selected or a new
 * comment, sits level with its highlight, under the cards before it when they
 * fit above it. Near the top of the margin they don't, and pushing them above
 * it would leave the Collapse row where nothing can scroll to it, so the card
 * in focus comes first and the rest follow in document order.
 */
export function arrangeOpenStack(
  cards: readonly { threadId: string; height: number }[],
  focusId: string | null,
  positions: ReadonlyMap<string, CommentThreadPosition>,
  headerHeight: number,
  gap = 12,
): { offsets: Map<string, number>; height: number; layoutTop: number | null } {
  const focusIndex = cards.findIndex((card) => card.threadId === focusId);
  const focus = focusIndex >= 0 ? cards[focusIndex] : undefined;
  const focusTop = focus
    ? (positions.get(focus.threadId)?.layoutTop ?? null)
    : null;
  const above = cards
    .slice(0, Math.max(0, focusIndex))
    .reduce((sum, card) => sum + card.height + gap, headerHeight + gap);
  const order =
    focus && focusTop !== null && focusTop < above
      ? [focus, ...cards.filter((_, index) => index !== focusIndex)]
      : cards;
  const offsets = new Map<string, number>();
  let bottom = headerHeight;
  for (const card of order) {
    offsets.set(card.threadId, bottom + gap);
    bottom += gap + card.height;
  }
  const anchor = focusTop !== null ? focus : cards[0];
  const anchorTop = anchor
    ? (positions.get(anchor.threadId)?.layoutTop ?? null)
    : null;
  return {
    offsets,
    height: bottom,
    layoutTop:
      anchor && anchorTop !== null
        ? anchorTop - (offsets.get(anchor.threadId) ?? 0)
        : null,
  };
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

export function preserveCommentComposerEscape(event: KeyboardEvent) {
  const target = event.target;
  if (
    event.key === "Escape" &&
    target instanceof HTMLElement &&
    (target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      target.getAttribute("contenteditable") === "true") &&
    target === target.ownerDocument.activeElement &&
    // Comment composers, including the Discussion page composer, and the
    // Discussion search close their own menus and boxes; Escape there must
    // not close the panel too.
    target.closest("[data-comment-composer], [data-discussion-toolbar]")
  ) {
    event.preventDefault();
  }
}

type CommentHistoryFilters = {
  status: "all" | "open" | "resolved";
  kind: "all" | "comments" | "suggestions";
  author: string | null;
  /** A Blocks field tab's key (see `commentTabKey`); null is every tab. */
  tab: string | null;
  target: "all" | DiscussionTarget;
  /** Only threads that @mention the reader. */
  mentionsMe: boolean;
  query: string;
  sort: DiscussionSort;
};
/** The filters each person keeps per Page; status and sort follow them. */
type PageHistoryFilters = Pick<
  CommentHistoryFilters,
  "kind" | "author" | "tab" | "target" | "mentionsMe"
>;
const defaultPageHistoryFilters: PageHistoryFilters = {
  kind: "all",
  author: null,
  tab: null,
  target: "all",
  mentionsMe: false,
};
const pageHistoryFilterKeys = Object.keys(
  defaultPageHistoryFilters,
) as (keyof PageHistoryFilters)[];

// Remembered values come back from storage, so anything unrecognized there
// reads as the default rather than as a filter nobody can see or clear.
function rememberedPageFilters(value: unknown): PageHistoryFilters {
  const stored =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof PageHistoryFilters, unknown>>)
      : {};
  return {
    kind:
      stored.kind === "comments" || stored.kind === "suggestions"
        ? stored.kind
        : "all",
    author: typeof stored.author === "string" ? stored.author : null,
    tab: typeof stored.tab === "string" ? stored.tab : null,
    target: DISCUSSION_TARGETS.includes(stored.target as DiscussionTarget)
      ? (stored.target as DiscussionTarget)
      : "all",
    mentionsMe: stored.mentionsMe === true,
  };
}

export function useCommentReplyDrafts(
  documentId: string,
  currentUserEmail?: string | null,
) {
  const accountKey = currentUserEmail?.trim().toLowerCase() ?? "";
  const draftStore = useCommentDraftContext();
  const [rememberedStatus, setRememberedStatus] = useLocalStorage<
    CommentHistoryFilters["status"]
  >(`content-review-status:${JSON.stringify(accountKey)}`, "open");
  const [storedSort, setRememberedSort] = useLocalStorage<DiscussionSort>(
    `content-discussion-sort:${JSON.stringify(accountKey)}`,
    "page",
  );
  const rememberedSort = DISCUSSION_SORTS.includes(storedSort)
    ? storedSort
    : "page";
  const pageFiltersKey = `content-discussion-filters:${JSON.stringify([
    accountKey,
    documentId,
  ])}`;
  const [storedPageFilters, setStoredPageFilters] =
    useLocalStorage<PageHistoryFilters>(
      pageFiltersKey,
      defaultPageHistoryFilters,
    );
  const pageFilters = useMemo(
    () => rememberedPageFilters(storedPageFilters),
    [storedPageFilters],
  );
  // Opening a conflict or a linked suggestion shows every thread without
  // saving over the filters someone chose. A search keeps that view; choosing
  // a filter there starts from what's on screen.
  const [revealed, setRevealed] = useState<{
    documentId: string;
    accountKey: string;
    status: boolean;
    filters: boolean;
  } | null>(null);
  const [search, setSearch] = useState({ documentId, query: "" });
  const revealedHistory = useRef<string | null>(null);
  useEffect(() => {
    setSearch({ documentId, query: "" });
    setRevealed(null);
    revealedHistory.current = null;
  }, [documentId, accountKey]);
  const revealedHere =
    revealed?.documentId === documentId && revealed.accountKey === accountKey
      ? revealed
      : null;
  const setHistoryFilters = useCallback(
    (filters: Partial<CommentHistoryFilters>) => {
      if (filters.status) setRememberedStatus(filters.status);
      if (filters.sort) setRememberedSort(filters.sort);
      const pageChange = pageHistoryFilterKeys.filter((key) => key in filters);
      const changesFilters = pageChange.length > 0;
      if (pageChange.length) {
        const next = {
          ...(revealedHere?.filters ? defaultPageHistoryFilters : pageFilters),
          ...Object.fromEntries(pageChange.map((key) => [key, filters[key]])),
        };
        setStoredPageFilters(next);
        // Only Pages someone has filtered keep an entry.
        if (
          pageHistoryFilterKeys.every(
            (key) => next[key] === defaultPageHistoryFilters[key],
          )
        ) {
          try {
            window.localStorage.removeItem(pageFiltersKey);
            // coercion-ok: the in-memory filters are already the defaults.
          } catch {}
        }
      }
      if ("query" in filters)
        setSearch({ documentId, query: filters.query ?? "" });
      if (filters.status || changesFilters)
        setRevealed((current) =>
          current
            ? {
                ...current,
                status: filters.status ? false : current.status,
                filters: changesFilters ? false : current.filters,
              }
            : current,
        );
    },
    [
      documentId,
      pageFilters,
      pageFiltersKey,
      revealedHere?.filters,
      setRememberedSort,
      setRememberedStatus,
      setStoredPageFilters,
    ],
  );
  const revealHistory = useCallback(
    (conflictId: string | null, focusId: string | null) => {
      const key =
        conflictId || focusId ? `${documentId}:${conflictId}:${focusId}` : null;
      if (revealedHistory.current === key) return;
      revealedHistory.current = key;
      if (key) {
        setRevealed({ documentId, accountKey, status: true, filters: true });
        setSearch({ documentId, query: "" });
      }
    },
    [documentId, accountKey],
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
  const replyRetries = useRef(
    new Map<string, { payload: string; operationId: string }>(),
  );
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
      status: revealedHere?.status ? ("all" as const) : rememberedStatus,
      ...(revealedHere?.filters ? defaultPageHistoryFilters : pageFilters),
      query: search.documentId === documentId ? search.query : "",
      sort: rememberedSort,
    } satisfies CommentHistoryFilters,
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
    setMentions: (threadId: string, mentions: MentionEntry[]) =>
      update(threadId, (draft) => ({ ...draft, mentions })),
    setAiDraft: (threadId: string, aiDraft: CommentAiDraft | null) =>
      update(threadId, (draft) => ({ ...draft, aiDraft })),
    clear: (threadId: string) =>
      update(threadId, () => ({ text: "", mentions: [], aiDraft: null })),
    discard: (threadId: string) =>
      draftStore.discard(`reply:${documentId}:${threadId}`),
    beginSubmission: (threadId: string, operationId: string) => {
      const key = `reply:${documentId}:${threadId}`;
      return draftStore.beginSubmission(
        key,
        operationId,
        draftStore.drafts.get(key) ?? {
          text: "",
          mentions: [],
          aiDraft: null,
          revision: 0,
        },
      );
    },
    restoreSubmittedDraft: (threadId: string, operationId: string) =>
      draftStore.restoreSubmittedDraft(
        `reply:${documentId}:${threadId}`,
        operationId,
      ),
    finishSubmission: draftStore.finishSubmission,
    isSubmitting: (threadId: string) =>
      draftStore.isSubmittingDraft(`reply:${documentId}:${threadId}`),
    retryOperationId: (threadId: string, payload: string) => {
      const retry = replyRetries.current.get(threadId);
      return retry?.payload === payload ? retry.operationId : undefined;
    },
    rememberRetry: (threadId: string, payload: string, operationId: string) =>
      replyRetries.current.set(threadId, { payload, operationId }),
    clearRetry: (threadId: string, operationId: string) => {
      if (replyRetries.current.get(threadId)?.operationId === operationId) {
        replyRetries.current.delete(threadId);
      }
    },
  };
}

export type PendingCommentSelection = {
  quotedText: string;
  offsetTop: number;
  anchor?: CommentTextAnchor;
  range?: { from: number; to: number; blockId?: string };
  /** Set when the comment is on a whole block, such as a video. */
  block?: { blockId: string; blockType: CommentAnchorBlockType };
  /** The Blocks field tab the quoted text is in; absent is the page body. */
  fieldId?: string | null;
  /** Set when the comment is on a Property value instead of quoted text. */
  property?: CommentPropertyTarget;
  /** The Collection whose Property it is. */
  databaseId?: string | null;
  /** Set when the comment starts a thread at a moment of a Clip's video. */
  clip?: { recordingId: string; videoTimestampMs: number };
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
    (
      selection: PendingCommentSelection | null,
      options?: { keepWritten?: boolean },
    ) => {
      // Opening another thread leaves a comment someone has started, so
      // nothing they wrote is lost; an empty one closes as before.
      if (!selection && options?.keepWritten && current.current) {
        const { text, mentions, aiDraft } = pendingDraftRef.current.draft;
        if (
          current.current.submitting ||
          text.trim() ||
          mentions.length ||
          aiDraft
        )
          return;
      }
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
  /** The Page's Properties, so a Property thread can say what changed. */
  documentProperties?: readonly DocumentProperty[];
  isLoading?: boolean;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  activeThreadId?: string | null;
  selectedThreadId?: string | null;
  onActivateThread?: (id: string) => void;
  activeSuggestionId?: string | null;
  unplaceableSuggestionRevisions?: ReadonlyMap<string, number>;
  focusSuggestionId?: string | null;
  onSuggestionFocused?: () => void;
  hoveredSuggestionId?: string | null;
  anchoredSuggestionIds?: string[] | null;
  onActivateSuggestion?: (id: string) => void;
  onSelectedThreadChange?: (id: string | null) => void;
  onHoveredThreadChange?: (id: string | null) => void;
  /** The thread whose highlight the pointer is on. */
  hoveredThreadId?: string | null;
  currentUserEmail?: string;
  /** The signed-in person's display name, for their own suggestions. */
  currentUserName?: string;
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
  /** Shows the decision on a draft at once, then saves and decides it. */
  onDecideDraftSuggestion?: (
    suggestion: DraftSuggestion,
    decision: SuggestionDecision,
  ) => void;
  canDecideSuggestions?: boolean;
  decidingSuggestion?: (suggestionId: string) => boolean;
  onDecideSuggestion?: (
    suggestion: ResourceSuggestion,
    decision: SuggestionDecision,
  ) => void;
  onDecideSuggestionProposal?: (
    proposalId: string,
    decision: SuggestionDecision,
    pendingMembers: ResourceSuggestion[],
  ) => void;
  visibleThreadId?: string | null;
  presentation?: "inline" | "history";
  /** Card treatment: margin rail, anchored popover, or the comments panel. */
  surface?: CommentSurface;
  /** Closes the anchored popover; shown as its header close button. */
  onClose?: () => void;
  /** Extra header actions for each comment thread's card. */
  renderThreadActions?: (thread: CommentThread) => ReactNode;
  /** Whether comment highlights show on the page; the panel can switch them. */
  highlightsVisible?: boolean;
  onHighlightsVisibleChange?: (visible: boolean) => void;
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
  documentProperties,
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
  unplaceableSuggestionRevisions,
  focusSuggestionId,
  onSuggestionFocused,
  hoveredSuggestionId,
  anchoredSuggestionIds,
  onActivateSuggestion,
  onSelectedThreadChange,
  onHoveredThreadChange,
  hoveredThreadId,
  currentUserEmail,
  currentUserName,
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
  onDecideDraftSuggestion,
  canDecideSuggestions = false,
  decidingSuggestion = () => false,
  onDecideSuggestion,
  onDecideSuggestionProposal,
  visibleThreadId,
  presentation = "inline",
  surface: surfaceProp,
  onClose,
  renderThreadActions,
  highlightsVisible = true,
  onHighlightsVisibleChange,
}: CommentsSidebarProps) {
  const surface: CommentSurface =
    surfaceProp ?? (presentation === "history" ? "panel" : "rail");
  const t = useT();
  const aiModelStorageKey = commentAiModelStorageKey(
    currentUserEmail,
    currentUserOrgId,
  );
  const createComment = useCreateComment({ email: currentUserEmail });
  const clipWrites = useClipCommentWrites(documentId, {
    email: currentUserEmail,
    name: currentUserName,
  });
  const deleteComment = useDeleteComment();
  const resolveComment = useResolveComment();
  const queryClient = useQueryClient();
  const pendingDraft = useCommentDraft("pending");
  const pageDraft = useCommentDraft("page");
  const pageComposerRef = useRef<TiptapComposerHandle>(null);
  const draftStore = useCommentDraftContext();
  const [pendingHandoff, setPendingHandoff] = useState<{
    id: symbol;
    operationId: string;
  } | null>(null);
  const pendingCommentRef = useRef(pendingComment);
  pendingCommentRef.current = pendingComment;
  const pendingHandoffHasThread =
    pendingHandoff !== null &&
    threads.some(
      (thread) =>
        thread.threadId === `optimistic-${pendingHandoff.operationId}` ||
        thread.comments.some(
          (comment) =>
            comment.mutation?.operationId === pendingHandoff.operationId,
        ),
    );
  const displayedPendingComment =
    pendingComment?.id === pendingHandoff?.id && pendingHandoffHasThread
      ? null
      : pendingComment;
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
  const pendingSubmitting = !!pendingComment?.submitting;
  const {
    status: historyStatus,
    kind: historyKind,
    author: historyAuthor,
    tab: historyTab,
    target: historyTarget,
    mentionsMe: historyMentionsMe,
    query: historyQuery,
    sort: historySort,
  } = replyDrafts.historyFilters;
  const setHistoryFilters = replyDrafts.setHistoryFilters;
  // With several Blocks fields, the panel groups and filters by tab.
  const commentTabs = useMemo(
    () => commentTabsFromProperties(documentProperties),
    [documentProperties],
  );
  const groupsByTab =
    presentation === "history" &&
    showsCommentTabs(documentProperties && commentTabs, threads);
  const historyTabOptions = useMemo(
    () =>
      groupsByTab
        ? groupCommentsByTab(threads, commentTabs, commentThreadPlacement, true)
        : [],
    [commentTabs, groupsByTab, threads],
  );
  // A tab deleted since it was chosen shows every tab again.
  const activeHistoryTab =
    historyTab !== null &&
    historyTabOptions.some((option) => option.key === historyTab)
      ? historyTab
      : null;
  const tabGroupLabel = (group: CommentTabGroup<unknown>) => {
    const name =
      group.name ??
      (group.fieldId === null ? t("comments.pageBody") : group.fieldId);
    return group.removed ? t("comments.fieldRemoved", { name }) : name;
  };
  const historySearch = historyQuery.trim();
  // A filter someone chose; showing open threads is where the panel starts.
  const historyNarrowed =
    historyStatus !== "open" ||
    historyKind !== "all" ||
    historyAuthor !== null ||
    activeHistoryTab !== null ||
    historyTarget !== "all" ||
    historyMentionsMe ||
    historySearch !== "";
  const [historyPortalContainer, setHistoryPortalContainer] =
    useState<HTMLDivElement | null>(null);
  // A failed accept leaves the suggestion pending at the revision that failed.
  // Amending it keeps the id but bumps the revision, and the new edit may place.
  const isUnplaceable = (suggestion: ResourceSuggestion) =>
    suggestion.status === "pending" &&
    unplaceableSuggestionRevisions?.get(suggestion.id) === suggestion.revision;
  const activeConflictId = suggestions.find(
    (suggestion) =>
      suggestion.id === activeSuggestionId &&
      (suggestion.status === "stale" || isUnplaceable(suggestion)),
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
          // A comment on the whole page has nothing in the margin to sit by;
          // it lives in the Discussion panel.
          !(presentation === "inline" && isPageCommentThread(thread)) &&
          (!thread.resolved ||
            (presentation === "inline" &&
              (thread.threadId === selectedThreadId ||
                commentAi?.freshResolutions.has(thread.threadId)))),
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
  // An AI suggestion asked for from a comment lives inside that thread, so it
  // never gets a second card with its own Accept and Reject.
  const threadSuggestions = useMemo(
    () => suggestionsByThread(suggestions, threads),
    [suggestions, threads],
  );
  const embeddedSuggestionIds = useMemo(
    () =>
      new Set(
        [...threadSuggestions.values()]
          .flat()
          .map((suggestion) => suggestion.id),
      ),
    [threadSuggestions],
  );
  // A suggestion whose text is gone has nothing to point at in the margin; it
  // stays reviewable in the comments panel.
  const inlineSuggestions = useMemo(
    () =>
      suggestions.filter(
        (suggestion) =>
          suggestion.status === "pending" &&
          !embeddedSuggestionIds.has(suggestion.id) &&
          (alignToAnchors || suggestion.id === activeSuggestionId) &&
          (suggestion.id === activeSuggestionId ||
            !anchoredSuggestionIds ||
            anchoredSuggestionIds.includes(suggestion.id)),
      ),
    [
      suggestions,
      alignToAnchors,
      activeSuggestionId,
      anchoredSuggestionIds,
      embeddedSuggestionIds,
    ],
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
  // The panel puts every open thread in page order, so it measures where
  // each suggested edit sits, not just the one the page has selected.
  const measuredThreads = useMemo(
    () =>
      presentation === "history"
        ? [
            ...openThreads,
            ...suggestions
              .filter(
                (suggestion) =>
                  suggestion.status === "pending" &&
                  !embeddedSuggestionIds.has(suggestion.id),
              )
              .map((suggestion) => ({
                threadId: suggestion.threadId,
                comments: [],
                suggestion,
              })),
            ...draftSuggestions.map((suggestion) => ({
              threadId: suggestion.threadId,
              comments: [],
              suggestion,
            })),
          ]
        : inlineThreads,
    [
      draftSuggestions,
      embeddedSuggestionIds,
      inlineThreads,
      openThreads,
      presentation,
      suggestions,
    ],
  );
  const inlineProposalMembers = useMemo(() => {
    const groups = new Map<string, ResourceSuggestion[]>();
    for (const suggestion of inlineSuggestions) {
      if (!suggestion.proposalId) continue;
      if (groups.has(suggestion.proposalId)) continue;
      groups.set(
        suggestion.proposalId,
        suggestions.filter(
          (member) => member.proposalId === suggestion.proposalId,
        ),
      );
    }
    return groups;
  }, [inlineSuggestions, suggestions]);
  const proposalMemberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const suggestion of suggestions) {
      if (!suggestion.proposalId) continue;
      counts.set(
        suggestion.proposalId,
        (counts.get(suggestion.proposalId) ?? 0) + 1,
      );
    }
    return counts;
  }, [suggestions]);
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

  // In the margin, a block with two or more open threads folds into one
  // card. Opening it lays its threads out as cards; one stack opens at once.
  const stacksEnabled =
    presentation === "inline" &&
    surface === "rail" &&
    alignToAnchors &&
    !visibleThreadId;
  const [threadBlocks, setThreadBlocks] = useState(NO_BLOCKS);
  // The open threads the blocks were measured for. A thread the margin hasn't
  // measured yet sits outside its stack, so until then a stack's front is
  // only provisional: a posted comment's saved copy, say, before its highlight.
  const [placedThreadIds, setPlacedThreadIds] = useState<string | null>(null);
  // The block a new comment's text is in, once measured; `key` is null for
  // text in no block, such as a Property.
  const [pendingBlock, setPendingBlock] = useState<{
    id: symbol;
    key: string | null;
  } | null>(null);
  // The open stack's threads, as last laid out. Whichever stack still holds
  // one of them is open, so it outlasts its block key shifting and the thread
  // it was opened on being resolved.
  const [openStack, setOpenStack] = useState<ReadonlySet<string> | null>(null);
  // When each thread was last touched, so a folded stack shows that one.
  // Thread ids are unique across tabs, so a touch never crosses tabs.
  const [stackTouches, setStackTouches] = useState(NO_TOUCHES);
  // The thread each folded card last showed in front, by its stack's threads,
  // so a card that comes back with another thread in front plays the change.
  const [shownStackFronts] = useState(() => new Map<string, string>());
  const touchCountRef = useRef(0);
  const touchThread = useCallback((threadId: string) => {
    touchCountRef.current += 1;
    const touch = touchCountRef.current;
    setStackTouches((prev) => new Map(prev).set(threadId, touch));
  }, []);
  // A thread just posted is selected without moving the open stack.
  const postedThreadIdRef = useRef<string | null>(null);
  const focusStackKeyRef = useRef<string | null>(null);
  const commentStacks = useMemo(
    () => (stacksEnabled ? groupCommentStacks(openThreads, threadBlocks) : []),
    [openThreads, stacksEnabled, threadBlocks],
  );
  // A folded Clip stack follows its video: it shows the thread the playhead
  // last passed.
  const clipStackFronts = useClipStackFronts(
    documentId,
    commentStacks,
    (stack) => commentStackFront(stack.threads, stackTouches).threadId,
  );
  const openThreadIds = useMemo(
    () => openThreads.map((thread) => thread.threadId).join(","),
    [openThreads],
  );
  const stackOfThread = useMemo(() => {
    const stacks = new Map<string, CommentStack<CommentThread>>();
    for (const stack of commentStacks) {
      for (const member of stack.threads) stacks.set(member.threadId, stack);
    }
    return stacks;
  }, [commentStacks]);
  const stackOfThreadRef = useRef(stackOfThread);
  stackOfThreadRef.current = stackOfThread;
  const openThreadIdRef = useRef(hoveredThreadId ?? selectedThreadId);
  openThreadIdRef.current = hoveredThreadId ?? selectedThreadId;
  const pendingStackKey =
    displayedPendingComment && pendingBlock?.id === displayedPendingComment.id
      ? pendingBlock.key
      : undefined;
  const openedStack = openStack
    ? (commentStacks.find((stack) =>
        stack.threads.some((member) => openStack.has(member.threadId)),
      ) ?? null)
    : null;
  // A new comment outside the open stack folds it, as does leaving it with
  // nothing selected. A thread opened while the comment waits keeps its own.
  const pendingFoldsOpenStack =
    !selectedThreadId &&
    pendingStackKey !== undefined &&
    pendingStackKey !== (openedStack?.key ?? null);
  const expandedStack =
    pendingFoldsOpenStack || (!selectedThreadId && !pendingComment)
      ? null
      : openedStack;
  // A new comment on a folded stack opens on top of it.
  const composingStack =
    pendingStackKey == null || pendingStackKey === expandedStack?.key
      ? null
      : (commentStacks.find((stack) => stack.key === pendingStackKey) ?? null);

  const openStackOn = useCallback((threadId: string) => {
    const stack = stackOfThreadRef.current.get(threadId);
    setOpenStack(
      new Set(
        stack ? stack.threads.map((member) => member.threadId) : [threadId],
      ),
    );
  }, []);
  // Cards closed by a resolve still saving. One is passed over once the
  // selection leaves the thread that opened in its place or a new comment
  // starts, so a failed resolve doesn't take back what came after.
  const closedResolvesRef = useRef(
    new Set<{ selection: string | null; passedOver: boolean }>(),
  );
  useEffect(() => {
    for (const closed of closedResolvesRef.current) {
      if ((selectedThreadId ?? null) !== closed.selection || pendingComment)
        closed.passedOver = true;
    }
  }, [pendingComment, selectedThreadId]);
  const previousSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = selectedThreadId ?? null;
    if (!stacksEnabled || !selectedThreadId || selectedThreadId === previous)
      return;
    touchThread(selectedThreadId);
    const posted = postedThreadIdRef.current === selectedThreadId;
    postedThreadIdRef.current = null;
    if (!posted) openStackOn(selectedThreadId);
  }, [openStackOn, selectedThreadId, stacksEnabled, touchThread]);
  useEffect(() => {
    if (!openStack) return;
    if ((!selectedThreadId && !pendingComment) || pendingFoldsOpenStack) {
      setOpenStack(null);
    } else if (openedStack) {
      const members = openedStack.threads;
      if (
        members.length !== openStack.size ||
        members.some((member) => !openStack.has(member.threadId))
      )
        setOpenStack(new Set(members.map((member) => member.threadId)));
    } else if (
      // A thread selected before the margin measured its block may still
      // turn out to stack. Otherwise none of them does, and keeping them
      // would open a stack their block forms later by itself.
      !openThreads.some(
        (thread) =>
          !thread.resolved &&
          openStack.has(thread.threadId) &&
          !threadBlocks.has(thread.threadId),
      )
    ) {
      setOpenStack(null);
    }
  }, [
    openStack,
    openThreads,
    openedStack,
    pendingComment,
    pendingFoldsOpenStack,
    selectedThreadId,
    threadBlocks,
  ]);
  // A highlight click opens its stack and touches its thread, even one already
  // selected, whose selection doesn't change.
  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!stacksEnabled || !container) return;
    const openFromHighlight = (event: MouseEvent) => {
      const threadId = commentThreadAt(event.target, openThreadIdRef.current);
      if (!threadId || !stackOfThreadRef.current.has(threadId)) return;
      touchThread(threadId);
      openStackOn(threadId);
    };
    container.addEventListener("click", openFromHighlight);
    return () => container.removeEventListener("click", openFromHighlight);
  }, [openStackOn, scrollContainerRef, stacksEnabled, touchThread]);
  // Resting on a highlight brings its thread to the front of a folded stack;
  // passing over one on the way to the margin doesn't. It does so once per
  // rest, so a thread touched while the pointer stays put, like a comment
  // just posted, keeps the front.
  const peekedThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (peekedThreadRef.current !== hoveredThreadId)
      peekedThreadRef.current = null;
    if (!hoveredThreadId || peekedThreadRef.current) return;
    const stack = stackOfThread.get(hoveredThreadId);
    if (!stack || stack === expandedStack) return;
    const timer = setTimeout(() => {
      peekedThreadRef.current = hoveredThreadId;
      touchThread(hoveredThreadId);
    }, STACK_HOVER_INTENT_MS);
    return () => clearTimeout(timer);
  }, [expandedStack, hoveredThreadId, stackOfThread, touchThread]);
  const expandedStackKey = expandedStack?.key ?? null;
  const selectedInExpandedStack =
    !!selectedThreadId &&
    !!expandedStack?.threads.some(
      (member) => member.threadId === selectedThreadId,
    );
  useLayoutEffect(() => {
    if (!selectedInExpandedStack || !selectedThreadId) return;
    const card = sidebarRef.current?.querySelector<HTMLElement>(
      `[data-thread-card="${cssEscape(selectedThreadId)}"]`,
    );
    if (!card) return;
    // Opening from the folded card removes the button that had focus.
    const active = document.activeElement;
    if (!active || active === document.body)
      card.focus({ preventScroll: true });
    const timer = setTimeout(
      () => card.scrollIntoView?.({ block: "nearest", behavior: "smooth" }),
      300,
    );
    return () => clearTimeout(timer);
  }, [expandedStackKey, selectedInExpandedStack, selectedThreadId]);
  const pendingInExpandedStack =
    !!expandedStack && pendingStackKey === expandedStack.key;
  useLayoutEffect(() => {
    if (!pendingInExpandedStack) return;
    // Show all, under a new comment, removes the button that had focus.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    sidebarRef.current
      ?.querySelector<HTMLElement>(
        '[data-comment-pending] [contenteditable="true"]',
      )
      ?.focus({ preventScroll: true });
  }, [pendingInExpandedStack]);
  useLayoutEffect(() => {
    const key = focusStackKeyRef.current;
    if (key === null) return;
    const stack = [
      ...(sidebarRef.current?.querySelectorAll<HTMLElement>(
        "[data-comment-stack]",
      ) ?? []),
    ].find((element) => element.dataset.commentStack === key);
    const target = stack?.querySelector<HTMLElement>(
      "[data-comment-stack-open], [data-comment-stack-show-all]",
    );
    if (!target) return;
    focusStackKeyRef.current = null;
    target.focus({ preventScroll: true });
  });
  const collapseStack = (stack: CommentStack<CommentThread>) => {
    focusStackKeyRef.current = stack.key;
    setOpenStack(null);
    setReplyingThreadId(null);
    onSelectedThreadChange?.(null);
  };

  const historyAuthors = useMemo(() => {
    const authors = new Map<string, string>();
    // A name from any record outranks the email's local part from another.
    const addAuthor = (email: string | null, name?: string | null) => {
      if (!email) return;
      const known =
        name?.trim() || ownAuthorName(email, currentUserEmail, currentUserName);
      if (known) authors.set(email, known);
      else if (!authors.has(email)) authors.set(email, email.split("@")[0]);
    };
    for (const suggestion of suggestions) addAuthor(suggestion.authorEmail);
    for (const suggestion of draftSuggestions)
      addAuthor(suggestion.authorEmail);
    for (const thread of threads) {
      for (const comment of thread.comments) {
        addAuthor(comment.author_email, comment.author_name);
      }
    }
    return [...authors.entries()].sort((left, right) =>
      left[1].localeCompare(right[1]),
    );
  }, [
    currentUserEmail,
    currentUserName,
    draftSuggestions,
    suggestions,
    threads,
  ]);
  // Suggestions edit the page body, so they sit in its tab.
  const historyBodyTabShown =
    activeHistoryTab === null || activeHistoryTab === commentTabKey(null);
  // Suggested edits point at text and carry no @mentions of their own.
  const historyShowsSuggestions =
    historyKind !== "comments" &&
    historyBodyTabShown &&
    (historyTarget === "all" || historyTarget === "text") &&
    !historyMentionsMe;
  const historySuggestions = useMemo(() => {
    if (!historyShowsSuggestions) return [];
    return suggestions.filter((suggestion) => {
      if (historyKind === "all" && embeddedSuggestionIds.has(suggestion.id))
        return false;
      const unresolved =
        suggestion.status === "pending" || suggestion.status === "stale";
      if (historyStatus === "open" && !unresolved) {
        return false;
      }
      if (historyStatus === "resolved" && unresolved) {
        return false;
      }
      if (historyAuthor && suggestion.authorEmail !== historyAuthor)
        return false;
      return suggestionMatchesSearch(suggestion, historySearch);
    });
  }, [
    embeddedSuggestionIds,
    historyAuthor,
    historyKind,
    historySearch,
    historyShowsSuggestions,
    historyStatus,
    suggestions,
  ]);
  const historyDraftSuggestions = useMemo(() => {
    if (!historyShowsSuggestions) return [];
    if (historyStatus === "resolved") return [];
    return draftSuggestions.filter(
      (suggestion) =>
        (!historyAuthor || suggestion.authorEmail === historyAuthor) &&
        suggestionMatchesSearch(suggestion, historySearch),
    );
  }, [
    draftSuggestions,
    historyAuthor,
    historySearch,
    historyShowsSuggestions,
    historyStatus,
  ]);
  // Comments someone just posted on the page stay in view even when their
  // filters would hide them, until they change the filters.
  const [postedThreadIds, setPostedThreadIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const keepPostedThread = useCallback(
    (threadId: string) =>
      setPostedThreadIds((current) =>
        current.has(threadId) ? current : new Set(current).add(threadId),
      ),
    [],
  );
  useEffect(() => {
    setPostedThreadIds((current) => (current.size === 0 ? current : new Set()));
  }, [
    activeHistoryTab,
    documentId,
    historyAuthor,
    historyKind,
    historyMentionsMe,
    historySearch,
    historyStatus,
    historyTarget,
  ]);
  const historyThreads = useMemo(() => {
    return threads.filter((thread) => {
      // A linked thread, or one just posted, shows whatever the filters say,
      // Type included. So does one with a comment or reply whose save wasn't
      // confirmed: its card holds the only way to check it.
      if (
        thread.threadId === selectedThreadId ||
        postedThreadIds.has(thread.threadId) ||
        thread.comments.some(
          (comment) =>
            comment.mutation?.ambiguous && comment.mutation.kind === "create",
        )
      )
        return true;
      if (historyKind === "suggestions") return false;
      if (
        activeHistoryTab !== null &&
        commentTabKey(commentThreadFieldId(thread)) !== activeHistoryTab
      )
        return false;
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
      if (
        historyTarget !== "all" &&
        discussionThreadTarget(thread) !== historyTarget
      )
        return false;
      if (historyMentionsMe && !threadMentions(thread, currentUserEmail))
        return false;
      return threadMatchesSearch(thread, historySearch);
    });
  }, [
    activeHistoryTab,
    currentUserEmail,
    historyAuthor,
    historyKind,
    historyMentionsMe,
    historySearch,
    historyStatus,
    historyTarget,
    threads,
    selectedThreadId,
    postedThreadIds,
  ]);

  const [threadPositions, setThreadPositions] = useState<
    Map<string, CommentThreadPosition>
  >(new Map());
  // The threads the last measurement looked for. One that came after it, such
  // as a comment posted while highlights are hidden, hasn't been looked for.
  const [measuredThreadIds, setMeasuredThreadIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // Threads whose highlight waits in a tab that isn't open: still on the page.
  const [hiddenTabThreadIds, setHiddenTabThreadIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // Quotes whose highlight crosses a block, with a space where it does.
  const [threadQuotes, setThreadQuotes] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  // Highlights shown again that the editor hasn't drawn yet.
  const highlightsReturningRef = useRef(false);
  const propertyOrder = useMemo(
    () =>
      new Map(
        (documentProperties ?? []).map((property, index) => [
          property.definition.id,
          index,
        ]),
      ),
    [documentProperties],
  );
  const historyEntries = useMemo(() => {
    const textFacts = (
      id: string,
      threadId: string,
      createdAt: string,
      lastActivityAt: string,
      offset: number | undefined,
    ): DiscussionOrderFacts => {
      const top = threadPositions.get(threadId)?.documentTop;
      return top === undefined
        ? {
            rank: 3,
            position: offset ?? Infinity,
            createdAt,
            lastActivityAt,
            id,
          }
        : { rank: 2, position: top, createdAt, lastActivityAt, id };
    };
    return [
      ...historyDraftSuggestions.map((suggestion) => ({
        kind: "draft" as const,
        id: suggestion.id,
        order: textFacts(
          suggestion.id,
          suggestion.threadId,
          suggestion.createdAt,
          suggestion.createdAt,
          suggestion.anchor.from,
        ),
        suggestion,
      })),
      ...historySuggestions.map((suggestion) => ({
        kind: "suggestion" as const,
        id: suggestion.id,
        order: textFacts(
          suggestion.id,
          suggestion.threadId,
          suggestion.createdAt,
          suggestion.updatedAt || suggestion.createdAt,
          undefined,
        ),
        suggestion,
      })),
      ...historyThreads.map((thread) => ({
        kind: "comment" as const,
        id: thread.threadId,
        order: commentThreadOrderFacts(thread, {
          documentTop: threadPositions.get(thread.threadId)?.documentTop,
          propertyIndex: (propertyId) => propertyOrder.get(propertyId) ?? -1,
        }),
        thread,
      })),
    ].sort(
      (left, right) =>
        Number(right.id === activeConflictId) -
          Number(left.id === activeConflictId) ||
        compareDiscussionEntries(historySort, left.order, right.order),
    );
  }, [
    activeConflictId,
    historyDraftSuggestions,
    historySort,
    historySuggestions,
    historyThreads,
    propertyOrder,
    threadPositions,
  ]);

  const pendingFocus = displayedPendingComment?.focus;
  useEffect(() => {
    if (!pendingFocus || presentation !== "inline") return;
    // A new comment has no saved caret yet ({}); a draft that lost focus has
    // none at all (null) and stays put. A new comment takes focus from the
    // page, which keeps it through the toolbar click or shortcut that opened
    // the comment, so typing goes into the comment. A restored draft only
    // takes focus nobody else holds.
    const isNew =
      pendingFocus.current !== null && pendingFocus.current.start === undefined;
    let movedAway = false;
    const relinquish = (event: FocusEvent) => {
      if (!pendingCardRef.current?.contains(event.target as Node))
        movedAway = true;
    };
    document.addEventListener("focusin", relinquish);
    let attempts = 0;
    let frame = 0;
    const focusComposer = () => {
      const input = pendingInputRef.current;
      const card = pendingCardRef.current;
      const saved = pendingFocus.current;
      if (!saved || movedAway) return;
      if (input && card) {
        if (card.contains(document.activeElement)) return;
        const active = document.activeElement;
        if (
          !isNew &&
          active &&
          active !== document.body &&
          active !== document.documentElement &&
          active.isConnected
        )
          return;
        input.focus();
        if (saved.start !== undefined && saved.end !== undefined)
          input.setSelection(saved.start, saved.end, saved.direction);
        if (card.contains(document.activeElement)) return;
      }
      // The composer may still be mounting, or hidden while its popover is
      // positioned; focus can't land until it's on screen.
      if (++attempts < 30) frame = requestAnimationFrame(focusComposer);
    };
    const timer = setTimeout(focusComposer, 50);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", relinquish);
    };
  }, [pendingFocus, presentation]);

  // A Clip's thread is saved in Clips; the margin knows it by an id that
  // also names the Clip.
  const startClipThread = async (
    clip: { recordingId: string; videoTimestampMs: number },
    content: string,
    operationId: string,
  ) => {
    const saved = await clipWrites.startThread({
      recordingId: clip.recordingId,
      content,
      videoTimestampMs: clip.videoTimestampMs,
      operationId,
    });
    return {
      id: saved.id,
      threadId: clipMarginThreadId(clip.recordingId, saved.threadId),
    };
  };

  const handlePendingSubmit = async (
    agent?: CommentAiSelection,
  ): Promise<{
    id: string;
    threadId: string;
  } | null> => {
    if (!canComment) return null;
    if (
      !pendingComment ||
      !pendingText.trim() ||
      pendingSubmitting ||
      draftStore.isSubmittingDraft("pending") ||
      !pendingTargetValid ||
      ambiguousCreate()
    )
      return null;
    const id = pendingComment.id;
    const clientOperationId = crypto.randomUUID();
    const clip = pendingComment.clip;
    pendingDraft.beginSubmission(clientOperationId);
    onPendingChange(id, () => ({ submitting: true }));
    setPendingHandoff({ id, operationId: clientOperationId });
    touchThread(
      clip
        ? clipMarginThreadId(
            clip.recordingId,
            optimisticClipCommentId(clientOperationId),
          )
        : `optimistic-${clientOperationId}`,
    );
    try {
      const result = clip
        ? await startClipThread(clip, pendingText.trim(), clientOperationId)
        : await createComment.mutateAsync({
            clientOperationId,
            documentId,
            content: pendingText.trim(),
            ...(pendingComment.property
              ? {
                  propertyId: pendingComment.property.propertyId,
                  databaseId: pendingComment.databaseId ?? undefined,
                }
              : pendingComment.block
                ? {
                    blockId: pendingComment.block.blockId,
                    blockType: pendingComment.block.blockType,
                    ...(pendingComment.fieldId
                      ? { fieldId: pendingComment.fieldId }
                      : {}),
                  }
                : {
                    quotedText: pendingComment.quotedText,
                    anchorPrefix: pendingComment.anchor?.prefix,
                    anchorSuffix: pendingComment.anchor?.suffix,
                    anchorStartOffset: pendingComment.anchor?.startOffset,
                    ...(pendingComment.fieldId
                      ? { fieldId: pendingComment.fieldId }
                      : {}),
                  }),
            mentions: mentionsJsonFor(pendingText, pendingMentions, agent),
          });
      pendingDraft.finishSubmission(clientOperationId);
      setPendingHandoff(null);
      // The new thread is its stack's front. Selecting it leaves its stack
      // as it was, open or folded.
      touchThread(result.threadId);
      if (pendingCommentRef.current?.id === id) {
        postedThreadIdRef.current = result.threadId;
        onPendingDone(id, result.threadId);
      }
      return { id: result.id, threadId: result.threadId };
    } catch (error) {
      const isCurrentPendingComment = pendingCommentRef.current?.id === id;
      if (!isAmbiguousCommentCreateError(error) && isCurrentPendingComment) {
        pendingDraft.restoreSubmittedDraft(clientOperationId);
        setPendingHandoff(null);
      }
      pendingDraft.finishSubmission(clientOperationId);
      if (isCurrentPendingComment) {
        onPendingChange(id, () => ({ submitting: false }));
      }
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  // A new comment that mentions AI is posted first, then AI works on it as
  // the root of its own thread, exactly as it would for a reply.
  const handlePendingAiSubmit = async (selection: CommentAiSubmitPayload) => {
    if (!commentAi) return;
    const instructions = pendingText.trim();
    const created = await handlePendingSubmit(selection);
    if (!created) return;
    try {
      await startCommentAiSubmission(commentAi, {
        threadId: created.threadId,
        rootCommentId: created.id,
        submittedMode: selection.intent,
        instructions,
        provider: selection.provider,
        model: selection.model,
        engine: selection.engine,
      });
    } catch (error) {
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const handlePendingCancel = () => {
    if (pendingComment) onPendingDone(pendingComment.id);
  };

  // A comment on the whole page: no quote and no Property.
  const pageSubmitting = draftStore.isSubmittingDraft("page");
  const handlePageSubmit = async (
    agent?: CommentAiSelection,
  ): Promise<{ id: string; threadId: string } | null> => {
    const text = pageDraft.draft.text.trim();
    if (!canComment || !text || pageSubmitting || ambiguousCreate())
      return null;
    const mentions = mentionsJsonFor(text, pageDraft.draft.mentions, agent);
    const clientOperationId = crypto.randomUUID();
    pageDraft.beginSubmission(clientOperationId);
    try {
      const result = await createComment.mutateAsync({
        clientOperationId,
        documentId,
        content: text,
        mentions,
      });
      pageDraft.finishSubmission(clientOperationId);
      keepPostedThread(result.threadId);
      return { id: result.id, threadId: result.threadId };
    } catch (error) {
      // An unconfirmed save keeps its card, which offers the check instead.
      if (!isAmbiguousCommentCreateError(error))
        pageDraft.restoreSubmittedDraft(clientOperationId);
      pageDraft.finishSubmission(clientOperationId);
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
  const handlePageAiSubmit = async (selection: CommentAiSubmitPayload) => {
    if (!commentAi) return;
    const instructions = pageDraft.draft.text.trim();
    const created = await handlePageSubmit(selection);
    if (!created) return;
    try {
      await startCommentAiSubmission(commentAi, {
        threadId: created.threadId,
        rootCommentId: created.id,
        submittedMode: selection.intent,
        instructions,
        provider: selection.provider,
        model: selection.model,
        engine: selection.engine,
      });
    } catch (error) {
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const handleReply = async (
    threadId: string,
    {
      holdDraft = false,
      agent,
    }: { holdDraft?: boolean; agent?: CommentAiSelection } = {},
  ): Promise<{ id: string; operationId: string } | null> => {
    const { text: replyText, mentions: replyMentions } =
      replyDrafts.get(threadId);
    if (!canComment) return null;
    if (
      !replyText.trim() ||
      draftStore.isSubmittingDraft(`reply:${documentId}:${threadId}`) ||
      isResolving(threadId) ||
      ambiguousCreate(threadId)
    )
      return null;
    const thread = threads?.find((t) => t.threadId === threadId);
    if (!thread || thread.resolved || !threadCanComment(thread)) return null;
    const payload = JSON.stringify({
      documentId,
      threadId,
      parentId: thread.comments[0]?.id,
      content: replyText.trim(),
      mentions: mentionsJsonFor(replyText, replyMentions, agent),
    });
    const clientOperationId =
      replyDrafts.retryOperationId(threadId, payload) ?? crypto.randomUUID();
    replyDrafts.beginSubmission(threadId, clientOperationId);
    try {
      const created = thread.clip
        ? await clipWrites.reply({
            recordingId: thread.clip.recordingId,
            threadId: thread.clip.threadId,
            content: replyText.trim(),
            operationId: clientOperationId,
          })
        : await createComment.mutateAsync({
            clientOperationId,
            documentId,
            content: replyText.trim(),
            threadId,
            parentId: thread?.comments[0]?.id,
            mentions: mentionsJsonFor(replyText, replyMentions, agent),
          });
      replyDrafts.clearRetry(threadId, clientOperationId);
      if (!holdDraft) replyDrafts.finishSubmission(clientOperationId);
      return { id: created.id, operationId: clientOperationId };
    } catch (error) {
      replyDrafts.restoreSubmittedDraft(threadId, clientOperationId);
      if (isAmbiguousCommentCreateError(error)) {
        replyDrafts.rememberRetry(threadId, payload, clientOperationId);
      } else {
        replyDrafts.clearRetry(threadId, clientOperationId);
      }
      replyDrafts.finishSubmission(clientOperationId);
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
      return null;
    }
  };

  const [threadCardHeights, setThreadCardHeights] = useState<
    Map<string, number>
  >(new Map());
  const [pendingPosition, setPendingPosition] =
    useState<CommentThreadPosition | null>(null);
  const [pendingCardHeight, setPendingCardHeight] = useState<number | null>(
    null,
  );
  const pendingCardRef = useRef<HTMLDivElement>(null);
  // An inline group remounts under its next card once its leading edit is
  // decided, so whether it is open has to outlive the group.
  const [expandedProposalIds, setExpandedProposalIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const setProposalExpanded = useCallback(
    (proposalId: string, expanded: boolean) =>
      setExpandedProposalIds((current) => {
        if (current.has(proposalId) === expanded) return current;
        const next = new Set(current);
        if (expanded) next.add(proposalId);
        else next.delete(proposalId);
        return next;
      }),
    [],
  );
  const inlineProposalLeaders = useMemo(() => {
    const leaders = new Map<string, string>();
    for (const proposalId of inlineProposalMembers.keys()) {
      if ((proposalMemberCounts.get(proposalId) ?? 0) < 2) continue;
      const first = inlineSuggestions
        .filter((suggestion) => suggestion.proposalId === proposalId)
        .sort(
          (left, right) =>
            (threadPositions.get(left.threadId)?.documentTop ?? Infinity) -
              (threadPositions.get(right.threadId)?.documentTop ?? Infinity) ||
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )[0];
      if (first) leaders.set(proposalId, first.threadId);
    }
    return leaders;
  }, [
    inlineProposalMembers,
    inlineSuggestions,
    proposalMemberCounts,
    threadPositions,
  ]);
  // A folded stack is laid out as its first thread; a new comment opened on
  // top of it takes its place.
  const stackHiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const stack of commentStacks) {
      if (stack === expandedStack) continue;
      const folded =
        stack === composingStack ? stack.threads : stack.threads.slice(1);
      for (const member of folded) hidden.add(member.threadId);
    }
    return hidden;
  }, [commentStacks, composingStack, expandedStack]);
  const layoutThreads = useMemo(
    () =>
      inlineThreads.filter((thread) =>
        "suggestion" in thread
          ? !("proposalId" in thread.suggestion) ||
            !thread.suggestion.proposalId ||
            (proposalMemberCounts.get(thread.suggestion.proposalId) ?? 0) < 2 ||
            inlineProposalLeaders.get(thread.suggestion.proposalId) ===
              thread.threadId
          : !stackHiddenIds.has(thread.threadId),
      ),
    [
      inlineThreads,
      inlineProposalLeaders,
      proposalMemberCounts,
      stackHiddenIds,
    ],
  );
  const openThreadKey = measuredThreads
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

  const hasPendingComment = !!displayedPendingComment;
  const pendingCommentId = displayedPendingComment?.id;
  const pendingFieldId = displayedPendingComment?.fieldId ?? null;
  const pendingOnProperty = !!displayedPendingComment?.property;
  const pendingClipId = displayedPendingComment?.clip?.recordingId ?? null;
  const recomputeOffsets = useCallback(() => {
    const container = scrollContainerRef?.current ?? null;
    const blocks =
      stacksEnabled && container
        ? measureCommentBlocks(container, openThreads)
        : NO_BLOCKS;
    setThreadBlocks((prev) => (sameBlocks(prev, blocks) ? prev : blocks));
    setPlacedThreadIds(openThreadIds);
    if (stacksEnabled && container && pendingCommentId) {
      const highlight = pendingOnProperty
        ? null
        : pendingCommentMark(container, pendingClipId);
      const block =
        highlight && !inHiddenBlockFieldPanel(highlight)
          ? commentBlockKey(highlight)
          : null;
      // Text not drawn yet isn't known to be outside the open stack.
      if (pendingOnProperty || highlight) {
        const key =
          block === null ? null : commentStackKey(pendingFieldId, block);
        setPendingBlock((prev) =>
          prev?.id === pendingCommentId && prev.key === key
            ? prev
            : { id: pendingCommentId, key },
        );
      }
    }
    const layoutContainer = alignToAnchors ? sidebarRef.current : null;
    const nextPendingPosition =
      hasPendingComment && alignToAnchors
        ? findPendingCommentPosition(container, layoutContainer, pendingClipId)
        : null;
    setPendingPosition((prev) =>
      prev?.documentTop === nextPendingPosition?.documentTop &&
      prev?.layoutTop === nextPendingPosition?.layoutTop
        ? prev
        : nextPendingPosition,
    );
    if (!container || measuredThreads.length === 0) {
      setThreadPositions((prev) => (prev.size === 0 ? prev : new Map()));
      setHiddenTabThreadIds((prev) => (prev.size === 0 ? prev : new Set()));
      setMeasuredThreadIds((prev) => (prev.size === 0 ? prev : new Set()));
      setThreadQuotes((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    // With highlights hidden there are no marks to measure, and guessing from
    // the text would reshuffle page order, so the last places measured stay.
    if (presentation === "history" && !highlightsVisible) return;
    if (highlightsReturningRef.current) {
      if (
        !container.querySelector(
          ".ProseMirror [data-comment-thread], .ProseMirror [data-comment-block-threads]",
        )
      )
        return;
      highlightsReturningRef.current = false;
    }
    const positions = new Map<string, CommentThreadPosition>();
    const hiddenTabIds = new Set<string>();
    for (const thread of measuredThreads) {
      const fieldId =
        "suggestion" in thread ? null : commentThreadFieldId(thread);
      const position = findThreadPosition(
        "suggestion" in thread ? thread.suggestion.id : thread.threadId,
        "suggestion" in thread ? null : thread.quotedText,
        container,
        layoutContainer,
        "suggestion" in thread ? "data-suggestion-id" : "data-comment-thread",
        fieldId,
      );
      if (position) positions.set(thread.threadId, position);
      else if (threadTabHidden(container, fieldId))
        hiddenTabIds.add(thread.threadId);
    }
    const quotes = measureThreadQuotes(container, openThreads);
    setThreadQuotes((prev) => (sameQuotes(prev, quotes) ? prev : quotes));
    const lookedFor = new Set(measuredThreads.map((thread) => thread.threadId));
    setHiddenTabThreadIds((prev) =>
      sameThreadIds(prev, hiddenTabIds) ? prev : hiddenTabIds,
    );
    setMeasuredThreadIds((prev) =>
      sameThreadIds(prev, lookedFor) ? prev : lookedFor,
    );
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
  }, [
    alignToAnchors,
    hasPendingComment,
    highlightsVisible,
    measuredThreads,
    openThreadIds,
    openThreads,
    pendingClipId,
    pendingCommentId,
    pendingFieldId,
    pendingOnProperty,
    presentation,
    scrollContainerRef,
    stacksEnabled,
  ]);
  const recomputeOffsetsRef = useRef(recomputeOffsets);
  recomputeOffsetsRef.current = recomputeOffsets;

  // Shown again, highlights come back a moment after the panel hears of it.
  // Measured before then, each one would read "Highlight unavailable", so the
  // last places measured stay until the editor draws one, or until it's clear
  // none will come back.
  const highlightsWereVisibleRef = useRef(highlightsVisible);
  useLayoutEffect(() => {
    const shownAgain = highlightsVisible && !highlightsWereVisibleRef.current;
    highlightsWereVisibleRef.current = highlightsVisible;
    if (!shownAgain || presentation !== "history") return;
    highlightsReturningRef.current = true;
    const timer = setTimeout(() => {
      if (!highlightsReturningRef.current) return;
      highlightsReturningRef.current = false;
      recomputeOffsetsRef.current();
    }, 250);
    return () => {
      clearTimeout(timer);
      highlightsReturningRef.current = false;
    };
  }, [highlightsVisible, presentation]);

  // Measured before paint, so a card under a new id never paints unplaced.
  useLayoutEffect(() => {
    const container = scrollContainerRef?.current ?? null;
    if (!container) return;

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recomputeOffsets);
    };
    recomputeOffsets();

    const observer = new MutationObserver(schedule);
    // Every Blocks field tab holds highlights, and opening one moves them.
    const panels = container.querySelectorAll("[data-block-field-panel]");
    if (panels.length > 0) {
      for (const panel of panels) {
        observer.observe(panel, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: [
            "hidden",
            "data-comment-thread",
            "data-comment-block-threads",
            "data-clip-comment-threads",
          ],
        });
      }
    } else {
      // A posted comment's highlight can reuse the draft's span, gaining only
      // its thread id, and a stack needs that id to place the thread.
      observer.observe(primaryBlockFieldEditor(container) ?? container, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "data-comment-thread",
          "data-comment-block-threads",
          "data-clip-comment-threads",
        ],
      });
    }
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

  useLayoutEffect(() => {
    const element = pendingCardRef.current;
    if (!element) {
      setPendingCardHeight(null);
      return;
    }
    const measure = () =>
      setPendingCardHeight(element.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pendingCommentId, alignToAnchors]);

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

  // The panel lists resolved threads too, so a link to one keeps it selected
  // there; it lets go once the thread is gone.
  const selectableThreads = presentation === "history" ? threads : openThreads;
  useEffect(() => {
    if (
      selectedThreadId &&
      !selectableThreads.some((thread) => thread.threadId === selectedThreadId)
    ) {
      onSelectedThreadChange?.(null);
      setReplyingThreadId(null);
    }
  }, [onSelectedThreadChange, selectedThreadId, selectableThreads]);

  const hasContent =
    presentation === "history"
      ? threads.length > 0 ||
        suggestions.length > 0 ||
        draftSuggestions.length > 0
      : layoutThreads.length > 0 || !!displayedPendingComment;
  if (!hasContent && !isLoading && !forceVisible) return null;

  const activeSavedSuggestion = inlineSuggestions.find(
    (suggestion) => suggestion.id === activeSuggestionId,
  );
  // A thread in a folded stack is laid out as the stack's card.
  const selectedStack = selectedThreadId
    ? stackOfThread.get(selectedThreadId)
    : undefined;
  const selectedLayoutThreadId =
    (activeSavedSuggestion?.proposalId
      ? inlineProposalLeaders.get(activeSavedSuggestion.proposalId)
      : activeSavedSuggestion?.threadId) ??
    inlineDraftSuggestions.find(
      (suggestion) => suggestion.id === activeSuggestionId,
    )?.threadId ??
    (selectedStack && selectedStack !== expandedStack
      ? selectedStack.threads[0].threadId
      : selectedThreadId);
  const restingItems = layoutCommentThreads(
    layoutThreads,
    threadPositions,
    threadCardHeights,
    null,
  );
  const restingItemsById = new Map(
    restingItems.map((item) => [item.thread.threadId, item]),
  );
  type LayoutThread = (typeof layoutThreads)[number];
  const pendingLayout: ThreadLayoutIdentity | null =
    displayedPendingComment && alignToAnchors
      ? { threadId: PENDING_COMMENT_LAYOUT_ID, comments: [] }
      : null;
  const pendingAnchorTop =
    pendingPosition?.layoutTop ?? displayedPendingComment?.offsetTop ?? 0;
  const pendingAnchor: CommentThreadPosition = {
    documentTop: pendingPosition?.documentTop ?? pendingAnchorTop,
    layoutTop: pendingAnchorTop,
  };
  const layoutPositions = new Map(threadPositions);
  const layoutHeights = new Map(threadCardHeights);
  if (pendingLayout) {
    layoutPositions.set(PENDING_COMMENT_LAYOUT_ID, pendingAnchor);
    layoutHeights.set(
      PENDING_COMMENT_LAYOUT_ID,
      pendingCardHeight ?? PENDING_COMMENT_CARD_ESTIMATE,
    );
  }
  // A thread opened while a new comment waits takes the slot; the waiting
  // comment keeps its place beside its own highlight.
  const layoutFocusId =
    pendingLayout && !selectedThreadId
      ? PENDING_COMMENT_LAYOUT_ID
      : selectedLayoutThreadId;
  // An open stack is laid out as one block, its Collapse row on top: its
  // threads' cards, and a new comment in it.
  // The stack has its threads in document order, which their highlights'
  // tops can't give when two share a line.
  const stackOrder = new Map(
    expandedStack?.threads.map((member, index) => [member.threadId, index]),
  );
  const documentTopOf = (thread: ThreadLayoutIdentity) =>
    layoutPositions.get(thread.threadId)?.documentTop ?? Infinity;
  const stackCards: ThreadLayoutIdentity[] = layoutThreads
    .filter((thread) => stackOrder.has(thread.threadId))
    .sort(
      (left, right) =>
        (stackOrder.get(left.threadId) ?? 0) -
        (stackOrder.get(right.threadId) ?? 0),
    );
  if (pendingInExpandedStack && pendingLayout) {
    const pendingTop = documentTopOf(pendingLayout);
    const after = stackCards.findIndex(
      (card) => documentTopOf(card) > pendingTop,
    );
    stackCards.splice(
      after === -1 ? stackCards.length : after,
      0,
      pendingLayout,
    );
  }
  const stackTop = Math.min(...stackCards.map(documentTopOf));
  const openStackLayout =
    stackCards.length > 0
      ? arrangeOpenStack(
          stackCards.map((card) => ({
            threadId: card.threadId,
            height:
              layoutHeights.get(card.threadId) ??
              estimateThreadCardHeight(card),
          })),
          layoutFocusId ?? null,
          layoutPositions,
          STACK_HEADER_HEIGHT,
        )
      : null;
  const stackLayout: ThreadLayoutIdentity | null = openStackLayout
    ? { threadId: STACK_HEADER_LAYOUT_ID, comments: [] }
    : null;
  if (openStackLayout) {
    if (Number.isFinite(stackTop)) {
      layoutPositions.set(STACK_HEADER_LAYOUT_ID, {
        documentTop: stackTop - 0.5,
        layoutTop: openStackLayout.layoutTop,
      });
    }
    layoutHeights.set(STACK_HEADER_LAYOUT_ID, openStackLayout.height);
  }
  const anchoredItems = layoutCommentThreads<
    LayoutThread | ThreadLayoutIdentity
  >(
    [
      ...layoutThreads.filter((thread) => !stackOrder.has(thread.threadId)),
      ...(pendingLayout && !pendingInExpandedStack ? [pendingLayout] : []),
      ...(stackLayout ? [stackLayout] : []),
    ],
    layoutPositions,
    layoutHeights,
    stackCards.some((card) => card.threadId === layoutFocusId)
      ? STACK_HEADER_LAYOUT_ID
      : layoutFocusId,
  );
  // Keeping a card lower down level with its highlight pushes the cards above
  // it upward, and could push an open stack's Collapse row above the margin,
  // where nothing can scroll to it. The stack starts at the top instead.
  const stackOverflow = Math.max(
    0,
    -(anchoredItems.find((item) => item.thread === stackLayout)?.top ?? 0),
  );
  const tops = new Map(
    anchoredItems.map((item) => [
      item.thread.threadId,
      item.top + stackOverflow,
    ]),
  );
  const stackHeaderTop = stackLayout
    ? tops.get(STACK_HEADER_LAYOUT_ID)
    : undefined;
  if (openStackLayout && stackHeaderTop !== undefined) {
    for (const [threadId, offset] of openStackLayout.offsets)
      tops.set(threadId, stackHeaderTop + offset);
  }
  const pendingTop = tops.get(PENDING_COMMENT_LAYOUT_ID) ?? pendingAnchorTop;
  // Cards keep the resting layout's order, since their places in the flow
  // follow it, and move by their offset from there.
  const items = restingItems.map((item) => ({
    ...item,
    top: tops.get(item.thread.threadId) ?? item.top,
  }));
  // The guide beside an open stack spans its cards.
  const stackGuideTop = (stackHeaderTop ?? 0) + STACK_HEADER_HEIGHT + 12 + 16;
  const stackGuideHeight =
    (stackHeaderTop ?? 0) + (openStackLayout?.height ?? 0) - 16 - stackGuideTop;

  // Resolving the open thread closes its card; staying selected would keep it
  // in the margin with no highlight to sit by. In an open stack the next
  // thread opens in its place, so the stack stays open for the rest.
  // Clips decides who comments on a Clip and who resolves its threads.
  const threadCanComment = (thread: CommentThread) =>
    canComment && (!thread.clip || thread.clip.canComment);
  const threadCanResolve = (thread: CommentThread) =>
    thread.clip ? canComment && thread.clip.canResolve : canResolve;
  // Opening a Clip's thread moves its video to the thread's moment.
  const seekToThread = (thread: CommentThread) => {
    if (!thread.clip) return;
    seekClip(documentId, thread.clip.recordingId, thread.clip.videoTimestampMs);
  };

  const closeResolvedThread = (threadId: string) => {
    const members = expandedStack?.threads ?? [];
    const index = members.findIndex((member) => member.threadId === threadId);
    const rest = members.filter((member) => member.threadId !== threadId);
    const next =
      index >= 0 && rest.length >= 2
        ? (rest[Math.min(index, rest.length - 1)]?.threadId ?? null)
        : null;
    setReplyingThreadId(null);
    onSelectedThreadChange?.(next);
    return next;
  };
  const changeResolution = async (thread: CommentThread, resolved: boolean) => {
    if (
      !threadCanResolve(thread) ||
      // Clips lists only open threads, so a resolved one is out of reach.
      (thread.clip && !resolved) ||
      thread.comments.some(
        (comment) =>
          comment.mutation?.status === "pending" || comment.mutation?.ambiguous,
      ) ||
      !startResolution(thread.threadId)
    )
      return;
    const closed =
      resolved &&
      presentation === "inline" &&
      thread.threadId === selectedThreadId
        ? { selection: closeResolvedThread(thread.threadId), passedOver: false }
        : null;
    if (closed) closedResolvesRef.current.add(closed);
    try {
      if (thread.clip) {
        await clipWrites.resolveThread({
          recordingId: thread.clip.recordingId,
          threadId: thread.clip.threadId,
        });
      } else {
        await resolveComment.mutateAsync({
          id: thread.comments[0].id,
          documentId,
          resolved,
        });
      }
    } catch (error) {
      // A failed resolve reopens the thread, so its card opens again too,
      // unless the selection has moved or a new comment started since.
      if (closed && !closed.passedOver)
        onSelectedThreadChange?.(thread.threadId);
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      if (closed) closedResolvesRef.current.delete(closed);
      finishResolution(thread.threadId);
    }
  };
  const handleResolve = (thread: CommentThread) => {
    void changeResolution(thread, true);
  };

  const handleReopen = (thread: CommentThread) => {
    void changeResolution(thread, false);
  };

  // Accepting moves the source thread's quote, which a revision still in
  // flight would read as changed feedback and abandon.
  const suggestionBusy = (suggestion: ResourceSuggestion) => {
    const threadId = suggestionSourceThreadId(suggestion);
    return (
      decidingSuggestion(suggestion.id) ||
      Boolean(
        commentAi && threadId && isCommentAiWorkingOn(commentAi, threadId),
      )
    );
  };

  const renderFoldedStack = (
    stack: CommentStack<CommentThread>,
    layoutId: string,
  ) => {
    const passed = clipStackFronts.get(stack.key);
    const front =
      stack.threads.find((member) => member.threadId === passed) ??
      commentStackFront(stack.threads, stackTouches);
    return (
      <CommentStackCard
        stackKey={stack.key}
        heightId={layoutId}
        threads={stack.threads}
        front={front}
        frontPlaced={placedThreadIds === openThreadIds}
        shownFronts={shownStackFronts}
        quotes={threadQuotes}
        isActive={stack.threads.some(
          (member) => member.threadId === activeThreadId,
        )}
        onOpen={() => {
          openStackOn(front.threadId);
          onActivateThread?.(front.threadId);
          seekToThread(front);
          if (threadCanComment(front)) setReplyingThreadId(front.threadId);
        }}
        onHoverChange={(hovered) =>
          onHoveredThreadChange?.(hovered ? front.threadId : null)
        }
        onHeightChange={handleThreadCardHeightChange}
        t={t}
      />
    );
  };

  const renderCommentThread = (
    thread: CommentThread,
    marginTop = 0,
    isActive = false,
    inStack = false,
  ) => {
    const aiRequest = commentAi
      ? latestCommentAiRequest(commentAi.requests, thread.threadId)
      : undefined;
    const continuation = aiRequest
      ? commentAi?.continuations.get(aiRequest.operationId)
      : undefined;
    const freshResolution =
      thread.resolved && commentAi?.freshResolutions.has(thread.threadId);
    const embedded = threadSuggestions.get(thread.threadId) ?? [];
    // A receipt links the first edit of its proposal and stands for them all.
    const groups = proposalGroups(embedded);
    const receipts = new Map<string, ResourceSuggestion[]>();
    for (const comment of thread.comments) {
      const suggestion = receiptSuggestion(comment, embedded);
      const group =
        suggestion && groups.find((members) => members.includes(suggestion));
      if (group) receipts.set(comment.id, group);
    }
    const receiptless = groups.filter(
      (group) => ![...receipts.values()].includes(group),
    );
    const aiWorking = Boolean(
      commentAi && isCommentAiWorkingOn(commentAi, thread.threadId),
    );
    const suggestionProps = (members: ResourceSuggestion[]) => {
      const proposalId = members.length > 1 ? members[0]?.proposalId : null;
      return {
        suggestions: members,
        canDecide: canDecideSuggestions,
        busy: suggestionBusy,
        conflict: isUnplaceable,
        onDecide: (
          suggestion: ResourceSuggestion,
          decision: SuggestionDecision,
        ) => onDecideSuggestion?.(suggestion, decision),
        onDecideRemaining:
          proposalId && onDecideSuggestionProposal
            ? (decision: SuggestionDecision) =>
                onDecideSuggestionProposal(
                  proposalId,
                  decision,
                  suggestions.filter(
                    (suggestion) =>
                      suggestion.proposalId === proposalId &&
                      suggestion.status === "pending",
                  ),
                )
            : undefined,
      };
    };
    const showsRequestSuggestion =
      aiRequest?.status === "suggested" &&
      embedded.some(
        (suggestion) => suggestion.id === aiRequest.result?.suggestionId,
      );
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
    // A reply that mentions AI is posted first, so "actually, make it X"
    // stays in the thread the AI answers in. When AI is already busy on the
    // thread, the reply is taken back and the draft restored, so retrying
    // does not post the same reply twice. A failed start keeps the reply: the
    // request may have been saved before its response was lost.
    const submitAi = async (selection: CommentAiSubmitPayload) => {
      if (!commentAi || !thread.comments[0] || aiWorking) return;
      const instructions = replyDrafts.get(thread.threadId).text.trim();
      if (!instructions) return;
      const rootCommentId = thread.comments[0].id;
      const reply = await handleReply(thread.threadId, {
        holdDraft: true,
        agent: selection,
      });
      if (!reply) return;
      let outcome: "confirmed-start" | "busy" | "failed" = "failed";
      try {
        outcome = await startCommentAiSubmission(commentAi, {
          threadId: thread.threadId,
          rootCommentId,
          submittedMode: selection.intent,
          instructions,
          provider: selection.provider,
          model: selection.model,
          engine: selection.engine,
          priorRequest: aiRequest,
        });
      } catch (error) {
        toast.error(t("empty.genericError"), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
      // Taken back only once the draft holds the reply again, and restored
      // before the delete: a delete whose response is lost may still have
      // removed the reply, and a leftover reply is visible. A reply typed
      // meanwhile keeps the draft, so the posted one stays.
      if (
        outcome === "busy" &&
        replyDrafts.restoreSubmittedDraft(thread.threadId, reply.operationId)
      ) {
        try {
          await deleteComment.mutateAsync({ id: reply.id, documentId });
        } catch (error) {
          toast.error(t("empty.genericError"), {
            description: error instanceof Error ? error.message : undefined,
          });
        }
      }
      replyDrafts.finishSubmission(reply.operationId);
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
        canExpand={threadCanComment(thread) || !!thread.clip}
        isExpanded={replyingThreadId === thread.threadId}
        isSubmitting={
          isResolving(thread.threadId) || ambiguousCreate(thread.threadId)
        }
        isReplySubmitting={replyDrafts.isSubmitting(thread.threadId)}
        replyText={replyDrafts.get(thread.threadId).text}
        replyMentions={replyDrafts.get(thread.threadId).mentions}
        aiDraft={replyDrafts.get(thread.threadId).aiDraft}
        onHoverChange={(hovered) =>
          onHoveredThreadChange?.(hovered ? thread.threadId : null)
        }
        onExpand={() => {
          seekToThread(thread);
          if (replyingThreadId === thread.threadId) return;
          onActivateThread?.(thread.threadId);
          scrollToCommentAnchor(
            scrollContainerRef?.current ?? null,
            threadPositions.get(thread.threadId)?.documentTop,
          );
          if (threadCanComment(thread)) setReplyingThreadId(thread.threadId);
        }}
        onCollapse={() => {
          setReplyingThreadId(null);
          onSelectedThreadChange?.(null);
        }}
        onReplyChange={(text) => replyDrafts.setText(thread.threadId, text)}
        onReplyMentionsChange={(mentions) =>
          replyDrafts.setMentions(thread.threadId, mentions)
        }
        onAiDraftChange={(aiDraft) =>
          replyDrafts.setAiDraft(thread.threadId, aiDraft)
        }
        onHeightChange={handleThreadCardHeightChange}
        canComment={threadCanComment(thread) && !thread.resolved}
        canResolve={threadCanResolve(thread)}
        onSubmitReply={() => handleReply(thread.threadId)}
        onResolve={() =>
          thread.resolved ? handleReopen(thread) : handleResolve(thread)
        }
        resolved={Boolean(thread.resolved)}
        surface={surface}
        onClose={onClose}
        threadActions={thread.clip ? undefined : renderThreadActions?.(thread)}
        currentUserEmail={currentUserEmail}
        quote={
          threadQuotes.get(thread.threadId) ?? commentThreadQuote(thread, t)
        }
        showQuote={inStack || !!thread.clip}
        propertyTarget={
          thread.property
            ? propertyThreadTarget(thread.property, documentProperties)
            : null
        }
        anchorUnavailable={
          measuredThreadIds.has(thread.threadId) &&
          (!!thread.quotedText || !!thread.block) &&
          !thread.resolved &&
          !threadPositions.has(thread.threadId) &&
          !hiddenTabThreadIds.has(thread.threadId)
        }
        renderEntry={(id, slots) => (
          <CommentEntry
            comment={thread.comments.find((comment) => comment.id === id)!}
            documentId={documentId}
            currentUserEmail={currentUserEmail}
            // A Clip's comments are kept in Clips, so the page doesn't edit,
            // delete, or react to them.
            canComment={canComment && !thread.clip}
            headerActions={slots.headerActions}
            revealActions={slots.revealActions}
            replyAction={slots.replyAction}
            body={
              receipts.has(id) ? (
                <ThreadSuggestionBody {...suggestionProps(receipts.get(id)!)} />
              ) : undefined
            }
            onCreatedCommentConfirmed={(operationId) => {
              // Once confirmed, a new thread is one just posted, saved under
              // its operation's id, so the filters still don't hide it.
              if (id === thread.comments[0]?.id) keepPostedThread(operationId);
              if (
                pendingHandoff?.operationId === operationId &&
                pendingCommentRef.current?.id === pendingHandoff.id
              ) {
                setPendingHandoff(null);
                onPendingDone?.(pendingHandoff.id);
              }
            }}
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
          (aiRequest && commentAi) || receiptless.length ? (
            <>
              {receiptless.map((members) => (
                <ThreadSuggestionRow
                  key={members[0]!.id}
                  {...suggestionProps(members)}
                />
              ))}
              {!aiRequest || !commentAi ? null : continuation ||
                aiRequest.status === "replied" ||
                (aiRequest.status === "suggested" && !showsRequestSuggestion) ||
                aiRequest.status === "resolved" ? (
                <CommentAiConversation
                  request={aiRequest}
                  revision={commentAi.transcriptRevision}
                  continuation={continuation}
                />
              ) : null}
              {!aiRequest ||
              !commentAi ||
              (showsRequestSuggestion && !continuation) ? null : (
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
              )}
            </>
          ) : undefined
        }
        onAiSubmit={
          commentAi && !thread.field && !thread.clip ? submitAi : undefined
        }
        aiModelStorageKey={
          commentAi && !thread.field ? aiModelStorageKey : undefined
        }
        t={t}
      />
    );
  };

  const renderSuggestionCard = (
    suggestion: ResourceSuggestion,
    marginTop = 0,
    onHeightChange = handleThreadCardHeightChange,
    inProposalGroup = false,
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
        currentUserName={currentUserName}
        compact={compact}
        replyDrafts={replyDrafts}
        key={suggestion.id}
        marginTop={marginTop}
        onHeightChange={onHeightChange}
        suggestion={suggestion}
        reason={inProposalGroup ? null : agentSuggestionReason(suggestion)}
        documentId={documentId}
        isActive={
          activeSuggestionId === suggestion.id ||
          hoveredSuggestionId === suggestion.id
        }
        expandRequested={expandedSuggestionId === suggestion.id}
        focusRequested={focusSuggestionId === suggestion.id}
        onFocused={onSuggestionFocused}
        anchorUnavailable={anchorUnavailable}
        unplaceable={isUnplaceable(suggestion)}
        canComment={canComment}
        canDecide={canDecideSuggestions}
        deciding={suggestionBusy(suggestion)}
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

  const renderProposalGroup = (
    proposalId: string,
    members: ResourceSuggestion[],
    leaderThreadId?: string,
  ) => (
    <ProposalGroup
      key={proposalId}
      proposalId={proposalId}
      summary={members[0]?.proposalSummary || members[0]?.summary || ""}
      totalCount={proposalMemberCounts.get(proposalId) ?? members.length}
      members={members}
      active={members.some(
        (member) =>
          member.id === activeSuggestionId || member.id === focusSuggestionId,
      )}
      expanded={expandedProposalIds.has(proposalId)}
      onExpandedChange={(expanded) => setProposalExpanded(proposalId, expanded)}
      deciding={members.some(suggestionBusy)}
      acceptDisabled={members.some(isUnplaceable)}
      canDecide={canDecideSuggestions && !!onDecideSuggestionProposal}
      onDecide={(decision) =>
        onDecideSuggestionProposal?.(
          proposalId,
          decision,
          suggestions.filter(
            (suggestion) =>
              suggestion.proposalId === proposalId &&
              suggestion.status === "pending",
          ),
        )
      }
      onHeightChange={
        leaderThreadId
          ? (height) => handleThreadCardHeightChange(leaderThreadId, height)
          : undefined
      }
    >
      {members.map((member) => renderSuggestionCard(member, 0, () => {}, true))}
    </ProposalGroup>
  );

  const renderDraftSuggestionCard = (
    suggestion: DraftSuggestion,
    marginTop = 0,
  ) => (
    <DraftSuggestionThreadView
      surface={surface}
      onClose={onClose}
      currentUserEmail={currentUserEmail}
      currentUserName={currentUserName}
      key={suggestion.id}
      marginTop={marginTop}
      onHeightChange={handleThreadCardHeightChange}
      suggestion={suggestion}
      isActive={
        activeSuggestionId === suggestion.id ||
        hoveredSuggestionId === suggestion.id
      }
      canDecide={canDecideSuggestions}
      deciding={decidingSuggestion(suggestion.id)}
      onActivate={() => onActivateSuggestion?.(suggestion.id)}
      onMaterialize={onMaterializeDraft}
      onDecideDraft={onDecideDraftSuggestion}
      onActivateSaved={(saved) => {
        replyDrafts.setOpenReply(saved.threadId, saved.id);
        onActivateSuggestion?.(saved.id);
      }}
      onDecide={(saved, decision) => onDecideSuggestion?.(saved, decision)}
      t={t}
    />
  );

  if (presentation === "history") {
    const statusLabel = (status: CommentHistoryFilters["status"]) =>
      status === "all"
        ? t("comments.allStatuses")
        : status === "open"
          ? t("comments.open")
          : t("comments.resolvedStatus");
    const kindLabel = (kind: "comments" | "suggestions") =>
      kind === "comments" ? t("comments.title") : t("comments.suggestions");
    const targetLabel = (target: CommentHistoryFilters["target"]) =>
      target === "all"
        ? t("comments.allTargets")
        : target === "page"
          ? t("comments.targetPage")
          : target === "text"
            ? t("comments.targetText")
            : t("comments.targetProperty");
    const authorName = (email: string) =>
      historyAuthors.find(([candidate]) => candidate === email)?.[1] ??
      email.split("@")[0];
    const activeTabOption = historyTabOptions.find(
      (option) => option.key === activeHistoryTab,
    );
    const filterGroups: DiscussionFilterGroup[] = [
      {
        key: "status",
        label: t("comments.statusFilter"),
        options: (["open", "resolved", "all"] as const).map((status) => ({
          key: status,
          label: statusLabel(status),
          selected: historyStatus === status,
          onSelect: () => setHistoryFilters({ status }),
        })),
      },
      {
        key: "kind",
        label: t("comments.typeFilter"),
        // Both on is everything; turning one off leaves the other.
        options: (["comments", "suggestions"] as const).map((kind) => {
          const selected = historyKind === "all" || historyKind === kind;
          return {
            key: kind,
            label: kindLabel(kind),
            selected,
            onSelect: () =>
              setHistoryFilters({
                kind: !selected
                  ? "all"
                  : kind === "comments"
                    ? "suggestions"
                    : "comments",
              }),
          };
        }),
      },
      {
        key: "target",
        label: t("comments.targetFilter"),
        options: (["all", ...DISCUSSION_TARGETS] as const).map((target) => ({
          key: target,
          label: targetLabel(target),
          selected: historyTarget === target,
          onSelect: () => setHistoryFilters({ target }),
        })),
      },
      {
        key: "person",
        label: t("comments.authorFilter"),
        columns: 1,
        options: [
          {
            key: "mentions-me",
            label: t("comments.mentionsMe"),
            selected: historyMentionsMe,
            onSelect: () =>
              setHistoryFilters({ mentionsMe: !historyMentionsMe }),
          },
          {
            key: "everyone",
            label: t("comments.allAuthors"),
            selected: historyAuthor === null,
            onSelect: () => setHistoryFilters({ author: null }),
          },
          ...historyAuthors.map(([email, name]) => ({
            key: email,
            label: name,
            selected: historyAuthor === email,
            onSelect: () => setHistoryFilters({ author: email }),
          })),
        ],
      },
      ...(groupsByTab
        ? [
            {
              key: "tab",
              label: t("comments.tabFilter"),
              columns: 1 as const,
              options: [
                {
                  key: "all-tabs",
                  label: t("comments.allTabs"),
                  selected: activeHistoryTab === null,
                  onSelect: () => setHistoryFilters({ tab: null }),
                },
                ...historyTabOptions.map((option) => ({
                  key: option.key,
                  label: tabGroupLabel(option),
                  selected: activeHistoryTab === option.key,
                  onSelect: () => setHistoryFilters({ tab: option.key }),
                })),
              ],
            },
          ]
        : []),
    ];
    const chips: DiscussionChip[] = [
      ...(historyStatus !== "open"
        ? [
            {
              key: "status",
              label: `${t("comments.statusFilter")}: ${statusLabel(historyStatus)}`,
              onRemove: () => setHistoryFilters({ status: "open" }),
            },
          ]
        : []),
      ...(historyKind !== "all"
        ? [
            {
              key: "kind",
              label: `${t("comments.typeFilter")}: ${kindLabel(historyKind)}`,
              onRemove: () => setHistoryFilters({ kind: "all" }),
            },
          ]
        : []),
      ...(historyTarget !== "all"
        ? [
            {
              key: "target",
              label: `${t("comments.targetFilter")}: ${targetLabel(historyTarget)}`,
              onRemove: () => setHistoryFilters({ target: "all" }),
            },
          ]
        : []),
      ...(historyAuthor !== null
        ? [
            {
              key: "author",
              label: `${t("comments.authorFilter")}: ${authorName(historyAuthor)}`,
              onRemove: () => setHistoryFilters({ author: null }),
            },
          ]
        : []),
      ...(historyMentionsMe
        ? [
            {
              key: "mentions-me",
              label: t("comments.mentionsMe"),
              onRemove: () => setHistoryFilters({ mentionsMe: false }),
            },
          ]
        : []),
      ...(activeTabOption
        ? [
            {
              key: "tab",
              label: `${t("comments.tabFilter")}: ${tabGroupLabel(activeTabOption)}`,
              onRemove: () => setHistoryFilters({ tab: null }),
            },
          ]
        : []),
    ];
    const clearFilters = () =>
      setHistoryFilters({
        status: "open",
        kind: "all",
        target: "all",
        author: null,
        mentionsMe: false,
        tab: null,
        query: "",
      });
    const toolbar = (
      <DiscussionToolbar
        query={historyQuery}
        onQueryChange={(query) => setHistoryFilters({ query })}
        sort={historySort}
        onSortChange={(sort) => setHistoryFilters({ sort })}
        filterGroups={filterGroups}
        chips={chips}
        onClearFilters={clearFilters}
        portalContainer={historyPortalContainer}
        highlightsVisible={highlightsVisible}
        onHighlightsVisibleChange={onHighlightsVisibleChange}
      />
    );
    const composer = canComment ? (
      <div className="sticky bottom-0 z-10 mt-auto border-t border-border bg-background">
        <DiscussionComposer
          ref={pageComposerRef}
          currentUserEmail={currentUserEmail}
          value={pageDraft.draft.text}
          onChange={pageDraft.setText}
          mentions={pageDraft.draft.mentions}
          onMentionsChange={pageDraft.setMentions}
          aiDraft={pageDraft.draft.aiDraft}
          onAiDraftChange={pageDraft.setAiDraft}
          aiModelStorageKey={aiModelStorageKey}
          onSubmit={() => void handlePageSubmit()}
          onAiSubmit={commentAi ? handlePageAiSubmit : undefined}
          submitting={pageSubmitting}
          submitDisabled={!pageDraft.draft.text.trim() || ambiguousCreate()}
        />
      </div>
    ) : null;
    const nothingYet =
      threads.length === 0 &&
      suggestions.length === 0 &&
      draftSuggestions.length === 0;
    return (
      <div
        ref={setHistoryPortalContainer}
        className="flex w-full flex-1 flex-col bg-background"
        data-comments-history
        data-comments-sidebar
      >
        {/* Below the panel's sticky h-12 header, not under it. */}
        <div className="sticky top-12 z-10 border-b border-border bg-background">
          {toolbar}
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
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {nothingYet && !historyNarrowed
                ? t(canComment ? "comments.discussionEmpty" : "comments.empty")
                : t("comments.noFilteredComments")}
            </div>
          ) : (
            (() => {
              // One feed: every thread shows its first comment and latest
              // replies in place, whether it is a comment or a suggested
              // edit; with several Blocks fields, under its tab's name.
              const feed = historyEntries.filter(
                (entry, index) =>
                  entry.kind !== "suggestion" ||
                  !entry.suggestion.proposalId ||
                  (proposalMemberCounts.get(entry.suggestion.proposalId) ?? 0) <
                    2 ||
                  historyEntries.findIndex(
                    (candidate) =>
                      candidate.kind === "suggestion" &&
                      candidate.suggestion.proposalId ===
                        entry.suggestion.proposalId,
                  ) === index,
              );
              const renderEntry = (entry: (typeof feed)[number]) => {
                if (entry.kind === "draft")
                  return renderDraftSuggestionCard(entry.suggestion);
                if (entry.kind === "suggestion")
                  return entry.suggestion.proposalId &&
                    (proposalMemberCounts.get(entry.suggestion.proposalId) ??
                      0) >= 2
                    ? renderProposalGroup(
                        entry.suggestion.proposalId,
                        historySuggestions.filter(
                          (member) =>
                            member.proposalId === entry.suggestion.proposalId,
                        ),
                      )
                    : renderSuggestionCard(entry.suggestion);
                return renderCommentThread(
                  entry.thread,
                  0,
                  activeThreadId === entry.thread.threadId,
                );
              };
              if (!groupsByTab) return feed.map(renderEntry);
              return groupCommentsByTab(
                feed,
                commentTabs,
                (entry): CommentTabPlacement =>
                  entry.kind === "comment"
                    ? commentThreadPlacement(entry.thread)
                    : { fieldId: null, fieldName: null },
              ).map((group) => (
                <Fragment key={`tab:${group.key}`}>
                  <h3
                    className="bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground"
                    data-comments-tab-group={group.key}
                    data-comments-tab-removed={group.removed || undefined}
                  >
                    {tabGroupLabel(group)}
                  </h3>
                  {group.entries.map(renderEntry)}
                </Fragment>
              ));
            })()
          )}
        </div>
        {composer}
      </div>
    );
  }

  return (
    <div
      ref={sidebarRef}
      className="relative flow-root w-full min-w-0 shrink-0 pb-16"
      data-comments-sidebar
      onClick={(event) => {
        // The margin's empty space is outside every card, so it folds.
        const target = event.target as HTMLElement;
        if (
          expandedStack &&
          (target === event.currentTarget ||
            target.hasAttribute("data-comment-layout-thread") ||
            target.dataset.commentStackState === "open" ||
            target.hasAttribute("data-comment-stack-guide"))
        )
          collapseStack(expandedStack);
      }}
    >
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
      {expandedStack && stackHeaderTop !== undefined ? (
        <CommentStackHeader
          stackKey={expandedStack.key}
          top={stackHeaderTop}
          onCollapse={() => collapseStack(expandedStack)}
          t={t}
        />
      ) : null}
      {expandedStack && openStackLayout && stackHeaderTop !== undefined ? (
        <CommentStackGuide top={stackGuideTop} height={stackGuideHeight} />
      ) : null}
      {/* Pending new comment — positioned at the selection Y offset */}
      {displayedPendingComment && (
        <div
          ref={pendingCardRef}
          className={cn(
            alignToAnchors
              ? composingStack
                ? "absolute inset-x-0 z-10 pb-2"
                : "absolute left-2 right-4 z-10"
              : surface === "popover"
                ? "relative"
                : "relative mx-2 mt-3",
          )}
          style={alignToAnchors ? { top: pendingTop } : undefined}
          data-comment-pending
          data-comment-stack={composingStack?.key}
          data-comment-stack-state={composingStack ? "composing" : undefined}
        >
          {composingStack ? <CommentStackSheets /> : null}
          <div
            className={cn(
              "relative overflow-hidden rounded-xl bg-popover ring-1 ring-border/60 shadow-comment-raised",
              composingStack && "mx-2 mr-4",
            )}
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
                <CommentAvatar
                  email={currentUserEmail}
                  name={currentUserEmail}
                />
              </div>
              <div className="min-w-0 flex-1">
                {displayedPendingComment.property ? (
                  <PropertyThreadTargetLabel
                    className="mb-2"
                    target={propertyThreadTarget(
                      displayedPendingComment.property,
                      documentProperties,
                    )}
                  />
                ) : null}
                {displayedPendingComment.clip ? (
                  <span
                    className="mb-2 block border-s-2 border-border ps-2.5 text-sm tabular-nums text-muted-foreground"
                    data-comment-quote
                  >
                    {t("clipEmbed.commentMoment", {
                      time: msToClock(
                        displayedPendingComment.clip.videoTimestampMs,
                      ),
                    })}
                  </span>
                ) : null}
                {!pendingTargetValid && (
                  <p
                    role="alert"
                    className="mb-2 text-xs text-muted-foreground"
                  >
                    {t("comments.selectTextToComment")}
                  </p>
                )}
                <CommentComposer
                  ref={pendingInputRef}
                  value={pendingText}
                  onChange={(text) =>
                    onPendingChange?.(displayedPendingComment.id, () => ({
                      text,
                    }))
                  }
                  mentions={pendingMentions}
                  onMentionsChange={(mentions) =>
                    onPendingChange?.(displayedPendingComment.id, () => ({
                      mentions,
                    }))
                  }
                  onSubmit={() => void handlePendingSubmit()}
                  onAiSubmit={
                    commentAi &&
                    !displayedPendingComment.fieldId &&
                    !displayedPendingComment.clip
                      ? (selection) => void handlePendingAiSubmit(selection)
                      : undefined
                  }
                  aiDraft={pendingDraft.draft.aiDraft}
                  onAiDraftChange={pendingDraft.setAiDraft}
                  aiModelStorageKey={
                    commentAi && !displayedPendingComment.fieldId
                      ? aiModelStorageKey
                      : undefined
                  }
                  onCancel={handlePendingCancel}
                  onEscape={handlePendingCancel}
                  confirmEscape={pendingText.trim() ? "comment" : false}
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
                  placeholder={t("comments.add")}
                  submitLabel={t("comments.submit")}
                  submitDisabled={!pendingTargetValid || ambiguousCreate()}
                  disabled={pendingSubmitting}
                />
              </div>
            </div>
            {composingStack ? (
              <CommentStackShowAll
                threads={composingStack.threads}
                onOpen={() => openStackOn(composingStack.threads[0].threadId)}
                t={t}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Open thread cards — positioned to align with their referenced text */}
      {items.map((item, index) => {
        const { thread, top } = item;
        const restingItem = restingItemsById.get(thread.threadId);
        const marginTop = restingItem?.marginTop ?? item.marginTop;
        const translateY = top - (restingItem?.top ?? top);
        const stack =
          "suggestion" in thread
            ? undefined
            : stackOfThread.get(thread.threadId);
        const card =
          stack && stack !== expandedStack
            ? renderFoldedStack(stack, thread.threadId)
            : "suggestion" in thread
              ? "durability" in thread.suggestion
                ? renderDraftSuggestionCard(thread.suggestion)
                : thread.suggestion.proposalId &&
                    (proposalMemberCounts.get(thread.suggestion.proposalId) ??
                      0) >= 2
                  ? renderProposalGroup(
                      thread.suggestion.proposalId,
                      inlineProposalMembers.get(
                        thread.suggestion.proposalId,
                      ) ?? [thread.suggestion],
                      thread.threadId,
                    )
                  : renderSuggestionCard(thread.suggestion)
              : renderCommentThread(
                  thread,
                  0,
                  activeThreadId === thread.threadId,
                  !!stack,
                );
        // A Property thread has no highlight to lose, so it isn't one that
        // went missing.
        const lostHighlight = (candidate: (typeof items)[number]) =>
          candidate.isOrphaned &&
          !("property" in candidate.thread && candidate.thread.property);
        const startsOrphanedSection =
          lostHighlight(item) &&
          !items.slice(0, index).some((prior) => lostHighlight(prior));
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

/**
 * Why an agent suggested an edit, for a suggestion on its own card. A grouped
 * suggestion's reason is its group's header instead. People's suggestions and
 * the summary written for an agent that gave no reason add nothing to the
 * edit itself, so they have none.
 */
export function agentSuggestionReason(
  suggestion: ResourceSuggestion,
): string | null {
  if (suggestion.actorKind !== "agent") return null;
  const reason = (suggestion.proposalSummary || suggestion.summary).trim();
  if (!reason) return null;
  if (suggestion.proposalSummary && reason === suggestion.summary.trim())
    return null;
  const find = suggestion.metadata?.sourceFind;
  const replace = suggestion.metadata?.sourceReplace;
  if (
    typeof find === "string" &&
    reason ===
      findReplaceSuggestionSummary(
        find,
        typeof replace === "string" ? replace : "",
      )
  )
    return null;
  return reason;
}

/**
 * A change that adds or removes a line break, or swaps one run of whitespace
 * for another, doesn't say which lines it joins or splits, and a break alone
 * reads as a lone "↵", so what it replaces is shown too.
 */
function changesLayout(removed: string, inserted: string) {
  const before = suggestionAnchorText(removed);
  const after = suggestionAnchorText(inserted);
  return (
    /\n/.test(before + after) || (/^\s+$/.test(before) && /^\s+$/.test(after))
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
      const diff =
        operation.kind === "replace_text"
          ? suggestionDiffParts(previousText, nextText)
          : null;
      const hasSharedContext = diff?.some((part) => part.type === "equal");
      const richText = /[<>*_`\[\]]/.test(previousText + nextText);
      const changed = (type: "delete" | "insert", whole: string) =>
        diff && hasSharedContext
          ? diff
              .flatMap((part) => (part.type === type ? [part.text] : []))
              .join("")
          : whole;
      const showReplaced =
        expanded ||
        changesLayout(
          changed("delete", previousText),
          changed("insert", nextText),
        );
      const renderDiff = (side: "before" | "after") => {
        let offset = 0;
        const presentation =
          side === "before" ? previousPresentation : nextPresentation;
        return diff?.map((part, partIndex) => {
          if (part.type === (side === "before" ? "insert" : "delete"))
            return null;
          const from = (presentation?.from ?? 0) + offset;
          offset += part.text.length;
          return (
            <span
              key={partIndex}
              className={cn(
                side === "after" &&
                  part.type === "insert" &&
                  "text-[hsl(var(--suggestion))] underline decoration-[hsl(var(--suggestion))]",
                side === "before" && part.type === "delete" && "line-through",
              )}
            >
              {richText
                ? renderSuggestionText(
                    part.text,
                    presentation && {
                      source: presentation.source,
                      from,
                      to: from + part.text.length,
                    },
                  )
                : part.type !== "equal" && /^\s+$/.test(part.text)
                  ? suggestionTextForDisplay(part.text)
                  : part.text}
            </span>
          );
        });
      };
      return (
        <div key={key} className="break-words">
          <div
            className={cn(
              !(diff && hasSharedContext) && "text-[hsl(var(--suggestion))]",
            )}
          >
            {t("comments.suggestionWith")}: {"“"}
            {diff && hasSharedContext
              ? renderDiff("after")
              : renderSuggestionText(nextText, nextPresentation)}
            {"”"}
          </div>
          {showReplaced ? (
            <div className="text-muted-foreground">
              {t("comments.suggestionReplace")}: {"“"}
              {diff && hasSharedContext
                ? renderDiff("before")
                : renderSuggestionText(previousText, previousPresentation)}
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
  deciding,
  onActivate,
  onMaterialize,
  onDecideDraft,
  onActivateSaved,
  onDecide,
  surface = "rail",
  onClose,
  currentUserEmail,
  currentUserName,
  t,
}: {
  surface?: CommentSurface;
  onClose?: () => void;
  currentUserEmail?: string;
  currentUserName?: string;
  marginTop?: number;
  onHeightChange: (threadId: string, height: number) => void;
  suggestion: DraftSuggestion;
  isActive: boolean;
  canDecide: boolean;
  deciding: boolean;
  onActivate: () => void;
  onMaterialize?: (
    suggestion: DraftSuggestion,
  ) => Promise<ResourceSuggestion | null>;
  onDecideDraft?: (
    suggestion: DraftSuggestion,
    decision: SuggestionDecision,
  ) => void;
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
        author_name: ownAuthorName(
          suggestion.authorEmail,
          currentUserEmail,
          currentUserName,
        ),
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
        replyMentions={[]}
        onHoverChange={() => {}}
        onExpand={() => {
          onActivate();
          void materialize().then((saved) => {
            if (saved) onActivateSaved(saved);
          });
        }}
        onCollapse={() => {}}
        onReplyChange={() => {}}
        onReplyMentionsChange={() => {}}
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
            <SuggestionDecisionButtons
              disabled={
                isSaving || deciding || (!onDecideDraft && !onMaterialize)
              }
              onDecide={(decision) => {
                if (onDecideDraft) {
                  onDecideDraft(suggestion, decision);
                  return;
                }
                void materialize().then((saved) => {
                  if (saved) onDecide(saved, decision);
                });
              }}
            />
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
  reason,
  documentId,
  isActive,
  expandRequested,
  focusRequested,
  onFocused,
  anchorUnavailable,
  unplaceable,
  canComment,
  canDecide,
  deciding,
  onActivate,
  onExpansionChange,
  onDecide,
  surface = "rail",
  onClose,
  currentUserEmail,
  currentUserName,
  t,
}: {
  surface?: CommentSurface;
  onClose?: () => void;
  currentUserEmail?: string;
  currentUserName?: string;
  compact: boolean;
  replyDrafts: ReturnType<typeof useCommentReplyDrafts>;
  marginTop?: number;
  onHeightChange: (threadId: string, height: number) => void;
  suggestion: ResourceSuggestion;
  /** Why the agent suggested this edit, shown above it in full. */
  reason: string | null;
  documentId: string;
  isActive: boolean;
  expandRequested: boolean;
  focusRequested: boolean;
  onFocused?: () => void;
  anchorUnavailable: boolean;
  unplaceable: boolean;
  canComment: boolean;
  canDecide: boolean;
  deciding: boolean;
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
  const uncertainReply = useRef<{
    payload: string;
    operationId: string;
  } | null>(null);
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
          ownAuthorName(
            suggestion.authorEmail,
            currentUserEmail,
            currentUserName,
          ) ??
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
          ownAuthorName(
            comment.authorEmail,
            currentUserEmail,
            currentUserName,
          ) ??
          (comment.authorEmail ? null : comment.createdBy),
        created_at: comment.createdAt,
        content: comment.body,
        mentions: comment.mentions.flatMap((mention) =>
          typeof mention.email === "string"
            ? [
                {
                  kind: "person" as const,
                  email: mention.email,
                  name: mention.label,
                },
              ]
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
        isSubmitting={comments.isLoading}
        isReplySubmitting={reply.isPending}
        replyText={draft}
        replyMentions={mentions}
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
        onReplyMentionsChange={(entries) =>
          replyDrafts.setMentions(suggestion.threadId, entries)
        }
        onHeightChange={onHeightChange}
        onSubmitReply={() => {
          if (
            !canReply ||
            !root ||
            !draft.trim() ||
            reply.isPending ||
            replyDrafts.isSubmitting(suggestion.threadId)
          )
            return;
          const replyMentions = [
            ...new Map(
              findCommentMentions(draft, mentions.map(draftMention)).flatMap(
                ({ mention }) =>
                  mention.kind === "person"
                    ? [
                        [
                          mention.email,
                          { email: mention.email, label: mention.name },
                        ] as const,
                      ]
                    : [],
              ),
            ).values(),
          ];
          const payload = JSON.stringify({
            commentId: root.id,
            body: draft.trim(),
            mentions: replyMentions,
          });
          const clientOperationId =
            uncertainReply.current?.payload === payload
              ? uncertainReply.current.operationId
              : crypto.randomUUID();
          replyDrafts.beginSubmission(suggestion.threadId, clientOperationId);
          reply.mutate(
            {
              resourceType: "document",
              resourceId: documentId,
              commentId: root.id,
              clientOperationId,
              body: draft.trim(),
              mentions: replyMentions,
            },
            {
              onSuccess: () => {
                uncertainReply.current = null;
              },
              onError: (error) => {
                uncertainReply.current = isAmbiguousCommentCreateError(error)
                  ? { payload, operationId: clientOperationId }
                  : null;
                replyDrafts.restoreSubmittedDraft(
                  suggestion.threadId,
                  clientOperationId,
                );
              },
              onSettled: () => {
                replyDrafts.finishSubmission(clientOperationId);
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
            {reason ? (
              <p className="mb-1" data-suggestion-reason>
                {reason}
              </p>
            ) : null}
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
            <SuggestionDecisionButtons
              disabled={deciding}
              onDecide={onDecide}
            />
          ) : null
        }
        feedback={
          error ? (
            <div role="alert" className="px-3 pb-3 text-xs text-destructive">
              {error.message}
            </div>
          ) : suggestion.status === "stale" || unplaceable ? (
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
  showQuote = false,
  propertyTarget,
  anchorUnavailable = false,
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
  isReplySubmitting = false,
  timeLabel,
  replyText,
  replyMentions,
  aiDraft,
  onHoverChange,
  onExpand,
  onCollapse,
  onReplyChange,
  onReplyMentionsChange,
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
  /** Show the quote in the margin too, for a card away from its highlight. */
  showQuote?: boolean;
  /** The Property a thread is on, shown above it on every surface. */
  propertyTarget?: PropertyThreadTarget | null;
  anchorUnavailable?: boolean;
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
  isReplySubmitting?: boolean;
  timeLabel?: string;
  replyText: string;
  replyMentions: readonly MentionEntry[];
  aiDraft?: CommentAiDraft | null;
  onHoverChange: (hovered: boolean) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onReplyChange: (text: string) => void;
  onReplyMentionsChange: (mentions: MentionEntry[]) => void;
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const seenEntryCount = useRef(thread.comments.length);

  // A capped card hides what arrives below the fold, such as the AI's revised
  // suggestion after a follow-up, so bring a new entry into view from its
  // start: a long suggestion opens on its reason, not its last edit.
  useEffect(() => {
    const added = thread.comments.length > seenEntryCount.current;
    seenEntryCount.current = thread.comments.length;
    const body = bodyRef.current;
    const latest = thread.comments.slice(-1).pop();
    if (!added || !body || !latest || body.scrollHeight <= body.clientHeight)
      return;
    const entry = body.querySelector<HTMLElement>(
      `[data-comment-entry="${cssEscape(latest.id)}"]`,
    );
    if (!entry) return;
    const entryTop =
      entry.getBoundingClientRect().top - body.getBoundingClientRect().top;
    // Its start already shows, under the comment that asked for it: leave
    // the reader where they are.
    if (entryTop >= 0 && entryTop <= body.clientHeight - NEW_ENTRY_MIN_VISIBLE)
      return;
    const padding = Number.parseFloat(getComputedStyle(body).paddingTop) || 0;
    body.scrollTo({
      top: body.scrollTop + entryTop - padding,
      behavior: "smooth",
    });
  }, [thread.comments.length]);

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
        className="flex h-12 shrink-0 items-center gap-1 border-b border-border/70 pe-2 ps-4"
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
              "flex flex-col overflow-hidden rounded-xl bg-popover ring-1 ring-border/60 focus-visible:ring-2",
              surface === "popover"
                ? "max-h-[var(--comment-popover-max-height)] shadow-comment-raised"
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
        ref={bodyRef}
        className={cn(
          "relative grid grid-cols-1 gap-3.5",
          isPanel
            ? "px-4 py-3.5"
            : // Scrolling past either end of a long thread stays in the card
              // instead of moving the page behind it.
              "max-h-96 min-h-0 overflow-y-auto overscroll-y-contain px-4 pb-3.5 pt-3.5",
        )}
        data-comment-thread-body
      >
        {propertyTarget ? (
          <PropertyThreadTargetLabel
            className="-mb-1"
            target={propertyTarget}
          />
        ) : null}
        {(isPanel || showQuote) && quote ? (
          canExpand ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onExpand();
              }}
              className={cn(
                "-mb-1 border-s-2 border-border ps-2.5 text-start text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isPanel ? "line-clamp-2" : "line-clamp-1",
              )}
              data-comment-quote
            >
              {quote}
            </button>
          ) : (
            <p
              className={cn(
                "-mb-1 border-s-2 border-border ps-2.5 text-sm text-muted-foreground",
                isPanel ? "line-clamp-2" : "line-clamp-1",
              )}
              data-comment-quote
            >
              {quote}
            </p>
          )
        ) : null}
        {anchorUnavailable ? (
          <span
            className="-mb-1 text-xs text-muted-foreground"
            data-comment-anchor-unavailable
          >
            {t("comments.unanchored")}
          </span>
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
              <div className={indent} data-comment-entry={c.id}>
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
                data-comment-entry={c.id}
                avatar={
                  <CommentAvatar
                    email={c.author_email}
                    name={c.author_name ?? c.author_email}
                  />
                }
                name={c.author_name ?? c.author_email.split("@")[0]}
                identity={
                  c.author_email
                    ? {
                        kind: "person",
                        email: c.author_email,
                        name: c.author_name ?? c.author_email.split("@")[0],
                      }
                    : undefined
                }
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
            "flex shrink-0 items-start gap-2.5 px-4 pb-4",
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
            mentions={replyMentions}
            onMentionsChange={onReplyMentionsChange}
            onSubmit={onSubmitReply}
            onAiSubmit={onAiSubmit}
            aiDraft={aiDraft}
            onAiDraftChange={onAiDraftChange}
            aiModelStorageKey={aiModelStorageKey}
            onEscape={() => {
              // A reply on its way out keeps its draft until the save lands.
              if (!isReplySubmitting) replyDrafts?.discard(thread.threadId);
              onCollapse();
              requestAnimationFrame(() => cardRef.current?.focus());
            }}
            confirmEscape={
              replyText.trim() && !isReplySubmitting ? "reply" : false
            }
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
            placeholder={t("comments.reply")}
            submitLabel={t("comments.submit")}
            submitDisabled={isReplySubmitting}
            disabled={isSubmitting}
          />
        </div>
      )}
    </div>
  );
}
