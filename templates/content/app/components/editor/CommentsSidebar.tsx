import { useState, useRef } from "react";
import {
  useComments,
  useCreateComment,
  useResolveComment,
  type CommentThread,
} from "@/hooks/use-comments";
import { sendToAgentChat } from "@agent-native/core/client";
import {
  IconCheck,
  IconMessageCircle,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CommentsSidebarProps {
  documentId: string;
  onClose: () => void;
}

export function CommentsSidebar({ documentId, onClose }: CommentsSidebarProps) {
  const { data: threads, isLoading } = useComments(documentId);
  const createComment = useCreateComment();
  const resolveComment = useResolveComment();
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const openThreads = threads?.filter((t) => !t.resolved) ?? [];
  const resolvedThreads = threads?.filter((t) => t.resolved) ?? [];

  const handleNewComment = () => {
    if (!newComment.trim()) return;
    createComment.mutate({
      documentId,
      content: newComment.trim(),
    });
    setNewComment("");
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

  return (
    <div className="w-full sm:w-80 border-l border-border bg-background flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium">
          <IconMessageCircle size={16} />
          Comments
          {openThreads.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
              {openThreads.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
        >
          <IconX size={16} />
        </button>
      </div>

      {/* New comment */}
      <div className="px-4 py-3 border-b border-border">
        <textarea
          ref={inputRef}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleNewComment();
            }
          }}
          placeholder="Add a comment..."
          className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          rows={2}
        />
        {newComment.trim() && (
          <button
            onClick={handleNewComment}
            className="mt-2 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Comment
          </button>
        )}
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="text-center text-muted-foreground text-sm py-8">
            Loading...
          </div>
        )}

        {!isLoading && openThreads.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            No comments yet
          </div>
        )}

        {openThreads.map((thread) => (
          <ThreadView
            key={thread.threadId}
            thread={thread}
            documentId={documentId}
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

        {resolvedThreads.length > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground font-medium border-t border-border mt-2">
            Resolved ({resolvedThreads.length})
          </div>
        )}
        {resolvedThreads.map((thread) => (
          <ThreadView
            key={thread.threadId}
            thread={thread}
            documentId={documentId}
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
      </div>
    </div>
  );
}

function ThreadView({
  thread,
  documentId,
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
  documentId: string;
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
      className={`px-4 py-3 border-b border-border ${resolved ? "opacity-50" : ""}`}
    >
      {/* Quoted text */}
      {thread.quotedText && (
        <div className="text-xs text-muted-foreground bg-accent/50 px-2 py-1 rounded mb-2 line-clamp-2 italic border-l-2 border-primary/30">
          {thread.quotedText}
        </div>
      )}

      {/* Comments in thread */}
      {thread.comments.map((c) => (
        <div key={c.id} className={`mb-2 ${c.parent_id ? "ml-4" : ""}`}>
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
        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={onStartReply}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-accent"
          >
            Reply
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onResolve}
                className="p-2 rounded-lg text-muted-foreground hover:text-green-500 hover:bg-accent"
              >
                <IconCheck size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Resolve</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onSendToAI}
                className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent"
              >
                <IconSparkles size={16} />
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
