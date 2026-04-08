import { useState, useRef, useEffect } from "react";
import {
  useComments,
  useCreateComment,
  useResolveComment,
  type CommentThread,
} from "@/hooks/use-comments";
import { sendToAgentChat } from "@agent-native/core/client";
import { IconCheck, IconSparkles } from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CommentsSidebarProps {
  documentId: string;
  /** Pre-filled quoted text for a new comment from text selection. */
  pendingQuotedText?: string | null;
  /** Called after the pending comment is submitted or dismissed. */
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
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [pendingText, setPendingText] = useState("");
  const pendingInputRef = useRef<HTMLTextAreaElement>(null);

  const openThreads = threads?.filter((t) => !t.resolved) ?? [];
  const resolvedThreads = threads?.filter((t) => t.resolved) ?? [];

  // Focus the pending comment input when quoted text comes in
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
    setReplyingTo(null);
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

  const hasContent =
    openThreads.length > 0 || resolvedThreads.length > 0 || !!pendingQuotedText;

  if (!hasContent && !isLoading) return null;

  return (
    <div className="w-72 shrink-0 overflow-auto py-4 pl-2 pr-4">
      {/* New comment from text selection */}
      {pendingQuotedText && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-background p-3 shadow-sm">
          <div className="text-xs text-muted-foreground bg-accent/50 px-2 py-1 rounded mb-2 line-clamp-2 italic border-l-2 border-primary/30">
            {pendingQuotedText}
          </div>
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
            className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
          />
          <div className="flex gap-1 mt-1.5">
            <button
              onClick={handlePendingSubmit}
              disabled={!pendingText.trim()}
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Comment
            </button>
            <button
              onClick={handlePendingCancel}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Open threads */}
      {openThreads.map((thread) => (
        <ThreadView
          key={thread.threadId}
          thread={thread}
          isReplying={replyingTo === thread.threadId}
          replyText={replyText}
          onStartReply={() => setReplyingTo(thread.threadId)}
          onReplyChange={setReplyText}
          onSubmitReply={() => handleReply(thread.threadId)}
          onCancelReply={() => {
            setReplyingTo(null);
            setReplyText("");
          }}
          onResolve={() =>
            resolveComment.mutate({
              id: thread.comments[0].id,
              documentId,
            })
          }
          onSendToAI={() => handleSendToAI(thread)}
        />
      ))}

      {/* Resolved threads */}
      {resolvedThreads.length > 0 && (
        <>
          <div className="text-[11px] text-muted-foreground font-medium mt-4 mb-2 px-1">
            Resolved
          </div>
          {resolvedThreads.map((thread) => (
            <ThreadView
              key={thread.threadId}
              thread={thread}
              isReplying={false}
              replyText=""
              onStartReply={() => {}}
              onReplyChange={() => {}}
              onSubmitReply={() => {}}
              onCancelReply={() => {}}
              onResolve={() => {}}
              onSendToAI={() => handleSendToAI(thread)}
              resolved
            />
          ))}
        </>
      )}
    </div>
  );
}

function ThreadView({
  thread,
  isReplying,
  replyText,
  onStartReply,
  onReplyChange,
  onSubmitReply,
  onCancelReply,
  onResolve,
  onSendToAI,
  resolved,
}: {
  thread: CommentThread;
  isReplying: boolean;
  replyText: string;
  onStartReply: () => void;
  onReplyChange: (text: string) => void;
  onSubmitReply: () => void;
  onCancelReply: () => void;
  onResolve: () => void;
  onSendToAI: () => void;
  resolved?: boolean;
}) {
  return (
    <div
      className={`mb-3 rounded-lg border border-border bg-background p-3 shadow-sm ${resolved ? "opacity-50" : ""}`}
    >
      {/* Quoted text */}
      {thread.quotedText && (
        <div className="text-xs text-muted-foreground bg-accent/50 px-2 py-1 rounded mb-2 line-clamp-2 italic border-l-2 border-primary/30">
          {thread.quotedText}
        </div>
      )}

      {/* Comments in thread */}
      {thread.comments.map((c) => (
        <div key={c.id} className={`mb-2 ${c.parent_id ? "ml-3" : ""}`}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-medium text-foreground">
              {c.author_name ?? c.author_email.split("@")[0]}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {new Date(c.created_at).toLocaleDateString()}
            </span>
          </div>
          <p className="text-sm text-foreground/80">{c.content}</p>
        </div>
      ))}

      {/* Actions */}
      {!resolved && (
        <div className="flex items-center gap-0.5 mt-1">
          <button
            onClick={onStartReply}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
          >
            Reply
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onResolve}
                className="p-1.5 rounded text-muted-foreground hover:text-green-500 hover:bg-accent"
              >
                <IconCheck size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Resolve</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onSendToAI}
                className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-accent"
              >
                <IconSparkles size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Ask AI about this</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Reply input */}
      {isReplying && (
        <div className="mt-2">
          <textarea
            value={replyText}
            onChange={(e) => onReplyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmitReply();
              }
              if (e.key === "Escape") onCancelReply();
            }}
            placeholder="Reply..."
            className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            autoFocus
          />
          <div className="flex gap-1 mt-1">
            <button
              onClick={onSubmitReply}
              className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Reply
            </button>
            <button
              onClick={onCancelReply}
              className="px-2 py-1 text-xs rounded text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
