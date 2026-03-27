import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { OverlayPerson } from "@shared/api";
import { getNextOverlayColor } from "@/lib/overlay-colors";

export function useOverlayPeople() {
  return useQuery<OverlayPerson[]>({
    queryKey: ["overlay-people"],
    queryFn: async () => {
      const res = await fetch("/api/overlay-people");
      if (!res.ok) throw new Error("Failed to fetch overlay people");
      return res.json();
    },
  });
}

export function useAddOverlayPerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (person: { email: string; name?: string }) => {
      const current: OverlayPerson[] =
        queryClient.getQueryData(["overlay-people"]) ?? [];
      if (current.some((p) => p.email === person.email)) return current;
      const color = getNextOverlayColor(current);
      const updated = [...current, { ...person, color }];
      const res = await fetch("/api/overlay-people", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("Failed to save");
      return updated;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["overlay-people"], data);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useRemoveOverlayPerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const current: OverlayPerson[] =
        queryClient.getQueryData(["overlay-people"]) ?? [];
      const updated = current.filter((p) => p.email !== email);
      const res = await fetch("/api/overlay-people", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error("Failed to save");
      return updated;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["overlay-people"], data);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
