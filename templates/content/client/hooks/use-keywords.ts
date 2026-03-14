import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type {
  KeywordSuggestResponse,
  KeywordVolumeResponse,
  KeywordApiStatus,
} from "@shared/api";

export function useKeywordSuggest(query: string) {
  return useQuery<KeywordSuggestResponse>({
    queryKey: ["keywordSuggest", query],
    queryFn: async () => {
      const res = await authFetch(
        `/api/keywords/suggest?q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json();
    },
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000, // cache for 5 min
  });
}

export function useKeywordVolume() {
  return useMutation<KeywordVolumeResponse, Error, { keywords: string[] }>({
    mutationFn: async ({ keywords }) => {
      const res = await authFetch("/api/keywords/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to fetch volume data");
      }
      return res.json();
    },
  });
}

export function useKeywordApiStatus() {
  return useQuery<KeywordApiStatus>({
    queryKey: ["keywordApiStatus"],
    queryFn: async () => {
      const res = await authFetch("/api/keywords/status");
      if (!res.ok) throw new Error("Failed to check API status");
      return res.json();
    },
    staleTime: 30 * 1000,
  });
}
