import {
  callAction,
  useSession,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { dashboardCacheScope } from "@/lib/prefetch-keys";

export interface DashboardRevision {
  id: string;
  dashboardId: string;
  kind: "explorer" | "sql";
  title: string;
  createdAt: string;
  createdBy: string | null;
}

export function useDashboardRevisions(dashboardId: string | null) {
  const { session } = useSession();
  const scope = dashboardCacheScope(session);
  return useQuery({
    queryKey: ["dashboard-revisions", dashboardId, scope],
    enabled: !!dashboardId,
    queryFn: async () => {
      if (!dashboardId) return [];
      const data = await callAction(
        "list-dashboard-revisions",
        { dashboardId },
        { method: "GET" },
      );
      const revisions =
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        "revisions" in data
          ? (data as { revisions?: unknown }).revisions
          : undefined;
      const rows = revisions ?? data;
      return (Array.isArray(rows) ? rows : []) as DashboardRevision[];
    },
  });
}

export function useRestoreDashboardRevision(dashboardId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    {
      id: string;
      name: string;
      updatedAt: string;
      snapshotRevisionId: string;
    },
    {
      dashboardId: string;
      revisionId: string;
      expectedUpdatedAt?: string;
    }
  >("restore-dashboard-revision", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["dashboard-revisions", dashboardId],
      });
      queryClient.invalidateQueries({
        queryKey: ["dashboard", dashboardId],
      });
      queryClient.invalidateQueries({
        queryKey: ["data", "sql-dashboard", dashboardId],
      });
    },
  });
}
