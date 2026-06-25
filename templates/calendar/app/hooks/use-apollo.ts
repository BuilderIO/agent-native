import { agentNativePath } from "@agent-native/core/client";
import type { ApolloPersonResult } from "@shared/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { appApiPath } from "@/lib/api-path";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(
    url.startsWith("/api/") ? appApiPath(url) : agentNativePath(url),
    {
      headers: { "Content-Type": "application/json" },
      ...options,
    },
  );
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useApolloStatus() {
  // The raw API key is never sent to the browser. This endpoint returns only
  // `{ connected }`; the secret stays in the encrypted per-user vault server-side.
  const { data } = useQuery<{ connected: boolean } | null>({
    queryKey: ["apollo-status"],
    queryFn: async () => {
      const res = await fetch(appApiPath("/api/apollo/status"));
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
  return { connected: !!data?.connected };
}

export function useApolloConnect() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (apiKey: string) => {
      await apiFetch("/api/apollo/key", {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apollo-status"] });
      qc.invalidateQueries({ queryKey: ["apollo-person"] });
    },
  });
}

export function useApolloDisconnect() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiFetch("/api/apollo/key", {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apollo-status"] });
      qc.invalidateQueries({ queryKey: ["apollo-person"] });
    },
  });
}

export function useApolloPerson(email: string | undefined) {
  const { connected } = useApolloStatus();

  return useQuery<ApolloPersonResult | null>({
    queryKey: ["apollo-person", email],
    queryFn: async () => {
      const result = await apiFetch<ApolloPersonResult | null>(
        `/api/apollo/person?email=${encodeURIComponent(email!)}`,
      );
      return result ?? null;
    },
    enabled: !!email && connected,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}
