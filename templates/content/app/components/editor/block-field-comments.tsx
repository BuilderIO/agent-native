import type { ResourceSuggestion } from "@agent-native/core/review";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type { CommentThread } from "@/hooks/use-comments";

import {
  commentThreadFieldId,
  openReviewCountsByField,
  type BlockFieldOpenCounts,
} from "./block-field-comment-threads";
import { blockFieldEditor, inHiddenBlockFieldPanel } from "./blockFieldTabs";
import type { CommentTextAnchor } from "./comment-anchors";
import type { PendingCommentSelection } from "./CommentsSidebar";

/**
 * The Blocks field tabs a page shows, as comments need them. A field id of
 * `null` is the page body (the primary field, or the page's only editor).
 */
export type BlockFieldTabs = {
  /** False until the page's fields have loaded. */
  ready: boolean;
  /** The open tab's field. */
  openFieldId: string | null;
  /** Whether the field has an editor on the page. */
  hasField: (fieldId: string | null) => boolean;
  showField: (fieldId: string | null) => void;
};

/** A page without tabs: the body is all there is, and always open. */
export const BODY_BLOCK_FIELD_TABS: BlockFieldTabs = {
  ready: true,
  openFieldId: null,
  hasField: (fieldId) => fieldId === null,
  showField: () => {},
};

export const LOADING_BLOCK_FIELD_TABS: BlockFieldTabs = {
  ready: false,
  openFieldId: null,
  hasField: () => false,
  showField: () => {},
};

/** The only field, when it isn't the body, open and with nothing to switch. */
export function soloBlockFieldTabs(fieldId: string): BlockFieldTabs {
  return {
    ready: true,
    openFieldId: fieldId,
    hasField: (candidate) => candidate === fieldId,
    showField: () => {},
  };
}

type TextRange = { from: number; to: number };

export type BlockFieldCommentHandler = (
  fieldId: string,
  quotedText: string,
  offsetTop: number,
  anchor?: CommentTextAnchor,
  range?: TextRange,
) => void;

type BlockFieldEditorCommentsValue = {
  threads: readonly CommentThread[];
  activeThreadId: string | null;
  hoveredThreadId: string | null;
  pending: { fieldId: string; range: TextRange } | null;
  showCommentIndicators: boolean;
  onComment?: BlockFieldCommentHandler;
  onActivateThread?: (threadId: string) => void;
};

export type BlockFieldCommentsProviderValue = {
  editors: BlockFieldEditorCommentsValue;
  counts: BlockFieldOpenCounts;
};

const BlockFieldEditorCommentsContext =
  createContext<BlockFieldEditorCommentsValue | null>(null);
const BlockFieldOpenCountsContext = createContext<BlockFieldOpenCounts | null>(
  null,
);

export function BlockFieldCommentsProvider({
  value,
  children,
}: {
  value: BlockFieldCommentsProviderValue;
  children: ReactNode;
}) {
  return (
    <BlockFieldOpenCountsContext.Provider value={value.counts}>
      <BlockFieldEditorCommentsContext.Provider value={value.editors}>
        {children}
      </BlockFieldEditorCommentsContext.Provider>
    </BlockFieldOpenCountsContext.Provider>
  );
}

/** Open review per tab, keyed by field id (null is the body). */
export function useBlockFieldOpenCounts(): BlockFieldOpenCounts | null {
  return useContext(BlockFieldOpenCountsContext);
}

const NO_THREADS: readonly CommentThread[] = [];

/**
 * The comment props for one non-body field's editor: its own threads and
 * highlights, and a comment handler that names the field. The handler keeps
 * its identity while the page's state changes, since the editor rebuilds its
 * extensions when it changes.
 */
export function useBlockFieldEditorComments(fieldId: string) {
  const value = useContext(BlockFieldEditorCommentsContext);
  const onCommentRef = useRef(value?.onComment);
  onCommentRef.current = value?.onComment;
  const canComment = !!value?.onComment;
  const onComment = useMemo(
    () =>
      canComment
        ? (
            quotedText: string,
            offsetTop: number,
            anchor?: CommentTextAnchor,
            range?: TextRange,
          ) =>
            onCommentRef.current?.(
              fieldId,
              quotedText,
              offsetTop,
              anchor,
              range,
            )
        : undefined,
    [canComment, fieldId],
  );
  const allThreads = value?.threads ?? NO_THREADS;
  const commentThreads = useMemo(
    () =>
      allThreads.filter(
        (thread) =>
          !thread.property && commentThreadFieldId(thread) === fieldId,
      ),
    [allThreads, fieldId],
  );
  if (!value) return null;
  return {
    onComment,
    commentThreads,
    activeThreadId: value.activeThreadId,
    hoveredThreadId: value.hoveredThreadId,
    pendingHighlight:
      value.pending?.fieldId === fieldId ? value.pending.range : null,
    onActivateThread: value.onActivateThread,
    showCommentIndicators: value.showCommentIndicators,
  };
}

