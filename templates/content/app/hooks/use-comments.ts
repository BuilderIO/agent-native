import { useActionQuery, useActionMutation } from "@agent-native/core/client";

export interface CommentMention {
  email: string;
  name: string;
}

export interface Comment {
  id: string;
  document_id: string;
  thread_id: string;
  parent_id: string | null;
  content: string;
  quoted_text: string | null;
  anchor_prefix: string | null;
  anchor_suffix: string | null;
  anchor_start_offset: number | null;
  mentions: CommentMention[];
  author_email: string;
  author_name: string | null;
  resolved: number;
  created_at: string;
  updated_at: string;
  notion_comment_id: string | null;
}

export interface CommentThread {
  threadId: string;
  quotedText: string | null;
  /** Robust anchor context, captured from the root comment. */
  prefix: string | null;
  suffix: string | null;
  startOffset: number | null;
  resolved: boolean;
  comments: Comment[];
}

export function useComments(documentId: string | null) {
  return useActionQuery<CommentThread[]>(
    "list-comments",
    documentId ? { documentId } : undefined,
    {
      enabled: !!documentId,
      select: (data: any) => {
        // Group into threads
        const raw = data?.comments ?? data;
        const comments: Comment[] = Array.isArray(raw) ? raw : [];
        const threadMap = new Map<string, CommentThread>();
        for (const c of comments) {
          if (!threadMap.has(c.thread_id)) {
            threadMap.set(c.thread_id, {
              threadId: c.thread_id,
              quotedText: c.quoted_text,
              prefix: c.anchor_prefix ?? null,
              suffix: c.anchor_suffix ?? null,
              startOffset:
                typeof c.anchor_start_offset === "number"
                  ? c.anchor_start_offset
                  : null,
              resolved: !!c.resolved,
              comments: [],
            });
          }
          threadMap.get(c.thread_id)!.comments.push(c);
        }
        return Array.from(threadMap.values());
      },
      refetchInterval: 5000,
    },
  );
}

export function useCreateComment() {
  return useActionMutation<
    { id: string; threadId: string },
    {
      documentId: string;
      content: string;
      threadId?: string;
      parentId?: string;
      quotedText?: string;
      anchorPrefix?: string;
      anchorSuffix?: string;
      anchorStartOffset?: number;
      authorName?: string;
      mentions?: string;
    }
  >("add-comment");
}

export function useResolveComment() {
  return useActionMutation<
    { ok: boolean; resolved?: boolean },
    { id: string; documentId: string; resolved?: boolean }
  >("update-comment");
}

export function useDeleteComment() {
  return useActionMutation<{ ok: boolean }, { id: string; documentId: string }>(
    "delete-comment",
  );
}
