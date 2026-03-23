import { useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface NavigationState {
  view: string;
  threadId?: string;
  focusedEmailId?: string;
  search?: string;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    if (res.status === 404) return undefined as T;
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json();
}

export function useNavigationState() {
  const qc = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Write-only: UI syncs its current state so the agent can read it
  const putMutation = useMutation({
    mutationFn: (state: NavigationState) =>
      apiFetch("/api/application-state/navigation", {
        method: "PUT",
        body: JSON.stringify(state),
      }),
  });

  const sync = useCallback(
    (state: NavigationState) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        putMutation.mutate(state);
      }, 500);
    },
    [putMutation],
  );

  // One-shot command: agent writes navigate.json, UI reads and deletes it
  const command = useQuery<NavigationState | null>({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const result = await apiFetch<NavigationState | undefined>(
        "/api/application-state/navigate",
      );
      return result ?? null;
    },
    staleTime: 2_000,
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/application-state/navigate", { method: "DELETE" }),
    onSuccess: () => {
      qc.setQueryData(["navigate-command"], undefined);
    },
  });

  const clearCommand = useCallback(() => {
    deleteMutation.mutate();
  }, [deleteMutation]);

  return {
    sync,
    command: { data: command.data },
    clearCommand,
  };
}
