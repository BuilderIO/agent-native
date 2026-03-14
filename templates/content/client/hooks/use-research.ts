import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type { ResearchData } from "@shared/api";

export function useResearch(projectSlug: string | null) {
  return useQuery<ResearchData | null>({
    queryKey: ["research", projectSlug],
    queryFn: async () => {
      if (!projectSlug) return null;
      const res = await authFetch(`/api/projects/${projectSlug}/research`);
      if (!res.ok) throw new Error("Failed to fetch research");
      return res.json();
    },
    enabled: !!projectSlug,
  });
}

export function useSaveResearch(projectSlug: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ResearchData) => {
      if (!projectSlug) throw new Error("No project selected");
      const res = await authFetch(`/api/projects/${projectSlug}/research`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save research");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research", projectSlug] });
    },
  });
}
