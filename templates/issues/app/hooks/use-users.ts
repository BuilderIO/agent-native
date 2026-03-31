import { useQuery } from "@tanstack/react-query";

export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: ["users", query],
    queryFn: async () => {
      const res = await fetch(
        `/api/users/search?query=${encodeURIComponent(query)}`,
      );
      if (!res.ok) throw new Error("Failed to search users");
      return res.json();
    },
    enabled: query.length >= 1,
    staleTime: 30_000,
  });
}
