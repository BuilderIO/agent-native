import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GenerationRecord } from "@shared/types";

export function useGenerations() {
  return useQuery<GenerationRecord[]>({
    queryKey: ["generations"],
    queryFn: () => fetch("/api/generations").then((r) => r.json()),
  });
}

export function useGeneration(id: string) {
  return useQuery<GenerationRecord>({
    queryKey: ["generations", id],
    queryFn: () => fetch(`/api/generations/${id}`).then((r) => r.json()),
    enabled: !!id,
  });
}

export function useDeleteGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/generations/${id}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["generations"] }),
  });
}
