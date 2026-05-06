import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const KEY = "sidebarCollapsed";
const URL = `/_agent-native/application-state/${KEY}`;
const QUERY_KEY = ["app-state", KEY] as const;
export const SIDEBAR_COLLAPSED_STORAGE_KEY =
  "agent-native-slides-sidebar-collapsed";

interface SidebarCollapsedState {
  collapsed: boolean;
}

function readStoredCollapsed(): SidebarCollapsedState | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (stored === "true") return { collapsed: true };
    if (stored === "false") return { collapsed: false };
  } catch {
    // localStorage is best-effort; application-state remains the source of truth.
  }

  return undefined;
}

function writeStoredCollapsed(collapsed: boolean) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      String(collapsed),
    );
  } catch {
    // localStorage is best-effort; application-state remains the source of truth.
  }
}

function fallbackState(): SidebarCollapsedState {
  return readStoredCollapsed() ?? { collapsed: false };
}

export function useSidebarCollapsed() {
  const qc = useQueryClient();

  const { data } = useQuery<SidebarCollapsedState>({
    queryKey: QUERY_KEY,
    initialData: readStoredCollapsed,
    queryFn: async () => {
      try {
        const res = await fetch(URL);
        if (!res.ok) return fallbackState();
        const text = await res.text();
        if (!text) return fallbackState();
        try {
          const parsed = JSON.parse(text);
          const state = { collapsed: Boolean(parsed?.collapsed) };
          writeStoredCollapsed(state.collapsed);
          return state;
        } catch {
          return fallbackState();
        }
      } catch {
        return fallbackState();
      }
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const collapsed = data?.collapsed ?? false;

  const setCollapsed = useCallback(
    async (next: boolean | ((prev: boolean) => boolean)) => {
      // Cancel any in-flight poll so its response can't overwrite the
      // optimistic update we're about to commit (otherwise the UI snaps back
      // when a stale 2s poll lands after the click).
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev =
        qc.getQueryData<SidebarCollapsedState>(QUERY_KEY)?.collapsed ??
        readStoredCollapsed()?.collapsed ??
        false;
      const nextVal = typeof next === "function" ? next(prev) : next;
      writeStoredCollapsed(nextVal);
      qc.setQueryData<SidebarCollapsedState>(QUERY_KEY, { collapsed: nextVal });
      fetch(URL, {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collapsed: nextVal }),
      }).catch(() => {
        qc.invalidateQueries({ queryKey: QUERY_KEY });
      });
    },
    [qc],
  );

  return { collapsed, setCollapsed };
}
