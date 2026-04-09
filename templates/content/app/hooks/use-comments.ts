import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";

export interface Comment {
  id: string;
  document_id: string;
  thread_id: string;
  parent_id: string | null;
  content: string;
  quoted_text: string | null;
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
  resolved: boolean;
  comments: Comment[];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
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
    }
  >("add-comment");
}

export function useResolveComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; documentId: string }) =>
      fetchJson<{ ok: boolean }>(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action"] });
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; documentId: string }) =>
      fetchJson<{ ok: boolean }>(`/api/comments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["action"] });
    },
  });
}
