import { appApiPath } from "@agent-native/core/client";
import type { ApolloPersonResult } from "@shared/types";
import { useQuery } from "@tanstack/react-query";

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(appApiPath(url));
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function useApolloPerson(email: string | undefined) {
  return useQuery<ApolloPersonResult | null>({
    queryKey: ["integration-data", "apollo", email],
    queryFn: async () => {
      const result = await apiFetch<ApolloPersonResult | null>(
        `/api/apollo/person?email=${encodeURIComponent(email!)}`,
      );
      return result ?? null;
    },
    enabled: !!email,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
