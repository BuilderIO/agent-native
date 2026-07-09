import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

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
    },
  });
}
