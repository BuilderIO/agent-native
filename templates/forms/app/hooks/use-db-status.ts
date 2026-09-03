import { agentNativePath } from "@agent-native/core/client/api-path";
import { useQuery } from "@tanstack/react-query";

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
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const configured =
    data?.some(
      (entry) =>
        /(?:^|_)DATABASE_URL(?:_UNPOOLED)?$/.test(entry.key) &&
        entry.configured,
    ) ?? false;

  return {
    configured,
    isLocal: !configured,
    isLoading,
  };
}
