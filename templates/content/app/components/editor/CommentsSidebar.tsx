import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  InlineMarkdown,
  type InlineMarkdownProtectedSpan,
} from "@agent-native/core/client/markdown";
import {
  IconCheck,
  IconMessageCircle,
  IconArrowUp,
  IconArrowBackUp,
  IconFilter,
  IconDots,
} from "@tabler/icons-react";
import {
  Fragment,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  type RefObject,
} from "react";
import { toast } from "sonner";

import {
  Avatar as UserAvatar,
  AvatarFallback as UserAvatarFallback,
  AvatarImage as UserAvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
  useEditComment,
  type Comment,
  type CommentThread,
  type CommentMention,
} from "@/hooks/use-comments";
import {
  useMentionMembers,
  type MentionMember,
} from "@/hooks/use-mention-members";

import type { CommentTextAnchor } from "./comment-anchors";
import { useCommentDraft, useCommentPanelSession } from "./comment-drafts";
import { CommentComposer, type MentionEntry } from "./CommentComposer";

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

function emailToAvatarColor(email: string) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 55%)`;
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
        style={{ backgroundColor: emailToAvatarColor(email ?? "user") }}
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
): CommentThreadPosition | null {
  if (!scrollContainer) return null;
  const documentContent =
    (scrollContainer.querySelector(
      "[data-document-scroll-content]",
    ) as HTMLElement | null) ?? scrollContainer;
  const documentRect = documentContent.getBoundingClientRect();

  const marked = scrollContainer.querySelector(
    `[data-comment-thread="${cssEscape(threadId)}"]`,
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

export function estimateThreadCardHeight(thread: CommentThread) {
  return 80 + Math.max(0, thread.comments.length - 1) * 44;
}

type CommentLayoutItem = {
  thread: CommentThread;
  top: number;
  marginTop: number;
  anchorTop: number | null;
  isOrphaned: boolean;
};

export function layoutCommentThreads(
  threads: CommentThread[],
  positions: Map<string, CommentThreadPosition>,
  heights: Map<string, number>,
  selectedThreadId: string | null | undefined,
  gap = 12,
): CommentLayoutItem[] {
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
  const heightFor = (thread: CommentThread) =>
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

interface CommentsSidebarProps {
  documentId: string;
  threads?: CommentThread[];
  isLoading?: boolean;
  pendingComment?: {
    quotedText: string;
    offsetTop: number;
    anchor?: CommentTextAnchor;
    range?: { from: number; to: number };
  } | null;
  pendingTargetValid?: boolean;
  onPendingDone?: (threadId?: string) => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  activeThreadId?: string | null;
  selectedThreadId?: string | null;
  onActivateThread?: (id: string) => void;
  onSelectedThreadChange?: (id: string | null) => void;
  onHoveredThreadChange?: (id: string | null) => void;
  currentUserEmail?: string;
  canComment?: boolean;
  canResolve?: boolean;
  alignToAnchors?: boolean;
  forceVisible?: boolean;
  visibleThreadId?: string | null;
  presentation?: "inline" | "history";
  compactHistory?: boolean;
}

export function CommentsSidebar({
  documentId,
  threads = [],
  isLoading = false,
  pendingComment,
  pendingTargetValid = true,
  onPendingDone,
  scrollContainerRef,
  activeThreadId,
  selectedThreadId,
  onActivateThread,
  onSelectedThreadChange,
  onHoveredThreadChange,
  currentUserEmail,
  canComment = true,
  canResolve = false,
  alignToAnchors = true,
  forceVisible = false,
  visibleThreadId,
  presentation = "inline",
  compactHistory = false,
}: CommentsSidebarProps) {
  const t = useT();
  const { data: members = [] } = useMentionMembers();
  const createComment = useCreateComment({ email: currentUserEmail });
  const resolveComment = useResolveComment();
  const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);
  const replyDraft = useCommentDraft(
    `reply:${replyingThreadId ?? selectedThreadId ?? ""}`,
  );
  const { text: replyText, mentions: replyMentions } = replyDraft.draft;
  const setReplyText = replyDraft.setText;
  const setReplyMentions = replyDraft.setMentions;
  const pendingDraft = useCommentDraft("pending");
  const { text: pendingText, mentions: pendingMentions } = pendingDraft.draft;
  const setPendingText = pendingDraft.setText;
  const setPendingMentions = pendingDraft.setMentions;
  const { historyStatus, setHistoryStatus, historyAuthor, setHistoryAuthor } =
    useCommentPanelSession();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const pendingInputRef = useRef<HTMLTextAreaElement>(null);
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

  const openThreads = useMemo(() => {
    const open =
      threads?.filter(
        (thread) => !thread.resolved || thread.threadId === selectedThreadId,
      ) ?? [];
    return visibleThreadId
      ? open.filter((thread) => thread.threadId === visibleThreadId)
      : open;
  }, [threads, visibleThreadId, selectedThreadId]);
  const selectedThreadIsOpen =
    !!selectedThreadId &&
    openThreads.some((thread) => thread.threadId === selectedThreadId);

  useLayoutEffect(() => {
    const nextReplyingThreadId =
      presentation === "inline" && canComment && selectedThreadIsOpen
        ? selectedThreadId
        : null;
    setReplyingThreadId(nextReplyingThreadId);
  }, [canComment, presentation, selectedThreadId, selectedThreadIsOpen]);
  const historyAuthors = useMemo(() => {
    const authors = new Map<string, string>();
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
  }, [threads]);
  const historyThreads = useMemo(() => {
    return threads.filter((thread) => {
      if (selectedThreadId === thread.threadId) return true;
      if (compactHistory && selectedThreadId) return false;
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
  }, [historyAuthor, historyStatus, threads, selectedThreadId, compactHistory]);

  useEffect(() => {
    if (pendingComment) {
      setTimeout(() => pendingInputRef.current?.focus(), 50);
    }
  }, [pendingComment]);

  const handlePendingSubmit = () => {
    if (!canComment) return;
    if (
      !pendingText.trim() ||
      createComment.isPending ||
      !pendingTargetValid ||
      ambiguousCreate()
    )
      return;
    const submittedDraft = pendingDraft.draft;
    createComment.mutate(
      {
        documentId,
        content: pendingText.trim(),
        quotedText: pendingComment?.quotedText,
        anchorPrefix: pendingComment?.anchor?.prefix,
        anchorSuffix: pendingComment?.anchor?.suffix,
        anchorStartOffset: pendingComment?.anchor?.startOffset,
        mentions: mentionsJsonFor(pendingText, pendingMentions),
      },
      {
        onSuccess: (result) => {
          pendingDraft.clearIfUnchanged(submittedDraft);
          onPendingDone?.(result.threadId);
        },
        onError: (error) => {
          toast.error(t("empty.genericError"), {
            description: error.message,
          });
        },
      },
    );
  };

  const handlePendingCancel = () => {
    pendingDraft.discard();
    onPendingDone?.();
  };

  const handleReply = (threadId: string) => {
    if (!canComment) return;
    if (
      !replyText.trim() ||
      createComment.isPending ||
      ambiguousCreate(threadId)
    )
      return;
    const submittedDraft = replyDraft.draft;
    const thread = threads?.find((t) => t.threadId === threadId);
    createComment.mutate(
      {
        documentId,
        content: replyText.trim(),
        threadId,
        parentId: thread?.comments[0]?.id,
        mentions: mentionsJsonFor(replyText, replyMentions),
      },
      {
        onSuccess: () => {
          replyDraft.clearIfUnchanged(submittedDraft);
        },
        onError: (error) => {
          toast.error(t("empty.genericError"), {
            description: error.message,
          });
        },
      },
    );
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
  const openThreadKey = openThreads
    .map((t) => `${t.threadId}:${t.quotedText ?? ""}`)
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
    if (!container || openThreads.length === 0) {
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
    for (const thread of openThreads) {
      const position = findThreadPosition(
        thread.threadId,
        thread.quotedText,
        container,
        layoutContainer,
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
  }, [alignToAnchors, openThreads, pendingComment, scrollContainerRef]);

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
    const openIds = new Set(openThreads.map((thread) => thread.threadId));
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
  }, [openThreads]);

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
      ? threads.length > 0
      : openThreads.length > 0 || !!pendingComment;
  if (!hasContent && !isLoading && !forceVisible) return null;

  const items = layoutCommentThreads(
    openThreads,
    threadPositions,
    threadCardHeights,
    selectedThreadId,
  );

  const changeResolution = (thread: CommentThread, resolved: boolean) => {
    if (
      !canResolve ||
      thread.comments.some((c) => c.mutation?.status === "pending")
    )
      return;
    resolveComment.mutate(
      { id: thread.comments[0].id, documentId, resolved },
      {
        onError: (error) =>
          toast.error(t("empty.genericError"), { description: error.message }),
      },
    );
  };
  const handleResolve = (thread: CommentThread) =>
    changeResolution(thread, true);
  const handleReopen = (thread: CommentThread) =>
    changeResolution(thread, false);

  if (presentation === "history") {
    return (
      <div className="min-h-full w-full bg-background" data-comments-history>
        <div className="sticky top-0 z-10 flex items-center border-b border-border bg-background px-3 py-2">
          {selectedThreadId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onSelectedThreadChange?.(null)}
            >
              {t("comments.backToList")}
            </Button>
          )}
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
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>
                {t("comments.statusFilter")}
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                {(["all", "open", "resolved"] as const).map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={historyStatus === status}
                    onCheckedChange={(checked) =>
                      checked && setHistoryStatus(status)
                    }
                    onSelect={(event) => event.preventDefault()}
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
                  onSelect={(event) => event.preventDefault()}
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
                    onSelect={(event) => event.preventDefault()}
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
          ) : historyThreads.length === 0 ? (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">
              {historyStatus === "all" &&
              historyAuthor === null &&
              threads.length === 0
                ? t(
                    canComment
                      ? "comments.selectTextToComment"
                      : "comments.empty",
                  )
                : t("comments.noFilteredComments")}
            </div>
          ) : (
            historyThreads.map((thread) =>
              thread.resolved ? (
                <ResolvedThreadView
                  key={thread.threadId}
                  thread={thread}
                  canResolve={canResolve}
                  currentUserEmail={currentUserEmail}
                  canComment={canComment}
                  members={members}
                  documentId={documentId}
                  onReopen={() => handleReopen(thread)}
                  t={t}
                />
              ) : selectedThreadId === thread.threadId ? (
                <ThreadView
                  key={thread.threadId}
                  thread={thread}
                  documentId={documentId}
                  currentUserEmail={currentUserEmail}
                  marginTop={0}
                  isActive
                  allowEmphasisMotion={false}
                  isExpanded
                  isSubmitting={
                    (createComment.isPending &&
                      createComment.variables?.threadId === thread.threadId) ||
                    ambiguousCreate(thread.threadId)
                  }
                  replyText={replyText}
                  members={members}
                  canComment={canComment}
                  canResolve={canResolve}
                  onHoverChange={(hovered) =>
                    onHoveredThreadChange?.(hovered ? thread.threadId : null)
                  }
                  onExpand={() => onActivateThread?.(thread.threadId)}
                  onCollapse={() => onSelectedThreadChange?.(null)}
                  onReplyChange={setReplyText}
                  onReplyMentionAdd={(mention) =>
                    setReplyMentions((previous) => [...previous, mention])
                  }
                  onDiscardReply={replyDraft.discard}
                  onHeightChange={handleThreadCardHeightChange}
                  onSubmitReply={() => handleReply(thread.threadId)}
                  onResolve={() => handleResolve(thread)}
                  onSendToAI={() => handleSendToAI(thread)}
                  t={t}
                />
              ) : (
                <HistoryThreadView
                  key={thread.threadId}
                  thread={thread}
                  onOpen={() => onActivateThread?.(thread.threadId)}
                />
              ),
            )
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
            onChange={setPendingText}
            onMentionAdd={(m) => setPendingMentions((prev) => [...prev, m])}
            onSubmit={handlePendingSubmit}
            onEscape={() => {
              if (!pendingText.trim()) handlePendingCancel();
            }}
            members={members}
            placeholder={t("comments.add")}
            autoFocus
            disabled={createComment.isPending}
          />
          <div className="flex justify-end gap-1 mt-1.5">
            <button
              onClick={handlePendingCancel}
              disabled={createComment.isPending}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent"
            >
              {t("comments.discardDraft")}
            </button>
            <button
              onClick={handlePendingSubmit}
              disabled={
                !pendingText.trim() ||
                createComment.isPending ||
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
            <ThreadView
              thread={thread}
              marginTop={marginTop}
              isActive={isActive}
              allowEmphasisMotion={alignToAnchors}
              isExpanded={replyingThreadId === thread.threadId}
              documentId={documentId}
              currentUserEmail={currentUserEmail}
              isSubmitting={
                (createComment.isPending &&
                  createComment.variables?.threadId === thread.threadId) ||
                ambiguousCreate(thread.threadId)
              }
              replyText={replyingThreadId === thread.threadId ? replyText : ""}
              onHoverChange={(hovered) =>
                onHoveredThreadChange?.(hovered ? thread.threadId : null)
              }
              onExpand={() => {
                onActivateThread?.(thread.threadId);
                scrollToCommentAnchor(
                  scrollContainerRef?.current ?? null,
                  threadPositions.get(thread.threadId)?.documentTop,
                );
                if (canComment) {
                  setReplyingThreadId(thread.threadId);
                }
              }}
              onCollapse={() => {
                setReplyingThreadId(null);
                onSelectedThreadChange?.(null);
              }}
              onDiscardReply={replyDraft.discard}
              onReplyChange={setReplyText}
              onReplyMentionAdd={(mention) =>
                setReplyMentions((prev) => [...prev, mention])
              }
              onHeightChange={handleThreadCardHeightChange}
              members={members}
              canComment={canComment}
              canResolve={canResolve}
              onSubmitReply={() => handleReply(thread.threadId)}
              onResolve={() =>
                thread.resolved ? handleReopen(thread) : handleResolve(thread)
              }
              onSendToAI={() => handleSendToAI(thread)}
              t={t}
            />
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
  return (
    <button
      type="button"
      className="w-full min-w-0 overflow-hidden rounded-lg bg-popover p-3 text-start shadow-sm ring-1 ring-border/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
    >
      {thread.quotedText ? (
        <p className="mb-2 line-clamp-2 border-s-2 border-border ps-2 text-xs italic text-muted-foreground">
          {thread.quotedText}
        </p>
      ) : null}
      <div className="flex items-start gap-2">
        <CommentAvatar
          email={first.author_email}
          name={first.author_name ?? first.author_email}
          className="size-5 shrink-0"
        />
        <span className="min-w-0 flex-1 break-words text-[13px] text-foreground/90">
          {renderCommentBody(first.content, first.mentions)}
        </span>
      </div>
      {thread.comments.length > 1 && (
        <span className="mt-2 block text-xs text-muted-foreground">
          {t("comments.replyCount", { count: thread.comments.length - 1 })}
        </span>
      )}
    </button>
  );
}

function ThreadView({
  thread,
  documentId,
  currentUserEmail,
  onDiscardReply,
  marginTop,
  isActive,
  allowEmphasisMotion,
  isExpanded,
  isSubmitting,
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
  t,
}: {
  thread: CommentThread;
  documentId: string;
  currentUserEmail?: string;
  onDiscardReply: () => void;
  marginTop: number;
  isActive: boolean;
  allowEmphasisMotion: boolean;
  isExpanded: boolean;
  isSubmitting: boolean;
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
  onSendToAI: () => void;
  t: ReturnType<typeof useT>;
}) {
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => replyInputRef.current?.focus(), 50);
    }
  }, [isExpanded]);

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
      data-thread-card={thread.threadId}
      className={`group/thread ${allowEmphasisMotion ? "mx-2 mr-4" : ""} cursor-pointer rounded-lg bg-popover shadow-md ring-1 ring-border/50 ${
        allowEmphasisMotion
          ? `transition-transform duration-[260ms] ease-[var(--ease-drawer)] ${
              isActive
                ? "-translate-x-2 shadow-lg"
                : "hover:-translate-x-2 hover:shadow-lg"
            }`
          : ""
      }`}
      style={{ marginTop }}
      onClick={onExpand}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="relative p-3 pb-2">
        {/* Hover actions — top right, Notion style pill */}
        <div className="mb-2 flex items-center justify-end gap-1">
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
          {canResolve ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t(
                    thread.resolved ? "comments.reopen" : "comments.resolve",
                  )}
                  disabled={thread.comments.some(
                    (c) => c.mutation?.status === "pending",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onResolve();
                  }}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  {thread.resolved ? (
                    <IconArrowBackUp size={14} />
                  ) : (
                    <IconCheck size={14} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t(thread.resolved ? "comments.reopen" : "comments.resolve")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        {/* Comments */}
        <button
          type="button"
          className="mb-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          ref={expandRef}
          aria-expanded={isExpanded}
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
        >
          {t(thread.resolved ? "comments.resolvedStatus" : "comments.reply")}
        </button>
        {thread.comments.map((comment) => (
          <CommentEntry
            key={comment.id}
            comment={comment}
            documentId={documentId}
            currentUserEmail={currentUserEmail}
            canComment={canComment}
            members={members}
          />
        ))}
      </div>

      {/* Expanded: Notion-style reply input */}
      {isExpanded && canComment && !thread.resolved && (
        <div
          className="flex items-center gap-2 px-3 pb-3 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <CommentAvatar
            email={thread.comments[0]?.author_email}
            name={thread.comments[0]?.author_name ?? "user"}
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
                requestAnimationFrame(() => expandRef.current?.focus());
              }}
              members={members}
              placeholder={t("comments.reply")}
              rows={1}
              className="w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none pr-16"
            />
            <div className="absolute right-1 bottom-0.5 flex items-center gap-0.5">
              {replyText && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={onDiscardReply}
                >
                  {t("comments.discardDraft")}
                </Button>
              )}
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

function ResolvedThreadView({
  thread,
  onReopen,
  canResolve,
  currentUserEmail,
  canComment,
  documentId,
  members,
  t,
}: {
  thread: CommentThread;
  onReopen: () => void;
  canResolve: boolean;
  currentUserEmail?: string;
  canComment: boolean;
  documentId: string;
  members: MentionMember[];
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-lg bg-muted/40 p-3 ring-1 ring-border/40">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t("comments.resolvedStatus")}
        </span>
        {canResolve && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReopen}
            disabled={thread.comments.some(
              (c) => c.mutation?.status === "pending",
            )}
          >
            <IconArrowBackUp size={14} />
            {t("comments.reopen")}
          </Button>
        )}
      </div>
      {thread.quotedText && (
        <p className="mb-2 border-s-2 border-border ps-2 text-xs italic text-muted-foreground">
          {thread.quotedText}
        </p>
      )}
      {thread.comments.map((comment) => (
        <CommentEntry
          key={comment.id}
          comment={comment}
          documentId={documentId}
          currentUserEmail={currentUserEmail}
          canComment={canComment}
          members={members}
        />
      ))}
    </div>
  );
}

function CommentEntry({
  comment,
  documentId,
  currentUserEmail,
  canComment,
  members,
}: {
  comment: Comment;
  documentId: string;
  currentUserEmail?: string;
  canComment: boolean;
  members: MentionMember[];
}) {
  const t = useT();
  const edit = useEditComment();
  const create = useCreateComment({ email: currentUserEmail });
  const [checking, setChecking] = useState(false);
  const sourceDraft = useCommentDraft(
    comment.parent_id ? `reply:${comment.thread_id}` : "pending",
  );
  const [editing, setEditing] = useState(false);
  const initialDraft = { text: comment.content, mentions: comment.mentions };
  const draft = useCommentDraft(`edit:${comment.id}`, initialDraft);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const pending = comment.mutation?.status === "pending";
  const showMutationStatus =
    comment.mutation?.kind !== "resolve" || !comment.parent_id;
  const canEdit =
    canComment &&
    !!currentUserEmail &&
    currentUserEmail.toLowerCase() === comment.author_email.toLowerCase() &&
    !pending &&
    comment.mutation?.kind !== "create";
  const checkSaved = async () => {
    if (!comment.mutation?.ambiguous || checking) return;
    const submitted = sourceDraft.draft;
    setChecking(true);
    try {
      const result = await create.reconcileAmbiguous(
        documentId,
        comment.mutation.operationId,
      );
      if (result === "confirmed" && submitted.text.trim() === comment.content) {
        sourceDraft.clearIfUnchanged(submitted);
      }
    } catch (error) {
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setChecking(false);
    }
  };
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => menuRef.current?.focus());
  };
  const save = () => {
    if (!draft.draft.text.trim() || edit.isPending) return;
    const submitted = draft.draft;
    edit.mutate(
      {
        id: comment.id,
        documentId,
        content: submitted.text.trim(),
        mentions: mentionsJsonFor(submitted.text, submitted.mentions) ?? "[]",
      },
      {
        onSuccess: () => {
          draft.clearIfUnchanged(submitted);
          close();
        },
        onError: (error) => {
          toast.error(t("empty.genericError"), { description: error.message });
          inputRef.current?.focus();
        },
      },
    );
  };
  return (
    <div
      className="mb-3 last:mb-0"
      data-comment-id={comment.id}
      onClick={(event) => {
        if (
          editing ||
          (event.target as HTMLElement).closest(
            "button, textarea, [role=menuitem]",
          )
        )
          event.stopPropagation();
      }}
    >
      <div className="mb-0.5 flex items-center gap-2">
        <CommentAvatar
          email={comment.author_email}
          name={comment.author_name ?? comment.author_email}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {comment.author_name ?? comment.author_email.split("@")[0]}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatDate(comment.created_at)}
        </span>
        {canEdit && !editing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuRef}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("comments.commentActions")}
                className="size-7"
              >
                <IconDots size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" data-comment-menu>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  {t("comments.edit")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="ps-8 text-[13px] leading-relaxed text-foreground/90">
        {editing ? (
          <div>
            <CommentComposer
              ref={inputRef}
              ariaLabel={t("comments.edit")}
              value={draft.draft.text}
              onChange={draft.setText}
              members={members}
              onMentionAdd={(mention) =>
                draft.setMentions((previous) => [...previous, mention])
              }
              onSubmit={save}
              onEscape={close}
              autoFocus
              disabled={edit.isPending}
            />
            <div className="mt-1 flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={edit.isPending}
                onClick={() => {
                  draft.discard();
                  close();
                }}
              >
                {t("comments.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={edit.isPending || !draft.draft.text.trim()}
                onClick={save}
              >
                {t("comments.save")}
              </Button>
            </div>
          </div>
        ) : (
          renderCommentBody(comment.content, comment.mentions)
        )}
        {pending && showMutationStatus && (
          <span role="status" className="block text-xs text-muted-foreground">
            {t("comments.saving")}
          </span>
        )}
        {comment.mutation?.ambiguous && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={checking}
            onClick={checkSaved}
          >
            {t("comments.checkSaved")}
          </Button>
        )}
        {comment.mutation?.status === "error" && showMutationStatus && (
          <span role="alert" className="block text-xs text-destructive">
            {t(
              comment.mutation.ambiguous
                ? "comments.saveUnconfirmed"
                : "empty.genericError",
            )}
          </span>
        )}
      </div>
    </div>
  );
}
