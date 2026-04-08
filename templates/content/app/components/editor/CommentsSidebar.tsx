import { useState, useRef, useEffect } from "react";
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

interface CommentsSidebarProps {
  documentId: string;
  pendingQuotedText?: string | null;
  onPendingDone?: () => void;
}

export function CommentsSidebar({
  documentId,
  pendingQuotedText,
  onPendingDone,
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
    if (pendingQuotedText) {
      setPendingText("");
      setTimeout(() => pendingInputRef.current?.focus(), 50);
    }
  }, [pendingQuotedText]);

  const handlePendingSubmit = () => {
    if (!pendingText.trim()) return;
    createComment.mutate({
      documentId,
      content: pendingText.trim(),
      quotedText: pendingQuotedText ?? undefined,
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

  const hasContent = openThreads.length > 0 || !!pendingQuotedText;
  if (!hasContent && !isLoading) return null;

  return (
    <div className="w-80 shrink-0 overflow-auto pt-14 pl-2 pr-4 md:pt-16">
      {/* New comment from text selection */}
      {pendingQuotedText && (
        <div className="mb-3 rounded-lg bg-popover p-3 shadow-md ring-1 ring-border/50">
          <textarea
            ref={pendingInputRef}
            value={pendingText}
            onChange={(e) => setPendingText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handlePendingSubmit();
              }
              if (e.key === "Escape") handlePendingCancel();
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

      {openThreads.map((thread) => (
        <ThreadView
          key={thread.threadId}
          thread={thread}
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
      className="group/thread mb-3 rounded-lg bg-popover shadow-md ring-1 ring-border/50 cursor-pointer"
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
                // Delay so click on send button registers first
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
