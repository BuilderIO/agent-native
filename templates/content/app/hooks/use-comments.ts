import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  return useQuery({
    queryKey: ["comments", documentId],
    queryFn: () =>
      fetchJson<{ comments: Comment[] }>(
        `/api/comments?documentId=${documentId}`,
      ),
    enabled: !!documentId,
    select: (data) => {
      // Group into threads
      const threadMap = new Map<string, CommentThread>();
      for (const c of data.comments) {
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
    refetchInterval: 5000, // Poll for new comments
  });
}

export function useCreateComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      documentId: string;
      content: string;
      threadId?: string;
      parentId?: string;
      quotedText?: string;
    }) =>
      fetchJson<{ id: string; threadId: string }>("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["comments", variables.documentId] });
    },
  });
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
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["comments", variables.documentId] });
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; documentId: string }) =>
      fetchJson<{ ok: boolean }>(`/api/comments/${id}`, { method: "DELETE" }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["comments", variables.documentId] });
    },
  });
}
