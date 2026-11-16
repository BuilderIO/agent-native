import { callAction, useActionMutation } from "@agent-native/core/client/hooks";
import type { Alias } from "@shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const aliasesQueryOptions = {
  queryKey: ["aliases"],
  queryFn: () =>
    callAction("list-aliases", {}, { method: "GET" }) as Promise<Alias[]>,
  staleTime: 60_000,
};

export function useAliases() {
  return useQuery<Alias[]>(aliasesQueryOptions);
}

export function useCreateAlias() {
  const qc = useQueryClient();
  return useActionMutation<
    undefined,
    { name: string; emails: string[] },
    "create-alias"
  >("create-alias", {
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });
}

export function useUpdateAlias() {
  const qc = useQueryClient();
  return useActionMutation<
    undefined,
    { id: string; name?: string; emails?: string[] },
    "update-alias"
  >("update-alias", {
    method: "PUT",
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });
}

export function useDeleteAlias() {
  const qc = useQueryClient();
  return useActionMutation<undefined, { id: string }, "delete-alias">(
    "delete-alias",
    {
      method: "DELETE",
      onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
    },
  );
}
