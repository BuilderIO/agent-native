import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useTransitions(issueKey: string | undefined) {
  return useQuery({
    queryKey: ["transitions", issueKey],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueKey}/transitions`);
      if (!res.ok) throw new Error("Failed to fetch transitions");
      return res.json();
    },
    enabled: !!issueKey,
    staleTime: 30_000,
  });
}

export function useTransitionIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      issueKey,
      transitionId,
    }: {
      issueKey: string;
      transitionId: string;
    }) => {
      const res = await fetch(`/api/issues/${issueKey}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transitionId }),
      });
      if (!res.ok) throw new Error("Failed to transition issue");
      return res.json();
    },
    onSuccess: (_, { issueKey }) => {
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["issue", issueKey] });
      qc.invalidateQueries({ queryKey: ["transitions", issueKey] });
      qc.invalidateQueries({ queryKey: ["sprint-issues"] });
    },
  });
}
