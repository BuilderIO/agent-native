import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApolloPersonResult } from "@shared/types";
import { useSettings, useUpdateSettings } from "./use-emails";

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useApolloStatus() {
  const { data: settings } = useSettings();
  return {
    connected: !!settings?.apolloApiKey,
  };
}

export function useApolloConnect() {
  const updateSettings = useUpdateSettings();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (apiKey: string) => {
      // Test the key first
      const res = await fetch(`/api/apollo/person?email=test@example.com`);
      // 401 means our server doesn't have a key yet, which is expected
      // We need to save first, then test
      updateSettings.mutate({ apolloApiKey: apiKey });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useApolloDisconnect() {
  const updateSettings = useUpdateSettings();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      updateSettings.mutate({ apolloApiKey: "" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
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
    staleTime: 5 * 60 * 1000, // Cache for 5 min
    retry: false,
  });
}
