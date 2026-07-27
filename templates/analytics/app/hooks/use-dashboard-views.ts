import { callAction } from "@agent-native/core/client/hooks";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DashboardView {
  id: string;
  name: string;
  filters: Record<string, string>;
  createdBy?: string;
  createdAt?: string;
}

async function loadViews(dashboardId: string): Promise<DashboardView[]> {
  const data = await callAction(
    "list-dashboard-views",
    { dashboardId },
    { method: "GET" },
  );
  return (data?.views ?? []) as DashboardView[];
}

export function useDashboardViews(dashboardId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["dashboard-views", dashboardId];

  const viewsQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<DashboardView[]> => {
      if (!dashboardId) return [];
      return await loadViews(dashboardId);
    },
    enabled: !!dashboardId,
    staleTime: 30_000,
  });
  const views = viewsQuery.data ?? [];

  const { mutateAsync: saveView } = useMutation({
    mutationFn: async (view: DashboardView) => {
      if (!dashboardId) return;
      await callAction("save-dashboard-view", {
        dashboardId,
        id: view.id,
        name: view.name,
        filters: view.filters,
      });
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
      await callAction(
        "delete-dashboard-view",
        { dashboardId, viewId },
        { method: "DELETE" },
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["all-dashboard-views"] });
    },
  });

  return {
    views,
    isLoading: viewsQuery.isLoading,
    error: viewsQuery.error,
    refetch: viewsQuery.refetch,
    saveView,
    deleteView,
  };
}

/**
 * Standalone delete mutation — lets sidebar rows call delete without
 * subscribing to the per-dashboard views query (which would double-fetch
 * what `useAllDashboardViews` already loads).
 */
export function useDeleteDashboardView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      dashboardId,
      viewId,
    }: {
      dashboardId: string;
      viewId: string;
    }) => {
      await callAction(
        "delete-dashboard-view",
        { dashboardId, viewId },
        { method: "DELETE" },
      );
    },
    onSettled: (_data, _err, { dashboardId }) => {
      queryClient.invalidateQueries({
        queryKey: ["dashboard-views", dashboardId],
      });
      queryClient.invalidateQueries({ queryKey: ["all-dashboard-views"] });
    },
  });
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
          results[id] = await loadViews(id);
        }),
      );
      return results;
    },
    staleTime: 30_000,
  });
}