type ReviewTarget = {
  key: string;
  /** The tab to open; undefined when the target belongs to no tab. */
  fieldId: string | null | undefined;
  attribute: "data-comment-thread" | "data-suggestion-id";
  id: string;
};

function reviewTarget(
  threads: readonly CommentThread[] | undefined,
  selectedThreadId: string | null,
  suggestionId: string | null,
): ReviewTarget | null {
  if (selectedThreadId) {
    const thread = threads?.find(
      (candidate) => candidate.threadId === selectedThreadId,
    );
    return {
      key: `thread:${selectedThreadId}`,
      // A Property thread shows on every tab, so it opens none.
      fieldId:
        !thread || thread.property ? undefined : commentThreadFieldId(thread),
      attribute: "data-comment-thread",
      id: selectedThreadId,
    };
  }
  if (suggestionId) {
    // Suggestions edit the page body only.
    return {
      key: `suggestion:${suggestionId}`,
      fieldId: null,
      attribute: "data-suggestion-id",
      id: suggestionId,
    };
  }
  return null;
}

function cssEscape(value: string) {
  return globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

const SCROLL_ATTEMPTS = 10;

/** Scrolls a just-opened tab to the target's highlight once it has one. */
function scrollToReviewTarget(
  container: HTMLElement | null,
  target: ReviewTarget,
  attempt = 0,
) {
  requestAnimationFrame(() => {
    const editor = blockFieldEditor(container, target.fieldId ?? null);
    const highlight = editor?.querySelector<HTMLElement>(
      `[${target.attribute}="${cssEscape(target.id)}"]`,
    );
    if (highlight && !inHiddenBlockFieldPanel(highlight)) {
      highlight.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return;
    }
    if (attempt < SCROLL_ATTEMPTS) {
      scrollToReviewTarget(container, target, attempt + 1);
    }
  });
}

/**
 * Comments across a row's Blocks field tabs. The margin shows the open tab's
 * threads; each field's editor highlights its own; and opening a thread or
 * suggestion from anywhere (the panel, a `?comment=` or `?suggestion=` link)
 * opens its tab, then scrolls to its highlight.
 */
export function useBlockFieldComments({
  expectsBlockFields,
  threads,
  suggestions,
  draftSuggestions,
  anchoredSuggestionIds,
  selectedThreadId,
  selectedSuggestionId,
  focusSuggestionId,
  hoveredThreadId,
  pendingComment,
  showCommentIndicators,
  onComment,
  onActivateThread,
  scrollContainerRef,
}: {
  /** The page shows Blocks fields, so the body waits for them to load. */
  expectsBlockFields: boolean;
  threads: readonly CommentThread[] | undefined;
  suggestions: readonly ResourceSuggestion[];
  draftSuggestions: readonly unknown[];
  anchoredSuggestionIds: readonly string[] | null | undefined;
  selectedThreadId: string | null;
  selectedSuggestionId: string | null;
  focusSuggestionId: string | null;
  hoveredThreadId: string | null;
  pendingComment: PendingCommentSelection | null;
  showCommentIndicators: boolean;
  onComment?: BlockFieldCommentHandler;
  onActivateThread?: (threadId: string) => void;
  scrollContainerRef: RefObject<HTMLElement | null>;
}) {
  const [reportedTabs, setReportedTabs] = useState<BlockFieldTabs | null>(null);
  const onFieldTabChange = useCallback(
    (next: BlockFieldTabs | null) => setReportedTabs(next),
    [],
  );
  const tabs =
    reportedTabs ??
    (expectsBlockFields ? LOADING_BLOCK_FIELD_TABS : BODY_BLOCK_FIELD_TABS);
  const openFieldId = tabs.openFieldId;

  const target = reviewTarget(
    threads,
    selectedThreadId,
    selectedSuggestionId ?? focusSuggestionId,
  );
  const targetKey = target?.key ?? null;
  const targetFieldId = target?.fieldId;
  // Each newly opened target opens its tab once. Reset while rendering, so
  // the margin never sees a new target in the wrong tab.
  const [settled, setSettled] = useState<{
    key: string | null;
    done: boolean;
  }>({ key: null, done: false });
  let targetSettled = settled.key === targetKey && settled.done;
  if (settled.key !== targetKey) {
    setSettled({ key: targetKey, done: false });
    targetSettled = false;
  }
  const tabSwitchPending =
    targetKey !== null &&
    !targetSettled &&
    targetFieldId !== undefined &&
    targetFieldId !== openFieldId &&
    (!tabs.ready || tabs.hasField(targetFieldId));

  const switchRef = useRef<{ key: string; from: string | null } | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (
      targetKey === null ||
      targetSettled ||
      targetFieldId === undefined ||
      !tabs.ready
    )
      return;
    const settle = () =>
      setSettled((current) =>
        current.key === targetKey ? { key: targetKey, done: true } : current,
      );
    // A deleted tab has no highlight to open; the panel still lists it.
    if (!tabs.hasField(targetFieldId)) {
      settle();
      return;
    }
    const switched =
      switchRef.current?.key === targetKey ? switchRef.current : null;
    if (tabs.openFieldId !== targetFieldId) {
      if (!switched) {
        switchRef.current = { key: targetKey, from: tabs.openFieldId };
        tabs.showField(targetFieldId);
      } else if (tabs.openFieldId !== switched.from) {
        // Another tab was opened meanwhile; leave it open.
        settle();
      }
      return;
    }
    settle();
    const current = targetRef.current;
    if (switched && current?.key === targetKey) {
      scrollToReviewTarget(scrollContainerRef.current, current);
    }
  }, [scrollContainerRef, tabs, targetFieldId, targetKey, targetSettled]);

  const allThreads = threads ?? NO_THREADS;
  const railThreads = useMemo(() => {
    if (openFieldId === null && !allThreads.some((thread) => thread.field)) {
      return allThreads as CommentThread[];
    }
    return allThreads.filter(
      (thread) =>
        thread.property || commentThreadFieldId(thread) === openFieldId,
    );
  }, [allThreads, openFieldId]);

  const pendingFieldId = pendingComment?.property
    ? undefined
    : (pendingComment?.fieldId ?? null);
  const pendingRange = pendingComment?.range;
  const pendingVisible =
    !pendingComment ||
    pendingFieldId === undefined ||
    pendingFieldId === openFieldId;
  const bodyPendingHighlight =
    pendingComment && pendingFieldId === null ? (pendingRange ?? null) : null;

  const counts = useMemo(
    () =>
      openReviewCountsByField({
        threads,
        suggestions,
        draftSuggestions,
        anchoredSuggestionIds,
      }),
    [anchoredSuggestionIds, draftSuggestions, suggestions, threads],
  );
  const fieldPending = useMemo(
    () =>
      pendingFieldId && pendingRange
        ? { fieldId: pendingFieldId, range: pendingRange }
        : null,
    [pendingFieldId, pendingRange],
  );
  const editors = useMemo<BlockFieldEditorCommentsValue>(
    () => ({
      threads: allThreads,
      activeThreadId: selectedThreadId,
      hoveredThreadId,
      pending: fieldPending,
      showCommentIndicators,
      onComment,
      onActivateThread,
    }),
    [
      allThreads,
      fieldPending,
      hoveredThreadId,
      onActivateThread,
      onComment,
      selectedThreadId,
      showCommentIndicators,
    ],
  );
  const provider = useMemo<BlockFieldCommentsProviderValue>(
    () => ({ editors, counts }),
    [counts, editors],
  );

  return {
    onFieldTabChange,
    openFieldId,
    /** The margin waits while a thread's tab opens. */
    tabSwitchPending,
    /** The pending comment is in the open tab (or on a Property). */
    pendingVisible,
    bodyPendingHighlight,
    /** The open tab's threads, and Property threads, for the margin. */
    railThreads,
    /** Suggestions edit the body, so only its tab shows them in the margin. */
    railShowsSuggestions: openFieldId === null,
    provider,
  };
}
