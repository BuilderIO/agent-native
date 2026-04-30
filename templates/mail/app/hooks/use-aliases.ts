import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Alias } from "@shared/types";
import { appApiPath } from "@/lib/api-path";
import { TAB_ID } from "@/lib/tab-id";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(appApiPath(url), {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function useAliases() {
  return useQuery<Alias[]>({
    queryKey: ["aliases"],
    queryFn: () => apiFetch("/api/aliases"),
    staleTime: 60_000,
  });
}

export function useCreateAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; emails: string[] }) =>
      apiFetch<Alias>("/api/aliases", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });
}

export function useUpdateAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      emails?: string[];
    }) =>
      apiFetch<Alias>(`/api/aliases/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });
}

export function useDeleteAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/aliases/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });
}
