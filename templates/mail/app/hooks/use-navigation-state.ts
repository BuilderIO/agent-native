import { useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentNativePath } from "@agent-native/core/client";

export interface NavigationState {
  view: string;
  threadId?: string;
  focusedEmailId?: string;
  search?: string;
  label?: string;
}

import { TAB_ID } from "@/lib/tab-id";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(agentNativePath(url), {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Write-only: UI syncs its current state so the agent can read it
  const putMutation = useMutation({
    mutationFn: (state: NavigationState) =>
      apiFetch("/_agent-native/application-state/navigation", {
        method: "PUT",
        keepalive: true,
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

  // One-shot command: agent writes navigate, UI reads and deletes it
  const command = useQuery<NavigationState | null>({
    queryKey: ["navigate-command"],
    queryFn: async () => {
      const result = await apiFetch<NavigationState | undefined>(
        "/_agent-native/application-state/navigate",
      );
      if (result) {
        // Return with a timestamp to ensure uniqueness
        return { ...result, _ts: Date.now() } as NavigationState;
      }
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  const clearCommand = useCallback(() => {
    // Delete the one-shot command AFTER reading it
    apiFetch("/_agent-native/application-state/navigate", {
      method: "DELETE",
    }).catch(() => {});
    qc.setQueryData(["navigate-command"], null);
  }, [qc]);

  return {
    sync,
    command: { data: command.data },
    clearCommand,
  };
}
