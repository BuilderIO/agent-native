import { callAction } from "@agent-native/core/client/hooks";
import type { Alias } from "@shared/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useAliases() {
  return useQuery<Alias[]>({
    queryKey: ["aliases"],
    queryFn: () => callAction("list-aliases", {}, { method: "GET" }),
    staleTime: 60_000,
  });
}

export function useCreateAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; emails: string[] }) =>
      callAction("create-alias", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });
}

export function useUpdateAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; name?: string; emails?: string[] }) =>
      callAction("update-alias", data, { method: "PUT" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });
}

export function useDeleteAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callAction("delete-alias", { id }, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });
}
