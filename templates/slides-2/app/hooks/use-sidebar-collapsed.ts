import {
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { appStateKey } from "@shared/app-state-tabs";
import { appStorageKey } from "@shared/app-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { TAB_ID } from "@/lib/tab-id";

const KEY = appStateKey("sidebarCollapsed");
const QUERY_KEY = ["app-state", KEY] as const;
export const SIDEBAR_COLLAPSED_STORAGE_KEY = appStorageKey("sidebar-collapsed");

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
    // coercion-ok: app state remains authoritative when localStorage is unavailable.
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
    // coercion-ok: app state remains authoritative when localStorage is unavailable.
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
        const parsed = await readClientAppState<SidebarCollapsedState>(KEY);
        if (!parsed) return fallbackState();
        const state = { collapsed: Boolean(parsed.collapsed) };
        writeStoredCollapsed(state.collapsed);
        return state;
      } catch {
        return fallbackState();
      }
    },
    staleTime: 0,
  });

  const collapsed = data?.collapsed ?? false;

  const setCollapsed = useCallback(
    async (next: boolean | ((prev: boolean) => boolean)) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev =
        qc.getQueryData<SidebarCollapsedState>(QUERY_KEY)?.collapsed ??
        readStoredCollapsed()?.collapsed ??
        false;
      const nextVal = typeof next === "function" ? next(prev) : next;
      writeStoredCollapsed(nextVal);
      qc.setQueryData<SidebarCollapsedState>(QUERY_KEY, { collapsed: nextVal });
      void writeClientAppState(
        KEY,
        { collapsed: nextVal },
        { keepalive: true, requestSource: TAB_ID },
      ).catch(() => {
        void qc.invalidateQueries({ queryKey: QUERY_KEY });
      });
    },
    [qc],
  );

  return { collapsed, setCollapsed };
}
