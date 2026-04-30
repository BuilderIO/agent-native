import { useQuery } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

interface EnvStatusEntry {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

export function useDbStatus() {
  const { data, isLoading } = useQuery<EnvStatusEntry[]>({
    queryKey: ["env-status"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/env-status"));
      if (!res.ok) throw new Error("Failed to fetch env status");
      return res.json();
    },
    staleTime: 30_000,
  });

  const dbUrlEntry = data?.find((e) => e.key === "DATABASE_URL");
  const configured = dbUrlEntry?.configured ?? false;

  return {
    configured,
    isLocal: !configured,
    isLoading,
  };
}
