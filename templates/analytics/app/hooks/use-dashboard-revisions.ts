import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

import { sqlDashboardPrefetchKey } from "@/lib/prefetch-keys";

export interface DashboardRevision {
  id: string;
  dashboardId: string;
  kind: "explorer" | "sql";
  title: string;
  createdAt: string;
  createdBy: string | null;
}

export function useDashboardRevisions(dashboardId: string | null) {
  return useActionQuery<DashboardRevision[]>(
    "list-dashboard-revisions",
    dashboardId ? { dashboardId } : undefined,
    {
      enabled: !!dashboardId,
      select: (data: any) => {
        const revisions = data?.revisions ?? data;
        return Array.isArray(revisions) ? revisions : [];
      },
      placeholderData: (prev: any) => prev,
      retry: false,
    } as any,
  );
}

export function useRestoreDashboardRevision(dashboardId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    { id: string; name: string; updatedAt: string },
    { dashboardId: string; revisionId: string }
  >("restore-dashboard-revision", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-dashboard-revisions", { dashboardId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard", dashboardId],
      });
      queryClient.invalidateQueries({
        queryKey: ["data", "sql-dashboard", dashboardId],
      });
      queryClient.removeQueries({
        queryKey: sqlDashboardPrefetchKey(dashboardId),
      });
      queryClient.invalidateQueries({
        queryKey: ["sql-dashboards-sidebar"],
      });
      queryClient.invalidateQueries({
        queryKey: ["sql-dashboards-palette"],
      });
    },
  });
}
