import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type RefObject,
} from "react";
import {
  useComments,
  useCreateComment,
  useResolveComment,
  type CommentThread,
  type CommentMention,
} from "@/hooks/use-comments";
import {
  useMentionMembers,
  type MentionMember,
} from "@/hooks/use-mention-members";
import { sendToAgentChat, emailToName } from "@agent-native/core/client";
import {
  IconCheck,
  IconMessageCircle,
  IconArrowUp,
  IconArrowBackUp,
  IconChevronDown,
} from "@tabler/icons-react";
import type { CommentTextAnchor } from "./comment-anchors";
import { CommentComposer, type MentionEntry } from "./CommentComposer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Render a comment body, styling any `@mention` tokens that match the comment's
 * stored mentions. Plain text otherwise — no HTML is interpreted.
 */
function renderCommentBody(content: string, mentions: CommentMention[]) {
  const labels = Array.from(
    new Set(mentions.map((m) => m.name).filter((n): n is string => !!n)),
  ).sort((a, b) => b.length - a.length);
  if (labels.length === 0) return content;
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
  return content.split(re).map((seg, i) =>
    seg.startsWith("@") && labels.includes(seg.slice(1)) ? (
      <span key={i} className="comment-mention">
        {seg}
      </span>
    ) : (
      seg
    ),
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

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Y offset (relative to the scroll container's content) of a thread's inline
 * highlight. Prefers the real decoration element rendered by the
 * CommentHighlight plugin (`[data-comment-thread]`); falls back to a text search
 * by quoted text for legacy/unresolved anchors so older comments still line up.
 */
function findThreadOffset(
  threadId: string,
  quotedText: string | null,
  scrollContainer: HTMLElement | null,
): number | null {
  if (!scrollContainer) return null;
  const containerRect = scrollContainer.getBoundingClientRect();

  const marked = scrollContainer.querySelector(
    `[data-comment-thread="${CSS.escape(threadId)}"]`,
  ) as HTMLElement | null;
  if (marked) {
    const rect = marked.getBoundingClientRect();
    return rect.top - containerRect.top + scrollContainer.scrollTop;
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
      return rect.top - containerRect.top + scrollContainer.scrollTop;
    }
  }
  return null;
}

interface CommentsSidebarProps {
  documentId: string;
  pendingComment?: {
    quotedText: string;
    offsetTop: number;
    anchor?: CommentTextAnchor;
    range?: { from: number; to: number };
  } | null;
  onPendingDone?: () => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  activeThreadId?: string | null;
  onActiveThreadChange?: (id: string | null) => void;
  currentUserEmail?: string;
}

export function CommentsSidebar({
  documentId,
  pendingComment,
  onPendingDone,
  scrollContainerRef,
  activeThreadId,
  onActiveThreadChange,
  currentUserEmail,
}: CommentsSidebarProps) {
  const { data: threads, isLoading } = useComments(documentId);
  const { data: members = [] } = useMentionMembers();
  const createComment = useCreateComment();
  const resolveComment = useResolveComment();
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyMentions, setReplyMentions] = useState<MentionEntry[]>([]);
  const [pendingText, setPendingText] = useState("");
  const [pendingMentions, setPendingMentions] = useState<MentionEntry[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const pendingInputRef = useRef<HTMLTextAreaElement>(null);

  const openThreads = useMemo(
    () => threads?.filter((t) => !t.resolved) ?? [],
    [threads],
  );
  const resolvedThreads = useMemo(
    () => threads?.filter((t) => t.resolved) ?? [],
    [threads],
  );

  const authorName = currentUserEmail
    ? emailToName(currentUserEmail)
    : undefined;

  useEffect(() => {
    if (pendingComment) {
      setPendingText("");
      setPendingMentions([]);
      setTimeout(() => pendingInputRef.current?.focus(), 50);
    }
  }, [pendingComment]);

  const handlePendingSubmit = () => {
    if (!pendingText.trim()) return;
    createComment.mutate({
      documentId,
      content: pendingText.trim(),
      quotedText: pendingComment?.quotedText,
      anchorPrefix: pendingComment?.anchor?.prefix,
      anchorSuffix: pendingComment?.anchor?.suffix,
      anchorStartOffset: pendingComment?.anchor?.startOffset,
      authorName,
      mentions: mentionsJsonFor(pendingText, pendingMentions),
    });
    setPendingText("");
    setPendingMentions([]);
    onPendingDone?.();
  };

  const handlePendingCancel = () => {
    setPendingText("");
    setPendingMentions([]);
    onPendingDone?.();
  };

  const handleReply = (threadId: string) => {
    if (!replyText.trim()) return;
    const thread = threads?.find((t) => t.threadId === threadId);
    createComment.mutate({
      documentId,
      content: replyText.trim(),
      threadId,
      parentId: thread?.comments[0]?.id,
      authorName,
      mentions: mentionsJsonFor(replyText, replyMentions),
    });
    setReplyText("");
    setReplyMentions([]);
    setExpandedThread(null);
  };

  const handleSendToAI = (thread: CommentThread) => {
    const commentTexts = thread.comments
      .map((c) => `${c.author_name ?? c.author_email}: ${c.content}`)
      .join("\n");
    const context = thread.quotedText
      ? `Regarding this text: "${thread.quotedText}"\n\n`
      : "";
    sendToAgentChat({
      message: `${context}Comment thread:\n${commentTexts}\n\nPlease help with this.`,
    });
  };

  // Y positions for each open thread, derived from the inline highlight rects.
  // Recomputed when the thread set changes, when a highlight is (de)emphasized,
  // and whenever the editor DOM mutates so cards track edits live.
  const [threadOffsets, setThreadOffsets] = useState<Map<string, number>>(
    new Map(),
  );
  const openThreadKey = openThreads
    .map((t) => `${t.threadId}:${t.quotedText ?? ""}`)
    .join(",");

  const recomputeOffsets = useCallback(() => {
    const container = scrollContainerRef?.current ?? null;
    if (!container || openThreads.length === 0) {
      setThreadOffsets((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const offsets = new Map<string, number>();
    for (const thread of openThreads) {
      const offset = findThreadOffset(
        thread.threadId,
        thread.quotedText,
        container,
      );
      if (offset != null) offsets.set(thread.threadId, offset);
    }
    setThreadOffsets((prev) => {
      if (
        prev.size === offsets.size &&
        [...offsets].every(([k, v]) => prev.get(k) === v)
      ) {
        return prev;
      }
      return offsets;
    });
  }, [openThreads, scrollContainerRef]);

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
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadKey, recomputeOffsets]);

  // When a thread is activated (e.g. its highlight was clicked), expand it and
  // scroll its card into view.
  useEffect(() => {
    if (!activeThreadId) return;
    if (!openThreads.some((t) => t.threadId === activeThreadId)) return;
    setExpandedThread(activeThreadId);
    const card = window.document.querySelector(
      `[data-thread-card="${CSS.escape(activeThreadId)}"]`,
    );
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeThreadId, openThreads]);

  // Surface the resolved list automatically when there's nothing open to show.
  useEffect(() => {
    if (openThreads.length === 0 && !pendingComment && resolvedThreads.length) {
      setShowResolved(true);
    }
  }, [openThreads.length, pendingComment, resolvedThreads.length]);

  const hasContent =
    openThreads.length > 0 || !!pendingComment || resolvedThreads.length > 0;
  if (!hasContent && !isLoading) return null;

  // Sort open threads by their position in the document.
  const sortedThreads = [...openThreads].sort((a, b) => {
    const aOff = threadOffsets.get(a.threadId) ?? Infinity;
    const bOff = threadOffsets.get(b.threadId) ?? Infinity;
    return aOff - bOff;
  });

  // Stack each card to align with its referenced text without overlapping.
  const items: { thread: CommentThread; marginTop: number }[] = [];
  let cursor = 0;
  for (const thread of sortedThreads) {
    const targetTop = threadOffsets.get(thread.threadId);
    const marginTop =
      targetTop != null
        ? Math.max(0, targetTop - cursor)
        : cursor === 0
          ? 0
          : 12;
    items.push({ thread, marginTop });
    cursor += marginTop + 80 + (thread.comments.length - 1) * 44;
  }

  const handleResolve = (thread: CommentThread) => {
    resolveComment.mutate({
      id: thread.comments[0].id,
      documentId,
      resolved: true,
    });
    if (activeThreadId === thread.threadId) onActiveThreadChange?.(null);
  };

  const handleReopen = (thread: CommentThread) => {
    resolveComment.mutate({
      id: thread.comments[0].id,
      documentId,
      resolved: false,
    });
  };

  return (
    <div className="w-80 shrink-0 overflow-auto relative">
      {/* Pending new comment — positioned at the selection Y offset */}
      {pendingComment && (
        <div
          className="absolute left-2 right-4 rounded-lg bg-popover p-3 shadow-md ring-1 ring-border/50 z-10"
          style={{ top: pendingComment.offsetTop }}
        >
          <CommentComposer
            ref={pendingInputRef}
            value={pendingText}
            onChange={setPendingText}
            onMentionAdd={(m) => setPendingMentions((prev) => [...prev, m])}
            onSubmit={handlePendingSubmit}
            onEscape={() => {
              if (!pendingText.trim()) handlePendingCancel();
            }}
            onBlur={() => {
              setTimeout(() => {
                if (!pendingText.trim()) handlePendingCancel();
              }, 200);
            }}
            members={members}
            placeholder="Add a comment…"
            autoFocus
          />
          <div className="flex justify-end gap-1 mt-1.5">
            <button
              onClick={handlePendingCancel}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={handlePendingSubmit}
              disabled={!pendingText.trim()}
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Comment
            </button>
          </div>
        </div>
      )}

      {/* Open thread cards — positioned to align with their referenced text */}
      {items.map(({ thread, marginTop }) => (
        <ThreadView
          key={thread.threadId}
          thread={thread}
          marginTop={marginTop}
          isActive={activeThreadId === thread.threadId}
          isExpanded={expandedThread === thread.threadId}
          replyText={expandedThread === thread.threadId ? replyText : ""}
          onHoverChange={(hovered) =>
            onActiveThreadChange?.(hovered ? thread.threadId : null)
          }
          onExpand={() => {
            setExpandedThread(
              expandedThread === thread.threadId ? null : thread.threadId,
            );
            setReplyText("");
            setReplyMentions([]);
          }}
          onCollapse={() => {
            setExpandedThread(null);
            setReplyText("");
            setReplyMentions([]);
          }}
          onReplyChange={setReplyText}
          onReplyMentionAdd={(m) => setReplyMentions((prev) => [...prev, m])}
          members={members}
          onSubmitReply={() => handleReply(thread.threadId)}
          onResolve={() => handleResolve(thread)}
          onSendToAI={() => handleSendToAI(thread)}
        />
      ))}

      {/* Resolved comments — collapsible, reopenable */}
      {resolvedThreads.length > 0 && (
        <div className="mx-2 mr-4 mt-4 mb-6">
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            <IconChevronDown
              size={14}
              className={showResolved ? "" : "-rotate-90 transition-transform"}
            />
            Resolved ({resolvedThreads.length})
          </button>
          {showResolved && (
            <div className="mt-1.5 space-y-1.5">
              {resolvedThreads.map((thread) => (
                <ResolvedThreadView
                  key={thread.threadId}
                  thread={thread}
                  onReopen={() => handleReopen(thread)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThreadView({
  thread,
  marginTop,
  isActive,
  isExpanded,
  replyText,
  members,
  onHoverChange,
  onExpand,
  onCollapse,
  onReplyChange,
  onReplyMentionAdd,
  onSubmitReply,
  onResolve,
  onSendToAI,
}: {
  thread: CommentThread;
  marginTop: number;
  isActive: boolean;
  isExpanded: boolean;
  replyText: string;
  members: MentionMember[];
  onHoverChange: (hovered: boolean) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onReplyChange: (text: string) => void;
  onReplyMentionAdd: (entry: MentionEntry) => void;
  onSubmitReply: () => void;
  onResolve: () => void;
  onSendToAI: () => void;
}) {
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => replyInputRef.current?.focus(), 50);
    }
  }, [isExpanded]);

  return (
    <div
      data-thread-card={thread.threadId}
      className={`group/thread mx-2 mr-4 rounded-lg bg-popover shadow-md cursor-pointer transition-shadow ${
        isActive
          ? "ring-2 ring-primary/60"
          : "ring-1 ring-border/50 hover:ring-border"
      }`}
      style={{ marginTop }}
      onClick={onExpand}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="relative p-3 pb-2">
        {/* Hover actions — top right, Notion style pill */}
        <div className="absolute top-2 right-2 hidden group-hover/thread:flex items-center rounded-md bg-accent/80 ring-1 ring-border/50">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSendToAI();
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-l-md hover:bg-accent"
              >
                <IconMessageCircle size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Ask AI</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve();
                }}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <IconCheck size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Resolve</TooltipContent>
          </Tooltip>
        </div>

        {/* Comments */}
        {thread.comments.map((c) => (
          <div key={c.id} className="mb-3 last:mb-0">
            <div className="flex items-center gap-2 mb-0.5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium text-white shrink-0"
                style={{ backgroundColor: emailToAvatarColor(c.author_email) }}
              >
                {emailToInitial(c.author_name ?? c.author_email)}
              </div>
              <span className="text-[13px] font-semibold text-foreground">
                {c.author_name ?? c.author_email.split("@")[0]}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDate(c.created_at)}
              </span>
            </div>
            <p className="text-[13px] text-foreground/90 pl-8 leading-relaxed whitespace-pre-wrap">
              {renderCommentBody(c.content, c.mentions)}
            </p>
          </div>
        ))}
      </div>

      {/* Expanded: Notion-style reply input — collapses on blur */}
      {isExpanded && (
        <div
          className="flex items-center gap-2 px-3 pb-3 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium text-white shrink-0 opacity-40"
            style={{
              backgroundColor: emailToAvatarColor(
                thread.comments[0]?.author_email ?? "user",
              ),
            }}
          >
            {emailToInitial(thread.comments[0]?.author_name ?? "user")}
          </div>
          <div className="flex-1 relative">
            <CommentComposer
              ref={replyInputRef}
              value={replyText}
              onChange={onReplyChange}
              onMentionAdd={onReplyMentionAdd}
              onSubmit={onSubmitReply}
              onEscape={onCollapse}
              onBlur={() => {
                setTimeout(() => {
                  if (!replyText.trim()) onCollapse();
                }, 200);
              }}
              members={members}
              placeholder="Reply…"
              rows={1}
              className="w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none pr-16"
            />
            <div className="absolute right-1 bottom-0.5 flex items-center gap-0.5">
              <button
                onClick={onSubmitReply}
                disabled={!replyText.trim()}
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
}: {
  thread: CommentThread;
  onReopen: () => void;
}) {
  const first = thread.comments[0];
  return (
    <div className="group/resolved rounded-lg bg-muted/40 p-3 ring-1 ring-border/40">
      {thread.quotedText && (
        <p className="mb-1.5 truncate border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
          {thread.quotedText}
        </p>
      )}
      <div className="flex items-center gap-2">
        <div
          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white shrink-0 opacity-80"
          style={{ backgroundColor: emailToAvatarColor(first.author_email) }}
        >
          {emailToInitial(first.author_name ?? first.author_email)}
        </div>
        <span className="flex-1 truncate text-[13px] text-muted-foreground">
          {renderCommentBody(first.content, first.mentions)}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onReopen}
              className="p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/resolved:opacity-100"
            >
              <IconArrowBackUp size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reopen</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
