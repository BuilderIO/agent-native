import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

export interface AnalysisRevision {
  id: string;
  analysisId: string;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string | null;
}

export function useAnalysisRevisions(analysisId: string | null) {
  return useActionQuery<AnalysisRevision[]>(
    "list-analysis-revisions",
    analysisId ? { analysisId } : undefined,
    {
      enabled: !!analysisId,
      select: (data: any) => {
        const revisions = data?.revisions ?? data;
        return Array.isArray(revisions) ? revisions : [];
      },
      placeholderData: (prev: any) => prev,
    } as any,
  );
}

export function useRestoreAnalysisRevision(analysisId: string) {
  const queryClient = useQueryClient();
  return useActionMutation<
    { id: string; name: string; updatedAt: string },
    { analysisId: string; revisionId: string }
  >("restore-analysis-revision", {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-analysis-revisions", { analysisId }],
      });
      queryClient.invalidateQueries({
        queryKey: ["analysis-detail", analysisId],
      });
    },
  });
}
