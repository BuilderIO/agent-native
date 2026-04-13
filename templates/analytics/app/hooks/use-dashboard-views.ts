import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getIdToken } from "@/lib/auth";

export interface DashboardView {
  id: string;
  name: string;
  filters: Record<string, string>;
  createdBy?: string;
  createdAt?: string;
}

async function fetchWithAuth(url: string, options?: RequestInit) {
  const token = await getIdToken();
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  });
}

export function useDashboardViews(dashboardId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["dashboard-views", dashboardId];

  const { data: views = [], isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<DashboardView[]> => {
      if (!dashboardId) return [];
      const res = await fetchWithAuth(
        `/api/dashboard-views/${encodeURIComponent(dashboardId)}`,
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.views ?? [];
    },
    enabled: !!dashboardId,
    staleTime: 30_000,
  });

  const { mutateAsync: saveView } = useMutation({
    mutationFn: async (view: DashboardView) => {
      if (!dashboardId) return;
      await fetchWithAuth(
        `/api/dashboard-views/${encodeURIComponent(dashboardId)}`,
        {
          method: "POST",
          body: JSON.stringify(view),
        },
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
      // Also invalidate the sidebar views query
      queryClient.invalidateQueries({ queryKey: ["all-dashboard-views"] });
    },
  });

  const { mutateAsync: deleteView } = useMutation({
    mutationFn: async (viewId: string) => {
      if (!dashboardId) return;
      await fetchWithAuth(
        `/api/dashboard-views/${encodeURIComponent(dashboardId)}/${encodeURIComponent(viewId)}`,
        { method: "DELETE" },
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["all-dashboard-views"] });
    },
  });

  return { views, isLoading, saveView, deleteView };
}

/**
 * Fetch views for all dashboards at once (for sidebar).
 * Returns a map of dashboardId -> DashboardView[].
 */
export function useAllDashboardViews(dashboardIds: string[]) {
  return useQuery({
    queryKey: ["all-dashboard-views", dashboardIds.join(",")],
    queryFn: async (): Promise<Record<string, DashboardView[]>> => {
      const results: Record<string, DashboardView[]> = {};
      await Promise.all(
        dashboardIds.map(async (id) => {
          const res = await fetchWithAuth(
            `/api/dashboard-views/${encodeURIComponent(id)}`,
          );
          if (res.ok) {
            const data = await res.json();
            results[id] = data.views ?? [];
          }
        }),
      );
      return results;
    },
    staleTime: 30_000,
  });
}
