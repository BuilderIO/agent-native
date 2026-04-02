import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApolloPersonResult } from "@shared/types";
import { TAB_ID } from "@/lib/tab-id";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// Uses the generic application-state endpoints which write to
// application-state/apollo.json — the same file the server-side
// Apollo person lookup reads from.

export function useApolloStatus() {
  const { data } = useQuery<{ apiKey?: string } | null>({
    queryKey: ["apollo-status"],
    queryFn: async () => {
      const res = await fetch("/api/application-state/apollo");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
  return { connected: !!data?.apiKey };
}

export function useApolloConnect() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (apiKey: string) => {
      await apiFetch("/api/application-state/apollo", {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apollo-status"] });
      qc.invalidateQueries({ queryKey: ["integration-data", "apollo"] });
    },
  });
}

export function useApolloDisconnect() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiFetch("/api/application-state/apollo", { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apollo-status"] });
      qc.invalidateQueries({ queryKey: ["integration-data", "apollo"] });
    },
  });
}

export function useApolloPerson(email: string | undefined) {
  const { connected } = useApolloStatus();

  return useQuery<ApolloPersonResult | null>({
    queryKey: ["integration-data", "apollo", email],
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
