import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const KEY = "sidebarCollapsed";
const URL = `/_agent-native/application-state/${KEY}`;
const QUERY_KEY = ["app-state", KEY] as const;

interface SidebarCollapsedState {
  collapsed: boolean;
}

export function useSidebarCollapsed() {
  const qc = useQueryClient();

  const { data } = useQuery<SidebarCollapsedState>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(URL);
      if (!res.ok) return { collapsed: false };
      const text = await res.text();
      if (!text) return { collapsed: false };
      try {
        const parsed = JSON.parse(text);
        return { collapsed: Boolean(parsed?.collapsed) };
      } catch {
        return { collapsed: false };
      }
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const collapsed = data?.collapsed ?? false;

  const setCollapsed = useCallback(
    (next: boolean) => {
      qc.setQueryData<SidebarCollapsedState>(QUERY_KEY, { collapsed: next });
      fetch(URL, {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collapsed: next }),
      }).catch(() => {
        qc.invalidateQueries({ queryKey: QUERY_KEY });
      });
    },
    [qc],
  );

  return { collapsed, setCollapsed };
}
