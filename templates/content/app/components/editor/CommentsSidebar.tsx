import { useState, useRef, useEffect, type RefObject } from "react";
import {
  useComments,
  useCreateComment,
  useResolveComment,
  type CommentThread,
} from "@/hooks/use-comments";
import { sendToAgentChat } from "@agent-native/core/client";
import {
  IconCheck,
  IconDots,
  IconMessageCircle,
  IconArrowUp,
  IconAt,
} from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

/** Find the Y offset of quoted text in the ProseMirror editor relative to the scroll container. */
function findTextOffsetInEditor(
  quotedText: string | null,
  scrollContainer: HTMLElement | null,
): number | null {
  if (!quotedText || !scrollContainer) return null;
  const pm = scrollContainer.querySelector(".ProseMirror") as HTMLElement;
  if (!pm) return null;

  const walker = window.document.createTreeWalker(
    pm,
    NodeFilter.SHOW_TEXT,
    null,
  );
  let node: Node | null;
  const searchStr = quotedText.slice(0, 40);
  while ((node = walker.nextNode())) {
    if (node.textContent && node.textContent.includes(searchStr)) {
      const range = window.document.createRange();
      range.selectNode(node);
      const rect = range.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      return rect.top - containerRect.top + scrollContainer.scrollTop;
    }
  }
  return null;
}

interface CommentsSidebarProps {
  documentId: string;
  pendingComment?: { quotedText: string; offsetTop: number } | null;
  onPendingDone?: () => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

export function CommentsSidebar({
  documentId,
  pendingComment,
  onPendingDone,
  scrollContainerRef,
}: CommentsSidebarProps) {
  const { data: threads, isLoading } = useComments(documentId);
  const createComment = useCreateComment();
  const resolveComment = useResolveComment();
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [pendingText, setPendingText] = useState("");
  const pendingInputRef = useRef<HTMLTextAreaElement>(null);

  const openThreads = threads?.filter((t) => !t.resolved) ?? [];

  useEffect(() => {
    if (pendingComment) {
      setPendingText("");
      setTimeout(() => pendingInputRef.current?.focus(), 50);
    }
  }, [pendingComment]);

  const handlePendingSubmit = () => {
    if (!pendingText.trim()) return;
    createComment.mutate({
      documentId,
      content: pendingText.trim(),
      quotedText: pendingComment?.quotedText,
    });
    setPendingText("");
    onPendingDone?.();
  };

  const handlePendingCancel = () => {
    setPendingText("");
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
    });
    setReplyText("");
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

  // Calculate Y positions for each thread based on quoted text in the editor DOM
  const [threadOffsets, setThreadOffsets] = useState<Map<string, number>>(
    new Map(),
  );
  const threadIds = openThreads.map((t) => t.threadId).join(",");
  useEffect(() => {
    if (!scrollContainerRef?.current || openThreads.length === 0) return;
    const offsets = new Map<string, number>();
    for (const thread of openThreads) {
      const offset = findTextOffsetInEditor(
        thread.quotedText,
        scrollContainerRef.current,
      );
      if (offset != null) {
        offsets.set(thread.threadId, offset);
      }
    }
    setThreadOffsets(offsets);
  }, [threadIds, scrollContainerRef]);

  const hasContent = openThreads.length > 0 || !!pendingComment;
  if (!hasContent && !isLoading) return null;

  // Sort threads by their position in the document
  const sortedThreads = [...openThreads].sort((a, b) => {
    const aOff = threadOffsets.get(a.threadId) ?? Infinity;
    const bOff = threadOffsets.get(b.threadId) ?? Infinity;
    return aOff - bOff;
  });

  // Position each card with margin-top to align with its text, avoiding overlap
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
    // Estimate card height (~80px base + ~44px per additional comment)
    cursor += marginTop + 80 + (thread.comments.length - 1) * 44;
  }

  return (
    <div className="w-80 shrink-0 overflow-auto relative">
      {/* Pending new comment — positioned at selection Y offset */}
      {pendingComment && (
        <div
          className="absolute left-2 right-4 rounded-lg bg-popover p-3 shadow-md ring-1 ring-border/50 z-10"
          style={{ top: pendingComment.offsetTop }}
        >
          <textarea
            ref={pendingInputRef}
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handlePendingSubmit();
              }
              if (e.key === "Escape" && !pendingText.trim())
                handlePendingCancel();
            }}
            onBlur={() => {
              setTimeout(() => {
                if (!pendingText.trim()) handlePendingCancel();
              }, 150);
            }}
            placeholder="Add a comment..."
            className="w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            rows={2}
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

      {/* Thread cards — positioned to align with their referenced text */}
      {items.map(({ thread, marginTop }) => (
        <ThreadView
          key={thread.threadId}
          thread={thread}
          marginTop={marginTop}
          isExpanded={expandedThread === thread.threadId}
          replyText={expandedThread === thread.threadId ? replyText : ""}
          onExpand={() => {
            setExpandedThread(
              expandedThread === thread.threadId ? null : thread.threadId,
            );
            setReplyText("");
          }}
          onCollapse={() => {
            setExpandedThread(null);
            setReplyText("");
          }}
          onReplyChange={setReplyText}
          onSubmitReply={() => handleReply(thread.threadId)}
          onResolve={() =>
            resolveComment.mutate({
              id: thread.comments[0].id,
              documentId,
            })
          }
          onSendToAI={() => handleSendToAI(thread)}
        />
      ))}
    </div>
  );
}

function ThreadView({
  thread,
  marginTop,
  isExpanded,
  replyText,
  onExpand,
  onCollapse,
  onReplyChange,
  onSubmitReply,
  onResolve,
  onSendToAI,
}: {
  thread: CommentThread;
  marginTop: number;
  isExpanded: boolean;
  replyText: string;
  onExpand: () => void;
  onCollapse: () => void;
  onReplyChange: (text: string) => void;
  onSubmitReply: () => void;
  onResolve: () => void;
  onSendToAI: () => void;
}) {
  const replyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => replyInputRef.current?.focus(), 50);
    }
  }, [isExpanded]);

  return (
    <div
      className="group/thread mx-2 mr-4 rounded-lg bg-popover shadow-md ring-1 ring-border/50 cursor-pointer"
      style={{ marginTop }}
      onClick={onExpand}
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
          <button
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-r-md hover:bg-accent"
          >
            <IconDots size={14} />
          </button>
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
            <p className="text-[13px] text-foreground/90 pl-8 leading-relaxed">
              {c.content}
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
            <input
              ref={replyInputRef}
              value={replyText}
              onChange={(e) => onReplyChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmitReply();
                }
                if (e.key === "Escape") onCollapse();
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (!replyText.trim()) onCollapse();
                }, 150);
              }}
              placeholder="Reply..."
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground/50 focus:outline-none pr-16"
            />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              <button className="p-1 text-muted-foreground/40 hover:text-muted-foreground">
                <IconAt size={16} />
              </button>
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
