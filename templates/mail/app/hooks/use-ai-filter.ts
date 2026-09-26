import {
  callAction,
  useActionQuery,
  useActionMutation,
  useChangeVersions,
} from "@agent-native/core/client/hooks";
import type {
  AiFilterDecision,
  AiFilterState,
  AiFilterTarget,
} from "@shared/ai-filter";
import type {
  AiFilterBackfillStatus,
  AiFilterBackfillStartResult,
  AiFilterBackfillUndoResult,
  ManageAiFilterBackfillInput,
} from "@shared/ai-filter-backfill";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LABELS_QUERY_KEY } from "@/hooks/use-emails";
import { invalidateInboxThreads } from "@/hooks/use-inbox-threads";

export function useAiFilter() {
  const changeVersion = useChangeVersions(["settings", "action"]);
  return useQuery<AiFilterState>({
    queryKey: ["ai-filter", changeVersion],
    queryFn: () => callAction("get-ai-filter", {}, { method: "GET" }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

type AiFilterSettingsPatch = Partial<
  Pick<
    AiFilterState,
    "enabled" | "autoFilter" | "autoFilterThreshold" | "suggestionThreshold"
  >
>;

export function useManageAiFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      mode: "filter" | "keep" | "settings";
      targets?: AiFilterTarget[];
      comment?: string;
      settings?: AiFilterSettingsPatch;
    }) => callAction("apply-ai-filter", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-filter"] });
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
      void queryClient.invalidateQueries({ queryKey: ["emails"] });
      void queryClient.invalidateQueries({ queryKey: LABELS_QUERY_KEY });
      void invalidateInboxThreads(queryClient);
    },
  });
}

export function usePreviewAiFilter() {
  return useActionMutation("preview-ai-filter", {
    skipActionQueryInvalidation: true,
    timeoutMs: 15_000,
  });
}

export function useManageAiFilterBackfill() {
  const queryClient = useQueryClient();
  return useActionMutation<
    | AiFilterBackfillStartResult
    | AiFilterBackfillUndoResult
    | AiFilterBackfillStatus,
    ManageAiFilterBackfillInput
  >("manage-ai-filter-backfill", {
    skipActionQueryInvalidation: true,
    timeoutMs: 15_000,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "manage-ai-filter-backfill"],
      });
    },
  });
}

export function useRecentAiFilterBackfills() {
  return useActionQuery<AiFilterBackfillStatus[]>(
    "manage-ai-filter-backfill",
    { operation: "recent" },
    {
      staleTime: 0,
      refetchInterval: (query) =>
        query.state.data?.some((run) =>
          ["queued", "running", "undoing"].includes(run.status),
        )
          ? 1_000
          : false,
    },
  );
}

export function useAiFilterBackfillStatus(runId: string | null) {
  return useActionQuery<AiFilterBackfillStatus>(
    "manage-ai-filter-backfill",
    { operation: "status", runId: runId ?? "" },
    {
      enabled: runId !== null,
      staleTime: 0,
      refetchInterval: (query) => {
        if (runId === null) return false;
        const status = query.state.data?.status;
        return status === "completed" ||
          status === "failed" ||
          status === "undone"
          ? false
          : 1_000;
      },
    },
  );
}

export function useRefineAiFilter() {
  const queryClient = useQueryClient();
  return useActionMutation("refine-ai-filter", {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
    timeoutMs: 20_000,
  });
}

export function latestAiFilterDecisions(
  state: AiFilterState | undefined,
): AiFilterDecision[] {
  return state ? [...state.decisions].reverse() : [];
}
