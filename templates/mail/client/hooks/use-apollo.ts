import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApolloPersonResult } from "@shared/types";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useApolloStatus() {
  const { data } = useQuery<{ connected: boolean }>({
    queryKey: ["apollo-status"],
    queryFn: () => apiFetch("/api/apollo/status"),
    staleTime: 30_000,
  });
  return { connected: data?.connected ?? false };
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
      await apiFetch("/api/apollo/key", { method: "DELETE" });
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
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
