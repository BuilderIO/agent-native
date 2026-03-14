import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type {
  TwitterSearchResponse,
  TwitterArticle,
  TwitterSaveRequest,
  TwitterSaveResponse,
  LinkPreviewData,
} from "@shared/api";

interface SearchParams {
  query: string;
  queryType?: "Top" | "Latest";
  sinceTime?: number;
  untilTime?: number;
  cursor?: string;
  filter?: "all" | "links" | "media";
}

export function useTwitterSearch(params: SearchParams | null) {
  return useQuery<TwitterSearchResponse>({
    queryKey: ["twitter-search", params],
    queryFn: async ({ signal }) => {
      if (!params?.query) return { tweets: [], hasNextPage: false };
      const qs = new URLSearchParams({ query: params.query });
      if (params.queryType) qs.set("queryType", params.queryType);
      if (params.sinceTime) qs.set("sinceTime", String(params.sinceTime));
      if (params.untilTime) qs.set("untilTime", String(params.untilTime));
      if (params.cursor) qs.set("cursor", params.cursor);
      if (params.filter && params.filter !== "all") qs.set("filter", params.filter);

      const res = await authFetch(`/api/twitter/search?${qs}`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error || `Search failed (${res.status})`;
        throw new Error(msg);
      }
      return res.json();
    },
    enabled: !!params?.query,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      // Auto-retry rate limits up to 3 times
      if (error.message.includes("Rate limited")) return failureCount < 3;
      return false;
    },
    retryDelay: 6000,
  });
}

export function useTwitterArticle(tweetId: string | null) {
  return useQuery<TwitterArticle>({
    queryKey: ["twitter-article", tweetId],
    queryFn: async ({ signal }) => {
      const res = await authFetch(`/api/twitter/article?tweetId=${tweetId}`, { signal });
      if (!res.ok) throw new Error("Article fetch failed");
      return res.json();
    },
    enabled: !!tweetId,
    staleTime: 300_000,
  });
}

export function useLinkPreview(url: string | null) {
  return useQuery<LinkPreviewData>({
    queryKey: ["link-preview", url],
    queryFn: async ({ signal }) => {
      const res = await authFetch(`/api/twitter/preview?url=${encodeURIComponent(url!)}`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Preview fetch failed");
      }
      return res.json();
    },
    enabled: !!url,
    staleTime: 600_000, // cache previews for 10 minutes
    retry: false,
  });
}

export function useFetchMarkdown(url: string | null) {
  return useQuery<{ markdown: string; url: string }>({
    queryKey: ["fetch-markdown", url],
    queryFn: async ({ signal }) => {
      const res = await authFetch(`/api/twitter/fetch-markdown?url=${encodeURIComponent(url!)}`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Fetch failed");
      }
      return res.json();
    },
    enabled: !!url,
    staleTime: 600_000,
    retry: false,
  });
}

export function useSaveTwitterResults() {
  const qc = useQueryClient();
  return useMutation<TwitterSaveResponse, Error, TwitterSaveRequest>({
    mutationFn: async (data) => {
      const res = await authFetch("/api/twitter/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
