import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type { GoogleSearchResponse } from "@shared/api";

interface GoogleSearchParams {
  query: string;
  page?: number;
}

export function useGoogleSearch(params: GoogleSearchParams | null) {
  return useQuery<GoogleSearchResponse>({
    queryKey: ["google-search", params],
    queryFn: async ({ signal }) => {
      if (!params?.query) return { results: [], hasNextPage: false };
      const qs = new URLSearchParams({ q: params.query });
      if (params.page) qs.set("page", String(params.page));

      const res = await authFetch(`/api/google/search?${qs}`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Search failed (${res.status})`);
      }
      return res.json();
    },
    enabled: !!params?.query,
    staleTime: 120_000,
    retry: false,
  });
}
