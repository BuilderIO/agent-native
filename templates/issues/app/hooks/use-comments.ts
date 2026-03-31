import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useComments(issueKey: string | undefined) {
  return useQuery({
    queryKey: ["comments", issueKey],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueKey}/comments`);
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    enabled: !!issueKey,
    staleTime: 30_000,
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      issueKey,
      body,
    }: {
      issueKey: string;
      body: string;
    }) => {
      const res = await fetch(`/api/issues/${issueKey}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Failed to add comment");
      return res.json();
    },
    onSuccess: (_, { issueKey }) => {
      qc.invalidateQueries({ queryKey: ["comments", issueKey] });
      qc.invalidateQueries({ queryKey: ["issue", issueKey] });
    },
  });
}

export function useEditComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      issueKey,
      commentId,
      body,
    }: {
      issueKey: string;
      commentId: string;
      body: string;
    }) => {
      const res = await fetch(`/api/issues/${issueKey}/comments/${commentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Failed to edit comment");
      return res.json();
    },
    onSuccess: (_, { issueKey }) => {
      qc.invalidateQueries({ queryKey: ["comments", issueKey] });
    },
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      issueKey,
      commentId,
    }: {
      issueKey: string;
      commentId: string;
    }) => {
      const res = await fetch(`/api/issues/${issueKey}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete comment");
      return res.json();
    },
    onSuccess: (_, { issueKey }) => {
      qc.invalidateQueries({ queryKey: ["comments", issueKey] });
      qc.invalidateQueries({ queryKey: ["issue", issueKey] });
    },
  });
}
