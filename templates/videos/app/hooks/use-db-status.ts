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
      const res = await fetch("/api/env-status");
      if (!res.ok) return [];
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
