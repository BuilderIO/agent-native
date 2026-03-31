import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useJiraAuthStatus() {
  return useQuery({
    queryKey: ["jira-auth-status"],
    queryFn: async () => {
      const res = await fetch("/api/atlassian/status");
      if (!res.ok) throw new Error("Failed to fetch auth status");
      return res.json();
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useJiraAuthUrl(enabled = false) {
  return useQuery({
    queryKey: ["jira-auth-url"],
    queryFn: async () => {
      const res = await fetch("/api/atlassian/auth-url");
      // Return JSON even on error so the banner can show the message
      return res.json();
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDisconnectJira() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch("/api/atlassian/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jira-auth-status"] });
    },
  });
}
