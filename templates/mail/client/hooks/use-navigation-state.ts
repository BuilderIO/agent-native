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

  const query = useQuery<NavigationState | undefined>({
    queryKey: ["navigation-state"],
    queryFn: () =>
      apiFetch<NavigationState | undefined>(
        "/api/application-state/navigation",
      ),
    staleTime: 5_000,
  });

  const putMutation = useMutation({
    mutationFn: (state: NavigationState) =>
      apiFetch("/api/application-state/navigation", {
        method: "PUT",
        body: JSON.stringify(state),
      }),
  });

  // Debounced sync — UI writes to file so the agent can see current state
  const sync = useCallback(
    (state: NavigationState) => {
      qc.setQueryData<NavigationState>(["navigation-state"], state);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        putMutation.mutate(state);
      }, 500);
    },
    [qc, putMutation],
  );

  return {
    data: query.data,
    sync,
  };
}
