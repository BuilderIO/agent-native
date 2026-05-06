import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";
import type {
  ManagedGmailFilter,
  ManagedGmailFiltersAccount,
} from "@shared/types";

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
  const res = await fetch(
    agentNativePath("/_agent-native/actions/manage-gmail-filters"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": TAB_ID,
      },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body?.error || body?.message || `Request failed (${res.status})`,
    );
  }
  return res.json();
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
      runManageGmailFilters<GmailFilterMutationResponse>({
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
      runManageGmailFilters<GmailFilterMutationResponse>({
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
      runManageGmailFilters<GmailFilterMutationResponse>({
        ...input,
        operation: "delete",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["gmail-filters"] }),
  });
}
