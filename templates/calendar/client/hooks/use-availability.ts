import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AvailabilityConfig } from "@shared/api";

export function useAvailability() {
  return useQuery<AvailabilityConfig>({
    queryKey: ["availability"],
    queryFn: async () => {
      const res = await fetch("/api/availability");
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
  });
}

export function useUpdateAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: AvailabilityConfig) => {
      const res = await fetch("/api/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update availability");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });
}
