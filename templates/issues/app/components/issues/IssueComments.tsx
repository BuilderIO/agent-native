import { useState } from "react";
import { useComments, useAddComment } from "@/hooks/use-comments";
import { adfToHtml } from "@/lib/adf-client";
import { format } from "date-fns";
import { Send } from "lucide-react";

interface IssueCommentsProps {
  issueKey: string;
}

export function IssueComments({ issueKey }: IssueCommentsProps) {
  const { data, isLoading } = useComments(issueKey);
  const addComment = useAddComment();
  const [newComment, setNewComment] = useState("");

  const comments = data?.comments || [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    addComment.mutate(
      { issueKey, body: newComment },
      { onSuccess: () => setNewComment("") },
    );
  };

  return (
    <div>
      {/* Add comment */}
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment... (markdown supported)"
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
          />
          <button
            type="submit"
            disabled={!newComment.trim() || addComment.isPending}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>

      {/* Comments list */}
      {isLoading ? (
        <p className="text-[13px] text-muted-foreground">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No comments yet.</p>
      ) : (
        <div className="space-y-4">
          {comments.map((comment: any) => (
            <div
              key={comment.id}
              className="rounded-md border border-border/50 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                  {(comment.author?.displayName || "?")
                    .split(" ")
                    .map((n: string) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <span className="text-[13px] font-medium text-foreground">
                  {comment.author?.displayName}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {comment.created &&
                    format(
                      new Date(comment.created),
                      "MMM d, yyyy 'at' h:mm a",
                    )}
                </span>
              </div>
              <div
                className="adf-content text-[13px]"
                dangerouslySetInnerHTML={{
                  __html: adfToHtml(comment.body),
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
