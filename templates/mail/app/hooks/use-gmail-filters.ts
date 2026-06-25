import { callAction } from "@agent-native/core/client";
import type {
  ManagedGmailFilter,
  ManagedGmailFiltersAccount,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type ManageGmailFiltersInput = {
  operation: "list" | "get" | "create" | "replace" | "delete";
  account?: string;
  id?: string;
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  replaceCriteria?: boolean;
  archive?: boolean;
  markRead?: boolean;
  neverSpam?: boolean;
  neverImportant?: boolean;
  important?: boolean;
  starred?: boolean;
  trash?: boolean;
  label?: string;
  createLabel?: boolean;
  forward?: string;
  replaceAction?: boolean;
};

export type GmailFiltersListResponse = {
  ok: true;
  accounts: ManagedGmailFiltersAccount[];
  total: number;
};

export type GmailFilterMutationResponse = {
  ok: true;
  message: string;
  accountEmail: string;
  deletedId?: string;
  filter?: ManagedGmailFilter;
};

async function runManageGmailFilters<T>(
  input: ManageGmailFiltersInput,
): Promise<T> {
  return callAction<T>("manage-gmail-filters", input);
}

export function useGmailFilters() {
  return useQuery<GmailFiltersListResponse>({
    queryKey: ["gmail-filters"],
    queryFn: () => runManageGmailFilters({ operation: "list" }),
    staleTime: 30_000,
  });
}

export function useCreateGmailFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ManageGmailFiltersInput, "operation">) =>
      callAction<GmailFilterMutationResponse>("manage-gmail-filters", {
        ...input,
        operation: "create",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["gmail-filters"] }),
  });
}

export function useReplaceGmailFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ManageGmailFiltersInput, "operation">) =>
      callAction<GmailFilterMutationResponse>("manage-gmail-filters", {
        ...input,
        operation: "replace",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["gmail-filters"] }),
  });
}

export function useDeleteGmailFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; account?: string }) =>
      callAction<GmailFilterMutationResponse>("manage-gmail-filters", {
        ...input,
        operation: "delete",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["gmail-filters"] }),
  });
}
